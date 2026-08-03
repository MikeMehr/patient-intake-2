# Video-visit button on the OSCAR day sheet — install guide

Puts a 🎥 beside every patient on the day sheet. Clicking it opens the provider's Doxy.me
waiting room.

Note what the button does NOT do: video moved to Doxy on 2026-08-03, and Doxy has one permanent
room per provider rather than one per visit. So the appointment number the script passes goes
unused — it is kept because the install is unchanged and the day sheet has no other way to
identify anything, but the room belongs to the provider, not the appointment.

No OSCAR write API is involved and nothing is posted back — the provider simply lands in a video
room. There is no `NotesService` to register, no Tomcat restart, and no client-device-certificate
exemption needed (this is outbound only, so the mTLS gate on `location /` is untouched).

## How it fits together

```
OSCAR day sheet (oscar.mymdonline.ca)
  │  click 🎥 → window.open (WITH noopener)
  ▼
physician.health-assist.org/launch/oscar-video?oscarApptNo=123&demographicNo=456
  │  client-side location.replace  ← re-attaches the SameSite=Strict cookie
  ▼
physician.health-assist.org/physician/video?oscarApptNo=123&demographicNo=456
  │  GET /api/physician/video/room → the signed-in provider's Doxy room
  ▼
Provider clicks through to doxy.me and admits the patient from the waiting room
```

The `/launch/oscar-video` hop exists for the same reason as `/launch/oscar`: `physician_session`
is `SameSite=Strict`, so a direct cross-site `window.open` arrives with no cookie and bounces to
the login page. See the comments in `src/app/launch/oscar-video/page.tsx`.

**Why this one passes `noopener` and `echart-transcribe.js` does not.** The transcribe flow needs
`window.opener` to post the finished note back into the chart. This flow sends nothing back, so
`noopener` is both safe and the better default. Do not make the two consistent — it breaks one.

## Selectors — VERIFIED on oscar.mymdonline.ca (2026-08-01)

Confirmed by inspection of `/opt/tomcat9/webapps/oscar/provider/appointmentprovideradminday.jsp`:

1. **Target JSP:** `provider/appointmentprovideradminday.jsp` — this is what renders the day
   sheet (not `appointment/appointmentcontrol.jsp`, which is the single-appointment popup).
   `</body>` is at **line 2935**; the script line goes just before it.
2. **No frameset.** The day sheet is a single document, so the script sees the whole page.
3. **Appointment and demographic numbers:** the patient-name link at ~line 2632 is
   `<a class="apptLink" href=# onClick="popupPage(790,801,'…/appointmentcontrol.jsp?appointment_no=<id>&provider_no=…&demographic_no=<demo>&displaymode=edit&dboperation=search');return false;">NAME</a>`
   — one anchor carrying both ids. The script reads them out of the raw `onClick` attribute
   (`href` is literally `#`).
4. **Empty slots** render a different link with `demographic_no=0` (~line 2542). The script
   skips those, so free slots get no button.
5. **Re-render:** OSCAR rewrites rows in place on a status change, which drops injected nodes.
   A `MutationObserver` re-decorates; the decorate step is idempotent.

## Install

```bash
ssh manucher@10.9.0.1
sudo cp /opt/tomcat9/webapps/oscar/provider/appointmentprovideradminday.jsp \
        /opt/tomcat9/webapps/oscar/provider/appointmentprovideradminday.jsp.oscarbak.$(date +%Y%m%d%H%M%S)
```

Add this line immediately before `</body>` (line 2935):

```html
<script src="https://physician.health-assist.org/oscar/daysheet-video.js" defer></script>
```

Then force a recompile — no Tomcat restart needed:

```bash
sudo rm -rf /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/provider/
```

Verify the JSP still compiles without needing a logged-in session:

```bash
CP=$(ls /opt/tomcat9/lib/*.jar /opt/tomcat9/bin/*.jar /opt/tomcat9/webapps/oscar/WEB-INF/lib/*.jar | tr '\n' ':')
sudo java -cp "$CP" org.apache.jasper.JspC -uriroot /opt/tomcat9/webapps/oscar -d /tmp/jspout -compile provider/appointmentprovideradminday.jsp
```

Then load a day sheet with appointments on it and confirm a 🎥 appears beside each patient name
and none beside empty slots.

## Belt and braces: the appointment window

`appointment/editappointment.jsp` already carries this repo's "Email Reminder" button, so it is a
proven place to patch and it has `appointment_no` and `demono` in scope. Adding a hard button
there means the feature still works if a future OSCAR build changes the day-sheet DOM. Insert in
the `buttonBar` beside the Email Reminder button:

```jsp
<% if (!demono.equals("") && !demono.equals("0")) { %>
<input type="button" id="videoVisitButton" class="btn" value="Video Visit"
    onClick="window.open('https://physician.health-assist.org/launch/oscar-video?oscarApptNo=<%=appointment_no%>&demographicNo=<%=demono%>','healthassistVideo','height=920,width=1180,scrollbars=yes,noopener')">
<% } %>
```

Guard on `demono` rather than `appt` — `appt` is only populated on first display, not on
redisplay after a validation error. Preserve the existing null-MRP guard in that file when
reapplying.

## After a WAR redeploy

A redeploy wipes both JSP edits. The script itself lives in this repo and deploys with the app,
so recovery is just re-adding the two snippets above. Nothing else to restore — no properties
file, no database row, no nginx change.

## Prerequisites

Each provider needs their Doxy link set on their record (Online Booking Dashboard → Providers →
Edit). Without it the button lands on a page saying exactly that, rather than failing silently.
