<%--
  MyMD custom page: email a patient from OSCAR.

  Deployed to /opt/tomcat9/webapps/oscar/mymd/emailPatient.jsp on the live OSCAR box.
  This copy is kept in the repo because a WAR redeploy wipes the webapp directory.

  Entry points:
    ?demographicNo=29    - from the eChart header ("Email" link)
    ?appointmentNo=57    - from the Edit Appointment window ("Email Reminder" button);
                           the demographic is resolved from the appointment row and the
                           body is pre-filled with the appointment date/time/provider.
    &documentNo=5        - from the eChart Documents list ("Email to patient" icon);
                           the stored document is pre-attached after verifying via
                           ctl_document that it belongs to this demographic.

  Sends as info@mymdonline.ca via the GoDaddy SMTP account. Credentials live in
  /var/lib/OscarDocument/oscar/mymd_mail.properties (tomcat:tomcat 600, outside the web
  root) - never inline them here. Every attempt is logged to mymd_patient_email_log.
--%>
<%@ page import="java.io.File" %>
<%@ page import="java.io.FileInputStream" %>
<%@ page import="java.io.InputStream" %>
<%@ page import="java.nio.file.Files" %>
<%@ page import="java.sql.Connection" %>
<%@ page import="java.sql.DriverManager" %>
<%@ page import="java.sql.PreparedStatement" %>
<%@ page import="java.sql.ResultSet" %>
<%@ page import="java.sql.Timestamp" %>
<%@ page import="java.text.SimpleDateFormat" %>
<%@ page import="java.util.ArrayList" %>
<%@ page import="java.util.List" %>
<%@ page import="java.util.Properties" %>
<%@ page import="javax.activation.DataHandler" %>
<%@ page import="javax.mail.Authenticator" %>
<%@ page import="javax.mail.PasswordAuthentication" %>
<%@ page import="javax.mail.Transport" %>
<%@ page import="javax.mail.internet.InternetAddress" %>
<%@ page import="javax.mail.internet.MimeBodyPart" %>
<%@ page import="javax.mail.internet.MimeMessage" %>
<%@ page import="javax.mail.internet.MimeMultipart" %>
<%@ page import="javax.mail.internet.MimeUtility" %>
<%@ page import="javax.mail.util.ByteArrayDataSource" %>
<%@ page import="org.apache.commons.fileupload.FileItem" %>
<%@ page import="org.apache.commons.fileupload.disk.DiskFileItemFactory" %>
<%@ page import="org.apache.commons.fileupload.servlet.ServletFileUpload" %>
<%@ page import="org.oscarehr.util.LoggedInInfo" %>
<%@ page import="org.owasp.encoder.Encode" %>
<%@ page contentType="text/html;charset=UTF-8" %>
<%!
    private static final String MAIL_PROPS = "/var/lib/OscarDocument/oscar/mymd_mail.properties";
    // Matches DOCUMENT_DIR in oscar_mcmaster.properties - where eChart documents live on disk.
    private static final String DOCUMENT_DIR = "/var/lib/OscarDocument/oscar/document/";
    // Base64 inflates ~37% and GoDaddy rejects messages around 25-30 MB, so 15 MB of raw
    // attachment keeps the encoded message comfortably under the ceiling.
    private static final long MAX_ATTACH_TOTAL = 15L * 1024 * 1024;
    private static final String DB_URL = "jdbc:mysql://127.0.0.1:3306/oscar_db?useSSL=false";
    private static final String DB_USER = "oscar";
    private static final String DB_PASS = "oscar_password_2026";

    private Properties loadMailProps() throws Exception {
        Properties p = new Properties();
        InputStream in = new FileInputStream(new File(MAIL_PROPS));
        try { p.load(in); } finally { in.close(); }
        return p;
    }

    private String esc(String s) {
        return s == null ? "" : Encode.forHtml(s);
    }

    /**
     * Tidy a name for a patient-facing message.
     * Several provider records carry the billing number inside first_name (e.g. "Nahid 29328"),
     * which must not appear in an email, so purely numeric tokens are dropped. Names stored in
     * all-caps (common for demographics) are title-cased; mixed-case names are left alone so
     * "McDonald" survives.
     */
    private String tidyName(String raw) {
        if (raw == null) return "";
        StringBuilder sb = new StringBuilder();
        String[] parts = raw.trim().split("\\s+");
        for (int i = 0; i < parts.length; i++) {
            String p = parts[i];
            if (p.length() == 0 || p.matches("\\d+")) continue;
            if (p.equals(p.toUpperCase()) && p.matches(".*[A-Z].*")) {
                p = p.substring(0, 1).toUpperCase() + p.substring(1).toLowerCase();
            }
            if (sb.length() > 0) sb.append(' ');
            sb.append(p);
        }
        return sb.toString();
    }

    /**
     * Footer appended to every outgoing message. Deliberately no phone number - patients are
     * pointed at the website and the info@ mailbox so they book online rather than call.
     */
    private String footer() {
        return "\n\n--\nMyMD Telehealth\nMyMDonline.ca\ninfo@mymdonline.ca\n\n"
             + "This mailbox is not monitored for urgent matters. If this is an emergency, call 911.\n"
             + "Please do not reply with personal health information - email is not a secure channel.";
    }

    /** One uploaded attachment, held in memory just long enough to send. */
    public static class Attach {
        public final String name;
        public final String contentType;
        public final byte[] data;
        public Attach(String name, String contentType, byte[] data) {
            this.name = name; this.contentType = contentType; this.data = data;
        }
    }

    /** Strip any path a browser may prepend to an uploaded filename (old IE sends C:\...). */
    private String baseName(String raw) {
        if (raw == null) return "";
        String n = raw;
        int i = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (i >= 0) n = n.substring(i + 1);
        return n.trim();
    }

    /** Patient-facing filename for a chart document: the description + the stored file's extension. */
    private String docAttachName(String desc, String storedFilename) {
        String name = (desc == null ? "" : desc.trim()).replaceAll("[\\\\/:*?\"<>|]", "_");
        if (name.length() == 0) name = "document";
        String ext = "";
        if (storedFilename != null) {
            int dot = storedFilename.lastIndexOf('.');
            if (dot >= 0) ext = storedFilename.substring(dot);
        }
        return name.toLowerCase().endsWith(ext.toLowerCase()) ? name : name + ext;
    }

    private String fmtSize(long b) {
        if (b < 1024) return b + " B";
        if (b < 1024L * 1024) return Math.round(b / 1024.0) + " KB";
        return (Math.round(b * 10.0 / (1024 * 1024)) / 10.0) + " MB";
    }
