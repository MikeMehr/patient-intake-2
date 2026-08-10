#!/usr/bin/env python3
"""
MyMD inbox mirror for OSCAR.

Pulls the info@mymdonline.ca mailbox over IMAP into oscar_db so inbound patient email is
visible inside OSCAR, linked to the chart, and threadable against the outbound log that
mymd/emailPatient.jsp already writes.

Deployed to /usr/local/bin/mymd_mail_sync.py on the live OSCAR box and run by systemd as
mymd-mail-sync.timer (oneshot, every 2 minutes). This copy is kept in the repo because the
box holds no other record of it.

THE ONE RULE: this is a READ-ONLY IMAP client. It opens folders with EXAMINE and fetches
with BODY.PEEK[], so no message ever gets flagged \\Seen. A cPanel cron on the GoDaddy side
texts a new-mail alert and decides "unread" from the absence of S in the Maildir filename
flags - if this script marked mail as read, that alert would silently stop firing and no
one would find out. Read/handled state lives in mymd_inbox_message.status instead and is
never written back to IMAP.

Runs as the `tomcat` user. That is deliberate: tomcat already owns the SMTP credentials in
mymd_mail.properties and the DB credentials in oscar_mcmaster.properties, so no secret has
to be copied into a second file, and attachments written here are readable by the JSP
without any chown dance.

Usage:
  mymd_mail_sync.py                 # incremental sync of every configured folder
  mymd_mail_sync.py --dry-run       # parse and report, write nothing
  mymd_mail_sync.py --full          # rescan whole folders, ignoring the saved UID cursor
  mymd_mail_sync.py --folder INBOX  # limit to one folder
  mymd_mail_sync.py -v              # per-message detail
"""

import argparse
import email.utils
import hashlib
import html as htmlmod
import imaplib
import logging
import os
import re
import sys
from datetime import datetime
from email import policy
from email.parser import BytesParser

import mysql.connector

CONF_FILE = "/etc/mymd/mail-sync.conf"

DEFAULTS = {
    "mail.properties": "/var/lib/OscarDocument/oscar/mymd_mail.properties",
    "oscar.properties": "/opt/tomcat9/webapps/oscar/WEB-INF/classes/oscar_mcmaster.properties",
    "imap.host": "",  # falls back to mail.host from mymd_mail.properties
    "imap.port": "993",
    "imap.timeout": "30",
    # INBOX.Sent is mirrored too so replies sent straight from Roundcube still show up in the
    # chart thread. The IMAP hierarchy delimiter on this server is "." - see the folder list
    # in docs/oscar/inbox-install.md.
    "folders": "INBOX,INBOX.Sent",
    "outbound.folders": "INBOX.Sent",
    "storage.root": "/var/lib/OscarDocument/oscar/mymd_inbox",
    "db.host": "127.0.0.1",
    "db.port": "3306",
    "db.name": "oscar_db",
    "max.attachment.bytes": str(25 * 1024 * 1024),
    "max.run.attachment.bytes": str(200 * 1024 * 1024),
    # Consecutive auth failures after which the poller refuses to connect at all.
    "auth.failure.limit": "3",
}

# Column widths from mymd_inbox.sql. This server runs WITHOUT strict mode
# (sql_mode=NO_ENGINE_SUBSTITUTION), so an over-long value is silently truncated by MySQL
# rather than rejected. Capping here makes every truncation a deliberate, visible decision.
CAPS = {
    "message_id": 255,
    "in_reply_to": 255,
    "from_email": 320,
    "from_name": 255,
    "subject": 998,
    "filename": 255,
    "content_type": 100,
    "stored_path": 500,
    "raw_path": 255,
    "parse_error": 255,
    "spam_score": 64,
    "last_error": 500,
}

# body_text over this is truncated; the UI links to the stored .eml for the rest.
MAX_BODY_TEXT = 256 * 1024

logger = logging.getLogger("mymd-mail-sync")


