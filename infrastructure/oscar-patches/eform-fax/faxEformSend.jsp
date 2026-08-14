<%--
  Custom page: confirm the destination and pick chart documents to send with a saved
  eForm requisition, then hand off to faxEformReq.jsp (which renders, assembles and
  queues the fax). Opened as a popup from an eForm's Fax button AFTER the form has
  saved itself, so the "latest saved copy" faxEformReq.jsp picks up is the one on screen.

  Params: demographicNo, fid (both required)
          faxNumber   - digits, prefills the destination box
          label       - what to call the form in the confirm text ("MRI requisition")
          pageChoice  - "1" to offer the page-1-only choice (multi-page forms)
          defaultPages- "1" to preselect page 1 only, anything else = all pages

  Reads nothing sensitive of its own: the document list comes from OSCAR's DocumentDao,
  which is already scoped to this patient's chart, and faxEformReq.jsp re-checks every
  document id against ctl_document before it reads a file. Generic on fid, so any
  requisition eForm can point its Fax button here.
--%><%@ page import="java.util.*" %><%@
 page import="java.text.SimpleDateFormat" %><%@
 page import="org.oscarehr.common.dao.DocumentDao" %><%@
 page import="org.oscarehr.common.model.Document" %><%@
 page import="org.oscarehr.common.dao.DemographicDao" %><%@
 page import="org.oscarehr.common.model.Demographic" %><%@
 page import="org.oscarehr.util.SpringUtils" %><%@
 page import="org.owasp.encoder.Encode" %><%@
 page contentType="text/html;charset=UTF-8" trimDirectiveWhitespaces="true" %><%

Object userObj = session.getAttribute("user");
if (userObj == null) { response.sendRedirect("../logout.jsp"); return; }
String providerNo = String.valueOf(userObj);

String demographicNo = request.getParameter("demographicNo");
String fid = request.getParameter("fid");
if (demographicNo == null || !demographicNo.matches("\\d+") || fid == null || !fid.matches("\\d+")) {
    out.print("<html><body style=\"font-family:sans-serif;padding:20px\">Missing or bad parameters.</body></html>");
    return;
}

String faxPrefill = request.getParameter("faxNumber");
faxPrefill = (faxPrefill == null) ? "" : faxPrefill.replaceAll("[^0-9]", "");
if (faxPrefill.length() == 11 && faxPrefill.startsWith("1")) faxPrefill = faxPrefill.substring(1);

String label = request.getParameter("label");
if (label == null || label.trim().length() == 0) label = "requisition";
if (label.length() > 60) label = label.substring(0, 60);

boolean offerPageChoice = "1".equals(request.getParameter("pageChoice"));
boolean defaultPageOne  = "1".equals(request.getParameter("defaultPages"));

DemographicDao demographicDao = SpringUtils.getBean(DemographicDao.class);
Demographic demo = demographicDao.getDemographicById(Integer.parseInt(demographicNo));
String patientName = (demo == null) ? ("#" + demographicNo)
        : (demo.getLastName() + ", " + demo.getFirstName() + "  " + demo.getHin());

DocumentDao documentDao = SpringUtils.getBean(DocumentDao.class);
List<Document> docs = documentDao.findByDemographicId(demographicNo);
if (docs == null) docs = new ArrayList<Document>();

// Newest first. Observation date is what a clinician thinks of as the document's date;
// fall back to the upload time when it was never set.
Collections.sort(docs, new Comparator<Document>() {
    public int compare(Document a, Document b) {
        Date da = a.getObservationdate() != null ? a.getObservationdate() : a.getUpdatedatetime();
        Date db = b.getObservationdate() != null ? b.getObservationdate() : b.getUpdatedatetime();
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return db.compareTo(da);
    }
});

