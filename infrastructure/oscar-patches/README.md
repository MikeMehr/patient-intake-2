# OSCAR live-server patches

These files are **not part of the Next.js app**. They are hand-applied to the self-hosted OSCAR EMR
(`oscar.mymdonline.ca`, `192.168.0.201`, webapp root `/opt/tomcat9/webapps/oscar/`). A WAR redeploy
wipes them, so they are kept here to be recoverable.

Each patched stock file leaves a `<file>.oscarbak.<timestamp>` beside it on the server. After
editing any JSP, delete its compiled copy under
`/opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/...` to force a recompile — no Tomcat
restart is needed.

## Patient email inbox (added 2026-08-09)

"Patient Email" in the top nav, immediately right of Bill Day. Mirrors the
`info@mymdonline.ca` mailbox into `oscar_db` over IMAP so inbound patient mail is visible
inside OSCAR, auto-linked to the chart when the sender's address matches exactly one patient,
and replyable through `emailPatient.jsp`. Roundcube keeps working untouched and stays the
system of record for the mailbox itself.

Full install steps, the verified server facts and the verification procedure live in
`docs/oscar/inbox-install.md`. Sources in `docs/oscar/inbox/`. On the box:

| File | What |
|---|---|
| `mymd/inbox.jsp` | New. List, filters, message detail, assign, mark handled. |
| `mymd/inboxAttachment.jsp` | New. Attachment / original `.eml` download. |
| `mymd/inboxHtml.jsp` | New. Serves an HTML body into a sandboxed iframe, nothing else. |
| `mymd/emailPatient.jsp` | Patched — `&replyTo=` prefill, `In-Reply-To`/`References`, two-way history. |
| `/usr/local/bin/mymd_mail_sync.py` | New. The IMAP poller. |
| `/etc/systemd/system/mymd-mail-sync.{service,timer}` | New. Oneshot + 5-minute timer, `User=tomcat`. |
| `/etc/mymd/mail-sync.conf` | New. Settings only — deliberately no secrets. `root:tomcat 0640`. |
| `/var/lib/OscarDocument/oscar/mymd_inbox/` | New. Attachments and stored `.eml`, `0750 tomcat:tomcat`. |
| `provider/appointmentprovideradminday.jsp` | Patched — one `<li>` after the Bill Day link. |
| `oscar_db.mymd_inbox_message` + `_attachment`, `_sync_state`, `_access_log` | New tables. |

### The rule that matters

**The poller must never mark mail read.** A cPanel cron texts a new-mail alert and decides
"unread" from the Maildir filename flags; writing `\Seen` back would kill those texts silently.
The poller uses `EXAMINE` + `BODY.PEEK[]` only, and "Handled" is an OSCAR-side flag that is
never written back to IMAP. There is a banner in the UI saying so, so nobody "fixes" it later.

### Three things that will cost time if forgotten

- **`User=tomcat` is load-bearing.** tomcat already owns both secrets the poller needs
  (`mymd_mail.properties` for IMAP, `oscar_mcmaster.properties` for the database), so nothing is
  copied into a second file and attachments are Tomcat-readable without a chown. `manucher` is
  not in group `tomcat`, so the pharmacy-bridge pattern would have needed duplicated credentials.
  `ProtectHome=yes` in the unit is also why this script lives in `/usr/local/bin`, not
  `/home/manucher`.
- **MySQL 8 has no `ADD COLUMN IF NOT EXISTS`** and this server runs **without strict mode**, so
  over-long values truncate silently. `mymd_inbox.sql` guards its ALTERs via `information_schema`
  and the poller caps every field in Python.
- **The nav patcher anchors on the Bill Day `<li>`**, so the reinstall chain is now Health
  Assist → Lab Import → Bill Day → Patient Email. The block is inside `_admin`, so the link is
  admin-only.

### Also fixed here

`docs/oscar/inbox/mymd_patient_email_log.sql` finally commits the DDL for the outbound log
table, which had existed only in production since 2026-07-21 and could previously only be
reverse-engineered from the INSERT in `emailPatient.jsp`.

## Day billing (added 2026-08-06)

"Bill Day" in the top nav, immediately right of Lab Import. Sweeps the logged-in provider's day
sheet for visits marked Done with no claim, reads the diagnosis from the eChart note, picks the
diagnostic code, and writes the MSP claim. Clean BC cases bill unattended; out-of-province,
unsigned notes and unmatched codes wait for a tick. Claims are created Not-Submitted — Teleplan
submission stays a separate manual step.

Full install steps, the confirmed billing schema and the verify-before-billing sequence live in
`docs/oscar/day-billing-install.md`. Sources in `docs/oscar/billing/`. On the box:

| File | What |
|---|---|
| `mymd/dayBilling.jsp` | New. Sweep, results, review table. |
| `WEB-INF/classes/mymd/billing/*.class` | New. `DayBilling`, `BillingWriter`, `DxClient`, `Config`, `BillingCandidate`. |
| `provider/appointmentprovideradminday.jsp` | Patched — one `<li>` directly after the Lab Import link, same `_admin` block. |
| `/var/lib/OscarDocument/oscar/mymd_billing.properties` | New. URL, shared secret, dry-run flag. `600 tomcat:tomcat`, outside the web root. |
| `oscar_db.mymd_billing_log` | New table. Audit trail, and its unique key is the double-billing guard. |

Two things that will cost time if forgotten: `javac` must run under **sudo** (`/opt/tomcat9/lib` is
`tomcat`-only, so `servlet-api.jar` is unreadable otherwise and only `BillingWriter` fails to
compile), and the nav patcher anchors on the **Lab Import** `<li>`, so that patch has to be
reapplied first.

## Lab import (added 2026-08-05)

Turns a lab-result PDF already filed in OSCAR into a real HL7 lab so values land in the eChart Lab
Results tab and trend. Full details in `docs/oscar/lab-import-install.md`; sources in
`docs/oscar/lab-import/`. On the box:

| File | What |
|---|---|
| `mymd/labImport.jsp` | New. Document picker, patient-match guard, review screen, ingest. |
| `WEB-INF/classes/mymd/lab/*.class` | New. `LabPdfParser`, `Hl7Builder`. |
| `provider/appointmentprovideradminday.jsp` | Patched — one `<li>` after the Health Assist link, inside the `_admin` block. |

Requires `HL7TEXT_LABS=yes` in `oscar_mcmaster.properties` (needs a Tomcat restart); without it the
import appears to do nothing.

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
| `emailPatient.jsp` → `oscar/mymd/emailPatient.jsp` | New. The compose window, serving all entry points. |
| `oscar/casemgmt/newEncounterHeader.jsp` | Patched — adds the eChart header "Email" link. |
| `oscar/appointment/editappointment.jsp` | Patched — adds the "Email Reminder" button. |
| `oscar/dms/documentReport.jsp` | Patched — adds a per-document "Email to patient" envelope icon. |

Backups from this change: `.oscarbak.20260721083504`; attachments + documents work (2026-08-02):
`emailPatient.jsp.oscarbak.20260802163000`, `documentReport.jsp.oscarbak.20260802*`.

### Attachments (added 2026-08-02)

- The compose form is now `multipart/form-data` with a multi-file input, parsed with
  `commons-fileupload` (already in `WEB-INF/lib`) because a bare JSP cannot use
  `request.getParts()`. **A multipart POST hides normal fields from `request.getParameter()`**,
  so subject/body/documentNo are read from the parsed parts.
- Cap: 15 MB of raw attachment total (base64 inflates ~37%; GoDaddy rejects around 25–30 MB).
  Checked client-side, in the fileupload `setSizeMax`, and again when a chart document is added.
- `mymd_patient_email_log` gained an `attachments VARCHAR(1000) NULL` column (names + sizes);
  the history table shows a 📎 with the list in the tooltip.

### Email a chart document (added 2026-08-02)

`?demographicNo=X&documentNo=Y` pre-attaches a stored eChart document (e.g. an ER note PDF).
The document is verified against `ctl_document (module='demographic', module_id=demographicNo)`
on **every** request — a tampered `documentNo` belonging to another patient resolves to nothing.
Files are read from `DOCUMENT_DIR` (`/var/lib/OscarDocument/oscar/document/`); the patient-facing
filename is the document description plus the stored file's extension.

Entry point: `dms/documentReport.jsp` renders an envelope icon per row (demographic module only,
skipping deleted and HTML documents — HTML docs have no file on disk):

```jsp
<%-- MyMD: email this document to the patient (mymd/emailPatient.jsp pre-attaches it) --%>
<% if( curdoc.getStatus() != 'D' && curdoc.getStatus() != 'H' ) { %>
<a href="#" title="Email to patient" class="btn btn-link" onclick="popup(760,720,'${ pageContext.request.contextPath }/mymd/emailPatient.jsp?demographicNo=<%=moduleid%>&documentNo=<%=curdoc.getDocId()%>','emailPatient')">
  <i class="icon-envelope"></i></a>
<% } %>
```

Placed immediately after the Annotation (`icon-quote-right`) link inside the
`module.equals("demographic")` block (~line 598 of the stock file).

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
