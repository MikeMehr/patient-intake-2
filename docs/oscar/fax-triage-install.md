# Fax triage: AI pre-fill for OSCAR's Incoming Docs

When a fax opens in **Incoming Docs**, it is read and the filing boxes fill themselves in: document
type, class, description, observation date, the patient, and the provider to review it.

It only ever suggests. Every field it touches is tinted and captioned, the tint clears when you edit
it, and the physician still presses **Save & Next**. Nothing files itself.

**None of the OSCAR side lives in git's deployment path — it is installed by hand on the OSCAR
server and a WAR redeploy will wipe it.** This document is the recovery procedure.

## Why OCR, and why the reading happens off the box

Inbound faxes from SRFax are **raster scans with no text layer** — `pdftotext` on a real one returns
zero characters. The existing `LabPdfParser` (PDFBox geometry parsing) reads nothing from them, so
OCR is not an optimisation here, it is the only way to read a fax at all.

The OCR and the model call both happen in the Health Assist app, not on the OSCAR box, so clinical
documents keep **one road out of the clinic**: the Azure deployment covered by the vendor agreement,
`HIPAA_MODE`, and `physician_phi_audit_log`. Calling Azure from Tomcat would have meant a second key
on the box and a second audit trail. This is the same reasoning as `day-billing-install.md`, and it
is the second feature to use it.

## The rule that matters

**The model never picks a chart.** It returns what it read on the page — a name, a date of birth, a
health number, the doctor in the "To:" line — and `faxSuggest.jsp` resolves those against this
OSCAR's own tables. A misread name therefore fails to match instead of filing a document into a
stranger's chart.

A patient is preselected only when the match is unambiguous:

1. **PHN** matching exactly one chart (`REPLACE(REPLACE(hin,' ',''),'-','')`), or
2. **exact last + first + date of birth** matching exactly one chart.

Anything else — no PHN, two hits, name only — offers a candidate list to click and selects nothing.
The first name read off the fax sorts the list but never filters it: this clinic has six charts
surnamed `TEST`, which is exactly the case that makes name-only matching unsafe and an unranked list
useless.

Provider is resolved in order: the addressee's MSP number (`provider.ohip_no`), then a **unique**
surname match among active providers, then the matched patient's MRP (`demographic.provider_no`).
Two providers sharing a surname resolves to nobody rather than to a guess. That guard fired on the
very first real page: on a cover sheet with an empty `To:` field the model read `From: Dr. M.
Mehraein` as the addressee, and only the two-Mehraein ambiguity stopped it flagging someone.

## A fax covering several patients

One transmission routinely carries documents for several people — a batch of lab results, a stack of
letters. This is the single most dangerous case in the feature, because it does not look dangerous:
the model names one of them, that person has a clean unique PHN, the match rule fires, and one Save
files everyone's results into one chart. That misfiles the rest **and** puts their records in a
stranger's chart.

So the model is asked for **every** distinct identity with its page range, deduped on health number
(one person whose name is spelled two ways across two pages is still one person). More than one and
the screen **fills nothing, offers nothing to click**, and says where to split:

> This fax covers 3 patients — do not file it as one document.
> Split it with Extract Page, then file each part separately.
> p. 1 · Prince, Dakota Danette · DOB 1992-03-10 · PHN 9135945977
> p. 2 · Semilla, Krizelle · …

This is why OCR keeps page boundaries (`src/lib/fax/ocr.ts` reads `analyzeResult.pages` rather than
the flat `content` the shared helper returns) — without them the warning could raise an alarm but
not say where to cut.

Verified 2026-08-15 against a synthetic three-patient lab fax: all three found, pages 1/2/3 correct,
`multiPatient: true`, single-patient field empty. Before the guard, the same fax returned
"Prince, Dakota Danette", confidence **high** — exactly the confident wrong answer described above.

**Flush `mymd_fax_triage` after changing anything about how patients are read.** A cached answer is
replayed verbatim, so a fax evaluated under older rules would keep its pre-guard verdict:
`DELETE FROM mymd_fax_triage;` — everything regenerates on next view at roughly 5 s a fax.

## Files installed on the OSCAR box

