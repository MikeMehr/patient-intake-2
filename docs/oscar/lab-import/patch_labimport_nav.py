#!/usr/bin/env python3
"""Add a "Lab Import" item to the OSCAR top nav, next to the existing Health Assist link."""
import io, sys, time

PATH = "/opt/tomcat9/webapps/oscar/provider/appointmentprovideradminday.jsp"

ANCHOR = ('<li><a href="https://mymd.health-assist.org/auth/login" target="_blank" '
          'TITLE="Health Assist" style="color:#ffd700;font-weight:bold">Health Assist</a></li>\n')

NEW = ('<li><a href="<%=request.getContextPath()%>/mymd/labImport.jsp" target="_blank" '
       'TITLE="Import a lab result from a filed PDF document">Lab Import</a></li>\n')

with io.open(PATH, encoding="utf-8") as f:
    src = f.read()

if NEW in src:
    sys.exit("ABORT: the Lab Import link is already present.")
if src.count(ANCHOR) != 1:
    sys.exit("ABORT: expected exactly one Health Assist nav link, found %d" % src.count(ANCHOR))

src = src.replace(ANCHOR, ANCHOR + NEW)

backup = "%s.oscarbak.%s" % (PATH, time.strftime("%Y%m%d%H%M%S"))
with io.open(backup, "w", encoding="utf-8") as f:
    f.write(io.open(PATH, encoding="utf-8").read())
with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("backup: %s" % backup)
print("inserted after the Health Assist link")
