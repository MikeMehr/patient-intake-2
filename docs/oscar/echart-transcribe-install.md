# "Transcribe" button in the OSCAR eChart — install guide

Adds a **Transcribe** button to the OSCAR encounter window. It opens the Health
Assist transcription page in a popup with the current patient already selected,
and when the note is ready it is appended into the encounter note textarea. The
physician then clicks OSCAR's own Save.

No OSCAR write API is involved — the note travels back inside the browser via
`postMessage`, so there is no `NotesService` to register, no Tomcat restart, and
no client-device-certificate exemption.

## How it fits together

```
OSCAR eChart (oscar.mymdonline.ca)
  │  click Transcribe → window.open (NO noopener)
  ▼
physician.health-assist.org/launch/oscar?demographicNo=46&origin=…
  │  client-side location.replace  ← re-attaches the SameSite=Strict cookie
  ▼
physician.health-assist.org/physician/transcription?launch=oscar&demographicNo=46
  │  POST /api/physician/oscar-launch/resolve → patient pre-selected
  │  … dictate, generate SOAP …
  │  "Send to OSCAR note" → window.opener.postMessage(text, oscarOrigin)
  ▼
OSCAR eChart appends the text, posts an ack, popup closes
```

The `/launch/oscar` hop exists because `physician_session` is `SameSite=Strict`:
a direct cross-site `window.open` arrives with no cookie and bounces to the
login page. See the comments in `src/app/launch/oscar/page.tsx`.

## Selectors — VERIFIED on oscar.mymdonline.ca (2026-08-01)

Confirmed by inspection of `/opt/tomcat9/webapps/oscar/casemgmt/newEncounterLayout.jsp`
(the page `forward.jsp?action=view` renders) and `js/newCaseManagementView.js.jsp`:

1. **Target JSP:** `casemgmt/newEncounterLayout.jsp` — `</body>` is at the end
   of the file; the script line goes just before it.
2. **Demographic number:** the page defines a JS global `demographicNo` and
   `caseManagementEntryForm` carries a `demographicNo` field. Both are in the
   script's lookup chain.
3. **Note field:** the eChart creates ONE editor textarea at a time with a
   dynamic id `caseNote_note<noteId>`, and stores that id in the JS global
   `caseNote`. It is a plain `<textarea>` (no rich-text editor), and OSCAR's
   `ChartNoteAutosave` listens for `change` on it — which the script dispatches
   after inserting, so autosave picks the text up.
4. **Button host:** the page header div `#header` exists; the button lands
   there. If a future build lacks every known host, the button floats top-right.

If the doctor has **no note open** when the text comes back, the script alerts
"No encounter note is open" and inserts nothing; the popup then reports that
OSCAR didn't confirm and steers to Copy SOAP. Nothing is lost — the note stays
in the popup.

For other OSCAR builds, re-verify these before installing; the fallback chains
degrade (alert, insert nothing) rather than crash, but the feature won't work
until the selectors match.

## Install

Server-side prerequisites (do these first):

1. `OSCAR_LAUNCH_ALLOWED_ORIGINS=https://oscar.mymdonline.ca` is set in the
   Azure App Service application settings for `healt-assist-ai-prod`.
2. `https://physician.health-assist.org/oscar/echart-transcribe.js` serves 200.

Then add **one line** immediately before `</body>` in the eChart encounter JSP
(typically `oscarEncounter/oscarEncounter.jsp` — confirm on the box):

```html
<script src="https://physician.health-assist.org/oscar/echart-transcribe.js" defer></script>
```

Back up the JSP first, matching the existing convention on this server:

```bash
sudo cp /var/lib/tomcat9/webapps/oscar/oscarEncounter/oscarEncounter.jsp /var/lib/tomcat9/webapps/oscar/oscarEncounter/oscarEncounter.jsp.oscarbak
```

No Tomcat restart is needed for a JSP edit.

## After every WAR redeploy

A WAR redeploy **wipes this patch**. Re-apply:

1. Re-add the one `<script>` line before `</body>`.
2. Re-take the `.oscarbak` copy.
3. Load an encounter window and confirm the Transcribe button appears.

Only the one line lives on the server; all behaviour ships from the repo at
`public/oscar/echart-transcribe.js` and deploys with the app, so routine changes
never need SSH.

## Security properties

- **Origin pinning both ways.** The OSCAR listener ignores any message whose
  `event.origin` is not `https://physician.health-assist.org`. The popup posts
  only to an origin the server returned from the `OSCAR_LAUNCH_ALLOWED_ORIGINS`
  allow-list, never to `"*"`. PHI is in that payload, so both checks matter.
- **Wrong-patient guard.** The payload echoes the `demographicNo` it was
  dictated for; the JSP compares it to the chart currently open and refuses to
  insert on a mismatch.
- **Ack before export.** The note is only marked exported in Health Assist after
  OSCAR confirms the insert. A closed window, a missing listener or a missing
  textarea means nothing is finalized and nothing is recorded as sent.
- **Append, never replace.** Anything the physician already typed survives.
- **No auto-save.** The encounter is not saved by this script.
- **`window.opener` is required.** Do not add `noopener` to the `window.open`
  call, and never add a `Cross-Origin-Opener-Policy` header to the Health Assist
  app — either one severs the return channel. A regression test in
  `src/lib/security-regressions.test.ts` guards the header.

## Audit trail

| Event | Where |
|---|---|
| `oscar_launch_patient_resolved` | `physician_phi_audit_log`, on launch |
| `transcription_marked_exported` with `destination_system = 'oscar_echart_popup'` | `emr_exports`, on a successful send |

`oscar_echart_popup` is deliberately distinct from `manual_copy_paste` so the
automated channel is distinguishable in reporting.

## Fallback while a patch is scheduled

The same script can run as a Tampermonkey/Greasemonkey userscript for a single
physician, with a `@match` on the OSCAR encounter URL — no JSP change at all.
Useful for trying the flow before touching the server.

## Troubleshooting

| Symptom | Cause |
|---|---|
| No Transcribe button | Script tag missing (WAR redeploy?), or `addButton()` found no host element. Check the browser console. |
| "Could not determine which patient" | The demographic-number selector is wrong for this build. |
| Popup opens on the login page | Expected on first use per browser — log in inside the popup; the deep link is preserved. If it happens every time, the `/launch/oscar` bounce is not running (check for a `Cross-Origin-Opener-Policy` header or a server-side redirect having been introduced). |
| "OSCAR did not confirm the note was inserted" | The OSCAR page has no listener — script not loaded on that page — or the textarea selector is wrong. |
| Note text goes nowhere but no error | The note field is a rich-text editor, not a `<textarea>`. |