# ---------------------------------------------------------------------------------------
# config
# ---------------------------------------------------------------------------------------

def load_props(path):
    """Parse a java.util.Properties-style file. Missing file returns {}."""
    props = {}
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or line.startswith("!") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                props[key.strip()] = value.strip()
    except OSError as exc:
        logger.debug("cannot read %s: %s", path, exc)
    return props


def load_config():
    cfg = dict(DEFAULTS)
    cfg.update(load_props(CONF_FILE))
    return cfg


def truncate(value, key):
    if value is None:
        return None
    cap = CAPS.get(key)
    return value[:cap] if cap and len(value) > cap else value


# ---------------------------------------------------------------------------------------
# parsing
# ---------------------------------------------------------------------------------------

_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_RE = re.compile(r"<(script|style)\b.*?</\1>", re.IGNORECASE | re.DOTALL)
_BLANKS_RE = re.compile(r"\n{3,}")


def html_to_text(html):
    """
    Crude but safe HTML -> text, so body_text is always populated and the UI never has to
    render attacker-supplied markup just to show what a message says.
    """
    if not html:
        return ""
    text = _SCRIPT_RE.sub(" ", html)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</(p|div|tr|li|h[1-6])>", "\n", text, flags=re.IGNORECASE)
    text = _TAG_RE.sub("", text)
    text = htmlmod.unescape(text)
    text = "\n".join(line.rstrip() for line in text.splitlines())
    return _BLANKS_RE.sub("\n\n", text).strip()


def header_str(msg, name):
    """str() a header defensively - malformed headers raise rather than degrade."""
    try:
        value = msg.get(name)
        return str(value).strip() if value is not None else None
    except Exception:  # noqa: BLE001 - one bad header must not lose the message
        return None


def first_address(msg, name):
    """(email, display_name) of the first address in a header, or (None, None)."""
    try:
        hdr = msg.get(name)
        if hdr is None:
            return None, None
        for addr in getattr(hdr, "addresses", ()):
            if addr.addr_spec:
                return addr.addr_spec.lower(), (addr.display_name or None)
    except Exception:  # noqa: BLE001
        pass
    # Fall back to the raw header when the structured parse fails.
    raw = header_str(msg, name)
    if raw:
        name_part, addr_part = email.utils.parseaddr(raw)
        if addr_part:
            return addr_part.lower(), (name_part or None)
    return None, None


def all_addresses(msg, name):
    try:
        hdr = msg.get(name)
        if hdr is None:
            return None
        addrs = [a.addr_spec for a in getattr(hdr, "addresses", ()) if a.addr_spec]
        return ", ".join(addrs) if addrs else header_str(msg, name)
    except Exception:  # noqa: BLE001
        return header_str(msg, name)


def parse_date(msg):
    """Date: header as a naive local datetime MySQL will accept, or None."""
    try:
        hdr = msg.get("Date")
        dt = getattr(hdr, "datetime", None)
        if dt is None:
            raw = header_str(msg, "Date")
            dt = email.utils.parsedate_to_datetime(raw) if raw else None
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        # MySQL DATETIME cannot hold year 0 or absurd futures that show up in spam.
        if not (1970 <= dt.year <= 2100):
            return None
        return dt
    except Exception:  # noqa: BLE001
        return None


def part_text(part):
    """Decoded text of a body part, tolerating a wrong or unknown charset."""
    try:
        return part.get_content()
    except Exception:  # noqa: BLE001
        try:
            raw = part.get_payload(decode=True) or b""
            return raw.decode(part.get_content_charset() or "utf-8", "replace")
        except Exception:  # noqa: BLE001
            return ""


