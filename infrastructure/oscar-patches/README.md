# OSCAR live-server patches

These files are **not part of the Next.js app**. They are hand-applied to the self-hosted OSCAR EMR
(`oscar.mymdonline.ca`, `192.168.0.201`, webapp root `/opt/tomcat9/webapps/oscar/`). A WAR redeploy
wipes them, so they are kept here to be recoverable.

Each patched stock file leaves a `<file>.oscarbak.<timestamp>` beside it on the server. After
editing any JSP, delete its compiled copy under
`/opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/...` to force a recompile — no Tomcat
restart is needed.

## Add Specialist — PathwaysBC paste into the consultation list (added 2026-08-17)

An **Add Specialist** nav item (right of Specialist Directory) opens `mymd/addSpecialist.jsp`:
paste a PathwaysBC profile, AI extracts the fields into a review form, the physician picks the
consultation service and clicks Add. The write runs client-side in the physician's own session
(`AddSpecialist.do` → verify → `UpdateServiceSpecialists.do`, same guards as the bulk sync
bookmarklet); the extraction goes through the app with a shared secret. Public directory data, not
PHI — the app route deliberately has no PHI audit or `HIPAA_MODE` gate.

Full install steps and verification live in `docs/oscar/add-specialist-install.md`. Sources in
`docs/oscar/add-specialist/`. On the box:

| File | What |
|---|---|
| `mymd/addSpecialist.jsp` | New. The page + server-side extraction relay (fails soft to manual entry). |
| `provider/appointmentprovideradminday.jsp` | Patched — Specialist Directory `<li>` (retroactive patcher) + Add Specialist `<li>` after it. |
| `/var/lib/OscarDocument/oscar/mymd_specialist.properties` | New. URL, shared secret, `enabled` flag. `600 tomcat:tomcat`, outside the web root. |

## Requisitions into the chart, and multi-document Send Fax (added 2026-08-14)

Requisitions generated from the eChart used to be downloaded to a Windows/macOS desktop and
re-uploaded to fax them, leaving nothing in the patient's record. Now they can be filed straight
into the patient's **Documents**, and Send Fax can take several chart documents at once.

**The "folder".** OSCAR has no folders — `dms/documentReport.jsp` hardcodes exactly one bucket per
patient chart, and the only content filter is the **View:** dropdown, built from
`EDocUtil.getActiveDocTypes(module)`. So a doctype *is* the folder:
`dms/documentReport.jsp?function=demographic&functionid=<demoNo>&view=requisition`.

| File | What |
|---|---|
| `sql/requisition_doctype.sql` | Adds the `requisition` doctype (idempotent). |
| `eform/saveEformToChart.jsp` | **New.** Renders the saved eForm and files it into Documents. POST-only, `_edoc`/`w`. |
| `eform/faxEformReq.jsp` | `saveToChart=1` files the requisition (alone) after the fax is queued. |
| `eform/faxEformSend.jsp` | "Also keep a copy in the patient's Documents", ticked by default. |
| `eform-fax/patch_eform_savetochart.py` | Adds the **Save to chart** button; generic on fid. |
| `eform-fax/patch_eform_faxsaves.py` | Adds `saveToChart=1` to the forms that call `faxEformReq.jsp` directly. |
| `eform-fax/restore_eform16_html.py` | Puts back fid 16's HTML, which a misfiled upload lost. |
| `fax/newFax.jsp` | Multi-document: `demographicNo` + `docNos`, chart picker, PDFBox merge, security fixes. Detected-sender banner (2026-08-17). |
| `fax/faxDestSuggest.jsp` | **New.** JSON pre-flight: reads the chosen PDF, finds the sender's fax number (PDFBox text layer, or fax-triage OCR for scans), reverse-matches the address book, renders the page as PNG. See `docs/oscar/fax-triage-install.md`. |
| `dms/patch_documentreport_faxselected.py` | Adds **Fax Selected** next to Combine PDF. |

**Forms wired** (all carry **Save to chart**):