%>
<%
    LoggedInInfo loggedInInfo = LoggedInInfo.getLoggedInInfoFromSession(request);
    if (loggedInInfo == null) { response.sendRedirect("../logout.jsp"); return; }
    String providerNo = loggedInInfo.getLoggedInProviderNo();

    String demoParam = request.getParameter("demographicNo");
    String apptParam = request.getParameter("appointmentNo");
    boolean isPost = "POST".equalsIgnoreCase(request.getMethod());

    int demoNo = 0;
    int apptNo = 0;
    String patientFirst = "", patientLast = "", patientEmail = "";
    boolean consent = false;
    boolean found = false;

    String apptWhen = null;        // "Tuesday, July 21, 2026 at 11:45 AM"
    String apptProvider = null;
    String apptLocation = null;

    String resultMsg = null;
    boolean resultOk = false;
    String postedSubject = "", postedBody = "";

    // ---- multipart parsing (attachments) ------------------------------------------------
    // A multipart POST hides the ordinary fields from request.getParameter(), so the fields
    // AND the files are both pulled out here with commons-fileupload (already in WEB-INF/lib).
    String mpSubject = null, mpBody = null, mpDocumentNo = null;
    List<Attach> attachments = new ArrayList<Attach>();
    String attachError = null;
    if (isPost && ServletFileUpload.isMultipartContent(request)) {
        try {
            DiskFileItemFactory factory = new DiskFileItemFactory();
            factory.setSizeThreshold(512 * 1024);
            ServletFileUpload upload = new ServletFileUpload(factory);
            // A little headroom over the attachment cap for the text fields + part headers;
            // the per-attachment running total below is the real limit.
            upload.setSizeMax(MAX_ATTACH_TOTAL + 1024 * 1024);
            upload.setHeaderEncoding("UTF-8");
            List<FileItem> items = upload.parseRequest(request);
            long total = 0;
            for (FileItem item : items) {
                if (item.isFormField()) {
                    if ("subject".equals(item.getFieldName())) mpSubject = item.getString("UTF-8");
                    else if ("body".equals(item.getFieldName())) mpBody = item.getString("UTF-8");
                    else if ("documentNo".equals(item.getFieldName())) mpDocumentNo = item.getString("UTF-8");
                } else {
                    String name = baseName(item.getName());
                    // An untouched <input type=file> still posts one empty part - skip it.
                    if (name.length() == 0 || item.getSize() == 0) { item.delete(); continue; }
                    total += item.getSize();
                    if (total > MAX_ATTACH_TOTAL) {
                        attachError = "Attachments too large: the total must stay under "
                                    + fmtSize(MAX_ATTACH_TOTAL) + ". Nothing was sent.";
                        item.delete();
                        break;
                    }
                    String ct = item.getContentType();
                    if (ct == null || ct.trim().length() == 0) ct = "application/octet-stream";
                    attachments.add(new Attach(name, ct, item.get()));
                    item.delete();
                }
            }
        } catch (org.apache.commons.fileupload.FileUploadBase.SizeLimitExceededException sle) {
            attachError = "Attachments too large: the total must stay under "
                        + fmtSize(MAX_ATTACH_TOTAL) + ". Nothing was sent.";
        } catch (Exception upEx) {
            attachError = "The form upload could not be read (" + upEx.getMessage()
                        + ") - nothing was sent.";
        }
    }

    Class.forName("com.mysql.cj.jdbc.Driver");
    Connection conn = DriverManager.getConnection(DB_URL, DB_USER, DB_PASS);
    try {
        // ---- resolve the appointment (appointment mode) --------------------------------
        if (apptParam != null && apptParam.trim().length() > 0) {
            try { apptNo = Integer.parseInt(apptParam.trim()); } catch (NumberFormatException nfe) { apptNo = 0; }
            if (apptNo > 0) {
                PreparedStatement ps = conn.prepareStatement(
                    "SELECT a.demographic_no, a.appointment_date, a.start_time, a.location, "
                  + "       p.first_name AS pfirst, p.last_name AS plast, p.provider_type AS ptype "
                  + "FROM appointment a LEFT JOIN provider p ON p.provider_no = a.provider_no "
                  + "WHERE a.appointment_no = ?");
                ps.setInt(1, apptNo);
                ResultSet rs = ps.executeQuery();
                if (rs.next()) {
                    demoNo = rs.getInt("demographic_no");
                    java.sql.Date d = rs.getDate("appointment_date");
                    java.sql.Time t = rs.getTime("start_time");
                    if (d != null) {
                        String when = new SimpleDateFormat("EEEE, MMMM d, yyyy").format(d);
                        if (t != null) when += " at " + new SimpleDateFormat("h:mm a").format(t);
                        apptWhen = when;
                    }
                    String pname = tidyName((rs.getString("pfirst") == null ? "" : rs.getString("pfirst"))
                                          + " " + (rs.getString("plast") == null ? "" : rs.getString("plast")));
                    if (pname.length() > 0) {
                        apptProvider = ("doctor".equalsIgnoreCase(rs.getString("ptype")) ? "Dr. " : "") + pname;
                    }
                    apptLocation = rs.getString("location");
                }
                rs.close(); ps.close();
            }
        } else if (demoParam != null && demoParam.trim().length() > 0) {
            try { demoNo = Integer.parseInt(demoParam.trim()); } catch (NumberFormatException nfe) { demoNo = 0; }
        }

        // ---- load the patient ----------------------------------------------------------
        if (demoNo > 0) {
            PreparedStatement ps = conn.prepareStatement(
                "SELECT first_name, last_name, email, consentToUseEmailForCare "
              + "FROM demographic WHERE demographic_no = ?");
            ps.setInt(1, demoNo);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                found = true;
                patientFirst = rs.getString("first_name") == null ? "" : rs.getString("first_name").trim();
                patientLast  = rs.getString("last_name")  == null ? "" : rs.getString("last_name").trim();
                patientEmail = rs.getString("email")      == null ? "" : rs.getString("email").trim();
                consent = rs.getBoolean("consentToUseEmailForCare");
            }
            rs.close(); ps.close();
        }

        // ---- resolve a chart document to attach (documentNo mode) -----------------------
        // The ctl_document join is the security check: a tampered documentNo that belongs to
        // a different patient simply resolves to nothing.
        String docRaw = mpDocumentNo != null ? mpDocumentNo : request.getParameter("documentNo");
        int docNo = 0;
        String docDesc = null, docStoredFile = null, docContentType = null;
        String docName = null;
        long docSize = 0;
        if (found && docRaw != null && docRaw.trim().length() > 0) {
            try { docNo = Integer.parseInt(docRaw.trim()); } catch (NumberFormatException nfe) { docNo = 0; }
            if (docNo > 0) {
                PreparedStatement dp = conn.prepareStatement(
                    "SELECT d.docdesc, d.docfilename, d.contenttype "
                  + "FROM document d JOIN ctl_document c ON c.document_no = d.document_no "
                  + "WHERE d.document_no = ? AND c.module = 'demographic' AND c.module_id = ? "
                  + "AND d.status <> 'D'");
                dp.setInt(1, docNo);
                dp.setInt(2, demoNo);
                ResultSet drs = dp.executeQuery();
                if (drs.next()) {
                    docDesc = drs.getString("docdesc");
                    docStoredFile = drs.getString("docfilename");
                    docContentType = drs.getString("contenttype");
                }
                drs.close(); dp.close();

                if (docStoredFile == null) {
                    docNo = 0;
                    if (resultMsg == null) resultMsg = "The requested chart document was not found "
                        + "for this patient, so it will NOT be attached.";
                } else {
                    // The stored filename comes from our own DB row, but keep the path strictly
                    // inside DOCUMENT_DIR anyway.
                    File df = new File(DOCUMENT_DIR, baseName(docStoredFile));
                    if (!df.isFile()) {
                        docNo = 0;
                        if (resultMsg == null) resultMsg = "The chart document's file is missing on "
                            + "the server, so it will NOT be attached.";
                    } else {
                        docSize = df.length();
                        docName = docAttachName(docDesc, docStoredFile);
                        if (docContentType == null || docContentType.trim().length() == 0)
                            docContentType = "application/octet-stream";
                    }
                }
            }
        }

        // ---- send ----------------------------------------------------------------------
        if (isPost && found && patientEmail.length() > 0) {
            postedSubject = mpSubject != null ? mpSubject : request.getParameter("subject");
            postedBody = mpBody != null ? mpBody : request.getParameter("body");
            if (postedSubject == null) postedSubject = "";
            if (postedBody == null) postedBody = "";
            postedSubject = postedSubject.trim();
            postedBody = postedBody.trim();

            if (attachError != null) {
                resultMsg = attachError;
            } else if (postedSubject.length() == 0 || postedBody.length() == 0) {
                resultMsg = "Subject and message are both required - nothing was sent.";
            } else {
                // Pre-attach the chart document (documentNo mode) ahead of any uploaded files.
                if (docNo > 0 && docName != null) {
                    try {
                        attachments.add(0, new Attach(docName, docContentType,
                            Files.readAllBytes(new File(DOCUMENT_DIR, baseName(docStoredFile)).toPath())));
                    } catch (Exception readEx) {
                        attachError = "The chart document could not be read (" + readEx.getMessage()
                                    + ") - nothing was sent.";
                    }
                    long combined = 0;
                    for (Attach a : attachments) combined += a.data.length;
                    if (attachError == null && combined > MAX_ATTACH_TOTAL) {
                        attachError = "Attachments too large: the chart document plus uploads must "
                                    + "stay under " + fmtSize(MAX_ATTACH_TOTAL) + ". Nothing was sent.";
                    }
                }
                if (attachError != null) {
                    resultMsg = attachError;
                } else {
                Properties mp = loadMailProps();
                String host = mp.getProperty("mail.host");
                String port = mp.getProperty("mail.port", "465");
                final String user = mp.getProperty("mail.user");
                final String pass = mp.getProperty("mail.password");
                String from = mp.getProperty("mail.from", user);
                String fromName = mp.getProperty("mail.fromName", "MyMD Telehealth");

                // NOTE: the recipient comes from the database row loaded above, never from the
                // posted form, so a tampered form cannot redirect the message elsewhere.
                String fullBody = postedBody + footer();

                String attachNames = null;
                if (!attachments.isEmpty()) {
                    StringBuilder an = new StringBuilder();
                    for (Attach a : attachments) {
                        if (an.length() > 0) an.append("; ");
                        an.append(a.name).append(" (").append(fmtSize(a.data.length)).append(")");
                    }
                    attachNames = an.length() > 1000 ? an.substring(0, 1000) : an.toString();
                }

                String status;
                String errorMsg = null;
                try {
                    Properties sp = new Properties();
                    sp.put("mail.smtp.host", host);
                    sp.put("mail.smtp.port", port);
                    sp.put("mail.smtp.auth", "true");
                    sp.put("mail.smtp.ssl.enable", "true");
                    sp.put("mail.smtp.socketFactory.port", port);
                    sp.put("mail.smtp.socketFactory.class", "javax.net.ssl.SSLSocketFactory");
                    sp.put("mail.smtp.socketFactory.fallback", "false");
                    sp.put("mail.smtp.connectiontimeout", "15000");
                    sp.put("mail.smtp.timeout", "15000");
                    sp.put("mail.smtp.writetimeout", "15000");

                    javax.mail.Session mailSession = javax.mail.Session.getInstance(sp, new Authenticator() {
                        protected PasswordAuthentication getPasswordAuthentication() {
                            return new PasswordAuthentication(user, pass);
                        }
                    });

                    MimeMessage msg = new MimeMessage(mailSession);
                    msg.setFrom(new InternetAddress(from, fromName));
                    msg.setReplyTo(new InternetAddress[]{ new InternetAddress(from, fromName) });
                    msg.setRecipients(javax.mail.Message.RecipientType.TO, InternetAddress.parse(patientEmail, false));
                    msg.setSubject(postedSubject, "UTF-8");
                    if (attachments.isEmpty()) {
                        msg.setText(fullBody, "UTF-8");
                    } else {
                        MimeMultipart mixed = new MimeMultipart("mixed");
                        MimeBodyPart textPart = new MimeBodyPart();
                        textPart.setText(fullBody, "UTF-8");
                        mixed.addBodyPart(textPart);
                        for (Attach a : attachments) {
                            MimeBodyPart filePart = new MimeBodyPart();
                            filePart.setDataHandler(new DataHandler(new ByteArrayDataSource(a.data, a.contentType)));
                            filePart.setFileName(MimeUtility.encodeText(a.name, "UTF-8", null));
                            mixed.addBodyPart(filePart);
                        }
                        msg.setContent(mixed);
                    }
                    msg.setSentDate(new java.util.Date());
                    Transport.send(msg);

                    status = "SENT";
                    resultOk = true;
                    resultMsg = "Email sent to " + patientEmail
                              + (attachments.isEmpty() ? "" : " with " + attachments.size()
                                 + (attachments.size() == 1 ? " attachment" : " attachments")) + ".";
                } catch (Exception mailEx) {
                    status = "FAILED";
                    errorMsg = mailEx.toString();
                    if (errorMsg.length() > 500) errorMsg = errorMsg.substring(0, 500);
                    resultMsg = "Send FAILED: " + mailEx.getMessage() + " - nothing was delivered. "
                              + "The attempt has been logged; please try again or phone the patient.";
                }

                // Always log the attempt, sent or failed.
                try {
                    PreparedStatement lp = conn.prepareStatement(
                        "INSERT INTO mymd_patient_email_log "
                      + "(demographic_no, appointment_no, provider_no, to_email, subject, body, attachments, status, error_msg, sent_datetime) "
                      + "VALUES (?,?,?,?,?,?,?,?,?,?)");
                    lp.setInt(1, demoNo);
                    if (apptNo > 0) lp.setInt(2, apptNo); else lp.setNull(2, java.sql.Types.INTEGER);
                    lp.setString(3, providerNo);
                    lp.setString(4, patientEmail);
                    lp.setString(5, postedSubject);
                    lp.setString(6, fullBody);
                    lp.setString(7, attachNames);
                    lp.setString(8, status);
                    lp.setString(9, errorMsg);
                    lp.setTimestamp(10, new Timestamp(System.currentTimeMillis()));
                    lp.executeUpdate();
                    lp.close();
                } catch (Exception logEx) {
                    resultMsg = resultMsg + " (Warning: the audit log entry could not be written: "
                              + logEx.getMessage() + ")";
                }
                } // end attachError-clear branch
            }
        }

        // ---- appointment prefill --------------------------------------------------------
        // Messages are signed by the clinic, not the individual clinician - office staff send
        // these on a doctor's behalf, and the sender is recorded in mymd_patient_email_log anyway.
        String signature = "MyMD Telehealth";

        String greetName = tidyName(patientFirst);
        String greeting = "Hello " + (greetName.length() > 0 ? greetName : "there") + ",";

        String defaultSubject = "";
        String defaultBody = "";
        if (apptNo > 0 && apptWhen != null) {
            defaultSubject = "Your appointment at MyMD Telehealth";
            defaultBody = greeting + "\n\nThis is a reminder of your upcoming appointment:\n\n"
                        + "    Date and time: " + apptWhen + "\n"
                        + (apptProvider != null ? "    With: " + apptProvider + "\n" : "")
                        + (apptLocation != null && apptLocation.trim().length() > 0
                              ? "    Location: " + apptLocation.trim() + "\n" : "")
                        + "\nIf you need to reschedule or cancel, please contact the office in advance.\n\n"
                        + "Thank you,\n" + signature;
        } else if (docNo > 0 && docName != null) {
            defaultSubject = "A document from your doctor's office";
            defaultBody = greeting + "\n\nPlease find attached: "
                        + (docDesc != null && docDesc.trim().length() > 0 ? docDesc.trim() : "your document")
                        + ".\n\nThank you,\n" + signature;
        }
