#!/usr/bin/env python3
"""Hide the "Date Joined" (date_joined) field on both the Add Patient and Edit
Patient forms. Hidden not deleted: checkDateYMD/parsedate_joined and the body
onLoad read the elements, and on the edit page the stored value must keep
POSTing back so saves wipe nothing.
"""
import sys

MARK = """        <div class="control-group span5" style="display:none"><%-- MyMD 2026-08-24: date_joined hidden; input kept so scripts and stored values keep working --%>
            <label class="control-label" for="date_joined">"""

OLD = """        <div class="control-group span5">
            <label class="control-label" for="date_joined">"""

for path in (
    "/opt/tomcat9/webapps/oscar/demographic/demographicaddarecordhtm.jsp",
    "/opt/tomcat9/webapps/oscar/demographic/demographiceditdemographic.jsp",
):
    src = open(path, encoding="utf-8").read()
    if MARK in src:
        print(f"ALREADY PATCHED: {path}")
        continue
    n = src.count(OLD)
    if n != 1:
        print(f"ABORT: marker matched {n} times in {path}")
        sys.exit(1)
    open(path, "w", encoding="utf-8").write(src.replace(OLD, MARK))
    print(f"PATCHED OK: {path}")
