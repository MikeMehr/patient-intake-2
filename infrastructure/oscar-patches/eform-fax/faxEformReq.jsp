<%--
  Custom endpoint: fax the patient's most recent saved eForm (fid) to a fax number.
  Renders the saved form to PDF (wkhtmltopdf, authenticated via forwarded cookies) and
  queues it in the `faxes` table — the same queue the New Fax page uses; the SRFax
  poller picks it up within ~30s. Generic on fid so any requisition eForm can use it.

  Params: demographicNo, fid, faxNumber (10 digits)   required
          docNos      - CSV of chart document ids to append after the form (max 20)
          pages       - "1" to fax the first page of the form only
          saveToChart - "1" to also file the requisition (on its own, NOT the assembled
                        fax) into the patient's Documents, skipping it if this same saved
                        copy is already there
  Returns plaintext SUCCESS/ERROR.
  Backup/patch tracked in memory reference_oscar_live_jsp_patches.
--%><%@ page import="java.sql.*, java.io.*, java.util.*" %><%@
 page import="com.itextpdf.text.pdf.PdfReader" %><%@
 page import="oscar.OscarProperties" %><%@
 page import="oscar.dms.EDoc" %><%@
 page import="oscar.dms.EDocUtil" %><%@
 page import="org.apache.pdfbox.pdmodel.PDDocument" %><%@
 page import="org.apache.pdfbox.pdmodel.PDPage" %><%@
 page import="org.apache.pdfbox.pdmodel.PDPageContentStream" %><%@
 page import="org.apache.pdfbox.pdmodel.common.PDRectangle" %><%@
 page import="org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject" %><%@
 page import="org.apache.pdfbox.multipdf.PDFMergerUtility" %><%@
 page import="org.apache.pdfbox.text.PDFTextStripper" %><%@
 page trimDirectiveWhitespaces="true" contentType="text/plain;charset=UTF-8" %><%!

// A page with no text and no image/form XObject. wkhtmltopdf leaves one of these at
// the end of any eForm whose last page div carries page-break-after:always, and a
// blank sheet coming out of the recipient's fax machine looks like a transmission fault.
private static boolean pageIsBlank(PDDocument doc, int idx) throws Exception {
    PDPage pg = doc.getPage(idx);
    if (pg.getResources() != null && pg.getResources().getXObjectNames().iterator().hasNext()) return false;
    PDFTextStripper st = new PDFTextStripper();
    st.setStartPage(idx + 1); st.setEndPage(idx + 1);
    return st.getText(doc).trim().length() == 0;
}

// ---- keeping a copy of the requisition in the chart -------------------------------
// The three members below are COPIES of the canonical versions in
// eform/saveEformToChart.jsp. Keep them in sync: if they drift, the worst case is a
// duplicate chart document rather than anything corrupt, but that is still the bug this
// dedup exists to prevent.

// fid -> { doctype, description used in the chart }.
private static final java.util.Map<String, String[]> FORM_FILING = new java.util.HashMap<String, String[]>();
static {
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
    FORM_FILING.put("62", new String[] { "insurance", "Special Authority Request" });
    FORM_FILING.put("52", new String[] { "insurance", "Plan G Request" });
    // Referrals: the decision letter comes back by fax and gets filed under consult -
    // putting the outgoing referral there keeps request and response together.
    FORM_FILING.put("75", new String[] { "consult", "Thrombosis Clinic Referral" });
}

// Is this exact saved eForm already in the chart? Keyed on fdid via EFormDocs, which is
// what makes Save-then-Fax, Fax-then-Save and Fax-twice converge on one document.
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
// `new EDoc()` is deliberate - the multi-arg constructors call preliminaryProcessing(),
// which prefixes the filename with yyyyMMddHHmmss, leaving the row pointing at a name
// that is not the file that was written.
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
    edoc.setAppointmentNo(Integer.valueOf(0));
    edoc.setRestrictToProgram(false);

    String newDocNo = EDocUtil.addDocumentSQL(edoc);
    if (newDocNo == null) {
        try { outFile.delete(); } catch (Exception ig) {}
        throw new Exception("the document could not be registered in the chart");
    }
    try { EDocUtil.attachDocEForm(providerNo, newDocNo, fdid); } catch (Exception ig) {}
    return newDocNo;
}
%><%
response.setContentType("text/plain;charset=UTF-8");