def classify(msg):
    """
    NORMAL | BULK | AUTOREPLY | BOUNCE.

    info@ is a public address on a public website, so the unassigned queue will fill with
    newsletters and vendor mail unless they can be filtered out of the default view. An
    unassigned queue nobody reads defeats the whole feature. Nothing is ever auto-deleted -
    this only drives which tab a message lands in.
    """
    try:
        auto_submitted = (header_str(msg, "Auto-Submitted") or "").lower()
        precedence = (header_str(msg, "Precedence") or "").lower()
        return_path = (header_str(msg, "Return-Path") or "").strip()

        if return_path in ("<>", ""):
            if header_str(msg, "Content-Type") and "report" in (
                    header_str(msg, "Content-Type") or "").lower():
                return "BOUNCE"
        if auto_submitted and auto_submitted != "no":
            return "AUTOREPLY"
        if header_str(msg, "X-Autoreply") or header_str(msg, "X-Autorespond"):
            return "AUTOREPLY"
        if precedence in ("bulk", "list", "junk") or header_str(msg, "List-Unsubscribe"):
            return "BULK"
    except Exception:  # noqa: BLE001
        pass
    return "NORMAL"


def parse_message(raw_bytes):
    """Raw RFC822 bytes -> a dict of the columns in mymd_inbox_message, plus attachments."""
    msg = BytesParser(policy=policy.default).parsebytes(raw_bytes)

    from_email, from_name = first_address(msg, "From")
    plain_part = None
    html_part = None
    try:
        plain_part = msg.get_body(preferencelist=("plain",))
        html_part = msg.get_body(preferencelist=("html",))
    except Exception:  # noqa: BLE001
        pass

    body_text = part_text(plain_part) if plain_part is not None else ""
    body_html = part_text(html_part) if html_part is not None else None
    if not body_text.strip() and body_html:
        body_text = html_to_text(body_html)
    if not body_text.strip() and not msg.is_multipart():
        body_text = part_text(msg)

    attachments = []
    try:
        for part in msg.iter_attachments():
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            attachments.append({
                "filename": part.get_filename(),
                "content_type": part.get_content_type(),
                "data": payload,
            })
    except Exception as exc:  # noqa: BLE001
        logger.warning("attachment walk failed: %s", exc)

    if body_text and len(body_text) > MAX_BODY_TEXT:
        body_text = body_text[:MAX_BODY_TEXT] + "\n\n[... truncated - open the original .eml ...]"

    return {
        "message_id": truncate(header_str(msg, "Message-ID"), "message_id"),
        "in_reply_to": truncate(header_str(msg, "In-Reply-To"), "in_reply_to"),
        "thread_refs": header_str(msg, "References"),
        "from_email": truncate(from_email or "", "from_email"),
        "from_name": truncate(from_name, "from_name"),
        "to_emails": all_addresses(msg, "To"),
        "cc_emails": all_addresses(msg, "Cc"),
        "subject": truncate(header_str(msg, "Subject"), "subject"),
        "body_text": body_text,
        "body_html": body_html,
        "sent_datetime": parse_date(msg),
        "auto_kind": classify(msg),
        "spam_score": truncate(
            header_str(msg, "X-Spam-Status") or header_str(msg, "X-Spam-Score"), "spam_score"),
        "parse_error": None,
        "attachments": attachments,
    }


def unparseable_message(exc):
    """
    A stub row for a message the parser choked on.

    The row still gets written, with parse_error set and the raw .eml on disk, so the UID
    cursor advances past it. Refusing to advance is the classic mail-sync failure mode: one
    malformed message and the mirror silently stops forever.
    """
    return {
        "message_id": None, "in_reply_to": None, "thread_refs": None,
        "from_email": "", "from_name": None, "to_emails": None, "cc_emails": None,
        "subject": "(unreadable message)", "body_text": None, "body_html": None,
        "sent_datetime": None, "auto_kind": "NORMAL", "spam_score": None,
        "parse_error": truncate("%s: %s" % (type(exc).__name__, exc), "parse_error"),
        "attachments": [],
    }