| Path | What |
|---|---|
| `mymd/faxSuggest.jsp` | New. JSON endpoint: session guard, path confinement, cache, HTTPS call, patient/provider resolution. |
| `mymd/aiPrefill.js` | New. Fills the form in the browser and draws the suggestion banner. |
| `dms/incomingDocs.jsp` | Patched — one `<script src>` line, plus a guard inside `addflagprovider()`. |
| `/var/lib/OscarDocument/oscar/mymd_fax.properties` | New. URL, shared secret, `enabled` flag. `600 tomcat:tomcat`, outside the web root. |
| `oscar_db.mymd_fax_triage` | New table. Per-fax cache and audit trail. |

App side: `src/app/api/emr/oscar/fax-triage/route.ts`, `src/lib/fax/triage.ts`, and the
`/api/emr/oscar/fax-triage` entry in `PUBLIC_EXCEPTIONS` in `src/proxy.ts`.

Sources live beside this doc in `docs/oscar/fax-triage/`.

## A JSP, not a compiled class

Deliberate. Classes under `WEB-INF/classes` are held by the webapp classloader for the life of the
context, so changing one needs a reload that **logs out everyone signed into OSCAR**
(see `day-billing-install.md`). Jasper recompiles a JSP on demand. The heavy lifting is in the app,
so the OSCAR side stays thin enough to live in a JSP — the same split `labImport.jsp` uses.

It needs no new jars: `HttpURLConnection` is JDK, and `gson-2.8.9` is already in `WEB-INF/lib`.

## Install / reinstall after a WAR redeploy

```bash
W=/opt/tomcat9/webapps/oscar
sudo cp faxSuggest.jsp $W/mymd/faxSuggest.jsp
sudo cp aiPrefill.js   $W/mymd/aiPrefill.js
sudo chown tomcat:tomcat $W/mymd/faxSuggest.jsp $W/mymd/aiPrefill.js
sudo mysql oscar_db < mymd_fax_triage.sql
sudo python3 patch_incomingdocs.py          # script include + addflagprovider guard
```

Then clear the compiled copies — Jasper's auto-recompile is not trusted on this box:

```bash
sudo sh -c 'rm -f /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/dms/incomingDocs_jsp.*'
sudo sh -c 'rm -f /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/mymd/faxSuggest_jsp.*'
```

**`sudo sh -c '...'` matters.** `/opt/tomcat9/work` is `tomcat`-only, so `sudo rm -f <path>/foo_jsp.*`
lets your *login* shell expand the glob, which it cannot read — the pattern matches nothing, `rm`
gets a literal `*`, and it **exits 0 having done nothing**.

Compile-check without waiting for a user to hit the page:

```bash
W=/opt/tomcat9/webapps/oscar
CP="$W/WEB-INF/classes:$(sudo find $W/WEB-INF/lib -name '*.jar' | tr '\n' ':')$(sudo find /opt/tomcat9/lib /opt/tomcat9/bin -name '*.jar' | tr '\n' ':')"
sudo java -cp "$CP" org.apache.jasper.JspC -uriroot $W -d /tmp/jspc-fax -compile mymd/faxSuggest.jsp
```

"Generation completed with [0] errors" means good. Requesting the URL unauthenticated only proves
the auth guard works — OSCAR's `LoginFilter` returns a 302 to `logout.jsp` before the JSP runs.

No Tomcat restart, no nginx change, no new port: this is outbound-only, so the device-cert gate on
`location /` is untouched.

## Settings

`/var/lib/OscarDocument/oscar/mymd_fax.properties`, `600 tomcat:tomcat`:

```properties
healthassist.url = https://physician.health-assist.org
fax.secret       = <matches OSCAR_FAX_BRIDGE_SECRET in the app>
enabled          = true
```

Read on every request, so rotating the secret needs no restart. **Fails closed**: unreadable file,
missing URL, missing secret, or `enabled` anything other than exactly `true` all mean no suggestions
— and `aiPrefill.js` removes its own banner in that case, so the screen looks untouched.

The app side needs `OSCAR_FAX_BRIDGE_SECRET` in Azure App Service, plus the
`AZURE_DOCUMENT_INTELLIGENCE_*` settings (already present) and `HIPAA_MODE=false`.

## The trap that cost the first live call

`/api/emr/` is a protected prefix in `src/proxy.ts`: anything without a `physician_session` cookie is
401'd before the route runs. The caller here is Tomcat, so there is no cookie, and the first real
call came back `{"error":"Authentication required"}` — which is **not** the route's own message.
The fix is the `PUBLIC_EXCEPTIONS` entry; the route still authenticates itself by shared secret and
404s when that secret is unset. Day billing hit exactly this, and its comment in `proxy.ts` says so.

