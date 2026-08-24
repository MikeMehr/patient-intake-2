"""Manual PDF upload into the Faxes inbox (Incoming Docs / Fax queue).

Inbound SRFax faxes are nothing more than tomcat-owned PDFs dropped into
/var/lib/OscarDocument/oscar/incomingdocs/1/Fax/ - the Faxes window
(dms/incomingDocs.jsp) just lists that directory, and an unfiled fax has no
database row at all. Stock OSCAR already ships the upload backend
(dms/documentUploader.jsp + DocumentUploadAction, destination=incomingDocs),
so adding PDFs by hand only needs UI wiring:

  provider/appointmentprovideradminday.jsp
      - the "Fax" nav tab was only rendered when the Fax directory was
        non-empty, so an empty queue had no way in. Now always visible;
        alert styling + count superscript only when faxes are pending.
  dms/incomingDocs.jsp
      - "Upload PDF" button beside the Fax/Mail/File/Refile queue buttons,
        opening the stock uploader preselected for the current queue/folder.
  dms/documentUploader.jsp
      - query params destination/destFolder/queue (validated) override the
        sticky user-property defaults so the popup opens preselected, and a
        successful upload refreshes the incomingDocs opener via loadPdf().

Uploads land in the same directory the SRFax bridge writes to and are filed
to patient charts through the identical triage/Save flow. Because Tomcat
itself writes the file, the "PDF must be OWNED by tomcat" rasterisation
gotcha (see README, SRFax bridge section) does not apply.

Run ON the OSCAR box:  sudo python3 patch_fax_upload.py
"""

import shutil
import time

WEBAPP = '/opt/tomcat9/webapps/oscar/'
STAMP = time.strftime('%Y%m%d%H%M%S')


def patch(name, edits):
    p = WEBAPP + name
    s = open(p, encoding='utf-8').read()
    for old, new in edits:
        n = s.count(old)
        assert n == 1, '%s: expected 1 match, found %d for %r' % (name, n, old[:70])
        s = s.replace(old, new)
    bak = p + '.oscarbak.' + STAMP
    shutil.copy2(p, bak)
    open(p, 'w', encoding='utf-8').write(s)
    print('patched', name, '(backup:', bak + ')')


# ── provider/appointmentprovideradminday.jsp ───────────────────────────────
# The whole <li> used to sit inside `if (files.length > 0)`.

FAX_TAB_OLD = '''        File[] files = incomingFaxDir.listFiles();
        File[] faxDirFiles = incomingFaxDir.listFiles();

        if ( (files != null) && (files.length > 0) ) {
%>
<oscar:oscarPropertiesCheck property="SHOW_INCOMING_FAXES" value="yes" defaultVal="true">
\t<security:oscarSec roleName="<%=roleName$%>" objectName="_eDoc" rights="r">
\t<li>
    \t<a class="tabalert" HREF="#" ONCLICK ="popupPage(940,1200,'../dms/incomingDocs.jsp','<bean:message key='inboxmanager.document.incomingDocs'/>');return false;" TITLE='<bean:message key="inboxmanager.document.incomingDocs"/>'>
    \t<span id="oscar_incomingdocs" class="tabalert"><bean:message key='dms.incomingDocs.fax'/><sup><%=faxDirFiles.length%></sup></a></span>
\t</li>
\t</security:oscarSec>
</oscar:oscarPropertiesCheck>
<%
}
       } catch (FileNotFoundException e) {'''

FAX_TAB_NEW = '''        // MyMD: tab is always visible (so PDFs can be uploaded into an empty Fax
        // queue); alert styling and count only when faxes are pending
        File[] faxDirFiles = incomingFaxDir.listFiles();
        int incomingFaxCount = (faxDirFiles == null) ? 0 : faxDirFiles.length;
        String faxTabClass = (incomingFaxCount > 0) ? " class=\\"tabalert\\"" : "";
%>
<oscar:oscarPropertiesCheck property="SHOW_INCOMING_FAXES" value="yes" defaultVal="true">
\t<security:oscarSec roleName="<%=roleName$%>" objectName="_eDoc" rights="r">
\t<li>
    \t<a<%=faxTabClass%> HREF="#" ONCLICK ="popupPage(940,1200,'../dms/incomingDocs.jsp','<bean:message key='inboxmanager.document.incomingDocs'/>');return false;" TITLE='<bean:message key="inboxmanager.document.incomingDocs"/>'>
    \t<span id="oscar_incomingdocs"<%=faxTabClass%>><bean:message key='dms.incomingDocs.fax'/><%=(incomingFaxCount > 0) ? "<sup>"+incomingFaxCount+"</sup>" : ""%></a></span>
\t</li>
\t</security:oscarSec>
</oscar:oscarPropertiesCheck>
<%
       } catch (FileNotFoundException e) {'''