# ---------------------------------------------------------------------------------------
# storage
# ---------------------------------------------------------------------------------------

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(raw, index):
    name = (raw or "").strip()
    # Strip any path a sender may have embedded, the same guard emailPatient.jsp applies.
    name = name.replace("\\", "/").split("/")[-1]
    name = _SAFE_NAME_RE.sub("_", name).strip("._-")
    if not name:
        name = "part-%d" % index
    return name[:120]


def store_blob(storage_root, rel_path, data, dry_run):
    """Write bytes at rel_path under storage_root, atomically, 0640 tomcat:tomcat."""
    if dry_run:
        return rel_path
    abs_path = os.path.join(storage_root, rel_path)
    os.makedirs(os.path.dirname(abs_path), mode=0o750, exist_ok=True)
    # Write to a temp name and rename, so a crash mid-write cannot leave a half file that
    # looks complete to the JSP.
    tmp_path = abs_path + ".part"
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    os.replace(tmp_path, abs_path)
    return rel_path


def store_raw(storage_root, msg_row_id, raw_bytes, dry_run):
    """
    Keep the full .eml. It is the source of truth: it survives a Roundcube delete, and it
    lets a later phase re-parse a message without going back to IMAP.
    """
    now = datetime.now()
    rel_path = os.path.join("%04d" % now.year, "%02d" % now.month, "%d.eml" % msg_row_id)
    return store_blob(storage_root, rel_path, raw_bytes, dry_run)


def store_attachment(storage_root, msg_row_id, index, filename, data, dry_run):
    """
    Write one attachment under storage_root/YYYY/MM/. Returns the path relative to
    storage_root so the DB never holds an absolute path the JSP could be tricked into
    following somewhere else.
    """
    now = datetime.now()
    rel_path = os.path.join("%04d" % now.year, "%02d" % now.month,
                            "%d-%d-%s" % (msg_row_id, index, filename))
    # Written by tomcat, so the JSP that streams it can read it. The SRFax lesson was that a
    # file Tomcat cannot open reads as a broken feature rather than a permissions problem.
    return store_blob(storage_root, rel_path, data, dry_run)


# ---------------------------------------------------------------------------------------
# database
# ---------------------------------------------------------------------------------------

def connect_db(cfg):
    oscar_props = load_props(cfg["oscar.properties"])
    user = oscar_props.get("db_username")
    password = oscar_props.get("db_password")
    if not user or password is None:
        raise RuntimeError(
            "db_username/db_password not readable from %s - is this running as tomcat?"
            % cfg["oscar.properties"])
    return mysql.connector.connect(
        host=cfg["db.host"], port=int(cfg["db.port"]), user=user, password=password,
        database=cfg["db.name"], connection_timeout=10, use_pure=True, ssl_disabled=True,
        charset="utf8mb4", collation="utf8mb4_general_ci",
    )


def match_demographic(db, address):
    """
    (demographic_no, match_method, match_count) for an address.

    Links only when exactly one living patient owns the address. Shared addresses are normal
    here rather than a data-quality bug - families use one inbox, and the clinic's own test
    address sits on nine charts - so "many matches" falls through to manual assignment.
    match_count is returned so the UI can say "3 charts share this address" and offer them as
    one-click options, instead of showing a bare "unassigned" with no explanation.

    The address is lowercased in Python and bound as a parameter, which sidesteps the
    collation mix (demographic.email is utf8mb3_general_ci, these tables are utf8mb4).
    """
    if not address:
        return None, None, 0
    cur = db.cursor()
    try:
        cur.execute(
            "SELECT demographic_no FROM demographic "
            "WHERE email IS NOT NULL AND LOWER(TRIM(email)) = %s "
            "  AND (patient_status IS NULL OR patient_status <> 'DE')",
            (address.strip().lower(),))
        rows = cur.fetchall()
        if len(rows) == 1:
            return rows[0][0], "EMAIL", 1
        return None, None, len(rows)
    finally:
        cur.close()