// ---- auth: must be a logged-in provider ----
Object userObj = session.getAttribute("user");
if (userObj == null) { out.print("ERROR: not logged in"); return; }
String providerNo = String.valueOf(userObj);

String demographicNo = request.getParameter("demographicNo");
String fid = request.getParameter("fid");
String faxNumber = request.getParameter("faxNumber");
if (demographicNo == null || !demographicNo.matches("\\d+") || fid == null || !fid.matches("\\d+")) {
    out.print("ERROR: bad parameters"); return;
}
if (faxNumber == null) faxNumber = "";
faxNumber = faxNumber.replaceAll("[^0-9]", "");
if (faxNumber.length() == 11 && faxNumber.startsWith("1")) faxNumber = faxNumber.substring(1);
if (faxNumber.length() != 10) { out.print("ERROR: fax number must be 10 digits"); return; }

// optional: chart documents to send after the form, and how much of the form to send
java.util.List<Integer> attachIds = new java.util.ArrayList<Integer>();
String docNosParam = request.getParameter("docNos");
if (docNosParam != null && docNosParam.trim().length() > 0) {
    for (String rawId : docNosParam.split(",")) {
        String t = rawId.trim();
        if (t.length() == 0) continue;
        if (!t.matches("\\d{1,9}")) { out.print("ERROR: bad document id"); return; }
        Integer id = Integer.valueOf(t);
        if (!attachIds.contains(id)) attachIds.add(id);
    }
    if (attachIds.size() > 20) { out.print("ERROR: too many attachments (max 20)"); return; }
}
boolean firstPageOnly = "1".equals(request.getParameter("pages"));
// Keep a copy of the requisition in the patient's Documents. The requisition ALONE, not
// the assembled fax: the assembly is the requisition plus documents the patient already
// has, so filing that would re-store the same PHI and put a transmission in the Documents
// list where a document belongs. The transmission record already lives in `faxes`.
boolean saveToChart = "1".equals(request.getParameter("saveToChart"));

// ---- config (same DB + faxline as fax/newFax.jsp) ----
final String DB_URL  = "jdbc:mysql://127.0.0.1:3306/oscar_db?useSSL=false";
// Credentials come from OSCAR's own config rather than being copied in here: this file
// sits in the web root and is kept in the repo, and it should not be a second place the
// database password has to be changed.
final String DB_USER = OscarProperties.getInstance().getProperty("db_username", "oscar");
final String DB_PW   = OscarProperties.getInstance().getProperty("db_password", "");
final String FAXLINE = "6046283830";

