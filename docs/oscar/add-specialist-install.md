# Add Specialist: paste a PathwaysBC profile into OSCAR's consultation list

A new **Add Specialist** item in the OSCAR top nav (right of **Specialist Directory**) opens
`mymd/addSpecialist.jsp`. The physician pastes a specialist's PathwaysBC profile text, AI extracts
the fields (name, specialty, MSP #, phone, fax, email, address), and a review form prefills. The
physician corrects anything, picks the consultation service, and clicks **Add** — the record is
created in OSCAR and filed under that service, verified, with a link to the new record.

It only ever suggests. Every prefilled field is tinted until edited, and nothing is written until
the physician presses Add.

**None of the OSCAR side lives in git's deployment path — it is installed by hand on the OSCAR
server and a WAR redeploy will wipe it.** This document is the recovery procedure.

## Why the write is client-side and the extraction isn't

OSCAR's `oscarEncounter/*.do` actions sit behind the nginx mTLS device-cert gate and a session
cookie, so **only an enrolled, logged-in browser can create a specialist** — no server, ours
included, can do it. The page's inline JS therefore performs OSCAR's own
`AddSpecialist.do` → verify → `UpdateServiceSpecialists.do` sequence, adapted from the proven bulk
sync bookmarklet (`src/app/api/oscar-sync/script.js/route.ts`), inheriting its hard-won guards:

- `AddSpecialist.do` **fails silently** (200 OK, form re-render, no insert) on a missing
  phone/address, a bad `referralNo`, or a `referralNo` collision. Every add is verified by reading
  the predicted new record back (`EditSpecialists.do?specId=maxId+1`, sequential allocation) with
  a roster resync retry before anything is reported as created.
- `UpdateServiceSpecialists.do` **replaces** a service's entire membership, so the current
  membership is fetched seconds before the write and posted back complete, plus the new id.
- Phone and address are **required** by OSCAR — the Add button stays disabled without them.
- Referral # must be blank or exactly 6 digits; the form enforces that before OSCAR can no-op.
- A dead OSCAR session answers with the login page, not a 401 — detected, reported plainly.

The AI extraction, by contrast, runs in the Health Assist app (fax-triage bridge pattern): the JSP
relays the pasted text server-side with a shared secret from `mymd_specialist.properties`. The
Azure key stays off this box and the model call goes out through the app like every other one.
**Unlike fax triage and day billing, what travels here is not PHI** — it is a specialist's public
PathwaysBC directory listing, no patient involved — which is why the app route deliberately has no
`physician_phi_audit_log` rows and no `HIPAA_MODE` gate.

The model never chooses anything in OSCAR. It returns what it read in the paste; the specialty →
consultation-service match is a case-insensitive **exact** match (via the same alias table the bulk
sync uses, applied app-side), and a specialty with no matching service becomes a "create it or pick
one" prompt for the physician, never a fuzzy guess. A likely duplicate (name already in the
roster) gets a warning with a link to the existing record.

## Files

On the box:

| File | What |
|---|---|
| `mymd/addSpecialist.jsp` | New. The page + the server-side extraction relay. |
| `provider/appointmentprovideradminday.jsp` | Patched — one `<li>` after the Specialist Directory link. |
| `/var/lib/OscarDocument/oscar/mymd_specialist.properties` | New. URL, shared secret, `enabled` flag. `600 tomcat:tomcat`, outside the web root. |

App side: `src/app/api/emr/oscar/specialist-extract/route.ts`, `src/lib/oscar/specialist-extract.ts`,
and the `/api/emr/oscar/specialist-extract` entry in `PUBLIC_EXCEPTIONS` in `src/proxy.ts`.
App env: `OSCAR_SPECIALIST_BRIDGE_SECRET` in Azure App Settings (route 404s without it).

Sources live beside this doc in `docs/oscar/add-specialist/`.

## A JSP, not a compiled class

Same reasoning as `fax-triage-install.md`: classes under `WEB-INF/classes` need a context reload
that logs out everyone in OSCAR; Jasper recompiles a JSP on demand. No new jars —
`HttpURLConnection` is JDK and `gson-2.8.9` is already in `WEB-INF/lib`.

## Install / reinstall after a WAR redeploy

```bash
W=/opt/tomcat9/webapps/oscar
sudo cp addSpecialist.jsp $W/mymd/addSpecialist.jsp
sudo chown tomcat:tomcat $W/mymd/addSpecialist.jsp
# Nav: Specialist Directory first (it's the anchor), then Add Specialist after it.
grep -c 'Specialist Directory' $W/provider/appointmentprovideradminday.jsp || sudo python3 patch_specialistdirectory_nav.py
sudo python3 patch_addspecialist_nav.py
```

