#!/usr/bin/env python3
"""
MyMD pharmacy bridge for OSCAR.

Deployed to /home/manucher/pharmacy_bridge_service.py on the live OSCAR box and run by
systemd as `pharmacy-bridge.service` on 127.0.0.1:8086. nginx proxies
https://oscar.mymdonline.ca/mymd/pharmacy-bridge to it, outside the mTLS device-cert gate.

Why a standalone service and not a JSP: every path under the webapp is gated by OSCAR's
CRFilter (`cr.filter.ignore` in WEB-INF/web.xml), which redirects a session-less request to
logout.jsp before the JSP ever runs. Opening a hole there would mean editing OSCAR's own auth
config, restarting Tomcat, and redoing it after every WAR redeploy. This mirrors the existing
drugref2_service.py instead: its own process, its own port, untouched by webapp redeploys.

Operations (POST, application/x-www-form-urlencoded, JSON response):
  op=list                                 -> every active pharmacyInfo row
  op=link   demographicNo= pharmacyId=    -> make that pharmacy the patient's preferred one
  op=upsert name= address= ...            -> create a pharmacyInfo row, return its recordID
  op=check_elig phn= dob=                 -> real-time MSP eligibility (Teleplan E45) for a BC PHN
  op=add_allergies demographicNo= allergies= -> record patient-reported allergies on the chart
  op=set_family_doctor demographicNo= familyDoctor= -> fill the Master Record's Referral Doctor field

Auth: shared secret in the X-MyMD-Pharmacy-Secret header, compared with hmac.compare_digest.
The secret lives in /var/lib/OscarDocument/oscar/mymd_pharmacy_bridge.properties (root:tomcat
600, outside the web root) — never inline it here.
"""

import hmac
import http.cookiejar
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo

import mysql.connector

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("pharmacy-bridge")

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 8086

SECRET_FILE = "/var/lib/OscarDocument/oscar/mymd_pharmacy_bridge.properties"
SECRET_KEY = "bridge.secret"
SECRET_HEADER = "X-MyMD-Pharmacy-Secret"

DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "oscar",
    "password": "oscar_password_2026",
    "database": "oscar_db",
    "connection_timeout": 10,
    "use_pure": True,
    "ssl_disabled": True,
}

# Bodies are small (the largest is an upsert); anything bigger is not a real request.
MAX_BODY_BYTES = 16 * 1024

NUMERIC_RE = re.compile(r"^\d{1,10}$")

# Column caps from `DESCRIBE pharmacyInfo`. Truncating here keeps MySQL in strict mode from
# rejecting the whole INSERT on an over-long field.
UPSERT_FIELDS = {
    "name": 255,
    "address": 2000,
    "city": 255,
    "province": 255,
    "postalCode": 20,
    "phone1": 20,
    "fax": 20,
    "email": 100,
}


