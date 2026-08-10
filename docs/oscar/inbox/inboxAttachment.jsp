<%--
  MyMD custom page: download an inbound-email attachment, or the original .eml.

  Deployed to /opt/tomcat9/webapps/oscar/mymd/inboxAttachment.jsp.

    ?id=<mymd_inbox_attachment.id>   - one attachment
    ?msg=<mymd_inbox_message.id>&raw=1 - the stored original message

  Everything is served as an octet-stream download. Nothing from a stranger's email is ever
  rendered inline by the browser under the OSCAR origin: an .html or .svg attachment executes
  script exactly like an HTML body would, and that would hand a random sender a logged-in
  clinician's EMR session. The one narrow exception is PDF, which clinicians actually need to
  preview and which the browser sandboxes itself.
--%>
<%@ page import="java.io.File" %>
<%@ page import="java.io.FileInputStream" %>
<%@ page import="java.io.InputStream" %>
<%@ page import="java.io.OutputStream" %>
<%@ page import="java.net.URLEncoder" %>
<%@ page import="java.sql.Connection" %>
<%@ page import="java.sql.PreparedStatement" %>
<%@ page import="java.sql.ResultSet" %>
<%@ page import="java.sql.Timestamp" %>
<%@ page import="org.oscarehr.util.DbConnectionFilter" %>
<%@ page import="org.oscarehr.util.LoggedInInfo" %>
<%@ page trimDirectiveWhitespaces="true" %>
<%!
    private static final String STORAGE_ROOT = "/var/lib/OscarDocument/oscar/mymd_inbox";

    /**
     * Content types we are willing to let the browser open in place. PDF only: it is what
     * clinicians actually need to preview, and browsers render it in their own sandbox.
     * Everything else - notably text/html and image/svg+xml - downloads.
     */
    private boolean inlineSafe(String contentType) {
        return contentType != null && contentType.toLowerCase().startsWith("application/pdf");
    }

    /** Strip anything that could break out of a header value. */
    private String headerSafe(String raw) {
        if (raw == null) return "attachment";
        String s = raw.replaceAll("[\\r\\n\\u0000]", "").trim();
        return s.isEmpty() ? "attachment" : s;
    }

    /** ASCII fallback for the legacy filename= parameter. */
    private String asciiName(String raw) {
        String s = headerSafe(raw).replaceAll("[^A-Za-z0-9._ -]", "_");
        return s.isEmpty() ? "attachment" : s;
    }
%>
<%
    String sessionUser = (String) session.getAttribute("user");
    if (sessionUser == null) {
        response.sendRedirect(request.getContextPath() + "/logout.jsp");
        return;
    }
    LoggedInInfo loggedInInfo = LoggedInInfo.getLoggedInInfoFromSession(request);
    if (loggedInInfo == null) {
        response.sendRedirect(request.getContextPath() + "/logout.jsp");
        return;
    }
    String providerNo = loggedInInfo.getLoggedInProviderNo();
    Connection conn = DbConnectionFilter.getThreadLocalDbConnection();

    boolean raw = "1".equals(request.getParameter("raw"));
    int attId = 0, msgId = 0;
    try { attId = Integer.parseInt(request.getParameter("id")); } catch (Exception ignored) {}
    try { msgId = Integer.parseInt(request.getParameter("msg")); } catch (Exception ignored) {}

    String relPath = null;
    String filename = null;
    String contentType = null;
    int auditMsgId = 0;

    // The path always comes out of the database, never off the query string.
    if (raw && msgId > 0) {
        PreparedStatement ps = conn.prepareStatement(
            "SELECT raw_path, subject FROM mymd_inbox_message WHERE id = ?");
        ps.setInt(1, msgId);
        ResultSet rs = ps.executeQuery();
        if (rs.next()) {
            relPath = rs.getString("raw_path");
            filename = "message-" + msgId + ".eml";
            contentType = "message/rfc822";
            auditMsgId = msgId;
        }
        rs.close(); ps.close();
    } else if (attId > 0) {
        PreparedStatement ps = conn.prepareStatement(
            "SELECT a.stored_path, a.filename, a.content_type, a.message_id_fk "
          + "  FROM mymd_inbox_attachment a WHERE a.id = ?");
        ps.setInt(1, attId);
        ResultSet rs = ps.executeQuery();
        if (rs.next()) {
            relPath = rs.getString("stored_path");
            filename = rs.getString("filename");
            contentType = rs.getString("content_type");
            auditMsgId = rs.getInt("message_id_fk");
        }
        rs.close(); ps.close();
    }

    if (relPath == null || relPath.isEmpty()) {
        response.setStatus(404);
        response.setContentType("text/plain;charset=UTF-8");
        out.println("Not found, or this attachment was too large to store. "
                  + "Open the message in webmail instead.");
        return;
    }

    // Containment check. The path came from our own database, but a canonicalised
    // startsWith is cheap and it is the same discipline emailPatient.jsp applies to
    // document filenames.
    File base = new File(STORAGE_ROOT).getCanonicalFile();
    File target = new File(base, relPath).getCanonicalFile();
    if (!target.getPath().startsWith(base.getPath() + File.separator) || !target.isFile()) {
        response.setStatus(404);
        response.setContentType("text/plain;charset=UTF-8");
        out.println("The stored file is missing on the server. The database row still exists; "
                  + "the message can be re-fetched with mymd_mail_sync.py --full.");
        return;
    }

    try {
        PreparedStatement ap = conn.prepareStatement(
            "INSERT INTO mymd_inbox_access_log "
          + "(provider_no, message_id_fk, action, detail, at_datetime) VALUES (?,?,?,?,?)");
        ap.setString(1, providerNo);
        ap.setInt(2, auditMsgId);
        ap.setString(3, raw ? "RAW" : "ATTACH");
        ap.setString(4, filename);
        ap.setTimestamp(5, new Timestamp(System.currentTimeMillis()));
        ap.executeUpdate();
        ap.close();
    } catch (Exception ignored) {
    }

    String disposition = inlineSafe(contentType) ? "inline" : "attachment";
    String safeName = headerSafe(filename);

    response.reset();
    response.setContentType(inlineSafe(contentType) ? contentType : "application/octet-stream");
    response.setHeader("X-Content-Type-Options", "nosniff");
    // Belt and braces: even if a content type slipped through, this stops the file being
    // treated as an active document in the OSCAR origin.
    response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    response.setHeader("Content-Disposition", disposition
        + "; filename=\"" + asciiName(safeName) + "\""
        + "; filename*=UTF-8''" + URLEncoder.encode(safeName, "UTF-8").replace("+", "%20"));
    response.setHeader("Cache-Control", "private, no-store");
    response.setContentLengthLong(target.length());

    InputStream in = new FileInputStream(target);
    OutputStream os = response.getOutputStream();
    try {
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        os.flush();
    } finally {
        in.close();
    }
%>
