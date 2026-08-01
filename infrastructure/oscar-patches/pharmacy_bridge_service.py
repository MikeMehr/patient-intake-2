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

Auth: shared secret in the X-MyMD-Pharmacy-Secret header, compared with hmac.compare_digest.
The secret lives in /var/lib/OscarDocument/oscar/mymd_pharmacy_bridge.properties (root:tomcat
600, outside the web root) — never inline it here.
"""

import hmac
import json
import logging
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs

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
