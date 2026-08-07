#!/usr/bin/env python3
"""Add a "Bill Day" item to the OSCAR top nav, immediately to the right of Lab Import.

Anchors on the Lab Import <li> rather than the Health Assist one, so the two links keep their
order. That also means Lab Import must be installed first after a WAR redeploy -- if it is
missing this aborts and says so, rather than putting the button somewhere else.
"""
import io, sys, time

PATH = "/opt/tomcat9/webapps/oscar/provider/appointmentprovideradminday.jsp"

# Byte-identical to NEW in patch_labimport_nav.py. If that string ever changes, change it here too.
ANCHOR = ('<li><a href="<%=request.getContextPath()%>/mymd/labImport.jsp" target="_blank" '
          'TITLE="Import a lab result from a filed PDF document">Lab Import</a></li>\n')

# go=1 makes the nav click itself the trigger: one click sweeps the day and bills the clean visits.
# Re-clicking is safe -- the unique key on mymd_billing_log refuses a second claim for the same
# visit, so the worst a double-click does is report "already billed".
NEW = ('<li><a href="<%=request.getContextPath()%>/mymd/dayBilling.jsp?go=1" target="_blank" '
       'TITLE="Bill today\'s completed virtual visits">Bill Day</a></li>\n')

with io.open(PATH, encoding="utf-8") as f:
    src = f.read()

if NEW in src:
    sys.exit("ABORT: the Bill Day link is already present.")
if src.count(ANCHOR) != 1:
    sys.exit("ABORT: expected exactly one Lab Import nav link, found %d. "
             "Install the Lab Import nav patch first." % src.count(ANCHOR))

src = src.replace(ANCHOR, ANCHOR + NEW)

backup = "%s.oscarbak.%s" % (PATH, time.strftime("%Y%m%d%H%M%S"))
with io.open(backup, "w", encoding="utf-8") as f:
    f.write(io.open(PATH, encoding="utf-8").read())
with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("backup: %s" % backup)
print("inserted after the Lab Import link")
