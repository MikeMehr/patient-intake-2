# Patient email inbox — install

Mirrors the `info@mymdonline.ca` mailbox into OSCAR so inbound patient email is visible in the
EMR, linked to the chart, and replyable through the compose window that already exists. No AI
is involved; this is the substrate a later AI phase would read.

Sources in `docs/oscar/inbox/`. Target is `oscar.mymdonline.ca` / `192.168.0.201`, webapp root
`/opt/tomcat9/webapps/oscar/`. A WAR redeploy wipes the webapp, which is why these copies exist.

## What it is

```
GoDaddy cPanel Dovecot (info@mymdonline.ca)
      │  IMAPS 993, READ-ONLY: EXAMINE + BODY.PEEK[], never a flag write
      ▼
mymd-mail-sync.timer  →  mymd_mail_sync.py   (systemd oneshot, User=tomcat, every 5 min)
      │  mysql.connector → 127.0.0.1:3306
      ▼
oscar_db: mymd_inbox_message / _attachment / _sync_state / _access_log
   attachments + .eml on disk under /var/lib/OscarDocument/oscar/mymd_inbox/
      ▲                                     ▲
mymd/inbox.jsp ──── Reply ────────► mymd/emailPatient.jsp
mymd/inboxAttachment.jsp                 (extended: reply prefill, In-Reply-To,
mymd/inboxHtml.jsp                        two-way conversation history)
```

No nginx change. `/mymd/*.jsp` already sits behind the mTLS device-cert gate on `location /`;
unlike the pharmacy bridge, nothing here needs an unauthenticated endpoint.

## The one rule

**The poller must never mark mail read.** A cPanel cron texts a new-mail alert and decides
"unread" from the absence of `S` in the Maildir filename flags. If OSCAR wrote `\Seen` back over
IMAP, those texts would silently stop and nobody would find out until a patient complained.

`mymd_mail_sync.py` opens folders with `EXAMINE` (`readonly=True`) and fetches with
`BODY.PEEK[]`. Verified on this server 2026-08-09: 30 messages fetched, the seen/unseen tally
was identical before and after. Caveat on that run — all 30 were already read, so it proved
"seen stays seen"; re-confirm against a genuinely unread message at step 6.

"Handled" in the OSCAR UI is a flag in `mymd_inbox_message.status` and is never written back.

## Verified server facts (2026-08-09)

| Fact | Value |
|---|---|
| IMAP host | `p3plzcpnl485506.prod.phx3.secureserver.net:993`, same host as SMTP. (`imap.secureserver.net` is a *different* GoDaddy platform — not this mailbox.) |
| Folders | delimiter `.` — `INBOX`, `INBOX.Archive`, `INBOX.spam`, `INBOX.Junk`, `INBOX.Trash`, `INBOX.Sent`, `INBOX.Drafts` |
| INBOX | 30 messages, `UIDVALIDITY 1782751735` |
| MySQL | 8.0.46. **No `ADD COLUMN IF NOT EXISTS`** (MariaDB only) — the ALTERs use an `information_schema` guard |
| `sql_mode` | `NO_ENGINE_SUBSTITUTION` — **no strict mode**, so over-long values truncate *silently*. Everything is capped in Python too |
| Collation | `oscar_db` defaults to utf8mb3; `demographic.email` is `utf8mb3_general_ci`; the `mymd_*` tables are `utf8mb4_0900_ai_ci`. Match addresses with a lowercased bound parameter |
| Timezone | `time_zone=SYSTEM` (America/Vancouver) and **`CONVERT_TZ` returns NULL** — tz tables never loaded. Convert in Python/Java only |
| Python | 3.12.3, `mysql.connector` 8.0.15 present. `imapclient` is absent and PEP 668 blocks `pip install` → stdlib `imaplib` |
| Demographics | 54 charts, 53 with an email, `patient_status` ∈ {`AC`,`DE`} |
| Shared addresses | 3 addresses are on >1 chart (`mehraein@yahoo.com` on 9). **Manual assign is the normal path, not the exception** |
| `tomcat` | uid 1001, no extra groups; `manucher` is **not** in group `tomcat` |

That last row is why the service runs as `User=tomcat`: tomcat already owns both secrets —
`mymd_mail.properties` (IMAP) and `oscar_mcmaster.properties` (database) — so **no credential is
copied into a second file**, and attachments it writes are Tomcat-readable without a chown.

## Install

Steps 1–4 are invisible to users. Nothing appears in OSCAR until step 7.

### 1. Schema

```bash
sudo mysql oscar_db -e 'source /home/manucher/mymd_inbox.sql'
```

Idempotent. Creates the four tables and adds `message_id` / `in_reply_to_id` to
`mymd_patient_email_log`. Verify:

```bash
sudo mysql oscar_db -e "SHOW TABLES LIKE 'mymd_inbox%'; SHOW COLUMNS FROM mymd_patient_email_log LIKE '%message_id%';"
```