def message_id_seen(db, account, message_id, direction):
    """
    Has this exact Message-ID already been mirrored for this account and direction?

    The UID unique key alone is not enough: if the server ever changes UIDVALIDITY, every UID
    is renumbered and a full rescan would re-insert everything. This second check makes that
    rescan idempotent. Messages with no Message-ID (common in spam) fall back to the UID key.
    """
    if not message_id:
        return None
    cur = db.cursor()
    try:
        cur.execute(
            "SELECT id FROM mymd_inbox_message "
            "WHERE account=%s AND message_id=%s AND direction=%s LIMIT 1",
            (account, message_id, direction))
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        cur.close()


def message_exists(db, account, folder, uid_validity, uid):
    cur = db.cursor()
    try:
        cur.execute(
            "SELECT id FROM mymd_inbox_message "
            "WHERE account=%s AND folder=%s AND uid_validity=%s AND imap_uid=%s",
            (account, folder, uid_validity, uid))
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        cur.close()


def insert_message(db, account, folder, direction, uid_validity, uid, parsed, demographic_no,
                   match_method, match_count, has_attachments):
    cur = db.cursor()
    try:
        cur.execute(
            "INSERT INTO mymd_inbox_message "
            "(account, folder, direction, uid_validity, imap_uid, message_id, in_reply_to, "
            " thread_refs, from_email, from_name, to_emails, cc_emails, subject, body_text, "
            " body_html, has_attachments, parse_error, auto_kind, spam_score, sent_datetime, "
            " received_at, demographic_no, match_count, match_method, status) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'NEW')",
            (account, folder, direction, uid_validity, uid, parsed["message_id"],
             parsed["in_reply_to"], parsed["thread_refs"], parsed["from_email"],
             parsed["from_name"], parsed["to_emails"], parsed["cc_emails"], parsed["subject"],
             parsed["body_text"], parsed["body_html"], 1 if has_attachments else 0,
             parsed["parse_error"], parsed["auto_kind"], parsed["spam_score"],
             parsed["sent_datetime"], datetime.now(), demographic_no, match_count, match_method))
        return cur.lastrowid
    finally:
        cur.close()


def set_raw_path(db, msg_row_id, rel_path):
    cur = db.cursor()
    try:
        cur.execute("UPDATE mymd_inbox_message SET raw_path=%s WHERE id=%s",
                    (truncate(rel_path, "raw_path"), msg_row_id))
    finally:
        cur.close()


def insert_attachment(db, msg_row_id, filename, content_type, size_bytes, rel_path, sha256):
    cur = db.cursor()
    try:
        cur.execute(
            "INSERT INTO mymd_inbox_attachment "
            "(message_id_fk, filename, content_type, size_bytes, stored_path, sha256) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (msg_row_id, truncate(filename, "filename"), truncate(content_type, "content_type"),
             size_bytes, truncate(rel_path, "stored_path"), sha256))
    finally:
        cur.close()


def load_sync_state(db, account, folder):
    """(uid_validity, last_uid, consecutive_errors, last_error_kind)."""
    cur = db.cursor()
    try:
        cur.execute(
            "SELECT uid_validity, last_uid, consecutive_errors, last_error_kind "
            "FROM mymd_inbox_sync_state WHERE account=%s AND folder=%s", (account, folder))
        row = cur.fetchone()
        return (row[0], row[1], row[2], row[3]) if row else (0, 0, 0, None)
    finally:
        cur.close()


def save_sync_ok(db, account, folder, uid_validity, last_uid):
    now = datetime.now()
    cur = db.cursor()
    try:
        cur.execute(
            "INSERT INTO mymd_inbox_sync_state "
            "(account, folder, uid_validity, last_uid, last_run_at, last_ok_at, last_status, "
            " last_error, consecutive_errors, last_error_kind) "
            "VALUES (%s,%s,%s,%s,%s,%s,'OK',NULL,0,NULL) "
            "ON DUPLICATE KEY UPDATE uid_validity=VALUES(uid_validity), "
            " last_uid=VALUES(last_uid), last_run_at=VALUES(last_run_at), "
            " last_ok_at=VALUES(last_ok_at), last_status='OK', last_error=NULL, "
            " consecutive_errors=0, last_error_kind=NULL",
            (account, folder, uid_validity, last_uid, now, now))
    finally:
        cur.close()


