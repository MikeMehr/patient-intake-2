"""Add an eChart button to the top toolbar of the single-document view.

dms/showDocument.jsp already offers E-Chart, but buried in the "Other" dropdown.
This surfaces it as a first-class button between Acknowledge and Comment, reusing
the dropdown item's popupPatient() call verbatim (minus its stray '>' inside the
curDate param, which otherwise leaks into the query string).

Placement constraint: btnDisabled/isLinkedToDemographic are declared AFTER the
Comment button in this JSP, so the inserted scriptlet computes its own linked
check instead of referencing them.

The button only renders when searchProviderNo != null — same guard as the
dropdown item, because the page is opened from the e-chart itself when null.

Run ON the OSCAR box:  sudo python3 patch_showdocument_echart_button.py

Idempotent, asserts the anchor matches exactly once, and leaves a .oscarbak.<stamp>.
After running, delete the compiled JSP so Tomcat recompiles:
  rm /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/dms/showDocument_jsp.*
"""

import shutil
import sys
import time

TARGET = '/opt/tomcat9/webapps/oscar/dms/showDocument.jsp'

ANCHOR = ('<input type="submit" id="ackBtn_<%=docId%>" class="btn  btn-primary" '
          'value="<bean:message key="oscarMDS.segmentDisplay.btnAcknowledge"/>">')

MARKER = 'echartTopBtn_'

BUTTON = '''

                                                        <% if ( searchProviderNo != null ) {
                                                            boolean mymdEchartLinked = demographicID != null && !demographicID.equals("") && !demographicID.equalsIgnoreCase("null") && !demographicID.equals("-1");
                                                        %>
                                                        <input type="button" id="echartTopBtn_<%=docId%>" class="btn" value="<bean:message key="oscarMDS.segmentDisplay.btnEChart"/>" onClick="popupPatient(710, 1024,'<%=request.getContextPath()%>/oscarEncounter/IncomingEncounter.do?reason=' + getDocumentType() + '&curDate=<%=currentDate%>&appointmentNo=&appointmentDate=&startTime=&status=&demographicNo=', 'encounter', '<%=docId%>', <%=openInTabs%>); return false;" <%=mymdEchartLinked ? "" : "disabled"%>>
                                                        <% } %>'''


def main():
    with open(TARGET, encoding='utf-8') as f:
        src = f.read()

    if MARKER in src:
        print('Already patched — nothing to do.')
        return

    count = src.count(ANCHOR)
    assert count == 1, f'Expected the Acknowledge anchor exactly once, found {count}'

    stamp = time.strftime('%Y%m%d%H%M%S')
    backup = f'{TARGET}.oscarbak.{stamp}'
    shutil.copy2(TARGET, backup)
    print(f'Backup: {backup}')

    src = src.replace(ANCHOR, ANCHOR + BUTTON)

    with open(TARGET, 'w', encoding='utf-8') as f:
        f.write(src)
    print('Patched: eChart button inserted after Acknowledge (before Comment).')


if __name__ == '__main__':
    sys.exit(main())
