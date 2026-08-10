<%--
  MyMD custom page: render an inbound email's HTML body, safely.

  Deployed to /opt/tomcat9/webapps/oscar/mymd/inboxHtml.jsp. Loaded ONLY as the src of the
  sandboxed iframe in mymd/inbox.jsp - never linked directly and never framed anywhere else.

  Why this exists as its own endpoint rather than inlining the HTML into inbox.jsp:

  The body is written by whoever emailed info@mymdonline.ca, which is anyone on the internet.
  Injected into inbox.jsp's DOM it would execute as first-party JavaScript inside a logged-in
  clinician's OSCAR session - full read/write of the EMR, from outside the clinic, with the
  mTLS device gate providing no protection at all because the payload rides in on the
  clinician's own already-certified browser.

  So the HTML is never mixed into an OSCAR page. It is served from here as a standalone
  document and loaded cross-document into an iframe carrying `sandbox=""` - no allow-scripts,
  no allow-same-origin - which puts it in a unique opaque origin with scripting disabled. The
  CSP below is the second, independent layer:

    default-src 'none'   nothing loads by default
    img-src data:        inline images only. Remote images stay BLOCKED on purpose: a remote
                         <img> in an email is a read receipt that confirms the mailbox is live
                         and leaks the clinician's IP to the sender.
    style-src 'unsafe-inline'  so the message still looks like a message
    sandbox              CSP-level sandbox, independent of the iframe attribute

  Two independent mechanisms, either of which alone is sufficient. That is deliberate.
--%>
<%@ page import="java.sql.Connection" %>
<%@ page import="java.sql.PreparedStatement" %>
<%@ page import="java.sql.ResultSet" %>
<%@ page import="java.sql.Timestamp" %>
<%@ page import="org.oscarehr.util.DbConnectionFilter" %>
<%@ page import="org.oscarehr.util.LoggedInInfo" %>
<%@ page trimDirectiveWhitespaces="true" %>
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

    int msgId = 0;
    try { msgId = Integer.parseInt(request.getParameter("id")); } catch (Exception ignored) {}

    String bodyHtml = null;
    if (msgId > 0) {
        PreparedStatement ps = conn.prepareStatement(
            "SELECT body_html FROM mymd_inbox_message WHERE id = ?");
        ps.setInt(1, msgId);
        ResultSet rs = ps.executeQuery();
        if (rs.next()) bodyHtml = rs.getString("body_html");
        rs.close(); ps.close();
    }

    if (bodyHtml == null) {
        response.setStatus(404);
        response.setContentType("text/plain;charset=UTF-8");
        out.print("No HTML body for this message.");
        return;
    }

    try {
        PreparedStatement ap = conn.prepareStatement(
            "INSERT INTO mymd_inbox_access_log "
          + "(provider_no, message_id_fk, action, detail, at_datetime) VALUES (?,?,?,?,?)");
        ap.setString(1, providerNo);
        ap.setInt(2, msgId);
        ap.setString(3, "HTML");
        ap.setString(4, null);
        ap.setTimestamp(5, new Timestamp(System.currentTimeMillis()));
        ap.executeUpdate();
        ap.close();
    } catch (Exception ignored) {
    }

    response.reset();
    response.setContentType("text/html;charset=UTF-8");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy",
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
    // Never let this document be framed by anything except our own inbox page.
    response.setHeader("X-Frame-Options", "SAMEORIGIN");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "private, no-store");

    // The body is emitted verbatim and UNESCAPED - that is the entire point of this endpoint,
    // and it is safe only because of the sandbox + CSP above plus the caller's iframe
    // sandbox attribute. Do not copy this pattern into a page that renders OSCAR chrome.
    out.print("<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<style>body{font:13px Helvetica,Arial,sans-serif;margin:10px;color:#222}"
            + "img{max-width:100%}</style></head><body>");
    out.print(bodyHtml);
    out.print("</body></html>");
%>