# ── dms/incomingDocs.jsp ───────────────────────────────────────────────────

UPLOAD_BTN_OLD = '''                                    <input type="button" value="<bean:message key="dms.incomingDocs.refile" />" onclick="loadPdf('1','Refile');">

                                </td>'''

UPLOAD_BTN_NEW = '''                                    <input type="button" value="<bean:message key="dms.incomingDocs.refile" />" onclick="loadPdf('1','Refile');">
                                    <%-- MyMD: manual PDF upload into this queue (stock uploader, preselected via query params) --%>
                                    <input type="button" value="Upload PDF" style="font-weight:bold;"
                                           onclick="window.open('documentUploader.jsp?destination=incomingDocs&destFolder=<%=Encode.forUriComponent(pdfDir)%>&queue=<%=Encode.forUriComponent(queueIdStr)%>','uploadPdf','width=800,height=1000,scrollbars=yes,resizable=yes');">
                                </td>'''


# ── dms/documentUploader.jsp ───────────────────────────────────────────────

PRESELECT_OLD = '''    uProp = userPropertyDAO.getProp(user_no, UserProperty.UPLOAD_INCOMING_DOCUMENT_FOLDER);
    String destFolder="Mail";
    if( uProp != null) {
        destFolder=uProp.getValue();
    }

String context = request.getContextPath();'''

PRESELECT_NEW = '''    uProp = userPropertyDAO.getProp(user_no, UserProperty.UPLOAD_INCOMING_DOCUMENT_FOLDER);
    String destFolder="Mail";
    if( uProp != null) {
        destFolder=uProp.getValue();
    }

    // MyMD: query params (from the incomingDocs.jsp "Upload PDF" button) override
    // the sticky user-property defaults, so the page opens preselected
    String reqDestination = request.getParameter("destination");
    if ("pendingDocs".equals(reqDestination) || "incomingDocs".equals(reqDestination)) {
        destination = reqDestination;
    }
    String reqDestFolder = request.getParameter("destFolder");
    if ("Fax".equals(reqDestFolder) || "Mail".equals(reqDestFolder) || "File".equals(reqDestFolder) || "Refile".equals(reqDestFolder)) {
        destFolder = reqDestFolder;
    }
    String reqQueue = request.getParameter("queue");
    if (reqQueue != null && reqQueue.matches("\\\\d+")) {
        queueId = Integer.parseInt(reqQueue);
    }

String context = request.getContextPath();'''

REFRESH_OLD = '''                        let li = document.createElement('li');
                        li.innerHTML = data.result[0].name;
                        $('#msgU').append(li);
                        $('#msgU').show();
                        console.log(data.textStatus);'''

REFRESH_NEW = '''                        let li = document.createElement('li');
                        li.innerHTML = data.result[0].name;
                        $('#msgU').append(li);
                        $('#msgU').show();
                        console.log(data.textStatus);
                        // MyMD: refresh the incomingDocs opener so the new file shows immediately
                        try {
                            if (window.opener && !window.opener.closed
                                && typeof window.opener.loadPdf === 'function'
                                && document.getElementById('destination').value === 'incomingDocs') {
                                window.opener.loadPdf('1', document.getElementById('destFolder').value);
                            }
                        } catch (err) { /* opener gone or inaccessible */ }'''


patch('provider/appointmentprovideradminday.jsp', [(FAX_TAB_OLD, FAX_TAB_NEW)])
patch('dms/incomingDocs.jsp', [(UPLOAD_BTN_OLD, UPLOAD_BTN_NEW)])
patch('dms/documentUploader.jsp', [(PRESELECT_OLD, PRESELECT_NEW),
                                   (REFRESH_OLD, REFRESH_NEW)])
print('done - clear /opt/tomcat9/work/.../jsp/{provider,dms}/ copies of these pages so Tomcat recompiles')
