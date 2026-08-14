<%--
  Custom endpoint: fax the patient's most recent saved eForm (fid) to a fax number.
  Renders the saved form to PDF (wkhtmltopdf, authenticated via forwarded cookies) and
  queues it in the `faxes` table — the same queue the New Fax page uses; the SRFax
  poller picks it up within ~30s. Generic on fid so any requisition eForm can use it.
  Params: demographicNo, fid, faxNumber (10 digits). Returns plaintext SUCCESS/ERROR.
  Backup/patch tracked in memory reference_oscar_live_jsp_patches.
--%><%@ page import="java.sql.*, java.io.*, java.util.*" %><%@
 page import="com.itextpdf.text.pdf.PdfReader" %><%@
 page import="oscar.OscarProperties" %><%@
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

// ---- config (same DB + faxline as fax/newFax.jsp) ----
final String DB_URL  = "jdbc:mysql://127.0.0.1:3306/oscar_db?useSSL=false";
// Credentials come from OSCAR's own config rather than being copied in here: this file
// sits in the web root and is kept in the repo, and it should not be a second place the
// database password has to be changed.
final String DB_USER = OscarProperties.getInstance().getProperty("db_username", "oscar");
final String DB_PW   = OscarProperties.getInstance().getProperty("db_password", "");
final String FAXLINE = "6046283830";

String fdid = null, provName = providerNo;
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

    out.print("SUCCESS: fax queued to " + faxNumber + " (" + numPages + " page" + (numPages == 1 ? "" : "s")
        + (attachFiles.isEmpty() ? "" : ", including " + attachFiles.size() + " attached document" + (attachFiles.size() == 1 ? "" : "s"))
        + ") - it will send within about 30 seconds");
} catch (Exception e) {
    out.print("ERROR: fax queue: " + e.getMessage()); return;
} finally {
    try { plain.delete(); } catch (Exception e) {}
    try { if (assembled != null) assembled.delete(); } catch (Exception e) {}
}
%>
