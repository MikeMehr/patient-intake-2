<%--
  MyMD custom page: the patient email inbox.

  Deployed to /opt/tomcat9/webapps/oscar/mymd/inbox.jsp on the live OSCAR box. This copy is
  kept in the repo because a WAR redeploy wipes the webapp directory.

  Shows the info@mymdonline.ca mailbox mirrored into oscar_db by mymd_mail_sync.py, linked to
  the chart where the sender's address matches exactly one patient. Reply and Compose hand off
  to mymd/emailPatient.jsp, which already owns the send path and the audit log: patient mode
  for linked messages, ?compose=1 (free-form recipient) for unlinked ones and for new mail.

  Views:
    (no params)            - list, defaulting to the "Needs attention" tab
    ?tab=unassigned|...    - list, filtered
    ?id=123                - one message

  This page NEVER marks anything read in the mailbox itself. "Handled" is an OSCAR-side flag
  in mymd_inbox_message.status. The clinic's new-mail SMS alert decides "unread" from the
  Maildir flags, so writing \Seen back over IMAP would silently kill that alert.

  Security notes, in order of how badly they bite:
    1. Message bodies are attacker-controlled. Anyone can email info@. The plain-text body is
       rendered escaped; the HTML body is NEVER injected into this page's DOM - it only ever
       goes into a sandboxed, script-less iframe served by mymd/inboxHtml.jsp.
    2. All mutations are POST with a synchroniser token. OSCAR ships no CSRF filter and no
       SameSite cookie policy, so a GET that mutated state would be triggerable by an
       <img src> inside the very email being displayed.
    3. Access is logged to mymd_inbox_access_log. This page exposes correspondence across all
       patients at once, so reads need to be attributable.

  Authorization is the same bar as the rest of OSCAR: an authenticated provider session. Any
  authenticated user here can already search every demographic and open any chart, so this is
  not a new class of access - but note the nav link is inside the _admin block, so in practice
  only admins can reach it. Moving that link widens access; see docs/oscar/inbox-install.md.
--%>
<%@ page import="java.sql.Connection" %>
<%@ page import="java.sql.PreparedStatement" %>
<%@ page import="java.sql.ResultSet" %>
<%@ page import="java.sql.Timestamp" %>
<%@ page import="java.security.MessageDigest" %>
<%@ page import="java.security.SecureRandom" %>
<%@ page import="java.math.BigInteger" %>
<%@ page import="java.nio.charset.StandardCharsets" %>
<%@ page import="java.text.SimpleDateFormat" %>
<%@ page import="org.oscarehr.util.DbConnectionFilter" %>
<%@ page import="org.oscarehr.util.LoggedInInfo" %>
<%@ page import="org.owasp.encoder.Encode" %>
<%@ page contentType="text/html;charset=UTF-8" %>
<%!
    private static final String CSRF_ATTR = "mymdInboxCsrf";
    private static final int LIST_LIMIT = 200;
    /** Older than this without a successful poll and the page shows a red banner. */
    private static final long STALE_MINUTES = 30;

    private String esc(String s) {
        return s == null ? "" : Encode.forHtml(s);
    }

    private String escAttr(String s) {
        return s == null ? "" : Encode.forHtmlAttribute(s);
    }

    /**
     * Tidy an all-caps demographic name for display. Same intent as tidyName() in
     * emailPatient.jsp: demographics are stored shouting, and "MEHRAEIN, HOMER" reads badly
     * in a list. Mixed case is left alone so "McDonald" survives.
     */
    private String tidyName(String raw) {
        if (raw == null) return "";
        StringBuilder sb = new StringBuilder();
        for (String p : raw.trim().split("\\s+")) {
            if (p.isEmpty()) continue;
            if (p.equals(p.toUpperCase()) && p.matches(".*[A-Z].*")) {
                p = p.substring(0, 1).toUpperCase() + p.substring(1).toLowerCase();
            }
            if (sb.length() > 0) sb.append(' ');
            sb.append(p);
        }
        return sb.toString();
    }

    private String fmtSize(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format("%.0f KB", bytes / 1024.0);
        return String.format("%.1f MB", bytes / (1024.0 * 1024.0));
    }

    /** Constant-time token comparison. */
    private boolean tokenOk(String expected, String provided) {
        if (expected == null || provided == null) return false;
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                                     provided.getBytes(StandardCharsets.UTF_8));
    }

    private void audit(Connection conn, String providerNo, int msgId, String action, String detail) {
        try {
            PreparedStatement ps = conn.prepareStatement(
                "INSERT INTO mymd_inbox_access_log "
              + "(provider_no, message_id_fk, action, detail, at_datetime) VALUES (?,?,?,?,?)");
            ps.setString(1, providerNo);
            ps.setInt(2, msgId);
            ps.setString(3, action);
            ps.setString(4, detail);
            ps.setTimestamp(5, new Timestamp(System.currentTimeMillis()));
            ps.executeUpdate();
            ps.close();
        } catch (Exception ignored) {
            // An audit failure must not deny care access to the message. It is visible in the
            // Tomcat log; it is not worth failing the page over.
        }
    }
