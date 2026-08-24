#!/usr/bin/env python3
"""Patch demographicaddarecordhtm.jsp: enrollment (roster) date optional, defaults to today."""
import sys

PATH = "/opt/tomcat9/webapps/oscar/demographic/demographicaddarecordhtm.jsp"

OLD = """  \t\t\tvar rosterStatus = document.adddemographic.roster_status.value;
  \t\t\tif(rosterStatus == 'RO') {
  \t\t\t\tvar rosterEnrolledTo = document.adddemographic.roster_enrolled_to.value;
  \t\t\t\tvar rosterDateYear = document.adddemographic.roster_date_year.value;
  \t  \t\t\tvar rosterDateMonth = document.adddemographic.roster_date_month.value;
  \t  \t\t\tvar rosterDateDate = document.adddemographic.roster_date_date.value;

  \t  \t\t\tif(rosterEnrolledTo == '') {
  \t  \t\t\t\t//alert('<bean:message key="demographic.demographiceditdemographic.alertenrollto" />');
                    //document.adddemographic.roster_enrolled_to.focus();
  \t  \t\t\t\treturn false;
  \t  \t\t\t}

  \t  \t\t\tif(rosterDateYear == '' || rosterDateMonth == '' || rosterDateDate == '') {
\t  \t\t\t\t//alert('<bean:message key="demographic.demographiceditdemographic.alertrosterdate" />');
                    //document.adddemographic.roster_date.focus();
\t  \t\t\t\treturn false;
\t  \t\t\t}

  \t\t\t}"""

NEW = """  \t\t\tvar rosterStatus = document.adddemographic.roster_status.value;
  \t\t\tif(rosterStatus == 'RO') {
  \t\t\t\t// MyMD 2026-08-24: enrollment date is optional - default to today instead of blocking the save
  \t\t\t\tif(document.getElementById('roster_date').value == '') {
  \t\t\t\t\tvar _now = new Date();
  \t\t\t\t\tdocument.getElementById('roster_date').value = _now.getFullYear() + '-' + ('0' + (_now.getMonth() + 1)).slice(-2) + '-' + ('0' + _now.getDate()).slice(-2);
  \t\t\t\t\tparseroster_date();
  \t\t\t\t}
  \t\t\t\tvar rosterEnrolledTo = document.adddemographic.roster_enrolled_to.value;
  \t  \t\t\tif(rosterEnrolledTo == '') {
  \t  \t\t\t\talert('<bean:message key="demographic.demographiceditdemographic.alertenrollto" />');
  \t  \t\t\t\tdocument.adddemographic.roster_enrolled_to.focus();
  \t  \t\t\t\treturn false;
  \t  \t\t\t}
  \t\t\t}"""

src = open(PATH, encoding="utf-8").read()
if NEW in src:
    print("ALREADY PATCHED")
    sys.exit(0)
count = src.count(OLD)
if count != 1:
    print(f"ABORT: expected 1 match, found {count}")
    sys.exit(1)
open(PATH, "w", encoding="utf-8").write(src.replace(OLD, NEW))
print("PATCHED OK")