def save_sync_error(db, account, folder, error, kind):
    """Record a failure and bump the consecutive counter without disturbing the UID cursor."""
    cur = db.cursor()
    try:
        cur.execute(
            "INSERT INTO mymd_inbox_sync_state "
            "(account, folder, last_run_at, last_status, last_error, consecutive_errors, "
            " last_error_kind) VALUES (%s,%s,%s,'ERROR',%s,1,%s) "
            "ON DUPLICATE KEY UPDATE last_run_at=VALUES(last_run_at), last_status='ERROR', "
            " last_error=VALUES(last_error), "
            " consecutive_errors=consecutive_errors+1, last_error_kind=VALUES(last_error_kind)",
            (account, folder, datetime.now(), truncate(str(error), "last_error"), kind))
    finally:
        cur.close()


# ---------------------------------------------------------------------------------------
# sync
# ---------------------------------------------------------------------------------------

def sync_folder(imap, db, cfg, account, folder, args):
    """Mirror one folder. Returns (new_messages, skipped)."""
    outbound = folder in [f.strip() for f in cfg["outbound.folders"].split(",") if f.strip()]
    direction = "OUT" if outbound else "IN"
    storage_root = cfg["storage.root"]
    max_attach = int(cfg["max.attachment.bytes"])
    max_run = int(cfg["max.run.attachment.bytes"])

    # EXAMINE, not SELECT. This is what keeps \Seen untouched.
    typ, _ = imap.select(folder, readonly=True)
    if typ != "OK":
        raise RuntimeError("cannot EXAMINE %s" % folder)

    typ, data = imap.status(folder, "(UIDVALIDITY)")
    if typ != "OK" or not data:
        raise RuntimeError("cannot read UIDVALIDITY for %s" % folder)
    m = re.search(r"UIDVALIDITY\s+(\d+)", data[0].decode("utf-8", "replace"))
    uid_validity = int(m.group(1)) if m else 0

    saved_validity, last_uid, _errs, _kind = load_sync_state(db, account, folder)
    if args.full or saved_validity != uid_validity:
        # Either asked for a rescan, or the server renumbered the folder and every saved UID
        # is meaningless. Walk the whole folder; the per-message existence check absorbs the
        # overlap without duplicating rows.
        if saved_validity and saved_validity != uid_validity:
            logger.warning("%s UIDVALIDITY changed %s -> %s, rescanning whole folder",
                           folder, saved_validity, uid_validity)
        search_range = "1:*"
        last_uid = 0
    else:
        search_range = "%d:*" % (last_uid + 1)

    typ, data = imap.uid("SEARCH", None, "UID", search_range)
    uids = [int(u) for u in data[0].split()] if typ == "OK" and data and data[0] else []
    # "N:*" always returns at least the highest UID even when nothing is new.
    uids = sorted(u for u in uids if u > last_uid)
    logger.info("%s: %d candidate message(s) (uidvalidity=%d, from uid %d)",
                folder, len(uids), uid_validity, last_uid + 1)

    new_count = 0
    skipped = 0
    run_attach_bytes = 0
    highest = last_uid

    for uid in uids:
        try:
            if message_exists(db, account, folder, uid_validity, uid):
                skipped += 1
                highest = max(highest, uid)
                continue

            # BODY.PEEK[], never BODY[] - the peek is what stops the server setting \Seen.
            typ, fetched = imap.uid("FETCH", str(uid), "(BODY.PEEK[])")
            if typ != "OK" or not fetched or not isinstance(fetched[0], tuple):
                logger.warning("%s uid %d: fetch returned nothing usable", folder, uid)
                continue
            raw = fetched[0][1]

            try:
                parsed = parse_message(raw)
            except Exception as parse_exc:  # noqa: BLE001 - never wedge the folder
                logger.warning("%s uid %d: unparseable, storing stub (%s)",
                               folder, uid, type(parse_exc).__name__)
                parsed = unparseable_message(parse_exc)

            # A rescan after a UIDVALIDITY change would otherwise re-insert everything.
            if message_id_seen(db, account, parsed["message_id"], direction):
                skipped += 1
                highest = max(highest, uid)
                continue

            match_address = parsed["to_emails"] if outbound else parsed["from_email"]
            if outbound and match_address:
                match_address = match_address.split(",")[0].strip()
            demographic_no, match_method, match_count = match_demographic(db, match_address)

            if args.dry_run:
                # Subject and address are PHI-adjacent, so they only ever appear at DEBUG,
                # which means an interactive terminal - never journald. See the logging note
                # in main().
                logger.info("[dry-run] %s uid %d  demo=%s  candidates=%d  attach=%d  kind=%s",
                            folder, uid, demographic_no, match_count,
                            len(parsed["attachments"]), parsed["auto_kind"])
                logger.debug("[dry-run] %s uid %d  from=%s  subject=%s", folder, uid,
                             parsed["from_email"], parsed["subject"])
                new_count += 1
                highest = max(highest, uid)
                continue

            msg_row_id = insert_message(
                db, account, folder, direction, uid_validity, uid, parsed,
                demographic_no, match_method, match_count, bool(parsed["attachments"]))

            set_raw_path(db, msg_row_id, store_raw(storage_root, msg_row_id, raw, args.dry_run))

            for index, att in enumerate(parsed["attachments"], start=1):
                data_bytes = att["data"]
                size = len(data_bytes)
                filename = safe_filename(att["filename"], index)
                if size > max_attach or run_attach_bytes + size > max_run:
                    # Recorded with no stored_path rather than dropped, so the UI can say
                    # "attachment too large" instead of pretending it never existed.
                    logger.warning("%s uid %d: attachment %s (%d bytes) over cap, not stored",
                                   folder, uid, filename, size)
                    insert_attachment(db, msg_row_id, filename, att["content_type"], size,
                                      None, None)
                    continue
                rel_path = store_attachment(storage_root, msg_row_id, index, filename,
                                            data_bytes, args.dry_run)
                run_attach_bytes += size
                insert_attachment(db, msg_row_id, filename, att["content_type"], size,
                                  rel_path, hashlib.sha256(data_bytes).hexdigest())

            db.commit()
            new_count += 1
            highest = max(highest, uid)
            logger.info("%s uid %d -> row %d  demo=%s  candidates=%d  att=%d",
                        folder, uid, msg_row_id, demographic_no, match_count,
                        len(parsed["attachments"]))
            logger.debug("%s uid %d  from=%s  subject=%s", folder, uid,
                         parsed["from_email"], parsed["subject"])

        except Exception as exc:  # noqa: BLE001
            # A parse failure is already handled above with a stub row, so reaching here means
            # the database or the filesystem is unhappy. That is not per-message state, so
            # stop the folder rather than churning through every remaining UID, and leave the
            # cursor where it is so nothing is skipped on the next run.
            db.rollback()
            logger.exception("%s uid %d failed, stopping folder: %s", folder, uid, exc)
            break

    if not args.dry_run:
        save_sync_ok(db, account, folder, uid_validity, highest)
        db.commit()
    return new_count, skipped