%>
<%
    // ---- auth --------------------------------------------------------------------------
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

    // DbConnectionFilter owns this connection for the life of the request. Do NOT close it -
    // closing it breaks the rest of the filter chain.
    Connection conn = DbConnectionFilter.getThreadLocalDbConnection();

    String ctx = request.getContextPath();

    // ---- CSRF token --------------------------------------------------------------------
    String csrf = (String) session.getAttribute(CSRF_ATTR);
    if (csrf == null) {
        csrf = new BigInteger(130, new SecureRandom()).toString(32);
        session.setAttribute(CSRF_ATTR, csrf);
    }

    String flash = null;
    boolean flashError = false;

    // ---- POST actions ------------------------------------------------------------------
    // Every mutation is POST + token, then redirect, so a refresh cannot repeat it and an
    // <img src> inside a displayed email cannot trigger one.
    if ("POST".equalsIgnoreCase(request.getMethod())) {
        if (!tokenOk(csrf, request.getParameter("csrf"))) {
            response.setStatus(403);
            out.println("<h3>Request rejected</h3><p>Security token mismatch. "
                      + "Reload the inbox and try again.</p>");
            return;
        }
        String action = request.getParameter("action");
        int msgId = 0;
        try { msgId = Integer.parseInt(request.getParameter("id")); } catch (Exception ignored) {}

        if (msgId > 0 && action != null) {
            try {
                if ("assign".equals(action)) {
                    int demoNo = 0;
                    try { demoNo = Integer.parseInt(request.getParameter("demographicNo")); }
                    catch (Exception ignored) {}
                    if (demoNo > 0) {
                        PreparedStatement ps = conn.prepareStatement(
                            "UPDATE mymd_inbox_message SET demographic_no=?, match_method='MANUAL' "
                          + "WHERE id=?");
                        ps.setInt(1, demoNo);
                        ps.setInt(2, msgId);
                        ps.executeUpdate();
                        ps.close();
                        audit(conn, providerNo, msgId, "ASSIGN", "demographic_no=" + demoNo);
                        flash = "Linked to chart #" + demoNo + ".";
                    } else {
                        flash = "Pick a patient from the list first.";
                        flashError = true;
                    }
                } else if ("unassign".equals(action)) {
                    PreparedStatement ps = conn.prepareStatement(
                        "UPDATE mymd_inbox_message SET demographic_no=NULL, match_method=NULL "
                      + "WHERE id=?");
                    ps.setInt(1, msgId);
                    ps.executeUpdate();
                    ps.close();
                    audit(conn, providerNo, msgId, "ASSIGN", "cleared");
                    flash = "Patient link removed.";
                } else if ("handle".equals(action) || "ignore".equals(action)) {
                    String newStatus = "handle".equals(action) ? "HANDLED" : "IGNORED";
                    PreparedStatement ps = conn.prepareStatement(
                        "UPDATE mymd_inbox_message SET status=?, handled_by=?, handled_at=? "
                      + "WHERE id=?");
                    ps.setString(1, newStatus);
                    ps.setString(2, providerNo);
                    ps.setTimestamp(3, new Timestamp(System.currentTimeMillis()));
                    ps.setInt(4, msgId);
                    ps.executeUpdate();
                    ps.close();
                    audit(conn, providerNo, msgId, newStatus.substring(0, 6), null);
                    flash = "handle".equals(action) ? "Marked handled." : "Dismissed.";
                } else if ("reopen".equals(action)) {
                    PreparedStatement ps = conn.prepareStatement(
                        "UPDATE mymd_inbox_message SET status='NEW', handled_by=NULL, "
                      + "handled_at=NULL WHERE id=?");
                    ps.setInt(1, msgId);
                    ps.executeUpdate();
                    ps.close();
                    audit(conn, providerNo, msgId, "HANDLE", "reopened");
                    flash = "Moved back to Needs attention.";
                }
            } catch (Exception ex) {
                flash = "Could not apply that change: " + ex.getMessage();
                flashError = true;
            }
        }
        // POST-redirect-GET.
        String back = request.getParameter("back");
        String target = ctx + "/mymd/inbox.jsp"
                      + (back != null && back.startsWith("?") ? back : "?tab=new");
        target += (target.contains("?") ? "&" : "?") + "msg="
                + java.net.URLEncoder.encode(flash == null ? "" : flash, "UTF-8")
                + (flashError ? "&err=1" : "");
        response.sendRedirect(target);
        return;
    }

    if (request.getParameter("msg") != null && !request.getParameter("msg").isEmpty()) {
        flash = request.getParameter("msg");
        flashError = "1".equals(request.getParameter("err"));
    }

    int detailId = 0;
    try { detailId = Integer.parseInt(request.getParameter("id")); } catch (Exception ignored) {}

    String tab = request.getParameter("tab");
    if (tab == null || !tab.matches("new|unassigned|handled|bulk|all")) tab = "new";

    SimpleDateFormat stamp = new SimpleDateFormat("dd-MMM-yyyy HH:mm");
