# OSCAR live-server patches

These files are **not part of the Next.js app**. They are hand-applied to the self-hosted OSCAR EMR
(`oscar.mymdonline.ca`, `192.168.0.201`, webapp root `/opt/tomcat9/webapps/oscar/`). A WAR redeploy
wipes them, so they are kept here to be recoverable.

Each patched stock file leaves a `<file>.oscarbak.<timestamp>` beside it on the server. After
editing any JSP, delete its compiled copy under
`/opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/...` to force a recompile — no Tomcat
restart is needed.

## Video visit button on the day sheet (added 2026-08-01)

Puts a 🎥 beside every patient on the day sheet, opening the Health Assist video console for
that appointment. Rooms are created on demand, so it covers appointments typed straight into
OSCAR and not only ones booked online.

Full install steps, verified selectors and the post-redeploy checklist live in
`docs/oscar/daysheet-video-install.md`. Summary of what changes on the box:

| Path | What |
| --- | --- |
| `provider/appointmentprovideradminday.jsp` | Patched — one `<script src>` line before `</body>` (line 2935). |
| `appointment/editappointment.jsp` | Optional belt-and-braces "Video Visit" button beside Email Reminder. |

Like `echart-transcribe.js`, the behaviour lives in a file served by the app
(`public/oscar/daysheet-video.js`), so a WAR redeploy costs one line to restore rather than a
re-patch. No nginx change and no new service — this is outbound only, so the device-cert gate on
`location /` is untouched.

### Gotchas worth remembering

- The day sheet is `provider/appointmentprovideradminday.jsp`, **not**
  `appointment/appointmentcontrol.jsp` (that is the single-appointment popup). No frameset.
- Both ids come from one anchor: `a.apptLink`'s `onClick` carries `appointment_no` and
  `demographic_no`. `href` is literally `#`, so read the attribute, not the href.
- Empty slots render `demographic_no=0` — the script skips them, which is why free slots get no
  button without any special-casing.
- This script passes `noopener` and `echart-transcribe.js` deliberately does not: transcribe
  needs `window.opener` to post the note back, video sends nothing back. Do not unify them.
- `appointment.notes` is `varchar(255)` and `reason` is `varchar(80)`. The day-sheet row tooltip
  renders both, so anything written there is visible to anyone reading the schedule.
- The live WADL publishes only `updateStatus`, `updateType` and `updateUrgency` for an existing
  appointment — **there is no notes-update operation**, so notes can only be set at creation.

## Pharmacy bridge (added 2026-08-01)

Lets the booking app read OSCAR's pharmacy directory and set a patient's preferred pharmacy, so a
pharmacy chosen during online booking lands in the Rx module instead of being re-asked at the visit.

### Why this one is a service, not a JSP

OSCAR publishes no pharmacy REST endpoint. `PharmacyService` and `RxWebService` are listed in
`WEB-INF/classes/applicationContextREST.xml`, but neither appears in the live WADL
(`curl 'http://127.0.0.1:8080/oscar/ws/services?_wadl'` — only demographics, schedule, provider and
status are published), and `RxWebService` would only ever expose a *read*. The only writer is the
Struts action `RxManagePharmacyAction.setPreferred`, which needs a logged-in OSCAR session.

A JSP was the obvious next choice, but every webapp path is gated by `CRFilter`
(`cr.filter.ignore` in `WEB-INF/web.xml`), which bounces a session-less request to `logout.jsp`
before the JSP runs — so it would mean editing OSCAR's own auth config, restarting Tomcat, and
redoing both after every WAR redeploy. This follows `drugref2_service.py` instead: a separate
process on its own port, untouched by webapp redeploys.

### Files

| Path | What |
| --- | --- |
| `pharmacy_bridge_service.py` → `/home/manucher/pharmacy_bridge_service.py` | The service. Python + `mysql.connector`, listens on `127.0.0.1:8086`. |
| `pharmacy-bridge.service` → `/etc/systemd/system/pharmacy-bridge.service` | systemd unit, runs as `manucher`, `Restart=always`. |
| `/etc/nginx/sites-available/oscar` | Patched — adds `location = /mymd/pharmacy-bridge`. Backup: `oscar.bak.pre-pharmacybridge`. |

### Operations

`POST https://oscar.mymdonline.ca/mymd/pharmacy-bridge`, form-encoded, JSON back. Every request
needs the `X-MyMD-Pharmacy-Secret` header.

- `op=list` — every active `pharmacyInfo` row (1516 today). Feeds the app's directory mirror.
- `op=link` + `demographicNo` + `pharmacyId` — deactivates the patient's existing
  `demographicPharmacy` rows, then activates the chosen one (`status='1'`, `preferredOrder=1`),
  reusing a prior row for the same pharmacy rather than accumulating duplicates.
- `op=upsert` — adds a `pharmacyInfo` row, returns its `recordID`. Implemented but the app leaves it
  off (`PHARMACY_BRIDGE_ALLOW_UPSERT`): it would let anonymous booking input write into the table
  that routes prescription faxes.

### Server-side prerequisites (already done, not in this repo)

- `/var/lib/OscarDocument/oscar/mymd_pharmacy_bridge.properties` — `root:manucher`, mode `640`,
  outside the web root. One line, `bridge.secret=<64 hex chars>`. The same value goes in the app's
  `OSCAR_PHARMACY_BRIDGE_SECRET`. Group is `manucher`, not `tomcat`, because the service — not
  Tomcat — reads it.

### The nginx exemption

`location = /mymd/pharmacy-bridge` is an **exact** match proxying to `127.0.0.1:8086`, so nothing
else under `/mymd/` is exposed and the device-cert gate on `location /` is untouched. Verified after
the change: the bridge answers 401 without the secret and 200 with it, while `/oscar/`,
`/oscar/oscarRx/managePharmacy.do`, `/mymd/emailPatient.jsp` and `/mymd/` all still return 403
without a device cert, and `/oscar/ws/services/demographics` still returns 401 (booking OAuth
unaffected).

Rollback: `sudo cp /etc/nginx/sites-available/oscar.bak.pre-pharmacybridge \
/etc/nginx/sites-available/oscar && sudo systemctl reload nginx`, then
`sudo systemctl disable --now pharmacy-bridge`.

### Gotchas worth remembering

- The secret file is read on **every** request, so rotating it takes effect without a restart — but
  an unreadable file fails every request closed rather than open.
- `pharmacyInfo.phone1`/`fax` are `varchar(20)` and hold unformatted strings like `604957-0711`.
  Format for display in the app, not here.
- `demographicPharmacy` has no unique constraint, so the reuse-then-activate logic in `op_link` is
  what keeps a patient from collecting a row per re-link.

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
