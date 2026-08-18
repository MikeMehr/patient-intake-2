<%--
  MyMD: import a LifeLabs/Excelleris PDF result as a real OSCAR lab.

  Works from a document already filed in OSCAR (the PDF stays the legal source of truth) and
  turns it into an HL7 v2.3 ORU^R01 that MessageUploader.routeReport ingests, so the result
  lands in the eChart Lab Results tab with discrete values that trend.

  NOTHING is written until the physician approves on the review screen. The patient-match panel
  is the critical control: OSCAR is configured LAB_NOMATCH_NAMES=yes, so it matches on
  sex + DOB + PHN and IGNORES the name -- a wrong PHN would silently file results onto another
  patient's chart. The screen therefore shows which demographic will actually receive the
  results and refuses to proceed if the PDF and the filed document disagree.

  Not in git; a WAR redeploy wipes it. See docs/oscar/lab-import-install.md.
--%>
<%@ page contentType="text/html; charset=UTF-8" %>
<%@ page import="java.io.*, java.sql.*, java.util.*" %>
<%@ page import="org.oscarehr.util.LoggedInInfo, org.oscarehr.util.SpringUtils, org.oscarehr.util.DbConnectionFilter" %>
<%@ page import="org.oscarehr.common.dao.DocumentDao, org.oscarehr.common.model.Document" %>
<%@ page import="org.oscarehr.common.dao.Hl7TextInfoDao, org.oscarehr.common.model.Hl7TextInfo" %>
<%@ page import="oscar.oscarLab.ca.all.upload.MessageUploader, oscar.oscarLab.FileUploadCheck" %>
<%@ page import="oscar.OscarProperties" %>
<%@ page import="org.owasp.encoder.Encode" %>
<%@ page import="mymd.lab.LabPdfParser, mymd.lab.Hl7Builder" %>
<%!
    /** Demographic candidate for the match panel. */
    static class Demo {
        int no; String last, first, sex, dob, hin;
        String label() { return last + ", " + first + "  (#" + no + ")  DOB " + dob + "  " + sex + "  PHN " + hin; }
    }

    static List<Demo> findByHin(Connection c, String hin) throws SQLException {
        List<Demo> out = new ArrayList<Demo>();
        if (hin == null || hin.trim().isEmpty()) return out;
        String sql = "SELECT demographic_no,last_name,first_name,sex,"
                + "year_of_birth,month_of_birth,date_of_birth,hin FROM demographic "
                + "WHERE REPLACE(REPLACE(hin,' ',''),'-','') = ?";
        PreparedStatement ps = c.prepareStatement(sql);
        ps.setString(1, hin.replaceAll("[ -]", ""));
        ResultSet rs = ps.executeQuery();
        while (rs.next()) {
            Demo d = new Demo();
            d.no = rs.getInt(1); d.last = rs.getString(2); d.first = rs.getString(3);
            d.sex = rs.getString(4);
            d.dob = rs.getString(5) + "-" + rs.getString(6) + "-" + rs.getString(7);
            d.hin = rs.getString(8);
            out.add(d);
        }
        rs.close(); ps.close();
        return out;
    }

    /** Demographic the PDF document itself is filed under, or -1. */
    static int linkedDemographic(Connection c, String documentNo) throws SQLException {
        PreparedStatement ps = c.prepareStatement(
                "SELECT module_id FROM ctl_document WHERE document_no=? AND module='demographic'");
        ps.setString(1, documentNo);
        ResultSet rs = ps.executeQuery();
        int id = rs.next() ? rs.getInt(1) : -1;
        rs.close(); ps.close();
        return id;
    }

    static String nz(String s) { return s == null ? "" : s; }
%>
<%
    String user = (String) session.getAttribute("user");
    if (user == null) { response.sendRedirect(request.getContextPath() + "/logout.jsp"); return; }
    LoggedInInfo loggedInInfo = LoggedInInfo.getLoggedInInfoFromSession(request);

    String documentNo = nz(request.getParameter("documentNo")).trim();
    String action = nz(request.getParameter("action"));
    String ctx = request.getContextPath();
