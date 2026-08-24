#!/usr/bin/env python3
"""Hide the read-only "Clinic Status" summary box on the patient detail page
(demographiceditdemographic.jsp). Display-only (roster/enrolment lines,
patient status, chart no) - no form inputs, so hiding has no POST side
effects. Patient Status stays editable in the edit form itself.
"""
import sys

PATH = "/opt/tomcat9/webapps/oscar/demographic/demographiceditdemographic.jsp"

OLD = """<div class="demographicSection" id="clinicStatus">"""
NEW = """<div class="demographicSection" id="clinicStatus" style="display:none"><%-- MyMD 2026-08-24: read-only enrolment/clinic-status summary hidden --%>"""

src = open(PATH, encoding="utf-8").read()
if NEW in src:
    print("ALREADY PATCHED")
    sys.exit(0)
n = src.count(OLD)
if n != 1:
    print(f"ABORT: marker matched {n} times")
    sys.exit(1)
open(PATH, "w", encoding="utf-8").write(src.replace(OLD, NEW))
print("PATCHED OK")
