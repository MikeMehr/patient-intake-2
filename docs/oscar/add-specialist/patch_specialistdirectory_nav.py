#!/usr/bin/env python3
"""Add the "Specialist Directory" item to the OSCAR top nav, next to the Patient Email link.

Retroactive: this link was originally a hand-edit on the live server with no patcher in the repo.
Committed here so the item — which patch_addspecialist_nav.py anchors on — is recoverable after a
WAR redeploy. Run this BEFORE patch_addspecialist_nav.py when rebuilding the nav from stock.
"""
import io, sys, time

PATH = "/opt/tomcat9/webapps/oscar/provider/appointmentprovideradminday.jsp"

ANCHOR = ('<li><a href="<%=request.getContextPath()%>/mymd/inbox.jsp" target="_blank" '
          'TITLE="Patient email received at info@mymdonline.ca">Patient Email</a></li>\n')

NEW = ('<li><a href="https://physician.health-assist.org/physician/specialist-directory" '
       'target="_blank" TITLE="Search BC specialists by specialty, city, and wait time '
       '(PathwaysBC)">Specialist Directory</a></li>\n')

with io.open(PATH, encoding="utf-8") as f:
    src = f.read()

if NEW in src:
    sys.exit("ABORT: the Specialist Directory link is already present.")
if src.count(ANCHOR) != 1:
    sys.exit("ABORT: expected exactly one Patient Email nav link, found %d" % src.count(ANCHOR))

src = src.replace(ANCHOR, ANCHOR + NEW)

backup = "%s.oscarbak.%s" % (PATH, time.strftime("%Y%m%d%H%M%S"))
with io.open(backup, "w", encoding="utf-8") as f:
    f.write(io.open(PATH, encoding="utf-8").read())
with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("backup: %s" % backup)
print("inserted after the Patient Email link")