%>
<html>
<head>
  <title>Import lab result from PDF</title>
  <style>
    body { font-family: Helvetica, Arial, sans-serif; font-size: 13px; margin: 16px; }
    h2 { margin: 0 0 12px 0; }
    table.results { border-collapse: collapse; width: 100%; }
    table.results th { background: #e8eaf0; text-align: left; padding: 4px 6px; border: 1px solid #c3c7d1; }
    table.results td { padding: 2px 4px; border: 1px solid #dfe2e8; }
    table.results input { border: 1px solid #ccc; padding: 2px 3px; font-size: 12px; }
    tr.groupRow td { background: #f4f5f8; font-weight: bold; }
    tr.abnormal input.val { background: #ffecec; font-weight: bold; }
    .panel { border: 2px solid #2b6cb0; padding: 10px 12px; margin-bottom: 14px; background: #f2f7fd; }
    .panel.bad { border-color: #c0392b; background: #fdf0ee; }
    .warn { border: 2px solid #c0392b; background: #fdf0ee; padding: 8px 12px; margin-bottom: 12px; }
    .note { color: #555; font-size: 12px; }
    .commit { font-size: 15px; padding: 8px 18px; }
    .cmt { color: #666; font-size: 11px; }
  </style>
</head>
<body>
<h2>Import lab result from PDF</h2>

<%
    if (documentNo.isEmpty()) {
        // Recent PDFs, so there is no need to go hunting for a document number.
        Connection lc = DbConnectionFilter.getThreadLocalDbConnection();
        PreparedStatement lps = lc.prepareStatement(
                "SELECT d.document_no, d.doctype, d.docdesc, d.observationdate, "
              + "       c.module_id, dm.last_name, dm.first_name "
              + "FROM document d "
              + "LEFT JOIN ctl_document c ON c.document_no = d.document_no AND c.module='demographic' "
              + "LEFT JOIN demographic dm ON dm.demographic_no = c.module_id "
              + "WHERE d.status='A' AND LOWER(d.docfilename) LIKE '%.pdf' "
              + "ORDER BY d.document_no DESC LIMIT 30");
        ResultSet lrs = lps.executeQuery();
%>
  <p class="note">Download the result from Excelleris Launchpad, file it in OSCAR as a Document the
     way you normally would, then pick it here. The PDF stays filed and remains the source of
     truth; this adds a structured lab record so the values appear under Lab Results and trend.</p>

  <table class="results">
    <tr><th style="width:7%">Doc #</th><th style="width:10%">Type</th><th style="width:33%">Description</th>
        <th style="width:28%">Filed to</th><th style="width:14%">Date</th><th style="width:8%"></th></tr>
<%
        while (lrs.next()) {
            String dno = String.valueOf(lrs.getInt(1));
            String dtype = nz(lrs.getString(2));
            String ddesc = nz(lrs.getString(3));
            String ddate = nz(lrs.getString(4));
            String dlast = lrs.getString(6);
            String pat = dlast == null ? "— not filed to a patient —"
                    : dlast + ", " + nz(lrs.getString(7)) + " (#" + lrs.getInt(5) + ")";
%>
    <tr<%="lab".equalsIgnoreCase(dtype) ? " style=\"background:#f2f7fd;\"" : ""%>>
      <td><%=Encode.forHtml(dno)%></td>
      <td><%=Encode.forHtml(dtype)%></td>
      <td><%=Encode.forHtml(ddesc)%></td>
      <td><%=Encode.forHtml(pat)%></td>
      <td><%=Encode.forHtml(ddate)%></td>
      <td><a href="labImport.jsp?documentNo=<%=Encode.forHtmlAttribute(dno)%>">Import &rarr;</a></td>
    </tr>
<%
        }
        lrs.close(); lps.close();
%>
  </table>

  <form method="get" style="margin-top:14px;">
    <p class="note">Or enter a document number directly:
       <input type="text" name="documentNo" size="8"/>
       <input type="submit" value="Load"/></p>
  </form>
</body></html>
<%
        return;
    }

    // ---- load the document and parse the PDF ----
    DocumentDao documentDao = SpringUtils.getBean(DocumentDao.class);
    Document doc = documentDao.getDocument(documentNo);
    if (doc == null) {
%>
  <div class="warn">No document numbered <%=Encode.forHtml(documentNo)%> exists.</div>
  <p><a href="labImport.jsp">Back</a></p>
</body></html>
<%
        return;
    }

    String docDir = OscarProperties.getInstance().getProperty("DOCUMENT_DIR", "/var/lib/OscarDocument/oscar/document/");
    if (!docDir.endsWith("/")) docDir = docDir + "/";
    File pdf = new File(docDir + doc.getDocfilename());
    if (!pdf.canRead()) {
%>
  <div class="warn">Cannot read the PDF file for document <%=Encode.forHtml(documentNo)%>
      (<%=Encode.forHtml(nz(doc.getDocfilename()))%>). If it was received by fax, check that the
      file is owned by <code>tomcat</code>.</div>
</body></html>
<%
        return;
    }

    LabPdfParser.Report report;
    try {
        report = new LabPdfParser().parse(pdf);
    } catch (Exception e) {
%>
  <div class="warn">Could not read this PDF as a lab report: <%=Encode.forHtml(String.valueOf(e.getMessage()))%></div>
</body></html>
<%
        return;
    }

    // Flatten results so the form and the commit step agree on ordering.
    List<LabPdfParser.Result> flat = new ArrayList<LabPdfParser.Result>();
    for (LabPdfParser.Section s : report.sections) flat.addAll(s.results);

    Connection conn = DbConnectionFilter.getThreadLocalDbConnection();
    List<Demo> matches = findByHin(conn, report.phn);
    int linked = linkedDemographic(conn, documentNo);

    Hl7TextInfoDao hl7Dao = SpringUtils.getBean(Hl7TextInfoDao.class);
    List<Hl7TextInfo> existing = report.accession.isEmpty()
            ? new ArrayList<Hl7TextInfo>() : hl7Dao.searchByAccessionNumber(report.accession);

    // The wrong-patient guard: the PHN on the PDF must resolve to exactly one chart, and that
    // chart must be the one the PDF is filed under.
    boolean matchOk = matches.size() == 1
            && (linked < 0 || linked == matches.get(0).no);
    String matchProblem = null;
    if (matches.isEmpty())        matchProblem = "No chart has PHN " + report.phn + ". OSCAR would not be able to file this result.";
    else if (matches.size() > 1)  matchProblem = "More than one chart carries PHN " + report.phn + ". Resolve the duplicate before importing.";
    else if (linked >= 0 && linked != matches.get(0).no)
        matchProblem = "The PDF's PHN resolves to demographic #" + matches.get(0).no
                + ", but the document is filed under demographic #" + linked
                + ". Do not import until this is resolved.";

    // ---- commit ----
    if ("commit".equals(action)) {
        String[] fVal   = request.getParameterValues("val");
        String[] fUnits = request.getParameterValues("units");
        String[] fRange = request.getParameterValues("range");
        String[] fAbn   = request.getParameterValues("abn");

        if (!matchOk) {
%>
  <div class="warn">Refused: <%=Encode.forHtml(String.valueOf(matchProblem))%></div>
  <p><a href="labImport.jsp?documentNo=<%=Encode.forHtmlAttribute(documentNo)%>">Back</a></p>
</body></html>
<%
            return;
        }
        if (!existing.isEmpty() && !"yes".equals(request.getParameter("dupOverride"))) {
%>
  <div class="warn">Refused: accession <%=Encode.forHtml(report.accession)%> is already in OSCAR
      (lab <%=existing.get(0).getLabNumber()%>). Importing again would double-post the result and
      distort the trend.</div>
  <p><a href="labImport.jsp?documentNo=<%=Encode.forHtmlAttribute(documentNo)%>">Back</a></p>
</body></html>
<%
            return;
        }
        if (fVal == null || fVal.length != flat.size()) {
%>
  <div class="warn">Refused: the review form carried <%=(fVal == null ? 0 : fVal.length)%> values but
      the PDF parses to <%=flat.size()%>. Nothing was imported -- reload and try again.</div>
</body></html>
<%
            return;
        }

        // Apply the reviewed values onto the freshly parsed report, so comments and section
        // notes survive without being round-tripped through the form.
        for (int i = 0; i < flat.size(); i++) {
            LabPdfParser.Result r = flat.get(i);
            r.value    = nz(fVal[i]).trim();
            r.units    = fUnits != null ? nz(fUnits[i]).trim() : r.units;
            r.refRange = fRange != null ? nz(fRange[i]).trim() : r.refRange;
            r.abnFlag  = fAbn   != null ? nz(fAbn[i]).trim()   : r.abnFlag;
        }

        String hl7 = new Hl7Builder().build(report, "LABIMP" + report.accession);
        String outcome, err = null;
        int fileId = -1;
        try {
            fileId = FileUploadCheck.addFile("labimport-" + report.accession + ".hl7",
                    new ByteArrayInputStream(hl7.getBytes("UTF-8")), "0");
            outcome = MessageUploader.routeReport(loggedInInfo, "PATHL7", "PATHL7", hl7, fileId);
        } catch (Exception e) {
            outcome = "failed";
            err = String.valueOf(e);
        }

        // ---- routing safety net (added 2026-08-17) -------------------------------------
        // When the PDF carries no Client Ref # (seen on LifeLabs printed-direct reports),
        // Hl7Builder leaves OBR-16 empty and MessageUploader mints a providerLabRouting row
        // with provider_no='' - the lab then sits in NOBODY's inbox and only the nightly
        // routing check notices (bitten live: lab 4 / demo 82, 2026-08-17). After a
        // successful import: drop any blank-provider rows, and if no valid routing remains,
        // route the lab to the importing provider so a human always sees it.
        boolean routedToImporter = false;
        if (err == null) {
            try {
                int labNo = 0;
                PreparedStatement lps = conn.prepareStatement(
                        "SELECT lab_id FROM hl7TextMessage WHERE fileUploadCheck_id = ? "
                      + "ORDER BY lab_id DESC LIMIT 1");
                lps.setInt(1, fileId);
                ResultSet lrs = lps.executeQuery();
                if (lrs.next()) labNo = lrs.getInt(1);
                lrs.close(); lps.close();
                if (labNo > 0) {
                    PreparedStatement del = conn.prepareStatement(
                            "DELETE FROM providerLabRouting WHERE lab_no=? AND lab_type='HL7' "
                          + "AND TRIM(IFNULL(provider_no,''))=''");
                    del.setInt(1, labNo);
                    del.executeUpdate();
                    del.close();

                    PreparedStatement cnt = conn.prepareStatement(
                            "SELECT COUNT(*) FROM providerLabRouting WHERE lab_no=? AND lab_type='HL7'");
                    cnt.setInt(1, labNo);
                    ResultSet crs = cnt.executeQuery();
                    int remaining = crs.next() ? crs.getInt(1) : 0;
                    crs.close(); cnt.close();

                    if (remaining == 0) {
                        PreparedStatement ins = conn.prepareStatement(
                                "INSERT INTO providerLabRouting (provider_no, lab_no, status, lab_type) "
                              + "VALUES (?, ?, 'N', 'HL7')");
                        ins.setString(1, loggedInInfo.getLoggedInProviderNo());
                        ins.setInt(2, labNo);
                        ins.executeUpdate();
                        ins.close();
                        routedToImporter = true;
                    }
                }
            } catch (Exception routeFixEx) {
                // The import itself succeeded; a failed cleanup must not report it as failed.
                // Worst case is the pre-fix behaviour, which the nightly check still catches.
            }
        }
%>
  <% if (err == null) { %>
    <div class="panel"><b>Imported.</b> <%=flat.size()%> results filed to
        <%=Encode.forHtml(matches.get(0).label())%>.<br/>
        Accession <%=Encode.forHtml(report.accession)%>, upload id <%=fileId%>, outcome
        <code><%=Encode.forHtml(nz(outcome))%></code>.<br/>
        It now appears in the lab inbox for acknowledgement, and under Lab Results in the eChart.
        <% if (routedToImporter) { %><br/><b>Note:</b> the report named no ordering practitioner
        OSCAR could recognise, so it was routed to <b>your</b> lab inbox to acknowledge.<% } %></div>
  <% } else { %>
    <div class="warn"><b>Import failed.</b> <%=Encode.forHtml(err)%><br/>
        Nothing usable was written; check catalina.out.</div>
  <% } %>
  <p><a href="labImport.jsp">Import another</a></p>
</body></html>
<%
        return;
    }

    // ---- review screen ----
%>
  <div class="panel <%=matchOk ? "" : "bad"%>">
    <b>This result will be filed to:</b><br/>
    <% if (matches.size() == 1) { %>
        <span style="font-size:16px;"><%=Encode.forHtml(matches.get(0).label())%></span>
    <% } else { %>
        <span style="font-size:16px;">&mdash; no single chart &mdash;</span>
    <% } %>
    <div class="note" style="margin-top:6px;">
      On the PDF: <%=Encode.forHtml(report.patientName)%> &middot; DOB <%=Encode.forHtml(report.dob)%>
      &middot; <%=Encode.forHtml(report.sex)%> &middot; PHN <%=Encode.forHtml(report.phn)%>
      &middot; accession <%=Encode.forHtml(report.accession)%>
      <br/>OSCAR matches labs on sex + DOB + PHN and ignores the name, so the chart above &mdash;
      not the name printed on the report &mdash; is what receives these values.
    </div>
  </div>

  <% if (matchProblem != null) { %>
    <div class="warn"><b>Cannot import:</b> <%=Encode.forHtml(matchProblem)%></div>
  <% } %>

  <% if (!existing.isEmpty()) { %>
    <div class="warn"><b>Already imported:</b> accession <%=Encode.forHtml(report.accession)%>
        is in OSCAR as lab <%=existing.get(0).getLabNumber()%>. Importing again would double-post
        the result and distort the trend.</div>
  <% } %>

  <% if (!report.warnings.isEmpty()) { %>
    <div class="warn"><b>The parser could not read part of this report:</b>
      <ul><% for (String w : report.warnings) { %><li><%=Encode.forHtml(w)%></li><% } %></ul>
      Anything listed here was <i>not</i> extracted. Check it against the PDF before importing.</div>
  <% } %>

  <p class="note">
    Document <%=Encode.forHtml(documentNo)%>:
    <a href="<%=ctx%>/dms/ManageDocument.do?method=display&doc_no=<%=Encode.forHtmlAttribute(documentNo)%>"
       target="_blank">open the source PDF</a> and check these values against it.
    Correct anything wrong below &mdash; what you approve is what enters the chart.
  </p>

<form method="post" action="labImport.jsp">
  <input type="hidden" name="documentNo" value="<%=Encode.forHtmlAttribute(documentNo)%>"/>
  <input type="hidden" name="action" value="commit"/>

  <table class="results">
    <tr><th style="width:26%">Test</th><th style="width:12%">Result</th><th style="width:5%">Abn</th>
        <th style="width:14%">Reference range</th><th style="width:10%">Units</th>
        <th style="width:16%">Collected</th><th style="width:6%">Status</th></tr>
<%
    String lastSection = null, lastGroup = null;
    for (LabPdfParser.Section s : report.sections) {
        for (LabPdfParser.Result r : s.results) {
            if (!s.code.equals(lastSection)) {
                lastSection = s.code; lastGroup = null;
%>
    <tr class="groupRow"><td colspan="7"><%=Encode.forHtml(s.code)%></td></tr>
<%
            }
            if (r.group != null && !r.group.isEmpty() && !r.group.equals(lastGroup)) {
                lastGroup = r.group;
%>
    <tr class="groupRow"><td colspan="7" style="padding-left:18px; font-weight:normal; font-style:italic;"><%=Encode.forHtml(r.group)%></td></tr>
<%
            }
            boolean abnormal = "A".equalsIgnoreCase(r.abnFlag);
%>
    <tr class="<%=abnormal ? "abnormal" : ""%>">
      <td><%=Encode.forHtml(r.testName)%></td>
      <td><input class="val" type="text" name="val" size="12" value="<%=Encode.forHtmlAttribute(r.value)%>"/></td>
      <td><input type="text" name="abn" size="2" value="<%=Encode.forHtmlAttribute(r.abnFlag)%>"/></td>
      <td><input type="text" name="range" size="14" value="<%=Encode.forHtmlAttribute(r.refRange)%>"/></td>
      <td><input type="text" name="units" size="9" value="<%=Encode.forHtmlAttribute(r.units)%>"/></td>
      <td><%=Encode.forHtml(r.obsDate)%> <%=Encode.forHtml(r.obsTime)%></td>
      <td><%=Encode.forHtml(r.status)%></td>
    </tr>
<%
            for (String c : r.comments) {
%>
    <tr><td colspan="7" class="cmt" style="padding-left:22px;"><%=Encode.forHtml(c)%></td></tr>
<%
            }
        }
    }
%>
  </table>

  <p>
    <% if (!existing.isEmpty()) { %>
      <label><input type="checkbox" name="dupOverride" value="yes"/>
        This really is a new version of accession <%=Encode.forHtml(report.accession)%> &mdash; import anyway</label><br/><br/>
    <% } %>
    <input class="commit" type="submit" value="Approve and import <%=flat.size()%> results"
           <%=matchOk ? "" : "disabled"%>/>
    <% if (!matchOk) { %><span class="note"> &nbsp;Disabled until the patient match is resolved.</span><% } %>
  </p>
</form>
</body>
</html>
