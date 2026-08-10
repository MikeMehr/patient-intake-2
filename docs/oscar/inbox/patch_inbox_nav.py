#!/usr/bin/env python3
"""
Add the "Patient Email" link to the OSCAR day-sheet nav.

Inserts one <li> immediately after the Bill Day link in
/opt/tomcat9/webapps/oscar/provider/appointmentprovideradminday.jsp, inside the same
_admin block. Idempotent: running it twice is a no-op.

    sudo python3 patch_inbox_nav.py

Reinstall order matters. Each patcher anchors on the one before it:
    Health Assist  ->  Lab Import  ->  Bill Day  ->  Patient Email
so after a WAR redeploy reapply patch_labimport_nav.py, then patch_daybilling_nav.py, then
this one. Out of order and this aborts because its anchor is missing.

Two deliberate choices:

  * The label is "Patient Email", not "Inbox". OSCAR already has a document/lab inbox
    (dms/previewDocHL7Inbox.jsp), and a nav item called "Inbox" would be read as that one.

  * No unread-count badge. A COUNT(*) here would be cheap, but it would make the entire day
    sheet - the most-loaded page in the EMR - depend on a table that does not exist after a
    WAR redeploy until the schema is reapplied. One missing table and nobody can see their
    schedule. If a badge is ever wanted, fetch it asynchronously from a file under
    public/oscar/ the way daysheet-video.js does, so failure is invisible.
"""

import os
import sys
import time

PATH = "/opt/tomcat9/webapps/oscar/provider/appointmentprovideradminday.jsp"

# Verified byte-for-byte against the live file, 2026-08-09 (line 1541).
ANCHOR = ('<li><a href="<%=request.getContextPath()%>/mymd/dayBilling.jsp?go=1" target="_blank" '
          'TITLE="Bill today\'s completed virtual visits">Bill Day</a></li>')

NEW_LINK = ('<li><a href="<%=request.getContextPath()%>/mymd/inbox.jsp" target="_blank" '
            'TITLE="Patient email received at info@mymdonline.ca">Patient Email</a></li>')

MARKER = "/mymd/inbox.jsp"


def main():
    if not os.path.exists(PATH):
        print("ERROR: %s does not exist" % PATH)
        return 1

    with open(PATH, "r", encoding="utf-8", errors="surrogateescape") as fh:
        content = fh.read()

    if MARKER in content:
        print("Already patched - %s already links to mymd/inbox.jsp. Nothing to do." % PATH)
        return 0

    count = content.count(ANCHOR)
    if count != 1:
        print("ERROR: expected exactly 1 Bill Day anchor, found %d." % count)
        print("       Reapply patch_daybilling_nav.py first, or the file has drifted.")
        return 1

    backup = "%s.oscarbak.%s" % (PATH, time.strftime("%Y%m%d%H%M%S"))
    with open(backup, "w", encoding="utf-8", errors="surrogateescape") as fh:
        fh.write(content)
    print("Backup written to %s" % backup)

    patched = content.replace(ANCHOR, ANCHOR + "\n" + NEW_LINK, 1)
    with open(PATH, "w", encoding="utf-8", errors="surrogateescape") as fh:
        fh.write(patched)

    print("Patched %s - Patient Email link added after Bill Day." % PATH)
    print()
    print("Now clear the compiled JSP so Tomcat recompiles it. The glob MUST be inside")
    print("sudo sh -c: /opt/tomcat9/work is tomcat-only, so your login shell cannot expand")
    print("it, rm receives a literal * and exits 0 having done nothing.")
    print()
    print("  sudo sh -c 'rm -f /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/"
          "provider/appointmentprovideradminday_jsp.*'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