| fid | Form | Files under | Also files when faxed |
|---|---|---|---|
| 3 | 1.1 Lab Requisition | `requisition` | — (email button only) |
| 4 | 1- Brooke X-ray | `requisition` | — |
| 5 | 1 Brooke US | `requisition` | yes, direct |
| 6 | 2.1 Imaging FHA | `requisition` | — |
| 7 | 2 - CT/XR/US Req - FHA | `requisition` | — |
| 11 | Bone Density Requisition | `requisition` | — |
| 16 | CT/XR/US/Echo Req - VCH | `requisition` | — |
| 33 | Imaging Vancouver | `requisition` | — |
| 39 | MRI LM central | `requisition` | yes, via the picker checkbox |
| 52 | Plan G | `insurance` | yes, direct |
| 62 | Special Authority 2015 | `insurance` | yes, direct |
| 70 | West Coast Medical Imaging | `requisition` | — |
| 74 | *Coastal Sleep HSAT Requisition | `requisition` | yes, direct |

**fid 16 was broken and is now repaired** (`restore_eform16_html.py`). Its `form_html` had been NULL
since it was uploaded on 2026-06-17, and it had never been used once. Not data loss — the upload
misfiled itself. The evidence is in the row: `file_name` was `CT/XR/US/EchoReq-VCH.html`, so the
slashes in the form *name* were taken as a path and the HTML was written into the eForm **images**
directory under its basename while `form_html` stayed NULL:

```
/var/lib/OscarDocument/oscar/eform/images/EchoReq-VCH.html
```

The restore reads that file as **bytes** (it is CRLF; text mode would silently rewrite the line
endings), loads it through HEX/UNHEX, and corrects `file_name` to the basename. `form_name` is left
alone — the slashes there are the root cause, but the name is what shows in the eForm list, so
renaming it is a clinical call. **If that form is ever re-uploaded under the same name it will break
the same way.** Verified after restore by rendering it with the same wkhtmltopdf line the fax path
uses: a valid 1-page PDF with `vch-medical_imaging_requisition.png` embedded.

**fid 44 "Olive" is still broken and is not recoverable here** — `form_html` NULL, `file_name` and
`subject` both empty, 0 saved instances, and no orphaned HTML left on disk. It looks like an empty
shell created the same day. Deactivating it (`UPDATE eform SET status=0 WHERE fid=44`) would take it
out of the eForm list; not done, since that is a user-facing change.

Per-form facts that had to be looked up rather than assumed: fid 5 closes its head with `</HEAD>`;
fid 7's form element is named `MedicalImagingForm`, not `FormName`; fids 4, 5, 70 and 74 define no
`setFlag()`, so the call is wrapped in try/catch.

Things that will cost time if forgotten:

- `EDocUtil.attachDocEForm` is **`(providerNo, documentNo, fdid)`** and the link table is
  **`EFormDocs`** (CamelCase — no `@Table` annotation, so JPA defaulted to the class name), not
  `eform_docs`. `doctype` in that table is hardcoded `'D'`.
- Build the `EDoc` with **`new EDoc()`**, never a multi-arg constructor. Those call
  `preliminaryProcessing()`, which silently prefixes your filename with `yyyyMMddHHmmss` — the row
  then points at a name that is not the file you wrote.
- Files written into `DOCUMENT_DIR` must be **owned by tomcat**, not merely readable:
  `ManageDocumentAction.createCacheVersion2` opens them read-write to rasterise page 1, and the only
  symptom of getting it wrong is a broken-image thumbnail.
- A `ctl_doctype` row whose `status` is NULL will **not** appear in the View dropdown —
  `getActiveDocTypes` filters on `'A'`. Insert the status explicitly.
- `faxes.destination` is **`varchar(11)`** and this MySQL has no strict mode, so an over-long fax
  number used to truncate silently and the fax went somewhere else. Normalise to exactly 10 digits.
- `SpringUtils.getBean` is declared `<T> T getBean(Class<?>)` — `T` is **not** tied to the argument,
  so it only infers from an assignment target. Chain the call (`SpringUtils.getBean(X.class).foo()`)
  and it resolves to `Object` and will not compile. Always assign to a typed local first.
- `form_html` is a **latin-1** byte blob. A literal `✓` (or any non-latin-1 character) in injected
  JS cannot be written back — use a `\uXXXX` escape.