%>
<html>
<head>
<title>Email Patient</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; font-size: 13px; margin: 0; padding: 16px;
         background: #f6f7f9; color: #222; }
  h2 { margin: 0 0 4px 0; font-size: 17px; }
  .sub { color: #666; margin-bottom: 14px; }
  .card { background: #fff; border: 1px solid #d9dde2; border-radius: 5px; padding: 14px; margin-bottom: 14px; }
  label { display: block; font-weight: bold; margin: 10px 0 3px; }
  input[type=text], textarea, select {
    width: 100%; box-sizing: border-box; padding: 6px 7px; font-size: 13px;
    font-family: inherit; border: 1px solid #b9c0c8; border-radius: 3px; }
  textarea { height: 240px; font-family: Menlo, Consolas, monospace; font-size: 12.5px; }
  .ro { background: #eef1f4; color: #333; }
  .warn { background: #fff6e0; border: 1px solid #e5c76b; padding: 9px 11px; border-radius: 4px;
          margin-bottom: 12px; }
  .danger { background: #fdecea; border: 1px solid #e0a9a2; padding: 9px 11px; border-radius: 4px;
            margin-bottom: 12px; }
  .ok { background: #e8f5e9; border: 1px solid #9ccc9f; padding: 9px 11px; border-radius: 4px;
        margin-bottom: 12px; }
  .btn { padding: 7px 15px; font-size: 13px; border-radius: 3px; border: 1px solid #b9c0c8;
         background: #eceff1; cursor: pointer; }
  .btn-primary { background: #1a6fb5; border-color: #155d99; color: #fff; font-weight: bold; }
  table.hist { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.hist th, table.hist td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #e4e7ea; }
  table.hist th { background: #f0f2f5; }
  .muted { color: #777; }
  .foot-note { color: #666; font-size: 11.5px; margin-top: 6px; }
</style>
</head>
<body>

<% if (!found) { %>
    <div class="danger"><b>Patient not found.</b> No demographic record matched this request.</div>
    <button class="btn" onclick="window.close()">Close</button>

<% } else { %>

    <h2>Email <%= esc(patientFirst + " " + patientLast) %></h2>
    <div class="sub">Demographic #<%= demoNo %><%= apptNo > 0 ? " &middot; appointment #" + apptNo : "" %></div>

    <% if (resultMsg != null) { %>
        <div class="<%= resultOk ? "ok" : "danger" %>"><%= esc(resultMsg) %></div>
    <% } %>

    <% if (patientEmail.length() == 0) { %>
        <div class="card">
            <div class="danger"><b>No email address on file for this patient.</b></div>
            <p>Add one in the Master Demographic record, then reopen this window.</p>
            <a class="btn" target="_blank"
               href="<%= request.getContextPath() %>/demographic/demographiccontrol.jsp?demographic_no=<%= demoNo %>&displaymode=edit&dboperation=search_detail">Open Master Record</a>
            <button class="btn" onclick="window.close()">Close</button>
        </div>

    <% } else if (resultOk) { %>
        <div class="card">
            <p>The message has been sent and recorded in this patient's email history.</p>
            <button class="btn btn-primary" onclick="window.close()">Close</button>
            <button class="btn" onclick="window.location.reload()">Send another</button>
        </div>

    <% } else { %>

        <% if (!consent) { %>
            <div class="warn">
                <b>No recorded consent to use email for care.</b>
                This patient's record does not have "consent to use email for care" set.
                Consider confirming with the patient before sending.
            </div>
        <% } %>

        <div class="warn">
            <b>Email is not a secure channel.</b>
            Keep clinical detail out of the message - ask the patient to call or book a visit instead.
        </div>

        <form method="post" enctype="multipart/form-data" class="card" onsubmit="return confirmSend();">
            <label>To</label>
            <input type="text" class="ro" value="<%= esc(patientEmail) %>" readonly>
            <div class="foot-note">Taken from the patient's record. To change it, edit the Master Demographic record.</div>

            <label>From</label>
            <input type="text" class="ro" value="MyMD Telehealth &lt;info@mymdonline.ca&gt;" readonly>

            <label for="tpl">Template</label>
            <select id="tpl" onchange="applyTemplate(this.value)">
                <option value="">-- choose a template --</option>
                <option value="results">Test results are ready - please book a follow-up</option>
                <option value="call">Please call the office</option>
                <option value="appt">Appointment reminder</option>
                <option value="blank">Blank</option>
            </select>

            <label for="subject">Subject</label>
            <input type="text" id="subject" name="subject" maxlength="200"
                   value="<%= esc(postedSubject.length() > 0 ? postedSubject : defaultSubject) %>">

            <label for="body">Message</label>
            <textarea id="body" name="body"><%= esc(postedBody.length() > 0 ? postedBody : defaultBody) %></textarea>
            <div class="foot-note">
                A standard footer (clinic name, website, info@ address, emergency notice, and a
                "do not reply with personal health information" warning) is added automatically.
            </div>

            <% if (docNo > 0 && docName != null) { %>
                <label>Chart attachment</label>
                <input type="text" class="ro" value="<%= esc(docName + " (" + fmtSize(docSize) + ")") %>" readonly>
                <input type="hidden" name="documentNo" value="<%= docNo %>">
                <div class="foot-note">This document from the chart will be attached automatically.</div>
            <% } %>

            <label for="attachments"><%= docNo > 0 ? "Additional attachments" : "Attachments" %></label>
            <input type="file" id="attachments" name="attachments" multiple>
            <div class="foot-note">
                Optional. Up to 15&nbsp;MB total. Attachments are sent as-is and are
                <b>not password-protected</b> - for lab or imaging requisitions prefer the
                "Email to Patient" button on the eForm, which protects the PDF with the
                patient's health number.
            </div>

            <p style="margin-top:14px;">
                <input type="submit" class="btn btn-primary" value="Send Email">
                <button type="button" class="btn" onclick="window.close()">Cancel</button>
            </p>
        </form>

        <script type="text/javascript">
            var GREET = "<%= Encode.forJavaScriptBlock(greeting) %>";
            var SIG = "<%= Encode.forJavaScriptBlock(signature) %>";
            var APPT_BODY = "<%= Encode.forJavaScriptBlock(defaultBody) %>";
            var APPT_SUBJECT = "<%= Encode.forJavaScriptBlock(defaultSubject) %>";

            function applyTemplate(which) {
                var s = document.getElementById('subject');
                var b = document.getElementById('body');
                if (which === 'results') {
                    s.value = "A message from your doctor's office";
                    b.value = GREET + "\n\nYour recent test results are back and your doctor would like to "
                            + "review them with you. Please book a follow-up appointment at your convenience.\n\n"
                            + "Thank you,\n" + SIG;
                } else if (which === 'call') {
                    s.value = "Please call our office";
                    b.value = GREET + "\n\nPlease call our office at your earliest convenience regarding "
                            + "your care.\n\nThank you,\n" + SIG;
                } else if (which === 'appt') {
                    if (APPT_BODY.length > 0) {
                        s.value = APPT_SUBJECT;
                        b.value = APPT_BODY;
                    } else {
                        s.value = "Your appointment at MyMD Telehealth";
                        b.value = GREET + "\n\nThis is a reminder of your upcoming appointment.\n\n"
                                + "Thank you,\n" + SIG;
                    }
                } else if (which === 'blank') {
                    s.value = "";
                    b.value = "";
                }
            }

            function confirmSend() {
                var s = document.getElementById('subject').value.replace(/^\s+|\s+$/g, '');
                var b = document.getElementById('body').value.replace(/^\s+|\s+$/g, '');
                if (!s || !b) { alert('Please fill in both a subject and a message.'); return false; }
                var fi = document.getElementById('attachments');
                var n = <%= docNo > 0 && docName != null ? "1" : "0" %>, total = <%= docSize %>;
                if (fi && fi.files) {
                    n += fi.files.length;
                    for (var i = 0; i < fi.files.length; i++) total += fi.files[i].size;
                }
                if (total > 15 * 1024 * 1024) {
                    alert('Attachments are too large - the total must stay under 15 MB.');
                    return false;
                }
                var what = n === 0 ? 'this email'
                         : 'this email with ' + n + (n === 1 ? ' attachment' : ' attachments');
                return confirm('Send ' + what + ' to <%= Encode.forJavaScriptBlock(patientEmail) %>?');
            }
        </script>

    <% } %>

    <%-- ---- history -------------------------------------------------------------- --%>
    <div class="card">
        <b>Previous emails to this patient</b>
        <%
            PreparedStatement hp = conn.prepareStatement(
                "SELECT l.sent_datetime, l.subject, l.status, l.to_email, l.attachments, "
              + "       p.first_name AS pfirst, p.last_name AS plast "
              + "FROM mymd_patient_email_log l "
              + "LEFT JOIN provider p ON p.provider_no = l.provider_no "
              + "WHERE l.demographic_no = ? ORDER BY l.sent_datetime DESC LIMIT 25");
            hp.setInt(1, demoNo);
            ResultSet hrs = hp.executeQuery();
            boolean anyHistory = false;
        %>
        <table class="hist">
        <%
            while (hrs.next()) {
                if (!anyHistory) {
        %>
            <tr><th>Sent</th><th>By</th><th>To</th><th>Subject</th><th>Status</th></tr>
        <%
                }
                anyHistory = true;
                Timestamp ts = hrs.getTimestamp("sent_datetime");
                String by = ((hrs.getString("pfirst") == null ? "" : hrs.getString("pfirst")) + " "
                           + (hrs.getString("plast") == null ? "" : hrs.getString("plast"))).trim();
                String st = hrs.getString("status");
                String att = hrs.getString("attachments");
        %>
            <tr>
                <td><%= ts == null ? "" : new SimpleDateFormat("yyyy-MM-dd HH:mm").format(ts) %></td>
                <td><%= esc(by) %></td>
                <td><%= esc(hrs.getString("to_email")) %></td>
                <td><%= esc(hrs.getString("subject")) %><%= att != null && att.trim().length() > 0
                        ? " <span title=\"" + esc(att) + "\">&#128206;</span>" : "" %></td>
                <td<%= "FAILED".equals(st) ? " style=\"color:#b3261e;font-weight:bold;\"" : "" %>><%= esc(st) %></td>
            </tr>
        <%
            }
            hrs.close(); hp.close();
            if (!anyHistory) {
        %>
            <tr><td class="muted">No emails have been sent to this patient yet.</td></tr>
        <%  } %>
        </table>
    </div>

<% } %>

<%
    } finally {
        try { conn.close(); } catch (Exception ignore) {}
    }
%>
</body>
</html>
