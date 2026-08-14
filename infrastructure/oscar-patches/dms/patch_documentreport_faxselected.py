"""Add a "Fax Selected" button to the patient's Documents list.

dms/documentReport.jsp already renders a checkbox per PDF row (name="docNo", inside the
Combine PDF form) and a select-all in the header. This reuses those ticks: the button
collects them and opens fax/newFax.jsp with the documents pre-selected, so a doctor can
fax several chart documents together without downloading anything.

Deliberately does NOT go through the page's own submitForm(): that posts document.forms[2]
to a Struts action after repointing form.action, so hijacking it would leave Combine PDF
broken whenever the popup is blocked or the user cancels.

Run ON the OSCAR box:  sudo python3 patch_documentreport_faxselected.py

Idempotent, asserts each anchor matches exactly once, and leaves a .oscarbak.<stamp>.
After running, delete the compiled JSP so Tomcat recompiles:
  rm /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/dms/documentReport_jsp.*
"""

import os
import shutil
import sys
import time

TARGET = '/opt/tomcat9/webapps/oscar/dms/documentReport.jsp'

# popup1(height, width, url, windowName) is defined in this page itself, so the button
# does not depend on anything Oscar.js does or does not export.
FAX_JS = '''function mymdFaxSelected(){
   var boxes = document.querySelectorAll('input[name="docNo"]:checked');
   if(!boxes.length){ alert('Tick the documents you want to fax first.'); return false; }
   if(boxes.length > 20){ alert('Fax at most 20 documents at a time.'); return false; }
   var ids = [];
   for(var i=0;i<boxes.length;i++){ ids.push(boxes[i].value); }
   // Window name matches the Fax button in dms/MultiPageDocDisplay.jsp so the two entry
   // points reuse one window instead of stacking popups.
   popup1(780, 800, '<%=request.getContextPath()%>/fax/newFax.jsp?demographicNo='
       + encodeURIComponent('<%=moduleid%>') + '&docNos=' + encodeURIComponent(ids.join(',')),
       'faxdoc');
   return false;
}

'''

JS_ANCHOR = 'function popup1(height, width, url, windowName){'

BTN_ANCHOR = ('onclick="return submitForm(\'<rewrite:reWrite jspPage="combinePDFs.do"/>\');" />')

# Only for a patient chart: the provider module has no fax destination and no
# ctl_document scoping to hang this off.
FAX_BTN = '''
        <% if( module.equals("demographic") ) { %>
        <input type="button" class="btn" value="Fax Selected"
          title="Fax the ticked documents together, with an optional cover page"
          onclick="return mymdFaxSelected();" />
        <% } %>'''


def main():
    if not os.path.isfile(TARGET):
        raise SystemExit('not found: %s' % TARGET)

    s = open(TARGET, encoding='latin-1').read()

    if 'mymdFaxSelected' in s:
        print('documentReport.jsp already has Fax Selected - skipped')
        return

    edits = [
        (JS_ANCHOR, FAX_JS + JS_ANCHOR),          # the function, before popup1
        (BTN_ANCHOR, BTN_ANCHOR + FAX_BTN),       # the button, right after Combine PDF
    ]
    for old, new in edits:
        n = s.count(old)
        assert n == 1, 'expected 1 match, found %d for %r' % (n, old[:70])
        s = s.replace(old, new)

    backup = '%s.oscarbak.%s' % (TARGET, time.strftime('%Y%m%d%H%M%S'))
    shutil.copy2(TARGET, backup)
    with open(TARGET, 'w', encoding='latin-1') as fh:
        fh.write(s)
    shutil.chown(TARGET, 'tomcat', 'tomcat')
    os.chmod(TARGET, 0o640)
    print('patched %s (backup %s)' % (TARGET, backup))
    print('now: rm /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/dms/documentReport_jsp.*')


if __name__ == '__main__':
    sys.exit(main())