- eForm hex backups now go to `/var/lib/OscarDocument/oscar/mymd_eform_backups/`, not `/tmp`, which
  does not survive a reboot.
- The fax spool files (`eformfax_*`, `manualfax_*`) are orphans by design — `srfax_bridge.py` reads
  them by bare basename out of `DOCUMENT_DIR` and never deletes them. ~45 files, ~10 MB. A
  `find -mtime +90 -delete` cron would be reasonable; not done.
- **Still outstanding:** `faxEformReq.jsp` is a GET that will fax to an arbitrary number using
  cookies the browser attaches automatically. Making it POST-only has to land together with
  `faxEformSend.jsp` and the four eForms that call it directly (fid 5, 52, 62, 74), or faxing breaks
  on those forms.

Compile-check any JSP before deploying (the classpath needs OSCAR's **exploded** `WEB-INF/classes`,
not just the jars, and `javac` "Note:" lines are not failures):

```
W=/opt/tomcat9/webapps/oscar
CP=$(ls $W/WEB-INF/lib/*.jar /opt/tomcat9/lib/*.jar /opt/tomcat9/bin/*.jar | tr '\n' ':')$W/WEB-INF/classes
cd $W && java -cp "$CP" org.apache.jasper.JspC -webapp $W -d /tmp/jspc_out eform/saveEformToChart.jsp
javac -nowarn -cp "$CP" -d /tmp/jspc_cls /tmp/jspc_out/org/apache/jsp/eform/saveEformToChart_jsp.java
```

## Fax the MRI requisition, with attachments (added 2026-08-14)

The **LM MRI Requisition** eForm (fid=39) now has a **Fax to MRI Central** button. It saves the
requisition, then opens a window where the destination (prefilled 1-866-588-6955, the number printed
on the form), the page choice, and any documents from the patient's chart are confirmed before
anything is sent. The fax goes out through the same `faxes` queue the New Fax page uses.

| File | What |
|---|---|
| `eform/faxEformSend.jsp` | New. The confirm-and-attach window. Generic on `fid`, so any requisition eForm can point its Fax button at it. Kept here as `eform-fax/faxEformSend.jsp`. |
| `eform/faxEformReq.jsp` | Extended — `docNos` attachments, `pages=1`, blank-page trim. Kept here as `eform-fax/faxEformReq.jsp`. |
| `eform.form_html` (fid=39) | Patched in the DB — the Fax button, `faxMRIReq()`, and a print fix. Reapply with `eform-fax/patch_eform39_fax.py`. |

Backups: `faxEformReq.jsp.oscarbak.20260814105626` (pre-attachments) and `.20260814110011`
(pre-credentials move); eForm blob hex at `/tmp/eform_fid39_20260814105810.hex` on the box.

### Four things that will cost time if forgotten

- **Attachments are re-checked server-side.** `faxEformReq.jsp` resolves every `docNos` id through
  `ctl_document` for *that* demographic before it touches a file, and reads by basename only. The
  picker window is convenience; this is the control. Only `application/pdf` and `image/*` are
  accepted — images become one scaled page each, PDFs are appended with PDFBox.
- **The rendered eForm has a trailing blank page.** wkhtmltopdf leaves one behind on any form whose
  last page div carries `page-break-after:always` — every MRI req does. The fax now drops trailing
  pages that have no text and no XObject. A blank sheet at the far end reads as a transmission fault,
  so this is worth keeping.
- **`.DoNotPrint` needed `!important` on this form.** The two "CHECKLIST items required / not needed"
  banners were printing *and* faxing on page 2, overlapping in red and green. The form has no
  doctype, so it renders in quirks mode, where the class selector `.show` on those spans matches the
  form's own `.Show { display:inline }` rule — and that rule sits later in source order than the
  print block. Verified before and after by rendering the blob offline with the same wkhtmltopdf
  line the JSP uses (substitute `${oscar_image_path}` → empty, drop it in the eform images dir).
- **The page default is computed, not asked.** `faxMRIReq()` runs the same
  `/\b(knee|hip|lumbar|l-sp)\b/i` test the form uses for its own checklist warning, and preselects
  "requisition + checklist" only when that matches.