If `patch_addspecialist_nav.py` aborts on the anchor count, the live Specialist Directory line has
drifted from the patcher's `ANCHOR` — `grep -n 'Specialist Directory'` the file and make them
byte-identical before retrying.

Then clear the compiled copies — Jasper's auto-recompile is not trusted on this box:

```bash
sudo sh -c 'rm -f /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/mymd/addSpecialist_jsp.*'
sudo sh -c 'rm -f /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/provider/appointmentprovideradminday_jsp.*'
```

**`sudo sh -c '...'` matters.** `/opt/tomcat9/work` is `tomcat`-only, so a bare `sudo rm -f ...*`
lets your login shell expand the glob, which it cannot read — the pattern matches nothing and `rm`
exits 0 having done nothing.

Compile-check without waiting for a user to hit the page:

```bash
W=/opt/tomcat9/webapps/oscar
CP="$W/WEB-INF/classes:$(sudo find $W/WEB-INF/lib -name '*.jar' | tr '\n' ':')$(sudo find /opt/tomcat9/lib /opt/tomcat9/bin -name '*.jar' | tr '\n' ':')"
sudo java -cp "$CP" org.apache.jasper.JspC -uriroot $W -d /tmp/jspc-addspec -compile mymd/addSpecialist.jsp
```

"Generation completed with [0] errors" means good. No Tomcat restart, no nginx change, no new
port: outbound-only, so the device-cert gate on `location /` is untouched.

## Settings

```
# /var/lib/OscarDocument/oscar/mymd_specialist.properties   (600 tomcat:tomcat)
healthassist.url  = https://physician.health-assist.org
specialist.secret = <matches OSCAR_SPECIALIST_BRIDGE_SECRET in the app>
enabled           = true
```

Read on every request, so rotating the secret needs no restart. **Fails closed**: unreadable file,
missing URL, missing secret, or `enabled` anything other than exactly `true` all mean no AI
extraction — the page says so and the manual form still works, so `enabled=false` is the no-touch
kill switch.

## Telling the auth failures apart

Same ladder as fax triage; the fastest diagnosis available:

| Body | Meaning |
|---|---|
| `{"error":"Authentication required"}` | the app's proxy guard — the `PUBLIC_EXCEPTIONS` entry is missing; the route never ran |
| `{"error":"Unauthorized"}` | the route ran; the shared secret is wrong |
| `{"error":"Not found"}` (404) | `OSCAR_SPECIALIST_BRIDGE_SECRET` is unset in App Service |

## Verifying, without a browser

Exercise the app endpoint straight from the box with the canonical example:

```bash
sudo python3 - <<'PY'
import json, urllib.request
cfg = dict(l.split("=",1) for l in open("/var/lib/OscarDocument/oscar/mymd_specialist.properties")
           if "=" in l and not l.strip().startswith("#"))
url = cfg["healthassist.url"].strip().rstrip("/") + "/api/emr/oscar/specialist-extract"
text = ("Dr. Harmon Toor\nDermatology\nMan, MSP #Q4978\nAccepting consultative referrals.\n"
        "Office Information\n604-247-9378\nFax: 604-273-2363\n"
        "Public email (okay for patient use): freshbayderm@gmail.com\n"
        "Fresh Bay Health Centre - #305, 2777 Jow Street, Richmond, British Columbia, V6X 0V7 with 5 others\n")
req = urllib.request.Request(url, json.dumps({"text": text, "providerNo": "999998"}).encode(),
    {"Content-Type": "application/json", "x-mymd-specialist-secret": cfg["specialist.secret"].strip()})
print(json.dumps(json.load(urllib.request.urlopen(req)), indent=2))
PY
```

Expect one specialist: Harmon / Toor / Dr. / Dermatology, `mspNumber "Q4978"` with `referralNo ""`
(and the annotation explaining why), phone `604-247-9378`, fax `604-273-2363`, the email kept, and
the address without "with 5 others".

Then the live end-to-end: **Add Specialist** in the nav → paste → Extract → Dermatology
preselects → Add → follow the success link, and confirm the specialist appears in a consultation
request's specialist dropdown for that service. Do the first live run with a specialist you
actually want: **OSCAR has no specialist delete**, only `hideFromView`.

## Rollback

```bash
sudo rm /opt/tomcat9/webapps/oscar/mymd/addSpecialist.jsp
# restore the newest .oscarbak of appointmentprovideradminday.jsp, then clear its compiled copy
```

or just set `enabled = false` in the properties file to switch the AI off while leaving the page.

## Out of scope

Bulk adds (that is the bookmarklet / sync pipeline, unchanged), editing existing specialists, and
scraping PathwaysBC — this page only reads what the physician pastes.