### 2. Poller and config

```bash
sudo install -o root -g root -m 0755 /home/manucher/mymd_mail_sync.py /usr/local/bin/mymd_mail_sync.py
sudo mkdir -p /etc/mymd
sudo install -o root -g tomcat -m 0640 /home/manucher/mail-sync.conf /etc/mymd/mail-sync.conf
sudo mkdir -p /var/lib/OscarDocument/oscar/mymd_inbox
sudo chown tomcat:tomcat /var/lib/OscarDocument/oscar/mymd_inbox
sudo chmod 0750 /var/lib/OscarDocument/oscar/mymd_inbox
```

There are **no secrets in `mail-sync.conf`** by design.

### 3. Dry run — and prove the session is read-only

```bash
sudo -u tomcat /usr/bin/python3 /usr/local/bin/mymd_mail_sync.py --dry-run --imap-debug 2>&1 | tee /tmp/imap-trace.txt
```

`--imap-debug` prints the whole protocol trace, so the read-only claim is checkable rather than
asserted. It also prints message bodies, so it is for an interactive terminal only — never in
the systemd unit.

```bash
grep -nE '\b(STORE|COPY|MOVE|EXPUNGE|APPEND)\b' /tmp/imap-trace.txt   # must be empty
grep -n 'BODY\[' /tmp/imap-trace.txt | grep -v 'BODY.PEEK\['          # must be empty
grep -c EXAMINE /tmp/imap-trace.txt                                    # one per folder
rm -f /tmp/imap-trace.txt                                              # it contains PHI
```

### 4. Live backfill

```bash
sudo -u tomcat /usr/bin/python3 /usr/local/bin/mymd_mail_sync.py
```

```sql
SELECT folder, uid_validity, last_uid, last_ok_at, consecutive_errors FROM mymd_inbox_sync_state;
SELECT COUNT(*) n, SUM(demographic_no IS NOT NULL) linked,
       SUM(has_attachments) with_att, SUM(parse_error IS NOT NULL) unparsed
  FROM mymd_inbox_message;
SELECT auto_kind, COUNT(*) FROM mymd_inbox_message GROUP BY auto_kind;
```

Expect ~30 INBOX rows. **Then run it again immediately** — counts and `last_uid` must not move.
That is the idempotence test.

```bash
sudo find /var/lib/OscarDocument/oscar/mymd_inbox -type f -printf '%M %u:%g %p\n' | head
# files 0640 tomcat:tomcat, dirs 0750
```

Rollback: `TRUNCATE` the three tables and `rm -rf` the store. It is a mirror; nothing is lost.

### 5. Timer

```bash
sudo install -m 0644 /home/manucher/mymd-mail-sync.service /home/manucher/mymd-mail-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mymd-mail-sync.timer
systemctl list-timers mymd-mail-sync.timer
journalctl -u mymd-mail-sync -n 20 --no-pager
```

### 6. Confirm the SMS alert still works

Send a test message to `info@mymdonline.ca`, leave it unread in Roundcube, and confirm **both**
that a row appears in OSCAR within one cycle **and that the alert text still arrives**. This is
the check that the residual `\Seen` risk is actually zero on a genuinely unread message.

### 7. The pages

```bash
sudo install -o tomcat -g tomcat -m 0644 \
  /home/manucher/inbox.jsp /home/manucher/inboxAttachment.jsp /home/manucher/inboxHtml.jsp \
  /opt/tomcat9/webapps/oscar/mymd/
```

Compile-check before opening a browser. Requesting the URL unauthenticated proves nothing —
OSCAR's `CRFilter` redirects to `logout.jsp` before the JSP ever runs.

```bash
sudo sh -c 'CP=$(ls /opt/tomcat9/lib/*.jar /opt/tomcat9/bin/*.jar /opt/tomcat9/webapps/oscar/WEB-INF/lib/*.jar | tr "\n" ":")/opt/tomcat9/webapps/oscar/WEB-INF/classes; java -cp "$CP" org.apache.jasper.JspC -uriroot /opt/tomcat9/webapps/oscar -d /tmp/jspout -compile mymd/inbox.jsp mymd/inboxAttachment.jsp mymd/inboxHtml.jsp'
```

Expect `Generation completed with [0] errors`. Then clear the compiled copies. **The glob must be
inside `sudo sh -c`** — `/opt/tomcat9/work` is tomcat-only, so your login shell cannot expand it,
`rm` receives a literal `*`, and it exits 0 having done nothing:

```bash
sudo sh -c 'rm -f /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/mymd/inbox_jsp.* /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/mymd/inboxAttachment_jsp.* /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/mymd/inboxHtml_jsp.*'
```

### 8. The updated compose window