- **The fax window must be opened on the click, not after the save.** The first version called
  `window.open` from the hidden iframe's `onload` — an async callback, which the browser blocks
  outright. It failed silently: the form saved, no window appeared, and the access log showed the
  `addEForm.do` POST with zero requests for `faxEformSend.jsp`. It now opens a blank window on the
  click, writes "Saving the requisition..." into it, and redirects it once the save lands (20s
  timeout, and a "allow pop-ups" message when the open itself is refused).
- **A saved eForm is `efmshowform_data.jsp?fdid=N`** — no `demographic_no` or `fid` in the URL, so
  reading them from the query string only worked while the form was being created. Both are always
  on the form's action, which OSCAR rewrites to
  `../eform/addEForm.do?efmfid=..&efmdemographic_no=..` (`EForm.setAction()`); the button reads the
  URL first and falls back to the action. Note there are no `efmdemographic_no`/`efmfid` hidden
  *inputs* anywhere — they only ever exist as action query parameters.

`faxEformReq.jsp` now reads `db_username`/`db_password` from `oscar_mcmaster.properties` instead of
carrying a copy of the database password — that is what makes it safe to keep in this repo.

Not covered: faxing a file from disk. That is what `fax/newFax.jsp` (New Fax) is for.

## Move an appointment to another provider (added 2026-08-14)

The Edit Appointment window now has a **Provider** dropdown, so an appointment can be moved onto
another physician's day sheet in place. Stock OSCAR only offers Cut + Paste for this: the edit form
showed the appointment's provider in the window title alone, and `appointmentupdatearecord.jsp`
never wrote `provider_no` back.

| File | What |
|---|---|
| `appointment/editappointment.jsp` | Patched — Provider dropdown above the read-only Doctor field, plus a confirm on submit when it changed. |
| `appointment/appointmentupdatearecord.jsp` | Patched — writes `appt.setProviderNo()` on a normal update. |

Backups: `.oscarbak.20260814100747` on both. Reapply after a WAR redeploy with the patcher kept
here — it carries the exact before/after text and refuses to run if the stock file has moved on:

```bash
ssh -i ~/.ssh/oscar_server manucher@10.9.0.1 'sudo -n python3 -' < infrastructure/oscar-patches/patch_appointment_provider.py
```

### Three things that will cost time if forgotten

- **"Doctor" on that form is NOT the appointment's provider.** It is the patient's family doctor
  (MRP), read from `demographic.provider_no` and rendered read-only into `name="doctorNo"`. The new
  field is `name="appt_provider_no"` and is the only one that moves an appointment. Both now carry a
  `title` saying which is which.
- The update page **ignores a blank or missing `appt_provider_no`**, and checks the value against
  `ProviderDataDao.findByProviderNo` before writing. That is what keeps the page's other callers
  (Cancel Appt, No Show, Group Action) behaving exactly as before, and stops a tampered form from
  parking an appointment on a provider that does not exist.
- On the patient-search round trip the form is redisplayed with `bFirstDisp=false` and `appt` is
  **null**, so the dropdown re-reads the appointment from the DB instead of defaulting to blank.
  Same trap as the `Email Reminder` button, which is why that one is guarded on `demono`.

The dropdown lists active `provider_type='doctor'` records, minus OSCAR's built-in accounts
(`999998`, `-1`). If the appointment sits on a provider outside that list — there is one legacy row
on `provider_no=29328`, a billing number written where an internal provider number belonged — that
value is kept as the selected option rather than silently re-pointed on save.

Not propagated back to the booking app: its `appointments` row still names the original provider.

## Fax triage — AI pre-fill for Incoming Docs (added 2026-08-11)

Opening a fax in **Incoming Docs** now fills in the type, class, description, observation date,
patient and reviewing provider. Suggestions only: filled fields are tinted, the tint clears when you
edit, and the physician still presses Save & Next.

Full install steps, the matching rules and the verification procedure live in
`docs/oscar/fax-triage-install.md`. Sources in `docs/oscar/fax-triage/`. On the box:

