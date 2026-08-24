#!/usr/bin/env python3
"""Hide the enrollment/rostering fields on the Edit Patient (demographiceditdemographic.jsp) page.

Hides the roster_date ("Date Joined" enrollment date) control group and the
DEMOGRAPHIC_PATIENT_ROSTERING block (roster status / enrolled-to / termination
date + reason). Inputs stay in the DOM: onLoad handlers (checkRosterStatus2,
parseroster_date, parseroster_termination_date) and updateSubmit validation
read them, and existing patients' stored values must keep POSTing back
unchanged so nothing is wiped on save. The plain date_joined practice field is
deliberately left visible.
"""
import sys

PATH = "/opt/tomcat9/webapps/oscar/demographic/demographiceditdemographic.jsp"

ROSTER_DATE_OLD = """        <div class="control-group span5">
            <label class="control-label" for="roster_date" title="<bean:message key="demographic.demographiceditdemographic.DateJoined" />"><bean:message key="demographic.demographiceditdemographic.DateJoined" /></label>"""
ROSTER_DATE_NEW = """        <div class="control-group span5" style="display:none"><%-- MyMD 2026-08-24: enrollment date hidden; input kept so stored values still POST --%>
            <label class="control-label" for="roster_date" title="<bean:message key="demographic.demographiceditdemographic.DateJoined" />"><bean:message key="demographic.demographiceditdemographic.DateJoined" /></label>"""

OPEN_OLD = """<oscar:oscarPropertiesCheck property="DEMOGRAPHIC_PATIENT_ROSTERING" value="true">"""
OPEN_NEW = """<oscar:oscarPropertiesCheck property="DEMOGRAPHIC_PATIENT_ROSTERING" value="true">
<div style="display:none"><%-- MyMD 2026-08-24: enrollment/rostering fields hidden; inputs kept so stored values still POST and the onLoad/validation JS keeps working --%>"""

CLOSE_OLD = """</oscar:oscarPropertiesCheck>
<%-- END TOGGLE OFF PATIENT ROSTERING --%>"""
CLOSE_NEW = """</div>
</oscar:oscarPropertiesCheck>
<%-- END TOGGLE OFF PATIENT ROSTERING --%>"""

src = open(PATH, encoding="utf-8").read()
if OPEN_NEW in src:
    print("ALREADY PATCHED")
    sys.exit(0)
for name, needle in (("roster_date", ROSTER_DATE_OLD), ("open", OPEN_OLD), ("close", CLOSE_OLD)):
    n = src.count(needle)
    if n != 1:
        print(f"ABORT: {name} marker matched {n} times")
        sys.exit(1)
src = src.replace(ROSTER_DATE_OLD, ROSTER_DATE_NEW).replace(OPEN_OLD, OPEN_NEW).replace(CLOSE_OLD, CLOSE_NEW)
open(PATH, "w", encoding="utf-8").write(src)
print("PATCHED OK")