```bash
sudo install -o tomcat -g tomcat -m 0644 /home/manucher/emailPatient.jsp /opt/tomcat9/webapps/oscar/mymd/emailPatient.jsp
sudo sh -c 'rm -f /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/mymd/emailPatient_jsp.*'
```

Adds `&replyTo=<id>` prefill, `In-Reply-To`/`References` threading, and a two-way conversation
history. The history probes for `mymd_inbox_message` and silently falls back to outbound-only if
the table is missing, so this file is safe to deploy before step 1.

### 8b. Compose mode (added 2026-08-17)

`emailPatient.jsp?compose=1` is a free-form compose window: an editable To box (strict
RFC-822 validation, up to 5 comma-separated recipients) instead of a readonly address pulled
from a demographic row, no patient context, same SMTP path, footer, and
`mymd_patient_email_log` row (with `demographic_no = NULL`). `&replyTo=<id>` additionally
pre-fills the recipient/subject/quote from a mirrored message and threads the reply — this is
how "Reply" works on *unlinked* inbox messages, whose senders have no chart to anchor a reply
to. The inbox list view gained a "Compose" button that opens this mode blank.

Requires one schema change (applied to production 2026-08-17):

```bash
sudo mysql oscar_db < mymd_compose.sql   # demographic_no NULLable in mymd_patient_email_log
```

The compose-mode `replyTo` lookup is deliberately *not* scoped by demographic — unlinked
messages have none. That is the same access level as inbox.jsp itself, where any
authenticated provider sees every mirrored message and views are audited.

### 9. Nav link — last, so it never points at a half-built page

```bash
sudo python3 /home/manucher/patch_inbox_nav.py
sudo sh -c 'rm -f /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/provider/appointmentprovideradminday_jsp.*'
```

**Reinstall order:** Health Assist → Lab Import → Bill Day → **Patient Email**. Each patcher
anchors on the previous link, so out of order this aborts.

**Caveat:** the nav block is inside `<security:oscarSec objectName="_admin,…">`, so the link is
**admin-only**, like Lab Import and Bill Day. If reception should triage the queue, the `<li>`
has to move outside that block — and then the JSP's own session guard is the only gate.

## Verification

Device gate still covers the new paths (from a machine with **no** client cert):

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://oscar.mymdonline.ca/oscar/mymd/inbox.jsp          # 403
curl -sk -o /dev/null -w '%{http_code}\n' -X POST https://oscar.mymdonline.ca/mymd/pharmacy-bridge  # 401, unchanged
```

**XSS smoke test.** Email the clinic a message whose subject is `<img src=x onerror=alert(1)>`,
whose HTML body contains a `<script>` and a remote `<img>`, and which carries an `.svg`
attachment. Expected: the subject renders literally; no alert; no network request to the remote
image; "Show original formatting" stays inert; the `.svg` downloads rather than rendering.

**CSRF.** Replay an assign POST with the token removed and with it altered — both must give 403
with no database change.

## Gotchas

- **Never mark mail read.** Everything above depends on it. There is a warning banner in the UI
  next to the Handled button so a future maintainer does not "fix" this.
- **`--imap-debug` prints PHI.** Interactive use only; delete the trace afterwards.
- **journald is readable by group `adm`**, which `manucher` is in — so the poller logs counts and
  UIDs at INFO and never a subject, address or body. Those need `-v`.
- **Auto-linking will miss a lot on purpose.** Shared family addresses are normal; only an
  exactly-one match auto-links. The UI shows "N possible" and offers one-click candidates.
- **Wrong password is the dangerous failure**, not an outage. cPHulk bans by IP, so a poller
  retrying every few minutes would lock the clinic out of its own webmail. After 3 consecutive
  auth failures the poller refuses to connect at all; clear it with `--reset-errors`.
- **Messages deleted in Roundcube stay in OSCAR.** By design — the chart is the record — but a
  patient deletion request now has two places to satisfy.
- **`mymd_patient_email_log` DDL** is finally committed, at
  `docs/oscar/inbox/mymd_patient_email_log.sql`. It had only ever existed in production.
- **The nightly backup does not currently capture the custom JSPs** — `oscar-backup.sh:111` globs
  `*.jsp.oscarbak` (3 matches) while the real convention produces `*.oscarbak.<ts>` (37), and the
  `mymd/*.jsp` pages have no `.oscarbak` sibling at all. Tracked separately; until it is fixed the
  git repo is the only copy.

## Rollback

```bash
sudo systemctl disable --now mymd-mail-sync.timer
sudo rm -f /opt/tomcat9/webapps/oscar/mymd/inbox.jsp \
           /opt/tomcat9/webapps/oscar/mymd/inboxAttachment.jsp \
           /opt/tomcat9/webapps/oscar/mymd/inboxHtml.jsp
# restore the nav from the .oscarbak.<ts> the patcher wrote, then clear the compiled JSP
```

The tables can stay — nothing else reads them, and `emailPatient.jsp` degrades to outbound-only
on its own if they are dropped.