Telling the two 401s apart is the fastest diagnosis available:

| Body | Meaning |
|---|---|
| `{"error":"Authentication required"}` | the proxy guard — the route never ran |
| `{"error":"Unauthorized"}` | the route ran; the shared secret is wrong |
| `{"error":"Not found"}` (404) | `OSCAR_FAX_BRIDGE_SECRET` is unset in App Service |

## Verifying, without a browser

The app endpoint can be exercised straight from the box with a genuine fax, which covers outbound
HTTPS, the secret, OCR on a real raster scan, and the JSON shape before any OSCAR file is touched:

```bash
sudo python3 - <<'PY'
import base64, json, urllib.request, glob
secret = [l.split("=",1)[1].strip() for l in open("/var/lib/OscarDocument/oscar/mymd_fax.properties")
          if l.strip().startswith("fax.secret")][0]
pdf = sorted(glob.glob("/var/lib/OscarDocument/oscar/incomingdocs/1/Fax/*.pdf"))[0]
body = {"faxRef":"selftest","pdfBase64":base64.b64encode(open(pdf,"rb").read()).decode(),
        "providerNo":"100","docTypes":["lab","consult","radiology","others"],
        "docClasses":["Diagnostic Imaging Report"],"knownProviders":[]}
req = urllib.request.Request("https://physician.health-assist.org/api/emr/oscar/fax-triage",
        data=json.dumps(body).encode(),
        headers={"Content-Type":"application/json","x-mymd-fax-secret":secret})
print(json.dumps(json.loads(urllib.request.urlopen(req, timeout=200).read()), indent=2))
PY
```

A real scanned knee X-ray report round-tripped in **4.4 s** on 2026-08-11 and came back
`radiology / Diagnostic Imaging Report / "Knee X-Ray result"`, patient `Test, Frank`, addressee
`Manucher Mehraein` MSP `67199`, confidence `high`.

Then, in the browser: open Incoming Docs and confirm the boxes fill; check
`SELECT fax_ref, reason, created FROM mymd_fax_triage ORDER BY id DESC` has a row; save one document
and confirm `providerLabRouting` gained a row for it (that is the failure this whole area is prone
to — see `reference_oscar_document_inbox_routing`).

## The `addflagprovider` guard shipped with this

Not cosmetic. A chart with no MRP puts the **string** `"undefined"` into `MRPNo.value`, and both call
sites only checked `length>0` — 9 characters passes. It was then POSTed as `flagproviders=undefined`,
and because this server runs **without strict mode** (`sql_mode=NO_ENGINE_SUBSTITUTION`), MySQL
truncates it into a `providerLabRouting` row for `provider_no='undefi'` — a review request addressed
to nobody. The guard sits inside `addflagprovider()` so all four call sites are covered at once.

This was invisible until 2026-08-11, because until then *every* routing insert was failing anyway
(`explicit_defaults_for_timestamp`, see `reference_oscar_mysql8_timestamp_null`).

## Cost and latency

One Document Intelligence read plus one model call per fax, about 4 s. `mymd_fax_triage` caches by a
SHA-256 of `queueId|pdfDir|pdfName`, which matters because Incoming Docs reloads the entire page on
every Next/Previous — without it, paging back and forth would re-OCR the same fax repeatedly.

## Rollback

```bash
W=/opt/tomcat9/webapps/oscar
sudo rm -f $W/mymd/faxSuggest.jsp $W/mymd/aiPrefill.js
sudo cp $W/dms/incomingDocs.jsp.oscarbak.<timestamp> $W/dms/incomingDocs.jsp
sudo sh -c 'rm -f /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/dms/incomingDocs_jsp.*'
```

Or, to switch it off without touching files, set `enabled = false` in `mymd_fax.properties`. The app
route is inert without `OSCAR_FAX_BRIDGE_SECRET`.

## Out of scope

Auto-filing without review. Handwriting (OCR will not read it). Routing to anyone who is not a
provider in this OSCAR.

## Related

- `docs/oscar/day-billing-install.md` — the OSCAR→app shared-secret pattern this copies.
- `docs/oscar/lab-import-install.md` — the JSP/review-screen split, and the PDF parser that does
  **not** work on faxes.
- `infrastructure/oscar-patches/README.md` — register of everything hand-installed on this box.