String fdid = null, provName = providerNo;
String chartDoctype = "requisition", chartLabel = null;
String[] alreadyFiled = null;
java.util.List<String[]> attachFiles = new java.util.ArrayList<String[]>();  // {docfilename, contenttype, docdesc}
Connection c = null;
try {
    c = DriverManager.getConnection(DB_URL, DB_USER, DB_PW);
    PreparedStatement ps = c.prepareStatement(
        "SELECT fdid FROM eform_data WHERE demographic_no=? AND fid=? AND status=1 ORDER BY fdid DESC LIMIT 1");
    ps.setString(1, demographicNo); ps.setString(2, fid);
    ResultSet rs = ps.executeQuery();
    if (rs.next()) fdid = rs.getString(1);
    rs.close(); ps.close();
    if (fdid == null) { out.print("ERROR: no saved copy of this form found for this patient - save it first"); return; }

    PreparedStatement ps2 = c.prepareStatement(
        "SELECT CONCAT(last_name, ', ', first_name) FROM provider WHERE provider_no=?");
    ps2.setString(1, providerNo);
    ResultSet rs2 = ps2.executeQuery();
    if (rs2.next() && rs2.getString(1) != null) provName = rs2.getString(1);
    rs2.close(); ps2.close();

    // Attachments are looked up through ctl_document, so a document that is not in
    // THIS patient's chart cannot be faxed out no matter what the form posts. Ids are
    // already digits-only, checked above, before they reach this IN list.
    for (Integer id : attachIds) {
        PreparedStatement ps3 = c.prepareStatement(
            "SELECT d.docfilename, d.contenttype, d.docdesc FROM document d" +
            " JOIN ctl_document cd ON cd.document_no = d.document_no" +
            " WHERE cd.module='demographic' AND cd.module_id=? AND d.document_no=? AND d.status!='D'");
        ps3.setString(1, demographicNo); ps3.setInt(2, id.intValue());
        ResultSet rs3 = ps3.executeQuery();
        if (!rs3.next()) { rs3.close(); ps3.close(); out.print("ERROR: document " + id + " is not in this patient's chart"); return; }
        String afile = rs3.getString(1);
        String actype = rs3.getString(2) == null ? "" : rs3.getString(2).toLowerCase();
        String adesc = rs3.getString(3) == null ? ("document " + id) : rs3.getString(3);
        rs3.close(); ps3.close();
        if (afile == null || afile.trim().length() == 0) { out.print("ERROR: " + adesc + " has no file on disk"); return; }
        if (!(actype.startsWith("application/pdf") || actype.startsWith("image/"))) {
            out.print("ERROR: " + adesc + " is a " + actype + " - only PDFs and images can be faxed"); return;
        }
        attachFiles.add(new String[] { afile, actype, adesc });
    }

    if (saveToChart) {
        String[] filing = FORM_FILING.get(fid);
        if (filing != null) { chartDoctype = filing[0]; chartLabel = filing[1]; }
        else {
            PreparedStatement ps4 = c.prepareStatement("SELECT form_name FROM eform WHERE fid=?");
            ps4.setString(1, fid);
            ResultSet rs4 = ps4.executeQuery();
            if (rs4.next() && rs4.getString(1) != null) chartLabel = rs4.getString(1).trim();
            rs4.close(); ps4.close();
            if (chartLabel == null || chartLabel.length() == 0) chartLabel = "Requisition";
        }
        // Already filed by the Save to chart button, or by a previous fax of this same
        // saved copy. Send the fax either way, just do not file it twice.
        alreadyFiled = existingFiling(c, fdid);
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
File plain = File.createTempFile("eformfax_" + fdid + "_", ".pdf");
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
} catch (Exception e) {
    out.print("ERROR: render: " + e.getMessage()); return;
}

// ---- 1b) assemble what actually goes down the line ----
String docDirBase = OscarProperties.getInstance().getProperty("DOCUMENT_DIR", "/var/lib/OscarDocument/oscar/document");
if (!docDirBase.endsWith("/")) docDirBase += "/";
File assembled = null;
File reqOnly = null;          // the requisition on its own, for the chart copy
int reqOnlyPages = 0;
try {
    PDDocument main = PDDocument.load(plain);
    try {
        if (firstPageOnly) {
            while (main.getNumberOfPages() > 1) main.removePage(main.getNumberOfPages() - 1);
        } else {
            while (main.getNumberOfPages() > 1 && pageIsBlank(main, main.getNumberOfPages() - 1)) {
                main.removePage(main.getNumberOfPages() - 1);
            }
        }

        // Snapshot here, while `main` is still exactly the requisition and before any
        // attachments are appended to it.
        if (saveToChart && alreadyFiled == null) {
            reqOnlyPages = main.getNumberOfPages();
            reqOnly = File.createTempFile("eformreqcopy_" + fdid + "_", ".pdf");
            main.save(reqOnly);
        }

        for (String[] att : attachFiles) {
            // basename only: a crafted docfilename must not be able to walk out of DOCUMENT_DIR
            String base = new File(att[0]).getName();
            File src = new File(docDirBase + base);
            if (!src.exists() || !src.isFile()) { out.print("ERROR: " + att[2] + " is missing from the document store"); return; }
            if (att[1].startsWith("application/pdf")) {
                PDDocument sd = PDDocument.load(src);
                try { new PDFMergerUtility().appendDocument(main, sd); } finally { sd.close(); }
            } else {
                // one image, one page, scaled to fit inside a half-inch margin
                PDPage ip = new PDPage(PDRectangle.LETTER);
                main.addPage(ip);
                PDImageXObject img = PDImageXObject.createFromFile(src.getAbsolutePath(), main);
                float mw = PDRectangle.LETTER.getWidth() - 72f, mh = PDRectangle.LETTER.getHeight() - 72f;
                float sc = Math.min(mw / img.getWidth(), mh / img.getHeight());
                if (sc > 1f) sc = 1f;
                float iw = img.getWidth() * sc, ih = img.getHeight() * sc;
                PDPageContentStream cs = new PDPageContentStream(main, ip);
                try { cs.drawImage(img, (PDRectangle.LETTER.getWidth() - iw) / 2f, (PDRectangle.LETTER.getHeight() - ih) / 2f, iw, ih); }
                finally { cs.close(); }
            }
        }

        assembled = File.createTempFile("eformfaxout_" + fdid + "_", ".pdf");
        main.save(assembled);
    } finally { main.close(); }
} catch (Exception e) {
    out.print("ERROR: assembling the fax: " + e); return;
}
if (assembled.length() > 20L * 1024L * 1024L) {
    try { assembled.delete(); } catch (Exception ig) {}
    out.print("ERROR: the assembled fax is over 20 MB - send fewer documents"); return;
}

// ---- 2) drop the PDF into DOCUMENT_DIR and queue it in the faxes table ----
try {
    String docDir = docDirBase;
    String filename = "eformfax_" + fid + "_" + System.currentTimeMillis() + ".pdf";
    File outFile = new File(docDir + filename);

    FileInputStream fis = new FileInputStream(assembled);
    FileOutputStream fos = new FileOutputStream(outFile);
    byte[] buf = new byte[8192]; int n;
    while ((n = fis.read(buf)) > 0) fos.write(buf, 0, n);
    fis.close(); fos.close();

    int numPages = 1;
    try { PdfReader pr = new PdfReader(outFile.getAbsolutePath()); numPages = pr.getNumberOfPages(); pr.close(); } catch (Exception ig) {}

    Connection c2 = DriverManager.getConnection(DB_URL, DB_USER, DB_PW);
    PreparedStatement ps = c2.prepareStatement(
        "INSERT INTO faxes (filename,faxline,destination,status,numPages,stamp,user,oscarUser,demographicNo) VALUES (?,?,?,'SENT',?,NOW(),?,?,?)");
    ps.setString(1, filename);
    ps.setString(2, FAXLINE);
    ps.setString(3, faxNumber);
    ps.setInt(4, numPages);
    ps.setString(5, provName);
    ps.setString(6, providerNo);
    ps.setInt(7, Integer.parseInt(demographicNo));
    ps.executeUpdate(); ps.close(); c2.close();

    // ---- 3) keep a copy of the requisition in the chart --------------------------
    // Deliberately after the fax is queued: a filing that fails once the fax is away is
    // reportable, whereas faxing after filing can leave a chart document claiming an
    // order that never went out.
    String chartNote = "";
    if (saveToChart) {
        if (alreadyFiled != null) {
            chartNote = ", already in Documents as #" + alreadyFiled[0];
        } else if (reqOnly != null) {
            try {
                String newDocNo = fileRequisition(reqOnly, docDirBase, demographicNo, fdid,
                                                  providerNo, chartDoctype, chartLabel, reqOnlyPages);
                chartNote = ", and filed in this patient's Documents as #" + newDocNo;
            } catch (Exception fe) {
                chartNote = " - WARNING: the fax was sent but the chart copy failed ("
                          + (fe.getMessage() == null ? fe.toString() : fe.getMessage()) + ")";
            }
        }
    }

    out.print("SUCCESS: fax queued to " + faxNumber + " (" + numPages + " page" + (numPages == 1 ? "" : "s")
        + (attachFiles.isEmpty() ? "" : ", including " + attachFiles.size() + " attached document" + (attachFiles.size() == 1 ? "" : "s"))
        + ") - it will send within about 30 seconds" + chartNote);
} catch (Exception e) {
    out.print("ERROR: fax queue: " + e.getMessage()); return;
} finally {
    try { plain.delete(); } catch (Exception e) {}
    try { if (assembled != null) assembled.delete(); } catch (Exception e) {}
    try { if (reqOnly != null) reqOnly.delete(); } catch (Exception e) {}
}
%>
