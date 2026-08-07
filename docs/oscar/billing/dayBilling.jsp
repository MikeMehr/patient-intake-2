<%--
  MyMD: bill a day's virtual visits.

  Sweeps the logged-in provider's day sheet for visits marked Done that have no claim yet, reads
  the diagnosis out of each eChart note, and writes the MSP claim.

  Clean BC cases bill without asking: a BC card that passes its check digit, a signed note, a fee
  code that matches the patient's age, and a diagnostic code that exists in OSCAR's own table.
  Everything else -- out of province, unsigned note, failed check digit, no code matched -- is
  prepared and listed for a tick. Nothing with no note is ever billable.

  The fee code is NOT fixed at 13437. That code is banded 2-49; the GP telehealth visit family runs
  13237 / 13437 / 13537 / 13637 / 13737 / 13837 and the band is read from OSCAR's own
  ctl_billingservice_age_rules. Billing 13437 for a 60-year-old under-bills and trips OSCAR's own
  validation.

  Claims are created Not-Submitted (billingstatus 'O'). Teleplan submission stays a separate,
  deliberate action in OSCAR's own screen. This page creates claims; it does not submit them.

  Not in git's deploy path; a WAR redeploy wipes it. See docs/oscar/day-billing-install.md.
--%>
<%@ page contentType="text/html; charset=UTF-8" %>
<%@ page import="java.sql.*, java.util.*, java.text.SimpleDateFormat" %>
<%@ page import="org.oscarehr.util.LoggedInInfo, org.oscarehr.util.DbConnectionFilter" %>
<%@ page import="org.owasp.encoder.Encode" %>
<%@ page import="mymd.billing.*" %>
<%!
    static String nz(String s) { return s == null ? "" : s; }

    static String badge(BillingCandidate.Disposition d) {
        if (d == BillingCandidate.Disposition.AUTO) return "ok";
        if (d == BillingCandidate.Disposition.NEEDS_TICK) return "tick";
        return "blocked";
    }
%>
<%
    String user = (String) session.getAttribute("user");
    if (user == null) { response.sendRedirect(request.getContextPath() + "/logout.jsp"); return; }
    LoggedInInfo loggedInInfo = LoggedInInfo.getLoggedInInfoFromSession(request);

    String ctx = request.getContextPath();
    String action = nz(request.getParameter("action"));
    // Scope is always the logged-in provider. The page never bills under another physician's MSP
    // number, whatever arrives in the query string.
    String providerNo = user;
    String date = nz(request.getParameter("date")).trim();
    if (!date.matches("\\d{4}-\\d{2}-\\d{2}")) {
        date = new SimpleDateFormat("yyyy-MM-dd").format(new java.util.Date());
    }
    // The nav link carries go=1, so one click bills. Reaching the page without it previews only.
    boolean go = "1".equals(request.getParameter("go"));

    Config cfg = Config.load();
    Connection conn = DbConnectionFilter.getThreadLocalDbConnection();
    DayBilling engine = new DayBilling();
    DxClient dx = cfg.aiEnabled() ? new DxClient(cfg) : null;
    String runId = "day-" + providerNo + "-" + date + "-" + System.currentTimeMillis();

    List<BillingCandidate> rows = engine.sweep(conn, providerNo, date, dx, runId);