| File | What |
|---|---|
| `mymd/faxSuggest.jsp` | New. Session guard, path confinement, per-fax cache, HTTPS call, patient/provider resolution. |
| `mymd/aiPrefill.js` | New. Fills the form and draws the suggestion banner. |
| `dms/incomingDocs.jsp` | Patched — one `<script src>`, plus a guard inside `addflagprovider()`. |
| `/var/lib/OscarDocument/oscar/mymd_fax.properties` | New. URL, shared secret, `enabled` flag. `600 tomcat:tomcat`, outside the web root. |
| `oscar_db.mymd_fax_triage` | New table. Per-fax cache and audit trail. |

### Three things that will cost time if forgotten

- **Faxes have no text layer.** SRFax PDFs are raster scans; `pdftotext` returns zero characters and
  `LabPdfParser` reads nothing from them. OCR (Azure Document Intelligence, in the app) is the only
  way to read one — which is also why the reading happens off the box, keeping clinical documents on
  the one road out of the clinic that `HIPAA_MODE` and the PHI audit log cover.
- **`/api/emr/` is a protected prefix.** The caller is Tomcat with no session cookie, so without the
  `PUBLIC_EXCEPTIONS` entry in `src/proxy.ts` the first live call returns
  `{"error":"Authentication required"}` — the proxy's message, not the route's. Day billing hit this
  first. `{"error":"Unauthorized"}` instead means the route ran and the shared secret is wrong.
- **The model never picks a chart.** It returns a name/DOB/PHN and the JSP resolves them here.
  A patient is preselected only on a unique PHN or a unique exact name+DOB; anything else offers
  candidates. Six charts here are surnamed `TEST`, which is why name-only never auto-selects.
- **A fax covering several patients fills nothing.** The model reports every identity with its page
  range; more than one and the screen refuses and says where to split. Flush `mymd_fax_triage`
  after changing how patients are read — a cached answer is replayed verbatim, so a fax judged
  under older rules keeps its old verdict.

### Also fixed here

`addflagprovider()` gained a guard against the **string** `"undefined"`, which is what a chart with
no MRP puts in `MRPNo.value`. Both call sites only tested `length>0`, so 9 characters sailed through
and was POSTed as `flagproviders=undefined`; with no strict mode, MySQL truncated that into a
`providerLabRouting` row for `provider_no='undefi'` — a review request addressed to nobody. It was
invisible until 2026-08-11 only because every routing insert was failing anyway
(`explicit_defaults_for_timestamp`).

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
- `op=check_elig` + `phn` (10 digits) + `dob` (YYYY-MM-DD) — real-time MSP eligibility, added
  2026-08-22. Replicates OSCAR's own "Check Eligibility" button (decompiled
  `ManageTeleplanAction.checkElig` → `TeleplanAPI.checkElig`): three form POSTs to
  `https://teleplan.hnet.bc.ca/TeleplanBroker` over one cookie session — `AsignOn`, `AcheckE45`,
  `AsignOff` — using the credentials OSCAR keeps in its `property` table
  (`teleplan_username`/`teleplan_password`). Date of service is always "today" in clinic time, like
  OSCAR's button. Returns `{ok, eligOnDos: "YES"|"NO"|"", coverageEndDate, coverageEndReason,
  dateOfService, msgs}` — never the patient name/gender lines the E45 report also carries, and the
  PHN is never logged. Feeds the booking alert's MSP verdict (`@/lib/oscar/msp-coverage`); a card
  that merely passes its check digit is no longer reported as "eligible".

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
<a id="mymdEmailPatientBtn" href="javascript:void(0)" title="Email this patient"
   style="display:inline-block;margin:0 0 0 6px;padding:2px 8px;cursor:pointer;font:10px sans-serif;border:1px solid #0891b2;background:#0891b2;color:#fff;border-radius:4px;vertical-align:middle;text-decoration:none"
   onclick="popupPage(700,820,'EmailPatient','<c:out value="${ctx}"/>/mymd/emailPatient.jsp?demographicNo=<%=bean.demographicNo%>')">Email Patient</a>
&nbsp;
```

The inline style matches `makeHeaderButton()` in `public/oscar/echart-transcribe.js` so the link
reads as one of the Transcribe / Request Docs / Chart Attachment buttons. The `id` is what that
script looks for: it moves this anchor to sit just left of Transcribe. Keep the id if the style is
ever changed — without it the link stays in its stock header position (still functional, just not
grouped with the buttons).

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
