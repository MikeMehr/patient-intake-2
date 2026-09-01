<%--
  Custom endpoint: file the patient's most recent saved eForm requisition into their
  OSCAR Documents, so it stops living on somebody's desktop.

  Renders the saved form to PDF exactly the way faxEformReq.jsp does (wkhtmltopdf,
  authenticated by forwarding the caller's cookies), writes it into DOCUMENT_DIR, and
  registers it with EDocUtil.addDocumentSQL - which writes BOTH the `document` row and
  the `ctl_document` row. The ctl_document row is what makes it appear in the chart; a
  document row on its own is orphaned. Generic on fid, so any requisition eForm can use it.

  Params: demographicNo, fid   (required)
          fdid    - the exact saved copy to file; falls back to the newest one for this
                    patient+fid when absent
          pages   - "1" to file the first page only
          force   - "1" to file another copy even though this fdid is already in the chart
          dryRun  - "1" to render and report without writing anything
  Returns plaintext: SUCCESS: / EXISTS: / DRYRUN: / ERROR:, with a trailing #docNo=N
  on SUCCESS and EXISTS.

  NOTE: the render block below (precheck + wkhtmltopdf + %PDF validation + pageIsBlank)
  is duplicated from eform/faxEformReq.jsp, and the same block also exists in
  eform/emailLabReq.jsp and eform/emailImagingReq.jsp. Four copies is one too many;
  extracting it into a /WEB-INF fragment is tracked as its own change, because a static
  include has to be edited and recompiled across all four at once.

  Repo copy: infrastructure/oscar-patches/eform-fax/saveEformToChart.jsp
--%><%@ page import="java.sql.*, java.io.*, java.util.*" %><%@
 page import="oscar.OscarProperties" %><%@
 page import="oscar.dms.EDoc" %><%@
 page import="oscar.dms.EDocUtil" %><%@
 page import="org.oscarehr.util.LoggedInInfo" %><%@
 page import="org.oscarehr.util.SpringUtils" %><%@
 page import="org.oscarehr.managers.SecurityInfoManager" %><%@
 page import="org.apache.pdfbox.pdmodel.PDDocument" %><%@
 page import="org.apache.pdfbox.pdmodel.PDPage" %><%@
 page import="org.apache.pdfbox.text.PDFTextStripper" %><%@
 page trimDirectiveWhitespaces="true" contentType="text/plain;charset=UTF-8" %><%!

// fid -> { doctype, description used in the chart }. Deliberately server-side: the caller
// is an eForm button, and neither the folder a document lands in nor the name it carries
// in the chart should be something a request parameter gets to choose. Anything not listed
// falls back to { "requisition", eform.form_name }.
private static final java.util.Map<String, String[]> FORM_FILING = new java.util.HashMap<String, String[]>();
static {
    // Imaging requisitions. form_name is useless as a chart description for some of these
    // ("MRI LM central"), which is the main reason this map exists at all.
    FORM_FILING.put("39", new String[] { "requisition", "MRI Requisition" });
    FORM_FILING.put("11", new String[] { "requisition", "Bone Density Requisition" });
    FORM_FILING.put("5",  new String[] { "requisition", "Ultrasound Requisition" });
    FORM_FILING.put("4",  new String[] { "requisition", "X-Ray Requisition" });
    FORM_FILING.put("3",  new String[] { "requisition", "Lab Requisition" });
    FORM_FILING.put("6",  new String[] { "requisition", "Imaging Requisition" });
    FORM_FILING.put("7",  new String[] { "requisition", "Imaging Requisition" });
    FORM_FILING.put("16", new String[] { "requisition", "Imaging Requisition" });
    FORM_FILING.put("33", new String[] { "requisition", "Imaging Requisition" });
    FORM_FILING.put("70", new String[] { "requisition", "Imaging Requisition" });
    FORM_FILING.put("74", new String[] { "requisition", "Sleep Study Requisition" });
    // Not requisitions: these are coverage requests, and the decision comes back by fax.
    // Filing them under `insurance` puts the request next to the response in the chart.
    FORM_FILING.put("62", new String[] { "insurance", "Special Authority Request" });
    FORM_FILING.put("52", new String[] { "insurance", "Plan G Request" });
    // Referrals: the decision letter comes back by fax and gets filed under consult -
    // putting the outgoing referral there keeps request and response together.
    FORM_FILING.put("75", new String[] { "consult", "Thrombosis Clinic Referral" });
}

// A page with no text and no image/form XObject. wkhtmltopdf leaves one of these at
// the end of any eForm whose last page div carries page-break-after:always.
private static boolean pageIsBlank(PDDocument doc, int idx) throws Exception {
    PDPage pg = doc.getPage(idx);
    if (pg.getResources() != null && pg.getResources().getXObjectNames().iterator().hasNext()) return false;
    PDFTextStripper st = new PDFTextStripper();
    st.setStartPage(idx + 1); st.setEndPage(idx + 1);
    return st.getText(doc).trim().length() == 0;
}

// Is this exact saved eForm already in the chart? Keyed on fdid via EFormDocs (CamelCase
// table, no @Table annotation so JPA defaulted to the class name), which is what makes
// Save-then-Fax, Fax-then-Save and Fax-twice all converge on a single document instead of
// stacking up duplicates. Returns { documentNo, docdesc, filed-on } or null.
// KEEP IN SYNC with the copy in eform/faxEformReq.jsp.
private static String[] existingFiling(Connection c, String fdid) throws Exception {
    PreparedStatement ps = c.prepareStatement(
        "SELECT ed.document_no, d.docdesc, DATE(d.updatedatetime) FROM EFormDocs ed" +
        " JOIN document d ON d.document_no = ed.document_no" +
        " WHERE ed.fdid=? AND ed.doctype='D' AND (ed.deleted IS NULL OR ed.deleted<>'Y')" +
        "   AND d.status<>'D' ORDER BY ed.id DESC LIMIT 1");
    try {
        ps.setInt(1, Integer.parseInt(fdid));
        ResultSet rs = ps.executeQuery();
        try {
            if (!rs.next()) return null;
            return new String[] { rs.getString(1),
                                  rs.getString(2) == null ? "" : rs.getString(2),
                                  rs.getString(3) == null ? "" : rs.getString(3) };
        } finally { rs.close(); }
    } finally { ps.close(); }
}

// Copy an assembled requisition PDF into DOCUMENT_DIR and register it in the chart.
// Returns the new document_no. KEEP IN SYNC with the copy in eform/faxEformReq.jsp.
//
// Two things here are not obvious and are both silent when you get them wrong:
//  - `new EDoc()`, never the multi-arg constructors. Those call preliminaryProcessing(),
//    which prefixes the filename you passed with yyyyMMddHHmmss - so the row would point
//    at a name that is not the file you just wrote.
//  - the file has to end up OWNED by tomcat, not merely readable. OSCAR's viewer opens it
//    read-write to rasterise page 1, and a file owned by anyone else renders as a broken
//    image with no other symptom. A JSP write is tomcat-owned, so this is free here.
private static String fileRequisition(File pdf, String docDirBase, String demographicNo,
                                      String fdid, String providerNo, String doctype,
                                      String label, int pageCount) throws Exception {
    String outName = "eformreq_" + fdid + "_" + System.currentTimeMillis() + ".pdf";
    File outFile = new File(docDirBase + outName);
    FileInputStream fis = new FileInputStream(pdf);
    FileOutputStream fos = new FileOutputStream(outFile);
    try {
        byte[] buf = new byte[8192]; int n;
        while ((n = fis.read(buf)) > 0) fos.write(buf, 0, n);
    } finally {
        try { fis.close(); } catch (Exception ig) {}
        try { fos.close(); } catch (Exception ig) {}
    }

    java.util.Date now = new java.util.Date();
    String desc = label + " - " + new java.text.SimpleDateFormat("yyyy-MM-dd").format(now);
    // docdesc is varchar(255) and this MySQL runs without strict mode, so an over-long
    // value would truncate silently rather than fail.
    if (desc.length() > 255) desc = desc.substring(0, 255);

    EDoc edoc = new EDoc();
    edoc.setFileName(outName);
    edoc.setDescription(desc);
    edoc.setType(doctype);
    edoc.setCreatorId(providerNo);
    edoc.setResponsibleId(providerNo);
    edoc.setStatus('A');
    edoc.setContentType("application/pdf");
    edoc.setDocPublic("0");
    edoc.setAbnormal(Boolean.FALSE);
    edoc.setModule("demographic");
    edoc.setModuleId(demographicNo);
    edoc.setNumberOfPages(pageCount);
    edoc.setObservationDate(now);
    edoc.setContentDateTime(now);
    edoc.setDateTimeStampAsDate(now);
    edoc.setProgramId(Integer.valueOf(-1));
    edoc.setAppointmentNo(Integer.valueOf(0));   // never null or "" - EDoc's callers parseInt it unguarded
    edoc.setRestrictToProgram(false);

    String newDocNo = EDocUtil.addDocumentSQL(edoc);   // document + ctl_document, one call
    if (newDocNo == null) {
        try { outFile.delete(); } catch (Exception ig) {}
        throw new Exception("the document could not be registered in the chart");
    }
    // The eform<->document link is a nicety; the document is the deliverable. Do not let
    // the least-exercised table in the chain fail a filing that already succeeded.
    try { EDocUtil.attachDocEForm(providerNo, newDocNo, fdid); } catch (Exception ig) {}
    return newDocNo;
}
%><%
response.setContentType("text/plain;charset=UTF-8");

// This endpoint forwards the caller's session cookie into a subprocess and writes to the
// chart. A GET-shaped version of that is a CSRF target, because the browser attaches the
// cookie for free.
if (!"POST".equals(request.getMethod())) { out.print("ERROR: POST required"); return; }

// ---- auth ----
Object userObj = session.getAttribute("user");
if (userObj == null) { out.print("ERROR: not logged in"); return; }
String providerNo = String.valueOf(userObj);
LoggedInInfo loggedInInfo = LoggedInInfo.getLoggedInInfoFromSession(request);
if (loggedInInfo == null) { out.print("ERROR: not logged in"); return; }
try {
    SecurityInfoManager sim = SpringUtils.getBean(SecurityInfoManager.class);
    if (!sim.hasPrivilege(loggedInInfo, "_edoc", "w", null)) {
        out.print("ERROR: you do not have permission to file documents (_edoc)"); return;
    }
} catch (Exception e) { out.print("ERROR: permission check failed: " + e.getMessage()); return; }

// ---- params ----
String demographicNo = request.getParameter("demographicNo");
String fid = request.getParameter("fid");
String fdidParam = request.getParameter("fdid");
if (demographicNo == null || !demographicNo.matches("\\d{1,9}") || fid == null || !fid.matches("\\d{1,9}")) {
    out.print("ERROR: bad parameters"); return;
}
if (fdidParam != null && fdidParam.trim().length() == 0) fdidParam = null;
if (fdidParam != null && !fdidParam.matches("\\d{1,9}")) { out.print("ERROR: bad fdid"); return; }
boolean firstPageOnly = "1".equals(request.getParameter("pages"));
boolean force         = "1".equals(request.getParameter("force"));
boolean dryRun        = "1".equals(request.getParameter("dryRun"));

final String DB_URL  = "jdbc:mysql://127.0.0.1:3306/oscar_db?useSSL=false";
final String DB_USER = OscarProperties.getInstance().getProperty("db_username", "oscar");
final String DB_PW   = OscarProperties.getInstance().getProperty("db_password", "");

String docDirBase = OscarProperties.getInstance().getProperty("DOCUMENT_DIR", "/var/lib/OscarDocument/oscar/document");
if (!docDirBase.endsWith("/")) docDirBase += "/";

String fdid = null, doctype = "requisition", label = null;
Connection c = null;
try {
    c = DriverManager.getConnection(DB_URL, DB_USER, DB_PW);

    if (fdidParam != null) {
        // Trust it only after proving it is this patient's copy of this form. Passing the
        // fdid is what stops two tabs of the same form for the same patient from filing
        // whichever one happened to be saved last.
        PreparedStatement ps = c.prepareStatement(
            "SELECT fdid FROM eform_data WHERE fdid=? AND demographic_no=? AND fid=? AND status=1");
        ps.setString(1, fdidParam); ps.setString(2, demographicNo); ps.setString(3, fid);
        ResultSet rs = ps.executeQuery();
        if (rs.next()) fdid = rs.getString(1);
        rs.close(); ps.close();
        if (fdid == null) { out.print("ERROR: that saved form does not belong to this patient"); return; }
    } else {
        PreparedStatement ps = c.prepareStatement(
            "SELECT fdid FROM eform_data WHERE demographic_no=? AND fid=? AND status=1 ORDER BY fdid DESC LIMIT 1");
        ps.setString(1, demographicNo); ps.setString(2, fid);
        ResultSet rs = ps.executeQuery();
        if (rs.next()) fdid = rs.getString(1);
        rs.close(); ps.close();
        if (fdid == null) { out.print("ERROR: no saved copy of this form found for this patient - save it first"); return; }
    }

    String[] filing = FORM_FILING.get(fid);
    if (filing != null) { doctype = filing[0]; label = filing[1]; }
    else {
        PreparedStatement ps = c.prepareStatement("SELECT form_name FROM eform WHERE fid=?");
        ps.setString(1, fid);
        ResultSet rs = ps.executeQuery();
        if (rs.next() && rs.getString(1) != null) label = rs.getString(1).trim();
        rs.close(); ps.close();
        if (label == null || label.length() == 0) label = "Requisition";
    }

    if (!force) {
        String[] prev = existingFiling(c, fdid);
        if (prev != null) {
            out.print("EXISTS: this requisition is already in the chart as \"" + prev[1] + "\""
                + (prev[2].length() > 0 ? " (filed " + prev[2] + ")" : "")
                + " - open it from Documents, or use Save again to file a second copy. #docNo=" + prev[0]);
            return;
        }
    }
} catch (Exception e) {
    out.print("ERROR: database: " + e.getMessage()); return;
} finally { if (c != null) try { c.close(); } catch (Exception e) {} }

String viewUrl = "http://127.0.0.1:8080/oscar/eform/efmshowform_data.jsp?fdid=" + fdid;

// ---- 0) auth pre-check: the saved form must be reachable in this session ----
try {
    StringBuilder cookieHdr = new StringBuilder();
    javax.servlet.http.Cookie[] pc = request.getCookies();
    if (pc != null) for (javax.servlet.http.Cookie ck : pc) {
        if (cookieHdr.length() > 0) cookieHdr.append("; ");
        cookieHdr.append(ck.getName()).append("=").append(ck.getValue());
    }
    java.net.HttpURLConnection con = (java.net.HttpURLConnection) new java.net.URL(viewUrl).openConnection();
    con.setInstanceFollowRedirects(false);
    con.setRequestProperty("Cookie", cookieHdr.toString());
    con.setConnectTimeout(8000); con.setReadTimeout(20000);
    int code = con.getResponseCode();
    if (code != 200) { out.print("ERROR: cannot access saved form (HTTP " + code + " - login/auth?). fdid=" + fdid); return; }
    java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
    java.io.InputStream in = con.getInputStream(); byte[] buf = new byte[8192]; int n;
    while ((n = in.read(buf)) > 0 && bo.size() < 200000) bo.write(buf, 0, n);
    in.close();
    String peek = bo.toString("UTF-8");
    if (peek.indexOf("FormName") < 0 && peek.indexOf("BGImage") < 0) {
        out.print("ERROR: saved form did not render as expected (auth or fdid issue). fdid=" + fdid); return;
    }
} catch (Exception e) { out.print("ERROR: precheck: " + e.getMessage()); return; }

// ---- 1) render the saved eForm to PDF (wkhtmltopdf, caller's cookies forwarded) ----
File plain = File.createTempFile("eformreq_" + fdid + "_", ".pdf");
File trimmed = null;
try {
    java.util.List<String> cmd = new java.util.ArrayList<String>();
    cmd.add("wkhtmltopdf");
    javax.servlet.http.Cookie[] cookies = request.getCookies();
    if (cookies != null) {
        for (javax.servlet.http.Cookie ck : cookies) {
            cmd.add("--cookie"); cmd.add(ck.getName()); cmd.add(ck.getValue());
        }
    }
    cmd.add("--enable-local-file-access");
    cmd.add("--load-error-handling");       cmd.add("ignore");
    cmd.add("--load-media-error-handling"); cmd.add("ignore");
    cmd.add("--javascript-delay");          cmd.add("2500");
    cmd.add("--no-stop-slow-scripts");
    cmd.add("--quiet");
    cmd.add("-s"); cmd.add("Letter");
    cmd.add("-T"); cmd.add("6mm"); cmd.add("-B"); cmd.add("6mm");
    cmd.add("-L"); cmd.add("6mm"); cmd.add("-R"); cmd.add("6mm");
    cmd.add(viewUrl);
    cmd.add(plain.getAbsolutePath());

    ProcessBuilder pb = new ProcessBuilder(cmd);
    pb.redirectErrorStream(true);
    Process p = pb.start();
    StringBuilder pout = new StringBuilder();
    BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()));
    String ln; while ((ln = br.readLine()) != null) { if (pout.length() < 1000) pout.append(ln).append(" | "); }
    int rc = p.waitFor();
    // wkhtmltopdf can exit non-zero on a non-fatal external-resource miss while still
    // writing a valid PDF - validate the file, not the exit code.
    boolean pdfOk = false;
    if (plain.exists() && plain.length() > 5000) {
        byte[] head = new byte[5];
        FileInputStream fis = new FileInputStream(plain);
        int hr = fis.read(head); fis.close();
        pdfOk = (hr == 5 && head[0] == '%' && head[1] == 'P' && head[2] == 'D' && head[3] == 'F');
    }
    if (!pdfOk) {
        out.print("ERROR: PDF render failed (rc=" + rc + ", size=" + (plain.exists() ? plain.length() : -1) + "): " + pout.toString()); return;
    }

    // ---- 2) trim to what should actually be filed ----
    int pageCount;
    PDDocument main = PDDocument.load(plain);
    try {
        if (firstPageOnly) {
            while (main.getNumberOfPages() > 1) main.removePage(main.getNumberOfPages() - 1);
        } else {
            while (main.getNumberOfPages() > 1 && pageIsBlank(main, main.getNumberOfPages() - 1)) {
                main.removePage(main.getNumberOfPages() - 1);
            }
        }
        pageCount = main.getNumberOfPages();
        trimmed = File.createTempFile("eformreqout_" + fdid + "_", ".pdf");
        main.save(trimmed);
    } finally { main.close(); }

    if (dryRun) {
        out.print("DRYRUN: would file \"" + label + "\" under " + doctype + " - "
            + pageCount + " page" + (pageCount == 1 ? "" : "s") + ", " + trimmed.length() + " bytes. Nothing was written.");
        return;
    }

    // ---- 3) into DOCUMENT_DIR and into the chart ----
    String newDocNo = fileRequisition(trimmed, docDirBase, demographicNo, fdid, providerNo, doctype, label, pageCount);
    out.print("SUCCESS: filed as \"" + label + " - "
        + new java.text.SimpleDateFormat("yyyy-MM-dd").format(new java.util.Date()) + "\" ("
        + pageCount + " page" + (pageCount == 1 ? "" : "s") + ") in this patient's Documents"
        + " under " + doctype + ". #docNo=" + newDocNo);

} catch (Exception e) {
    out.print("ERROR: " + (e.getMessage() == null ? e.toString() : e.getMessage())); return;
} finally {
    try { plain.delete(); } catch (Exception e) {}
    try { if (trimmed != null) trimmed.delete(); } catch (Exception e) {}
}
%>