%>
<html>
<head>
<title>Patient Email</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; font-size: 13px; margin: 0; background: #f4f6f8; color: #222; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 14px 18px 40px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: #667; font-size: 12px; margin-bottom: 12px; }
  .banner { padding: 8px 11px; border-radius: 4px; margin-bottom: 12px; }
  .banner.stale { background: #fdecea; border: 1px solid #f5b7b1; color: #922b21; }
  .banner.ok { background: #eafaf1; border: 1px solid #a9dfbf; color: #1e6f42; }
  .banner.err { background: #fdecea; border: 1px solid #f5b7b1; color: #922b21; }
  .tabs { margin-bottom: 10px; }
  .tabs a { display: inline-block; padding: 6px 12px; margin-right: 4px; background: #e6eaee;
            color: #234; text-decoration: none; border-radius: 4px 4px 0 0; }
  .tabs a.on { background: #fff; font-weight: bold; border: 1px solid #ccd; border-bottom: none; }
  table.list { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ccd; }
  table.list th { text-align: left; background: #eef1f4; padding: 6px 8px; font-size: 12px;
                  border-bottom: 1px solid #ccd; }
  table.list td { padding: 6px 8px; border-bottom: 1px solid #eef; vertical-align: top; }
  table.list tr:hover td { background: #f7fbff; }
  .muted { color: #889; }
  .who { font-weight: bold; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 11px; }
  .pill.unassigned { background: #fff3cd; color: #7d6608; }
  .pill.linked { background: #d6eaf8; color: #1a5276; }
  .pill.bulk { background: #eee; color: #666; }
  .card { background: #fff; border: 1px solid #ccd; border-radius: 4px; padding: 14px; }
  .hdrs { border-bottom: 1px solid #eef; padding-bottom: 10px; margin-bottom: 10px; }
  .hdrs div { margin: 2px 0; }
  pre.body { white-space: pre-wrap; word-wrap: break-word; font-family: Menlo, Consolas, monospace;
             font-size: 12.5px; background: #fbfcfd; border: 1px solid #eef; padding: 10px;
             border-radius: 3px; max-height: 520px; overflow: auto; }
  .actions { margin-top: 12px; padding-top: 10px; border-top: 1px solid #eef; }
  .btn { display: inline-block; padding: 5px 11px; margin-right: 5px; background: #2c6fa8;
         color: #fff; border: none; border-radius: 3px; cursor: pointer; text-decoration: none;
         font-size: 12px; }
  .btn.sec { background: #7a8894; }
  .warn { background: #fff8e1; border: 1px solid #ffe08a; padding: 7px 10px; border-radius: 3px;
          margin-bottom: 10px; font-size: 12px; }
  iframe.htmlbody { width: 100%; height: 460px; border: 1px solid #ccd; background: #fff; }
</style>
</head>
<body>
<div class="wrap">

<h1>Patient Email</h1>
<div class="sub">Inbound mail to info@mymdonline.ca, mirrored into OSCAR.</div>

<%
    // ---- poller health -----------------------------------------------------------------
    // A dead poller must read as an error, not as a quiet inbox.
    try {
        PreparedStatement ps = conn.prepareStatement(
            "SELECT MAX(last_ok_at), MAX(consecutive_errors) FROM mymd_inbox_sync_state");
        ResultSet rs = ps.executeQuery();
        if (rs.next()) {
            Timestamp lastOk = rs.getTimestamp(1);
            int errs = rs.getInt(2);
            long ageMin = lastOk == null ? Long.MAX_VALUE
                        : (System.currentTimeMillis() - lastOk.getTime()) / 60000L;
            if (lastOk == null) {
%>
  <div class="banner stale"><b>The mail mirror has never completed a run.</b>
      Nothing below is current. Check <code>systemctl status mymd-mail-sync.timer</code>.</div>
<%
            } else if (ageMin > STALE_MINUTES) {
%>
  <div class="banner stale"><b>Mail mirror is stale.</b> Last successful sync
      <%= esc(stamp.format(lastOk)) %> (<%= ageMin %> minutes ago<%
      if (errs > 0) { %>, <%= errs %> consecutive failure(s)<% } %>).
      New patient email may not be shown. Check
      <code>journalctl -u mymd-mail-sync -n 30</code>.</div>
<%
            } else {
%>
  <div class="banner ok">Last synced <%= esc(stamp.format(lastOk)) %>.</div>
<%
            }
        }
        rs.close(); ps.close();
    } catch (Exception ex) {
%>
  <div class="banner stale"><b>Cannot read the mirror status.</b>
      <%= esc(ex.getMessage()) %> &mdash; has <code>mymd_inbox.sql</code> been applied?</div>
<%
    }

    if (flash != null && !flash.isEmpty()) {
%>
  <div class="banner <%= flashError ? "err" : "ok" %>"><%= esc(flash) %></div>
<%
    }
%>

<% if (detailId > 0) {
    // =================================================================================
    // Detail view
    // =================================================================================
    PreparedStatement ps = conn.prepareStatement(
        "SELECT m.id, m.from_email, m.from_name, m.to_emails, m.cc_emails, m.subject, "
      + "       m.body_text, m.body_html, m.sent_datetime, m.received_at, m.demographic_no, "
      + "       m.match_count, m.match_method, m.status, m.handled_by, m.handled_at, "
      + "       m.auto_kind, m.parse_error, m.raw_path, m.direction, "
      + "       d.first_name, d.last_name, d.email "
      + "  FROM mymd_inbox_message m "
      + "  LEFT JOIN demographic d ON d.demographic_no = m.demographic_no "
      + " WHERE m.id = ?");
    ps.setInt(1, detailId);
    ResultSet rs = ps.executeQuery();
    if (!rs.next()) {
        rs.close(); ps.close();
%>
  <div class="card">Message not found. <a href="<%= ctx %>/mymd/inbox.jsp">Back to the inbox</a>.</div>
<%
    } else {
        String fromEmail = rs.getString("from_email");
        String fromName  = rs.getString("from_name");
        String toEmails  = rs.getString("to_emails");
        String subject   = rs.getString("subject");
        String bodyText  = rs.getString("body_text");
        String bodyHtml  = rs.getString("body_html");
        Timestamp sentAt = rs.getTimestamp("sent_datetime");
        int demoNo       = rs.getInt("demographic_no");
        boolean hasDemo  = !rs.wasNull() && demoNo > 0;
        int matchCount   = rs.getInt("match_count");
        String status    = rs.getString("status");
        String autoKind  = rs.getString("auto_kind");
        String parseErr  = rs.getString("parse_error");
        String rawPath   = rs.getString("raw_path");
        String dFirst    = rs.getString("first_name");
        String dLast     = rs.getString("last_name");
        rs.close(); ps.close();

        audit(conn, providerNo, detailId, "VIEW", null);

        String backQs = "?tab=" + tab;
%>
  <div class="card">
    <div class="hdrs">
      <div><span class="muted">From:</span>
           <span class="who"><%= esc(fromName != null && !fromName.isEmpty()
                                     ? fromName + " <" + fromEmail + ">" : fromEmail) %></span></div>
      <div><span class="muted">To:</span> <%= esc(toEmails) %></div>
      <div><span class="muted">Date:</span>
           <%= sentAt == null ? "(no date header)" : esc(stamp.format(sentAt)) %></div>
      <div><span class="muted">Subject:</span> <b><%= esc(subject) %></b></div>
      <div><span class="muted">Patient:</span>
<%      if (hasDemo) { %>
        <a href="<%= ctx %>/casemgmt/forward.jsp?action=view&demographicNo=<%= demoNo %>"
           target="_blank"><%= esc(tidyName(dLast + ", " + dFirst)) %></a>
        <span class="muted">(chart #<%= demoNo %>)</span>
<%      } else { %>
        <span class="pill unassigned">not linked</span>
<%          if (matchCount > 1) { %>
        <span class="muted"><%= matchCount %> charts share this address &mdash;
              pick one below</span>
<%          } %>
<%      } %>
      </div>
    </div>

<%      if (parseErr != null) { %>
    <div class="warn"><b>This message could not be fully parsed</b> (<%= esc(parseErr) %>).
        The original is preserved &mdash;
        <a href="<%= ctx %>/mymd/inboxAttachment.jsp?msg=<%= detailId %>&raw=1">download the .eml</a>.</div>
<%      } %>

    <pre class="body"><%= esc(bodyText == null || bodyText.trim().isEmpty()
                              ? "(no readable text in this message)" : bodyText) %></pre>

<%      if (bodyHtml != null && !bodyHtml.trim().isEmpty()) { %>
    <div style="margin-top:8px">
      <a class="btn sec" href="javascript:void(0)"
         onclick="var f=document.getElementById('htmlbody');
                  f.style.display=(f.style.display==='none'?'block':'none');
                  if(!f.src){f.src='<%= ctx %>/mymd/inboxHtml.jsp?id=<%= detailId %>';}">
         Show original formatting</a>
      <span class="muted">Opens in a sandbox with scripts and remote images blocked.</span>
      <%-- The HTML body is attacker-controlled. It is never written into this page; it is
           loaded cross-document into a sandboxed iframe with no allow-scripts and no
           allow-same-origin, so it has no access to the OSCAR session. --%>
      <iframe id="htmlbody" class="htmlbody" style="display:none" sandbox=""
              referrerpolicy="no-referrer"></iframe>
    </div>
<%      } %>

<%      // ---- attachments ----
        PreparedStatement aps = conn.prepareStatement(
            "SELECT id, filename, content_type, size_bytes, stored_path "
          + "  FROM mymd_inbox_attachment WHERE message_id_fk = ? ORDER BY id");
        aps.setInt(1, detailId);
        ResultSet ars = aps.executeQuery();
        boolean anyAtt = false;
        while (ars.next()) {
            if (!anyAtt) { anyAtt = true; %>
    <div style="margin-top:12px"><b>Attachments</b><ul style="margin:4px 0 0 18px;padding:0">
<%          }
            String storedPath = ars.getString("stored_path");
            if (storedPath == null) { %>
      <li><%= esc(ars.getString("filename")) %>
          <span class="muted">(<%= fmtSize(ars.getLong("size_bytes")) %> &mdash; too large to
          store, open it in webmail)</span></li>
<%          } else { %>
      <li><a href="<%= ctx %>/mymd/inboxAttachment.jsp?id=<%= ars.getInt("id") %>"
             ><%= esc(ars.getString("filename")) %></a>
          <span class="muted">(<%= fmtSize(ars.getLong("size_bytes")) %>)</span></li>
<%          }
        }
        ars.close(); aps.close();
        if (anyAtt) { %></ul></div><% }
%>

    <div class="actions">
      <form method="post" action="<%= ctx %>/mymd/inbox.jsp" style="display:inline">
        <input type="hidden" name="csrf" value="<%= escAttr(csrf) %>">
        <input type="hidden" name="id" value="<%= detailId %>">
        <input type="hidden" name="back" value="<%= escAttr(backQs) %>">
<%      if ("NEW".equals(status)) { %>
        <button class="btn" type="submit" name="action" value="handle">Mark handled</button>
        <button class="btn sec" type="submit" name="action" value="ignore">Not a patient / dismiss</button>
<%      } else { %>
        <span class="muted" style="margin-right:8px">Status: <%= esc(status) %></span>
        <button class="btn sec" type="submit" name="action" value="reopen">Reopen</button>
<%      } %>
<%      if (hasDemo) { %>
        <button class="btn sec" type="submit" name="action" value="unassign">Unlink patient</button>
<%      } %>
      </form>

<%      if (hasDemo) { %>
      <a class="btn" target="_blank"
         href="<%= ctx %>/mymd/emailPatient.jsp?demographicNo=<%= demoNo %>&replyTo=<%= detailId %>"
         >Reply</a>
<%      } else { %>
      <%-- No chart to anchor to, so reply in compose mode: free-form recipient
           pre-filled with the sender, threaded off this message. --%>
      <a class="btn" target="_blank"
         href="<%= ctx %>/mymd/emailPatient.jsp?compose=1&replyTo=<%= detailId %>"
         >Reply</a>
<%      } %>
<%      if (rawPath != null) { %>
      <a class="btn sec" href="<%= ctx %>/mymd/inboxAttachment.jsp?msg=<%= detailId %>&raw=1"
         >Download original</a>
<%      } %>
      <a class="btn sec" href="<%= ctx %>/mymd/inbox.jsp?tab=<%= esc(tab) %>">Back</a>
    </div>

    <div class="warn" style="margin-top:12px">
      &ldquo;Handled&rdquo; is an OSCAR flag. It deliberately does <b>not</b> mark the message
      read in webmail &mdash; the clinic&rsquo;s new-mail SMS alert reads the mailbox&rsquo;s own
      unread state, and writing to it would silently stop those texts.
    </div>

<%      // ---- assign panel ----
        if (!hasDemo) {
            String q = request.getParameter("q");
%>
    <div style="margin-top:14px;padding-top:10px;border-top:1px solid #eef">
      <b>Link this message to a patient</b>
      <form method="get" action="<%= ctx %>/mymd/inbox.jsp" style="margin:6px 0">
        <input type="hidden" name="id" value="<%= detailId %>">
        <input type="hidden" name="tab" value="<%= escAttr(tab) %>">
        <input type="text" name="q" value="<%= escAttr(q) %>" placeholder="surname, or part of one"
               style="padding:4px;width:220px">
        <button class="btn sec" type="submit">Search</button>
      </form>
<%
            // Candidates: anyone already sharing this exact address, plus a name search.
            // Deliberately a click-to-pick list rather than an autocomplete: OSCAR's "Flag
            // Provider" autocomplete has the failure mode where typing a name without
            // selecting from the dropdown silently binds nothing.
            PreparedStatement cps;
            if (q != null && q.trim().length() >= 2) {
                cps = conn.prepareStatement(
                    "SELECT demographic_no, first_name, last_name, year_of_birth, month_of_birth, "
                  + "       date_of_birth, email FROM demographic "
                  + " WHERE (last_name LIKE ? OR first_name LIKE ?) AND patient_status <> 'DE' "
                  + " ORDER BY last_name, first_name LIMIT 25");
                cps.setString(1, q.trim() + "%");
                cps.setString(2, q.trim() + "%");
            } else {
                cps = conn.prepareStatement(
                    "SELECT demographic_no, first_name, last_name, year_of_birth, month_of_birth, "
                  + "       date_of_birth, email FROM demographic "
                  + " WHERE email IS NOT NULL AND LOWER(TRIM(email)) = ? AND patient_status <> 'DE' "
                  + " ORDER BY last_name, first_name LIMIT 25");
                cps.setString(1, fromEmail == null ? "" : fromEmail.trim().toLowerCase());
            }
            ResultSet crs = cps.executeQuery();
            boolean anyCand = false;
            while (crs.next()) {
                if (!anyCand) { anyCand = true; %>
      <table class="list"><tr><th>Chart</th><th>Name</th><th>DOB</th><th>Email on file</th><th></th></tr>
<%              } %>
        <tr>
          <td>#<%= crs.getInt("demographic_no") %></td>
          <td><%= esc(tidyName(crs.getString("last_name") + ", " + crs.getString("first_name"))) %></td>
          <td class="muted"><%= esc(crs.getString("year_of_birth")) %>-<%=
              esc(crs.getString("month_of_birth")) %>-<%= esc(crs.getString("date_of_birth")) %></td>
          <td class="muted"><%= esc(crs.getString("email")) %></td>
          <td>
            <form method="post" action="<%= ctx %>/mymd/inbox.jsp" style="display:inline">
              <input type="hidden" name="csrf" value="<%= escAttr(csrf) %>">
              <input type="hidden" name="id" value="<%= detailId %>">
              <input type="hidden" name="action" value="assign">
              <input type="hidden" name="demographicNo" value="<%= crs.getInt("demographic_no") %>">
              <input type="hidden" name="back" value="<%= escAttr(backQs) %>">
              <button class="btn" type="submit">Link</button>
            </form>
          </td>
        </tr>
<%          }
            crs.close(); cps.close();
            if (anyCand) { %></table><% } else { %>
      <div class="muted">No matching charts. Try a surname search above.</div>
<%          } %>
    </div>
<%      } %>
  </div>
<%
    }
} else {
    // =================================================================================
    // List view
    // =================================================================================
    long cNew = 0, cUnassigned = 0, cHandled = 0, cBulk = 0, cAll = 0;
    try {
        PreparedStatement cps = conn.prepareStatement(
            "SELECT SUM(status='NEW' AND auto_kind='NORMAL'), "
          + "       SUM(status='NEW' AND demographic_no IS NULL AND auto_kind='NORMAL'), "
          + "       SUM(status<>'NEW'), SUM(auto_kind<>'NORMAL'), COUNT(*) "
          + "  FROM mymd_inbox_message WHERE direction='IN'");
        ResultSet crs = cps.executeQuery();
        if (crs.next()) {
            cNew = crs.getLong(1); cUnassigned = crs.getLong(2);
            cHandled = crs.getLong(3); cBulk = crs.getLong(4); cAll = crs.getLong(5);
        }
        crs.close(); cps.close();
    } catch (Exception ignored) {}
%>
  <div class="tabs">
    <a class="btn" style="float:right" target="_blank"
       href="<%= ctx %>/mymd/emailPatient.jsp?compose=1">&#9998; Compose</a>
    <a class="<%= "new".equals(tab) ? "on" : "" %>"        href="?tab=new">Needs attention (<%= cNew %>)</a>
    <a class="<%= "unassigned".equals(tab) ? "on" : "" %>" href="?tab=unassigned">Not linked (<%= cUnassigned %>)</a>
    <a class="<%= "handled".equals(tab) ? "on" : "" %>"    href="?tab=handled">Handled (<%= cHandled %>)</a>
    <a class="<%= "bulk".equals(tab) ? "on" : "" %>"       href="?tab=bulk">Bulk / auto (<%= cBulk %>)</a>
    <a class="<%= "all".equals(tab) ? "on" : "" %>"        href="?tab=all">All (<%= cAll %>)</a>
  </div>
<%
    // Whitelisted branches rather than one OR-soup predicate, so the optimizer can use
    // ix_status / ix_demo instead of scanning.
    String where;
    if ("unassigned".equals(tab))   where = "m.status='NEW' AND m.demographic_no IS NULL AND m.auto_kind='NORMAL'";
    else if ("handled".equals(tab)) where = "m.status<>'NEW'";
    else if ("bulk".equals(tab))    where = "m.auto_kind<>'NORMAL'";
    else if ("all".equals(tab))     where = "1=1";
    else                            where = "m.status='NEW' AND m.auto_kind='NORMAL'";

    try {
        PreparedStatement ps = conn.prepareStatement(
            "SELECT m.id, m.sent_datetime, m.received_at, m.from_email, m.from_name, m.subject, "
          + "       m.has_attachments, m.demographic_no, m.match_count, m.status, m.auto_kind, "
          + "       d.first_name, d.last_name "
          + "  FROM mymd_inbox_message m "
          + "  LEFT JOIN demographic d ON d.demographic_no = m.demographic_no "
          + " WHERE m.direction='IN' AND " + where
          + " ORDER BY COALESCE(m.sent_datetime, m.received_at) DESC LIMIT " + LIST_LIMIT);
        ResultSet rs = ps.executeQuery();
%>
  <table class="list">
    <tr><th style="width:130px">Received</th><th style="width:230px">From</th><th>Subject</th>
        <th style="width:190px">Patient</th><th style="width:80px">Status</th></tr>
<%
        boolean any = false;
        while (rs.next()) {
            any = true;
            Timestamp ts = rs.getTimestamp("sent_datetime");
            if (ts == null) ts = rs.getTimestamp("received_at");
            int demoNo = rs.getInt("demographic_no");
            boolean hasDemo = !rs.wasNull() && demoNo > 0;
            String fname = rs.getString("from_name");
            String femail = rs.getString("from_email");
            String subj = rs.getString("subject");
            int mc = rs.getInt("match_count");
%>
    <tr>
      <td class="muted"><%= ts == null ? "" : esc(stamp.format(ts)) %></td>
      <td><%= esc(fname != null && !fname.isEmpty() ? fname : femail) %>
<%          if (fname != null && !fname.isEmpty()) { %>
          <div class="muted" style="font-size:11px"><%= esc(femail) %></div>
<%          } %>
      </td>
      <td><a href="?id=<%= rs.getInt("id") %>&tab=<%= esc(tab) %>"><%=
          esc(subj == null || subj.isEmpty() ? "(no subject)" : subj) %></a>
<%          if (rs.getInt("has_attachments") == 1) { %> &#128206;<% } %>
      </td>
      <td>
<%          if (hasDemo) { %>
        <span class="pill linked"><%= esc(tidyName(
            rs.getString("last_name") + ", " + rs.getString("first_name"))) %></span>
<%          } else if (mc > 1) { %>
        <span class="pill unassigned"><%= mc %> possible</span>
<%          } else { %>
        <span class="pill unassigned">not linked</span>
<%          } %>
      </td>
      <td><%
            String st = rs.getString("status");
            String ak = rs.getString("auto_kind");
            if (!"NORMAL".equals(ak)) { %><span class="pill bulk"><%= esc(ak) %></span><%
            } else { %><%= esc(st) %><% } %>
      </td>
    </tr>
<%
        }
        rs.close(); ps.close();
        if (!any) {
%>
    <tr><td colspan="5" class="muted" style="padding:14px">Nothing in this view.</td></tr>
<%      } %>
  </table>
<%
    } catch (Exception ex) {
%>
  <div class="banner stale">Could not read the mirror: <%= esc(ex.getMessage()) %></div>
<%
    }
}
%>
</div>
</body>
</html>