def load_secret():
    """Read the shared secret. Returns None when unreadable, which fails every request closed."""
    try:
        with open(SECRET_FILE, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                if key.strip() == SECRET_KEY:
                    return value.strip() or None
    except OSError as exc:
        logger.error("cannot read secret file: %s", exc)
    return None


def get_db():
    return mysql.connector.connect(**DB_CONFIG)


def op_list():
    """Every active pharmacy. Drives the directory mirror in the booking app."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT recordID, name, address, city, province, postalCode, phone1, fax, email "
            "FROM pharmacyInfo WHERE status = '1' ORDER BY recordID"
        )
        pharmacies = [
            {
                "pharmacyId": str(r[0]),
                "name": r[1] or "",
                "address": r[2] or "",
                "city": r[3] or "",
                "province": r[4] or "",
                "postalCode": r[5] or "",
                "phone": r[6] or "",
                "fax": r[7] or "",
                "email": r[8] or "",
            }
            for r in cursor.fetchall()
        ]
        cursor.close()
        return 200, {"pharmacies": pharmacies}
    finally:
        conn.close()


def op_link(params):
    """
    Make `pharmacyId` the preferred pharmacy for `demographicNo`.

    OSCAR's own Rx UI (RxManagePharmacyAction.setPreferred) treats demographicPharmacy as a
    list with one preferred entry, so this deactivates any existing rows for the patient before
    activating the chosen one. Re-linking a pharmacy the patient had before reuses that row
    rather than accumulating duplicates.
    """
    demographic_no = (params.get("demographicNo") or [""])[0].strip()
    pharmacy_id = (params.get("pharmacyId") or [""])[0].strip()

    if not NUMERIC_RE.match(demographic_no) or not NUMERIC_RE.match(pharmacy_id):
        return 400, {"error": "demographicNo and pharmacyId must be numeric"}

    conn = get_db()
    try:
        conn.autocommit = False
        cursor = conn.cursor()

        cursor.execute("SELECT 1 FROM demographic WHERE demographic_no = %s", (demographic_no,))
        if cursor.fetchone() is None:
            conn.rollback()
            cursor.close()
            return 404, {"error": "demographic not found"}

        cursor.execute("SELECT 1 FROM pharmacyInfo WHERE recordID = %s AND status = '1'", (pharmacy_id,))
        if cursor.fetchone() is None:
            conn.rollback()
            cursor.close()
            return 404, {"error": "pharmacy not found"}

        cursor.execute(
            "UPDATE demographicPharmacy SET status = '0' WHERE demographic_no = %s",
            (demographic_no,),
        )
        cursor.execute(
            "SELECT id FROM demographicPharmacy WHERE demographic_no = %s AND pharmacyID = %s LIMIT 1",
            (demographic_no, pharmacy_id),
        )
        existing = cursor.fetchone()
        if existing:
            cursor.execute(
                "UPDATE demographicPharmacy SET status = '1', preferredOrder = 1 WHERE id = %s",
                (existing[0],),
            )
        else:
            cursor.execute(
                "INSERT INTO demographicPharmacy (pharmacyID, demographic_no, status, preferredOrder) "
                "VALUES (%s, %s, '1', 1)",
                (pharmacy_id, demographic_no),
            )
        conn.commit()
        cursor.close()
        logger.info("linked demographic %s -> pharmacy %s", demographic_no, pharmacy_id)
        return 200, {"ok": True, "pharmacyId": pharmacy_id}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()



# Allergy entries created from booking-form free text. Attributed to OSCAR's built-in
# system provider so no physician appears to have vouched for them; the reaction text
# carries the real provenance. varchar(50) DESCRIPTION cap from `DESCRIBE allergies`.
ALLERGY_PROVIDER_NO = "999998"  # "oscardoc, doctor"
ALLERGY_DESC_MAX = 50
MAX_ALLERGY_ITEMS = 10


def op_add_allergies(params):
    """
    Record patient-reported allergies on a chart as Custom Allergy entries (TYPECODE 0,
    the code OSCAR's own Allergy.getTypeDesc labels "Custom Allergy").

    Called by the booking app right after it creates a chart for a new patient. The
    patient's free text arrives as one string; each comma/semicolon-separated item
    becomes its own `allergies` row so the eChart Allergies module lists them
    individually. Items already on the chart (same description, unarchived) are
    skipped, so retries don't duplicate. Custom entries carry no drugref id, which
    means OSCAR's automated Rx interaction checking ignores them — the reaction field
    marks them patient-reported so staff verify before relying on them.
    """
    demographic_no = (params.get("demographicNo") or [""])[0].strip()
    text = (params.get("allergies") or [""])[0].strip()

    if not NUMERIC_RE.match(demographic_no):
        return 400, {"error": "demographicNo must be numeric"}
    if not text:
        return 400, {"error": "allergies text is required"}

    items = [i.strip() for i in re.split(r"[,;]", text) if i.strip()][:MAX_ALLERGY_ITEMS]
    if not items:
        return 400, {"error": "no allergy items found"}

    conn = get_db()
    try:
        conn.autocommit = False
        cursor = conn.cursor()

        cursor.execute("SELECT 1 FROM demographic WHERE demographic_no = %s", (demographic_no,))
        if cursor.fetchone() is None:
            conn.rollback()
            cursor.close()
            return 404, {"error": "demographic not found"}

        added, skipped = [], []
        for item in items:
            desc = item[:ALLERGY_DESC_MAX]
            cursor.execute(
                "SELECT 1 FROM allergies WHERE demographic_no = %s AND DESCRIPTION = %s "
                "AND archived = '0' LIMIT 1",
                (demographic_no, desc),
            )
            if cursor.fetchone():
                skipped.append(desc)
                continue
            reaction = "Patient-reported at online booking"
            if len(item) > ALLERGY_DESC_MAX:
                reaction += " — full text: " + item
            cursor.execute(
                "INSERT INTO allergies (demographic_no, entry_date, DESCRIPTION, TYPECODE, "
                "reaction, archived, start_date, position, lastUpdateDate, providerNo) "
                "VALUES (%s, CURDATE(), %s, 0, %s, '0', CURDATE(), 0, NOW(), %s)",
                (demographic_no, desc, reaction, ALLERGY_PROVIDER_NO),
            )
            added.append(desc)

        conn.commit()
        cursor.close()
        logger.info(
            "added %d allergy entries for demographic %s (%d already present)",
            len(added), demographic_no, len(skipped),
        )
        return 200, {"ok": True, "added": added, "skipped": skipped}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# demographic.family_doctor is varchar(80) holding XML fragments; the wrapper tags cost
# 26 chars, leaving 54 for the name. Values considered "empty" and safe to overwrite:
# NULL, '', and the bare skeleton OSCAR's own forms write.
FAMILY_DOCTOR_NAME_MAX = 54
FAMILY_DOCTOR_EMPTY = ("", "<rdohip></rdohip><rd></rd>")


def op_set_family_doctor(params):
    """
    Fill the Master Record's Referral Doctor field (demographic.family_doctor) with the
    family-doctor name a patient typed at online booking.

    OSCAR's REST demographics create maps DemographicTo1.familyDoctor in its converter,
    but the value does not survive to the row (verified live 2026-09-05: a create that
    sent it produced the empty skeleton), so the booking app sets it here instead,
    right after chart creation. Only an empty field is written — a name staff entered
    is never overwritten — so retries and later bookings are safe.
    """
    demographic_no = (params.get("demographicNo") or [""])[0].strip()
    name = (params.get("familyDoctor") or [""])[0].strip()
    # The name becomes XML content: drop angle brackets, collapse whitespace, cap length.
    name = re.sub(r"[<>]", "", name)
    name = re.sub(r"\s+", " ", name).strip()[:FAMILY_DOCTOR_NAME_MAX]

    if not NUMERIC_RE.match(demographic_no):
        return 400, {"error": "demographicNo must be numeric"}
    if not name:
        return 400, {"error": "familyDoctor is required"}

    conn = get_db()
    try:
        conn.autocommit = False
        cursor = conn.cursor()
        cursor.execute(
            "SELECT family_doctor FROM demographic WHERE demographic_no = %s",
            (demographic_no,),
        )
        row = cursor.fetchone()
        if row is None:
            conn.rollback()
            cursor.close()
            return 404, {"error": "demographic not found"}
        current = (row[0] or "").strip()
        if current not in FAMILY_DOCTOR_EMPTY:
            conn.rollback()
            cursor.close()
            return 200, {"ok": True, "updated": False, "reason": "field already set"}
        cursor.execute(
            "UPDATE demographic SET family_doctor = %s WHERE demographic_no = %s",
            ("<rdohip></rdohip><rd>" + name + "</rd>", demographic_no),
        )
        conn.commit()
        cursor.close()
        logger.info("set family doctor for demographic %s", demographic_no)
        return 200, {"ok": True, "updated": True}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def op_upsert(params):
    """
    Add a pharmacy to OSCAR's shared directory and return its recordID.

    Implemented for completeness; the booking app keeps this off by default
    (PHARMACY_BRIDGE_ALLOW_UPSERT) because it would let anonymous public form input write into a
    table that also routes prescription faxes.
    """
    values = {}
    for field, cap in UPSERT_FIELDS.items():
        values[field] = (params.get(field) or [""])[0].strip()[:cap]

    if not values["name"]:
        return 400, {"error": "name is required"}

    conn = get_db()
    try:
        cursor = conn.cursor()
        # Reuse an existing row rather than growing a second "Shoppers Drug Mart" on the same street.
        cursor.execute(
            "SELECT recordID FROM pharmacyInfo "
            "WHERE status = '1' AND LOWER(name) = LOWER(%s) AND LOWER(COALESCE(city,'')) = LOWER(%s) "
            "LIMIT 1",
            (values["name"], values["city"]),
        )
        existing = cursor.fetchone()
        if existing:
            cursor.close()
            return 200, {"pharmacyId": str(existing[0]), "created": False}

        cursor.execute(
            "INSERT INTO pharmacyInfo (name, address, city, province, postalCode, phone1, fax, email, status) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, '1')",
            (
                values["name"], values["address"], values["city"], values["province"],
                values["postalCode"], values["phone1"], values["fax"], values["email"],
            ),
        )
        new_id = cursor.lastrowid
        conn.commit()
        cursor.close()
        logger.info("created pharmacy %s (%s)", new_id, values["name"])
        return 200, {"pharmacyId": str(new_id), "created": True}
    finally:
        conn.close()


# --- MSP eligibility (Teleplan E45) ---------------------------------------------------------
#
# Replicates exactly what OSCAR's own "Check Eligibility" button does (ManageTeleplanAction
# .checkElig -> TeleplanAPI.checkElig, verified by decompiling the deployed classes): three form
# POSTs to the Teleplan broker — AsignOn, AcheckE45, AsignOff — over one cookie session, using
# the same credentials OSCAR keeps in its `property` table. The E45 is a read-only inquiry; MSP
# answers with an ELIG_ON_DOS line for the given PHN + birthdate on the given date of service.

TELEPLAN_URL = "https://teleplan.hnet.bc.ca/TeleplanBroker"
# TeleplanAPI sends this UA; keep it so our requests look like every other OSCAR client.
TELEPLAN_UA = "TeleplanPerl 1.0"
TELEPLAN_TIMEOUT_S = 25

PHN_RE = re.compile(r"^\d{10}$")
DOB_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
# Every broker response ends with this trailer line (TeleplanResponse.processLastLine).
TRAILER_RE = re.compile(r"#TID=([^;]*);Result=([^;]*);Filename=([^;]*);Msgs=(.*);\s*$")


def teleplan_creds():
    """The Teleplan username/password OSCAR itself uses, from the `property` table.

    OSCAR's TeleplanUserPassDAO iterates every row for the name and keeps the last one, so
    ORDER BY id and take the final row to agree with it.
    """
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name, value FROM property "
            "WHERE name IN ('teleplan_username', 'teleplan_password') ORDER BY id"
        )
        creds = {}
        for name, value in cursor.fetchall():
            creds[name] = value or ""
        cursor.close()
        username = creds.get("teleplan_username", "").strip()
        password = creds.get("teleplan_password", "").strip()
        if username and password:
            return username, password
        return None
    finally:
        conn.close()


def _teleplan_post(opener, fields):
    """One broker POST. Returns (body_lines, trailer_dict); raises on transport errors."""
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(TELEPLAN_URL, data=data, headers={"User-Agent": TELEPLAN_UA})
    with opener.open(req, timeout=TELEPLAN_TIMEOUT_S) as resp:
        body = resp.read().decode("utf-8", "replace")
    lines = body.splitlines()
    trailer = {"tid": "", "result": "", "filename": "", "msgs": ""}
    if lines:
        m = TRAILER_RE.search(lines[-1])
        if m:
            trailer = {
                "tid": m.group(1),
                "result": m.group(2),
                "filename": m.group(3),
                "msgs": m.group(4),
            }
            lines = lines[:-1]
    return lines, trailer


def op_check_elig(params):
    """
    Ask MSP whether `phn` is eligible on today's date of service (Teleplan E45).

    Inputs: phn = 10-digit BC PHN, dob = YYYY-MM-DD. The date of service is always "today" in
    clinic time — the same choice OSCAR's own button makes — because MSP answers about current
    coverage, not future dates.

    The caller (the booking app) gets only the eligibility fields back, never the patient name
    or gender lines the E45 report also carries. Nothing PHN-shaped is logged here.
    """
    phn = (params.get("phn") or [""])[0].strip()
    dob = (params.get("dob") or [""])[0].strip()

    if not PHN_RE.match(phn):
        return 400, {"error": "phn must be 10 digits"}
    dob_m = DOB_RE.match(dob)
    if not dob_m:
        return 400, {"error": "dob must be YYYY-MM-DD"}

    creds = teleplan_creds()
    if not creds:
        return 503, {"ok": False, "reason": "teleplan_not_configured"}
    username, password = creds

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    try:
        _, login = _teleplan_post(
            opener,
            {"username": username, "password": password, "ExternalAction": "AsignOn"},
        )
        if login["result"] != "SUCCESS":
            logger.error("check_elig: teleplan login failed: %s", login["msgs"])
            return 502, {"ok": False, "reason": "teleplan_login_failed"}

        today = datetime.now(ZoneInfo("America/Vancouver"))
        lines, trailer = _teleplan_post(
            opener,
            {
                "PHN": phn,
                "dateOfBirthyyyy": dob_m.group(1),
                "dateOfBirthmm": dob_m.group(2),
                "dateOfBirthdd": dob_m.group(3),
                "dateOfServiceyyyy": f"{today.year:04d}",
                "dateOfServicemm": f"{today.month:02d}",
                "dateOfServicedd": f"{today.day:02d}",
                "PatientVisitCharge": "true",
                "LastEyeExam": "true",
                "PatientRestriction": "true",
                "ExternalAction": "AcheckE45",
            },
        )

        try:
            _teleplan_post(opener, {"ExternalAction": "AsignOff"})
        except Exception:
            pass  # the session expires on its own; the answer is already in hand

        if trailer["result"] != "SUCCESS":
            logger.error("check_elig: E45 failed: result=%s msgs=%s", trailer["result"], trailer["msgs"])
            return 502, {"ok": False, "reason": "teleplan_e45_failed", "msgs": trailer["msgs"]}

        report = {}
        for line in lines:
            key, sep, value = line.partition(":")
            if sep:
                report[key.strip().upper()] = value.strip()

        elig = report.get("ELIG_ON_DOS", "").upper()
        logger.info("check_elig: eligOnDos=%s msgs=%s", elig or "(missing)", trailer["msgs"])
        return 200, {
            "ok": True,
            "eligOnDos": elig,  # "YES" | "NO" | "" when MSP's answer had no such line
            "coverageEndDate": report.get("COVERAGE_END_DT", ""),
            "coverageEndReason": report.get("COVERAGE_END_REASON", ""),
            "dateOfService": today.strftime("%Y-%m-%d"),
            "msgs": trailer["msgs"],
        }
    except (urllib.error.URLError, OSError) as exc:
        # Reason only — never the request, which carries the PHN.
        logger.error("check_elig: teleplan unreachable: %s", exc)
        return 502, {"ok": False, "reason": "teleplan_unreachable"}


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "MyMDPharmacyBridge"
    sys_version = ""

    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Deliberately no GET surface: every operation either mutates or returns the whole
        # directory, and a GET would be reachable by a stray browser request.
        self._send(405, {"error": "POST only"})

    def do_POST(self):
        try:
            expected = load_secret()
            provided = self.headers.get(SECRET_HEADER) or ""
            if not expected or not hmac.compare_digest(provided, expected):
                self._send(401, {"error": "unauthorized"})
                return

            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY_BYTES:
                self._send(413, {"error": "body too large"})
                return
            raw = self.rfile.read(length).decode("utf-8", "replace") if length else ""
            params = parse_qs(raw, keep_blank_values=True)
            op = (params.get("op") or [""])[0]

            if op == "list":
                status, payload = op_list()
            elif op == "link":
                status, payload = op_link(params)
            elif op == "upsert":
                status, payload = op_upsert(params)
            elif op == "check_elig":
                status, payload = op_check_elig(params)
            elif op == "add_allergies":
                status, payload = op_add_allergies(params)
            elif op == "set_family_doctor":
                status, payload = op_set_family_doctor(params)
            else:
                status, payload = 400, {"error": "unknown op"}

            self._send(status, payload)
        except Exception as exc:
            # Log the detail locally; return a generic message so nothing about the schema or
            # the secret leaks to the caller.
            logger.exception("bridge error: %s", exc)
            self._send(500, {"error": "internal error"})

    def log_message(self, fmt, *args):
        # Default BaseHTTPRequestHandler logging writes the full request line to stderr. Route it
        # through the logger at debug level so journald doesn't accumulate request logs.
        logger.debug(fmt, *args)


def main():
    if not load_secret():
        logger.error("no secret configured at %s — every request will be rejected", SECRET_FILE)
    server = HTTPServer((LISTEN_HOST, LISTEN_PORT), BridgeHandler)
    logger.info("pharmacy bridge listening on %s:%s", LISTEN_HOST, LISTEN_PORT)
    server.serve_forever()


if __name__ == "__main__":
    main()
