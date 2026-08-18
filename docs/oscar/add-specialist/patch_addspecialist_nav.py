#!/usr/bin/env python3
"""Add an "Add Specialist" item to the OSCAR top nav, right of the Specialist Directory link.

The anchor line was originally a hand-edit (patch_specialistdirectory_nav.py in this directory
recreates it after a WAR redeploy) — if this aborts on the anchor count, run
    grep -n 'Specialist Directory' <PATH>
and make ANCHOR byte-identical to the live line before retrying.
"""
import io, sys, time

PATH = "/opt/tomcat9/webapps/oscar/provider/appointmentprovideradminday.jsp"

ANCHOR = ('<li><a href="https://physician.health-assist.org/physician/specialist-directory" '
          'target="_blank" TITLE="Search BC specialists by specialty, city, and wait time '
          '(PathwaysBC)">Specialist Directory</a></li>\n')

NEW = ('<li><a href="<%=request.getContextPath()%>/mymd/addSpecialist.jsp" target="_blank" '
       'TITLE="Paste a PathwaysBC profile and add the specialist to OSCAR\'s consultation list">'
       'Add Specialist</a></li>\n')

with io.open(PATH, encoding="utf-8") as f:
    src = f.read()

if NEW in src:
    sys.exit("ABORT: the Add Specialist link is already present.")
if src.count(ANCHOR) != 1:
    sys.exit("ABORT: expected exactly one Specialist Directory nav link, found %d" % src.count(ANCHOR))

src = src.replace(ANCHOR, ANCHOR + NEW)

backup = "%s.oscarbak.%s" % (PATH, time.strftime("%Y%m%d%H%M%S"))
with io.open(backup, "w", encoding="utf-8") as f:
    f.write(io.open(PATH, encoding="utf-8").read())
with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("backup: %s" % backup)
print("inserted after the Specialist Directory link")