def main():
    parser = argparse.ArgumentParser(description="Mirror the clinic mailbox into oscar_db.")
    parser.add_argument("--dry-run", action="store_true", help="parse and report, write nothing")
    parser.add_argument("--full", action="store_true", help="rescan folders from UID 1")
    parser.add_argument("--folder", action="append", help="limit to this folder (repeatable)")
    parser.add_argument("--reset-errors", action="store_true",
                        help="clear the consecutive-failure counter and try again")
    parser.add_argument("--imap-debug", action="store_true",
                        help="dump the full IMAP protocol trace. Proves the session is "
                             "read-only, but PRINTS MESSAGE BODIES - interactive use only, "
                             "never in the systemd unit.")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="include subjects and addresses in the log (interactive only)")
    args = parser.parse_args()

    # Logging discipline: journald on this box is readable by group `adm`, which is not
    # PHI-scoped. So INFO carries counts and identifiers only - never a subject, address or
    # body. Those need -v, which is for an interactive terminal.
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s", stream=sys.stdout)
    if args.imap_debug:
        imaplib.Debug = 4

    cfg = load_config()
    mail_props = load_props(cfg["mail.properties"])
    host = cfg["imap.host"] or mail_props.get("mail.host")
    user = mail_props.get("mail.user")
    password = mail_props.get("mail.password")
    if not (host and user and password):
        logger.error("IMAP credentials unavailable from %s - is this running as tomcat?",
                     cfg["mail.properties"])
        return 1

    folders = args.folder or [f.strip() for f in cfg["folders"].split(",") if f.strip()]

    if not args.dry_run:
        os.makedirs(cfg["storage.root"], mode=0o750, exist_ok=True)

    db = None
    imap = None
    exit_code = 0
    try:
        db = connect_db(cfg)

        if args.reset_errors:
            cur = db.cursor()
            cur.execute("UPDATE mymd_inbox_sync_state SET consecutive_errors=0, "
                        "last_error_kind=NULL WHERE account=%s", (user,))
            cur.close()
            db.commit()
            logger.info("consecutive error counters cleared")

        # cPHulk guard. GoDaddy throttles failed logins by source IP, so a poller retrying a
        # wrong password every couple of minutes would eventually ban the clinic's own IP from
        # its own webmail - taking Roundcube down along with the mirror. Refuse to even open
        # the socket until someone clears this with --reset-errors.
        limit = int(cfg["auth.failure.limit"])
        blocked = []
        for folder in folders:
            _v, _u, errs, kind = load_sync_state(db, user, folder)
            if kind == "AUTH" and errs >= limit:
                blocked.append(folder)
        if blocked and not args.dry_run:
            logger.error("refusing to connect: %d consecutive auth failure(s) on %s. "
                         "Fix mail.password, then run with --reset-errors.",
                         limit, ", ".join(blocked))
            return 2

        imap = imaplib.IMAP4_SSL(host, int(cfg["imap.port"]), timeout=int(cfg["imap.timeout"]))
        try:
            imap.login(user, password)
        except imaplib.IMAP4.error as auth_exc:
            logger.error("IMAP login rejected for %s", user)
            if db and not args.dry_run:
                for folder in folders:
                    save_sync_error(db, user, folder, auth_exc, "AUTH")
                db.commit()
            return 2
        logger.debug("connected to %s as %s", host, user)

        for folder in folders:
            try:
                new_count, skipped = sync_folder(imap, db, cfg, user, folder, args)
                logger.info("%s: %d new, %d already mirrored", folder, new_count, skipped)
            except Exception as exc:  # noqa: BLE001 - record and try the next folder
                logger.exception("%s failed: %s", folder, exc)
                exit_code = 1
                if db and not args.dry_run:
                    try:
                        db.rollback()
                        save_sync_error(db, user, folder, exc, "OTHER")
                        db.commit()
                    except Exception:  # noqa: BLE001
                        logger.exception("could not record sync error for %s", folder)
    except Exception as exc:  # noqa: BLE001
        logger.exception("sync aborted: %s", exc)
        exit_code = 1
    finally:
        if imap is not None:
            try:
                imap.logout()
            except Exception:  # noqa: BLE001
                pass
        if db is not None:
            try:
                db.close()
            except Exception:  # noqa: BLE001
                pass
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