%>
<html>
<head>
  <title>Bill day &mdash; <%=Encode.forHtml(date)%></title>
  <style>
    body { font-family: Helvetica, Arial, sans-serif; font-size: 13px; margin: 16px; }
    h2 { margin: 0 0 4px 0; }
    table.rows { border-collapse: collapse; width: 100%; margin-top: 10px; }
    table.rows th { background: #e8eaf0; text-align: left; padding: 5px 6px; border: 1px solid #c3c7d1; }
    table.rows td { padding: 4px 6px; border: 1px solid #dfe2e8; vertical-align: top; }
    tr.ok td { background: #f2fbf3; }
    tr.tick td { background: #fffaf0; }
    tr.blocked td { background: #f6f6f6; color: #777; }
    .panel { border: 2px solid #2b6cb0; padding: 10px 12px; margin-bottom: 12px; background: #f2f7fd; }
    .warn { border: 2px solid #c0392b; background: #fdf0ee; padding: 8px 12px; margin-bottom: 12px; }
    .note { color: #555; font-size: 12px; }
    .ev { color: #666; font-size: 11px; font-style: italic; }
    .commit { font-size: 15px; padding: 8px 18px; }
    input.dx { width: 62px; }
    .tag { font-size: 10px; padding: 1px 5px; border-radius: 3px; background: #ddd; }
  </style>
</head>
<body>
<h2>Bill day &mdash; <%=Encode.forHtml(date)%></h2>
<div class="note">Provider <%=Encode.forHtml(providerNo)%> &middot; visits marked Done with no claim yet</div>

<% if (cfg.dryRun) { %>
  <div class="warn"><b>Dry run.</b> Nothing will be written to OSCAR. Set <code>dryrun=false</code>
      in <code><%=Config.PATH%></code> once a claim has been checked end to end.</div>
<% } %>
<% if (!cfg.aiEnabled()) { %>
  <div class="warn"><b>Diagnostic codes are not being suggested.</b> The Health Assist connection is
      not configured, or AI is switched off there. Every visit below still bills &mdash; type the
      code yourself.</div>
<% } %>

<%
    // ---- commit ----
    // Two ways in: the nav link (go=1, bills the clean rows on its own) and the Approve button
    // (action=commit, bills exactly what was ticked).
    Set<Integer> approved = new HashSet<Integer>();
    Map<Integer, String> manualDx = new HashMap<Integer, String>();
    boolean committing = false;

    if ("commit".equals(action)) {
        committing = true;
        String[] ticked = request.getParameterValues("appt");
        if (ticked != null) for (String t : ticked) {
            try { approved.add(Integer.valueOf(t)); } catch (NumberFormatException ignored) { }
        }
        for (BillingCandidate bc : rows) {
            String typed = nz(request.getParameter("dx_" + bc.appointmentNo)).trim();
            if (!typed.isEmpty()) manualDx.put(bc.appointmentNo, typed);
        }
    } else if (go) {
        committing = true;
        for (BillingCandidate bc : rows) {
            if (bc.disposition == BillingCandidate.Disposition.AUTO) approved.add(bc.appointmentNo);
        }
    }

    int billed = 0, failed = 0, dup = 0, dryrun = 0;
    if (committing) {
        BillingWriter writer = new BillingWriter(cfg);
        for (BillingCandidate bc : rows) {
            if (!approved.contains(bc.appointmentNo)) continue;

            // A code typed on the review screen still has to exist in OSCAR.
            String typed = manualDx.get(bc.appointmentNo);
            if (typed != null && !typed.isEmpty()) {
                String desc = engine.validateDx(conn, typed);
                if (desc == null) {
                    bc.outcome = "ERROR";
                    bc.reason = "Code " + typed + " is not in OSCAR's diagnostic code list";
                    failed++;
                    continue;
                }
                bc.dxFinal = typed;
                bc.dxDescription = desc;
                bc.dxSource = "manual";
            }
            if (bc.dxFinal.isEmpty() || bc.claimHin.isEmpty() || bc.feeCode.isEmpty()
                    || bc.noteCount == 0) {
                bc.outcome = "SKIPPED";
                failed++;
                continue;
            }

            BillingWriter.Result r = writer.write(request, response, conn, bc, runId, user);
            bc.outcome = r.decision;
            bc.billingNo = r.billingNo;
            if (!r.detail.isEmpty()) bc.reason = r.detail;
            if ("BILLED".equals(r.decision)) billed++;
            else if ("DUPLICATE".equals(r.decision)) dup++;
            else if ("DRYRUN".equals(r.decision)) dryrun++;
            else failed++;
        }
%>
  <div class="panel">
    <b><%=billed%></b> claim<%=billed == 1 ? "" : "s"%> written<%
      if (dryrun > 0) { %>, <b><%=dryrun%></b> simulated (dry run)<% }
      if (dup > 0)    { %>, <b><%=dup%></b> already billed<% }
      if (failed > 0) { %>, <b><%=failed%></b> could not be billed<% }
    %>.
    <div class="note" style="margin-top:5px;">
      Claims are created <b>Not-Submitted</b>. Submit them to Teleplan from OSCAR's own billing
      screen when you are ready. Run <code><%=Encode.forHtml(runId)%></code>.
    </div>
  </div>
<%
    }
%>

<form method="post" action="dayBilling.jsp">
  <input type="hidden" name="date" value="<%=Encode.forHtmlAttribute(date)%>"/>
  <input type="hidden" name="action" value="commit"/>

  <table class="rows">
    <tr>
      <th style="width:3%"></th>
      <th style="width:6%">Time</th>
      <th style="width:22%">Patient</th>
      <th style="width:4%">Age</th>
      <th style="width:7%">Fee</th>
      <th style="width:9%">Dx</th>
      <th style="width:49%">Status</th>
    </tr>
<%
    int pending = 0;
    for (BillingCandidate bc : rows) {
        boolean done = "BILLED".equals(bc.outcome) || "DRYRUN".equals(bc.outcome)
                || "DUPLICATE".equals(bc.outcome);
        if (!done && bc.billable()) pending++;
%>
    <tr class="<%=done ? "ok" : badge(bc.disposition)%>">
      <td>
        <% if (!done && bc.billable()) { %>
          <input type="checkbox" name="appt" value="<%=bc.appointmentNo%>"
                 <%=bc.preTicked() ? "checked" : ""%>/>
        <% } %>
      </td>
      <td><%=Encode.forHtml(bc.startTime.length() >= 5 ? bc.startTime.substring(0, 5) : bc.startTime)%></td>
      <td>
        <a href="<%=ctx%>/demographic/demographiccontrol.jsp?demographic_no=<%=bc.demographicNo%>&displaymode=edit&dboperation=search_detail"
           target="_blank"><%=Encode.forHtml(bc.patientName)%></a>
        <% if (!"BC".equals(bc.province)) { %>
          <span class="tag"><%=Encode.forHtml(bc.province)%></span>
        <% } %>
      </td>
      <td><%=bc.ageAtService < 0 ? "?" : String.valueOf(bc.ageAtService)%></td>
      <td title="<%=Encode.forHtmlAttribute(bc.feeDescription)%>"><%=Encode.forHtml(bc.feeCode)%></td>
      <td>
        <% if (done) { %>
          <%=Encode.forHtml(bc.dxFinal)%>
        <% } else { %>
          <input class="dx" type="text" name="dx_<%=bc.appointmentNo%>"
                 value="<%=Encode.forHtmlAttribute(bc.dxFinal)%>"
                 <%=bc.noteCount == 0 ? "disabled" : ""%>/>
        <% } %>
      </td>
      <td>
        <% if ("BILLED".equals(bc.outcome)) { %>
          <b>Billed</b> &mdash; claim <%=bc.billingNo%>
        <% } else if ("DRYRUN".equals(bc.outcome)) { %>
          <b>Dry run</b> &mdash; nothing written
        <% } else if ("DUPLICATE".equals(bc.outcome)) { %>
          <b>Already billed</b>
        <% } else if (!bc.reason.isEmpty()) { %>
          <%=Encode.forHtml(bc.reason)%>
        <% } else { %>
          <%=Encode.forHtml(bc.dxDescription)%>
        <% } %>
        <% if (!bc.dxEvidence.isEmpty() && !done) { %>
          <div class="ev">&ldquo;<%=Encode.forHtml(bc.dxEvidence)%>&rdquo;</div>
        <% } %>
        <% if (bc.noteCount > 1) { %>
          <div class="note"><%=bc.noteCount%> notes on this visit</div>
        <% } %>
      </td>
    </tr>
<%
    }
    if (rows.isEmpty()) {
%>
    <tr><td colspan="7" class="note">Nothing to bill &mdash; no visits marked Done without a claim
        on this day.</td></tr>
<%
    }
%>
  </table>

  <% if (pending > 0) { %>
    <p>
      <input class="commit" type="submit" value="Bill the ticked visits"
             onclick="this.disabled=true;this.form.submit();"/>
      <span class="note">&nbsp;Ticked rows only. Type a diagnostic code where one is missing.</span>
    </p>
  <% } %>
</form>

<p class="note" style="margin-top:14px;">
  <a href="dayBilling.jsp?date=<%=Encode.forHtmlAttribute(date)%>">Reload without billing</a>
  &middot; fee code follows the patient's age band (13237 / 13437 / 13537 / 13637 / 13737 / 13837)
</p>
</body>
</html>