SimpleDateFormat dfmt = new SimpleDateFormat("yyyy-MM-dd");
%>
<html>
<head>
<title>Fax <%=Encode.forHtml(label)%></title>
<style>
 body { font-family: Helvetica, Arial, sans-serif; font-size: 13px; margin: 0; padding: 14px 16px; color: #222; }
 h1 { font-size: 16px; margin: 0 0 2px 0; }
 .sub { color: #555; margin-bottom: 12px; }
 .box { border: 1px solid #cfd8e3; border-radius: 5px; padding: 10px 12px; margin-bottom: 12px; background: #f7fafd; }
 label.hdr { display: block; font-weight: bold; margin-bottom: 5px; }
 input[type=text] { font-size: 14px; padding: 3px 5px; }
 #docwrap { max-height: 300px; overflow-y: auto; border: 1px solid #cfd8e3; border-radius: 5px; }
 table { border-collapse: collapse; width: 100%; }
 th { text-align: left; font-size: 11px; text-transform: uppercase; color: #566; background: #eef3f9;
      position: sticky; top: 0; padding: 5px 6px; border-bottom: 1px solid #cfd8e3; }
 td { padding: 4px 6px; border-bottom: 1px solid #eceff3; vertical-align: top; }
 tr.off td { color: #999; }
 .type { color: #667; font-size: 11px; }
 .actions { margin-top: 14px; }
 button { font-size: 14px; padding: 6px 14px; }
 #sendBtn { background: #0a7d33; color: #fff; border: 1px solid #0a7d33; border-radius: 4px; font-weight: bold; cursor: pointer; }
 #sendBtn[disabled] { opacity: .6; cursor: default; }
 #result { margin-top: 12px; padding: 9px 11px; border-radius: 4px; display: none; white-space: pre-wrap; }
 .ok { background: #e6f6ea; border: 1px solid #0a7d33; color: #06541f; }
 .bad { background: #fdecec; border: 1px solid #b32020; color: #8a1616; }
 .note { color: #666; font-size: 11px; margin-top: 4px; }
</style>
</head>
<body>

<h1>Fax <%=Encode.forHtml(label)%></h1>
<div class="sub"><%=Encode.forHtml(patientName)%></div>

<div class="box">
  <label class="hdr" for="faxNumber">Fax to</label>
  <input type="text" id="faxNumber" size="16" value="<%=Encode.forHtmlAttribute(faxPrefill)%>">
  <span class="note">10 digits. <%="8665886955".equals(faxPrefill) ? "1-866-588-6955 is MRI Central Intake." : ""%></span>
</div>

<% if (offerPageChoice) { %>
<div class="box">
  <label class="hdr">Pages</label>
  <label><input type="radio" name="pages" id="pagesOne" value="1"<%=defaultPageOne ? " checked" : ""%>> Requisition only</label>
  &nbsp;&nbsp;
  <label><input type="radio" name="pages" id="pagesAll" value="all"<%=defaultPageOne ? "" : " checked"%>> Requisition + appropriateness checklist</label>
  <div class="note">The checklist is required for lumbar spine, knee and hip MRI.</div>
</div>
<% } %>

<div class="box" style="background:#fff;">
  <label class="hdr">Attach documents from this patient's chart</label>
  <input type="text" id="filter" size="30" placeholder="Filter by description or type" oninput="applyFilter()">
  <span class="note">Ticked documents are faxed after the <%=Encode.forHtml(label)%>.</span>
  <div id="docwrap" style="margin-top:8px;">
    <table>
      <tr><th style="width:24px;"></th><th style="width:92px;">Date</th><th>Description</th><th style="width:70px;">View</th></tr>
<%
    int shown = 0;
    for (Document d : docs) {
        String ct = d.getContenttype() == null ? "" : d.getContenttype().toLowerCase();
        boolean faxable = ct.startsWith("application/pdf") || ct.startsWith("image/");
        Date dt = d.getObservationdate() != null ? d.getObservationdate() : d.getUpdatedatetime();
        String dateStr = dt == null ? "" : dfmt.format(dt);
        String desc = d.getDocdesc() == null ? "(no description)" : d.getDocdesc();
        String dtype = d.getDoctype() == null ? "" : d.getDoctype();
        String hay = (desc + " " + dtype + " " + dateStr).toLowerCase();
        shown++;
%>
      <tr class="<%=faxable ? "" : "off"%>" data-hay="<%=Encode.forHtmlAttribute(hay)%>">
        <td><% if (faxable) { %><input type="checkbox" class="docbox" value="<%=d.getDocumentNo()%>"><% } %></td>
        <td><%=Encode.forHtml(dateStr)%></td>
        <td><%=Encode.forHtml(desc)%>
            <div class="type"><%=Encode.forHtml(dtype)%><%=faxable ? "" : " - cannot be faxed (" + Encode.forHtml(ct) + ")"%></div></td>
        <td><a href="../dms/ManageDocument.do?method=display&amp;doc_no=<%=d.getDocumentNo()%>&amp;providerNo=<%=Encode.forUriComponent(providerNo)%>" target="_blank">view</a></td>
      </tr>
<%  }
    if (shown == 0) { %>
      <tr><td colspan="4" style="color:#777;padding:10px;">No documents in this patient's chart.</td></tr>
<%  } %>
    </table>
  </div>
</div>

<div class="actions">
  <button id="sendBtn" onclick="sendFax()">Send fax</button>
  <button onclick="window.close()">Cancel</button>
</div>

<div id="result"></div>

<script type="text/javascript">
var DEMO  = "<%=Encode.forJavaScript(demographicNo)%>";
var FID   = "<%=Encode.forJavaScript(fid)%>";
var LABEL = "<%=Encode.forJavaScript(label)%>";

function applyFilter() {
    var q = document.getElementById("filter").value.toLowerCase();
    var rows = document.querySelectorAll("#docwrap tr[data-hay]");
    for (var i = 0; i < rows.length; i++) {
        var hit = !q || rows[i].getAttribute("data-hay").indexOf(q) >= 0;
        rows[i].style.display = hit ? "" : "none";
    }
}

function show(cls, text) {
    var r = document.getElementById("result");
    r.className = cls;
    r.textContent = text;
    r.style.display = "block";
}

function sendFax() {
    var num = document.getElementById("faxNumber").value.replace(/[^0-9]/g, "");
    if (num.length === 11 && num.charAt(0) === "1") { num = num.substring(1); }
    if (num.length !== 10) { alert("Enter a 10-digit fax number."); return; }

    var ids = [];
    var boxes = document.querySelectorAll("input.docbox:checked");
    for (var i = 0; i < boxes.length; i++) { ids.push(boxes[i].value); }

    var pages = "all";
    var p1 = document.getElementById("pagesOne");
    if (p1 && p1.checked) { pages = "1"; }

    var what = ids.length
        ? (" with " + ids.length + " attached document" + (ids.length === 1 ? "" : "s"))
        : " with no attachments";
    if (!confirm("Fax this " + LABEL + " to " + num + what + "?")) { return; }

    var btn = document.getElementById("sendBtn");
    btn.disabled = true;
    btn.textContent = "Sending...";

    var url = "faxEformReq.jsp?demographicNo=" + encodeURIComponent(DEMO)
            + "&fid=" + encodeURIComponent(FID)
            + "&faxNumber=" + encodeURIComponent(num)
            + "&pages=" + encodeURIComponent(pages)
            + (ids.length ? "&docNos=" + encodeURIComponent(ids.join(",")) : "");

    fetch(url, { credentials: "same-origin" })
        .then(function (r) { return r.text(); })
        .then(function (t) {
            if (t.indexOf("SUCCESS") === 0) {
                show("ok", t);
                setTimeout(function () { window.close(); }, 2500);
            } else {
                show("bad", t);
                btn.disabled = false;
                btn.textContent = "Send fax";
            }
        })
        .catch(function (e) {
            show("bad", "Fax failed: " + e);
            btn.disabled = false;
            btn.textContent = "Send fax";
        });
}
</script>
</body>
</html>
