<%--
  MyMD custom page: email a patient from OSCAR.

  Deployed to /opt/tomcat9/webapps/oscar/mymd/emailPatient.jsp on the live OSCAR box.
  This copy is kept in the repo because a WAR redeploy wipes the webapp directory.

  Entry points:
    ?demographicNo=29    - from the eChart header ("Email" link)
    ?appointmentNo=57    - from the Edit Appointment window ("Email Reminder" button);
                           the demographic is resolved from the appointment row and the
                           body is pre-filled with the appointment date/time/provider.

  Sends as info@mymdonline.ca via the GoDaddy SMTP account. Credentials live in
  /var/lib/OscarDocument/oscar/mymd_mail.properties (tomcat:tomcat 600, outside the web
  root) - never inline them here. Every attempt is logged to mymd_patient_email_log.
--%>
<%@ page import="java.io.File" %>
<%@ page import="java.io.FileInputStream" %>
<%@ page import="java.io.InputStream" %>
<%@ page import="java.sql.Connection" %>
<%@ page import="java.sql.DriverManager" %>
<%@ page import="java.sql.PreparedStatement" %>
<%@ page import="java.sql.ResultSet" %>
<%@ page import="java.sql.Timestamp" %>
<%@ page import="java.text.SimpleDateFormat" %>
<%@ page import="java.util.Properties" %>
<%@ page import="javax.mail.Authenticator" %>
<%@ page import="javax.mail.PasswordAuthentication" %>
<%@ page import="javax.mail.Transport" %>
<%@ page import="javax.mail.internet.InternetAddress" %>
<%@ page import="javax.mail.internet.MimeMessage" %>
<%@ page import="org.oscarehr.util.LoggedInInfo" %>
<%@ page import="org.owasp.encoder.Encode" %>
<%@ page contentType="text/html;charset=UTF-8" %>
<%!
    private static final String MAIL_PROPS = "/var/lib/OscarDocument/oscar/mymd_mail.properties";
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

    /** Footer appended to every outgoing message. */
    private String footer(String clinicPhone) {
        return "\n\n--\nMyMD Telehealth\n" + clinicPhone + "\n"
             + "This mailbox is not monitored for urgent matters. If this is an emergency, call 911.\n"
             + "Please do not reply with personal health information - email is not a secure channel.";
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

        // ---- send ----------------------------------------------------------------------
        if (isPost && found && patientEmail.length() > 0) {
            postedSubject = request.getParameter("subject");
            postedBody = request.getParameter("body");
            if (postedSubject == null) postedSubject = "";
            if (postedBody == null) postedBody = "";
            postedSubject = postedSubject.trim();
            postedBody = postedBody.trim();

            if (postedSubject.length() == 0 || postedBody.length() == 0) {
                resultMsg = "Subject and message are both required - nothing was sent.";
            } else {
                Properties mp = loadMailProps();
                String host = mp.getProperty("mail.host");
                String port = mp.getProperty("mail.port", "465");
                final String user = mp.getProperty("mail.user");
                final String pass = mp.getProperty("mail.password");
                String from = mp.getProperty("mail.from", user);
                String fromName = mp.getProperty("mail.fromName", "MyMD Telehealth");
                String clinicPhone = mp.getProperty("mail.clinicPhone", "");

                // NOTE: the recipient comes from the database row loaded above, never from the
                // posted form, so a tampered form cannot redirect the message elsewhere.
                String fullBody = postedBody + footer(clinicPhone);

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
                    msg.setText(fullBody, "UTF-8");
                    msg.setSentDate(new java.util.Date());
                    Transport.send(msg);

                    status = "SENT";
                    resultOk = true;
                    resultMsg = "Email sent to " + patientEmail + ".";
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
                      + "(demographic_no, appointment_no, provider_no, to_email, subject, body, status, error_msg, sent_datetime) "
                      + "VALUES (?,?,?,?,?,?,?,?,?)");
                    lp.setInt(1, demoNo);
                    if (apptNo > 0) lp.setInt(2, apptNo); else lp.setNull(2, java.sql.Types.INTEGER);
                    lp.setString(3, providerNo);
                    lp.setString(4, patientEmail);
                    lp.setString(5, postedSubject);
                    lp.setString(6, fullBody);
                    lp.setString(7, status);
                    lp.setString(8, errorMsg);
                    lp.setTimestamp(9, new Timestamp(System.currentTimeMillis()));
                    lp.executeUpdate();
                    lp.close();
                } catch (Exception logEx) {
                    resultMsg = resultMsg + " (Warning: the audit log entry could not be written: "
                              + logEx.getMessage() + ")";
                }
            }
        }

        // ---- signature + appointment prefill -------------------------------------------
        String signature = "";
        PreparedStatement sps = conn.prepareStatement(
            "SELECT first_name, last_name, provider_type FROM provider WHERE provider_no = ?");
        sps.setString(1, providerNo);
        ResultSet srs = sps.executeQuery();
        if (srs.next()) {
            String sname = tidyName((srs.getString("first_name") == null ? "" : srs.getString("first_name"))
                                  + " " + (srs.getString("last_name") == null ? "" : srs.getString("last_name")));
            if (sname.length() > 0) {
                signature = ("doctor".equalsIgnoreCase(srs.getString("provider_type")) ? "Dr. " : "") + sname;
            }
        }
        srs.close(); sps.close();

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

        <form method="post" class="card" onsubmit="return confirmSend();">
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
                A standard footer (clinic name, phone, emergency notice, and a "do not reply with personal
                health information" warning) is added automatically.
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
                return confirm('Send this email to <%= Encode.forJavaScriptBlock(patientEmail) %>?');
            }
        </script>

    <% } %>

    <%-- ---- history -------------------------------------------------------------- --%>
    <div class="card">
        <b>Previous emails to this patient</b>
        <%
            PreparedStatement hp = conn.prepareStatement(
                "SELECT l.sent_datetime, l.subject, l.status, l.to_email, "
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
        %>
            <tr>
                <td><%= ts == null ? "" : new SimpleDateFormat("yyyy-MM-dd HH:mm").format(ts) %></td>
                <td><%= esc(by) %></td>
                <td><%= esc(hrs.getString("to_email")) %></td>
                <td><%= esc(hrs.getString("subject")) %></td>
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
