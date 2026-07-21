# OSCAR live-server patches

These files are **not part of the Next.js app**. They are hand-applied to the self-hosted OSCAR EMR
(`oscar.mymdonline.ca`, `192.168.0.201`, webapp root `/opt/tomcat9/webapps/oscar/`). A WAR redeploy
wipes them, so they are kept here to be recoverable.

Each patched stock file leaves a `<file>.oscarbak.<timestamp>` beside it on the server. After
editing any JSP, delete its compiled copy under
`/opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/...` to force a recompile — no Tomcat
restart is needed.

## Email a patient from OSCAR (added 2026-07-21)

Lets a clinician email a patient from inside the chart, and email an appointment reminder from the
appointment window. Sends as `info@mymdonline.ca` through the GoDaddy SMTP account and records
every attempt.

### Files

| Path | What |
| --- | --- |
| `emailPatient.jsp` → `oscar/mymd/emailPatient.jsp` | New. The compose window, serving both entry points. |
| `oscar/casemgmt/newEncounterHeader.jsp` | Patched — adds the eChart header "Email" link. |
| `oscar/appointment/editappointment.jsp` | Patched — adds the "Email Reminder" button. |

Backups from this change: `.oscarbak.20260721083504`.

### Server-side prerequisites (already done, not in this repo)

- `/var/lib/OscarDocument/oscar/mymd_mail.properties` — `tomcat:tomcat`, mode `600`, **outside the
  web root**. Holds the SMTP host/user/password copied from root's `/etc/msmtprc` (`mymd` account).
  The JSP reads it at send time; the password is deliberately not in the JSP because the web root is
  served.
- Table `mymd_patient_email_log` in `oscar_db` — one row per send attempt, `SENT` or `FAILED`. The
  compose window renders the last 25 rows for the patient as history.

### Patch to `casemgmt/newEncounterHeader.jsp`

Inserted after the `showEmailIndicator` block (~line 215). Deliberately **outside** that check, so
the link still appears when no address is on file — the page then explains how to add one.

```jsp
<a href="javascript:void(0)" title="Email this patient"
   onclick="popupPage(700,820,'EmailPatient','<c:out value="${ctx}"/>/mymd/emailPatient.jsp?demographicNo=<%=bean.demographicNo%>')">Email</a>
&nbsp;
```

### Patch to `appointment/editappointment.jsp`

Inserted in the `buttonBar` after the No Show button (~line 1318). Uses `window.open`, not
`window.location`, so unsaved edits to the appointment are not lost. Guarded on `demono` rather than
`appt`, because `appt` is only populated on first display, not on redisplay after a validation error.

```jsp
<% if (!demono.equals("") && !demono.equals("0")) { %>
<input type="button" id="emailReminderButton" class="btn"
    value="Email Reminder"
    onClick="window.open('<%=request.getContextPath()%>/mymd/emailPatient.jsp?appointmentNo=<%=appointment_no%>','emailpt','height=700,width=820,scrollbars=yes')">
<% } %>
```

This file also carries the earlier null-MRP guard (`doctorNo==null?"":doctorNo`) — preserve it when
reapplying.

### Gotchas worth remembering

- Provider records store the billing number inside `first_name` ("Nahid 29328"), and demographics are
  often all-caps. `tidyName()` in the JSP strips numeric tokens and title-cases all-caps names so
  neither leaks into a patient-facing message. "Dr." is prefixed only when `provider_type='doctor'`.
- The recipient is always re-read from the database on POST; the posted form value is ignored, so a
  tampered form cannot redirect the message.
- Verify a compile without needing a logged-in session:
  ```bash
  CP=$(ls /opt/tomcat9/lib/*.jar /opt/tomcat9/bin/*.jar /opt/tomcat9/webapps/oscar/WEB-INF/lib/*.jar | tr '\n' ':')
  java -cp "$CP" org.apache.jasper.JspC -uriroot /opt/tomcat9/webapps/oscar -d /tmp/jspout -compile mymd/emailPatient.jsp
  ```
  Requesting the URL unauthenticated only proves the auth guard works — OSCAR's filter redirects to
  `logout.jsp` before the JSP ever runs, so nothing gets compiled.
