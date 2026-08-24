#!/usr/bin/env python3
"""Hide the enrollment/rostering fields on the Add Patient form entirely.

Wraps the DEMOGRAPHIC_PATIENT_ROSTERING block in a display:none div. The
inputs stay in the DOM (aSubmit() reads roster_status; removing it would
throw) but post their empty "Not Set" defaults.
"""
import sys

PATH = "/opt/tomcat9/webapps/oscar/demographic/demographicaddarecordhtm.jsp"

OPEN_OLD = """<oscar:oscarPropertiesCheck property="DEMOGRAPHIC_PATIENT_ROSTERING" value="true">"""
OPEN_NEW = """<oscar:oscarPropertiesCheck property="DEMOGRAPHIC_PATIENT_ROSTERING" value="true">
<div style="display:none"><%-- MyMD 2026-08-24: enrollment/rostering fields hidden on Add Patient; inputs kept so aSubmit() and the empty POST defaults still work --%>"""

CLOSE_OLD = """</oscar:oscarPropertiesCheck>
<%-- END TOGGLE OFF PATIENT ROSTERING --%>"""
CLOSE_NEW = """</div>
</oscar:oscarPropertiesCheck>
<%-- END TOGGLE OFF PATIENT ROSTERING --%>"""

src = open(PATH, encoding="utf-8").read()
if OPEN_NEW in src:
    print("ALREADY PATCHED")
    sys.exit(0)
for name, needle in (("open", OPEN_OLD), ("close", CLOSE_OLD)):
    n = src.count(needle)
    if n != 1:
        print(f"ABORT: {name} marker matched {n} times")
        sys.exit(1)
src = src.replace(OPEN_OLD, OPEN_NEW).replace(CLOSE_OLD, CLOSE_NEW)
open(PATH, "w", encoding="utf-8").write(src)
print("PATCHED OK")
