# Day billing: AI diagnostic coding for MSP telehealth claims

A **Bill Day** item in the OSCAR top nav, immediately right of Lab Import. One click sweeps the
logged-in provider's day sheet for visits marked Done with no claim, reads the diagnosis out of
each eChart note, picks the diagnostic code, and writes the MSP claim.

Clean BC cases bill without asking. Everything else is prepared and listed for a tick.

**None of this lives in git's deployment path — it is installed by hand on the OSCAR server and a
WAR redeploy will wipe it.** This document is the recovery procedure.

## What bills on its own, and what waits

Auto-billed only when **all four** hold:

| | |
|---|---|
| Health card | BC, and it passes the mod-11 check digit |
| Chart note | exists for this appointment, and is signed |
| Fee code | an age band covers the patient |
| Diagnostic code | the model chose one and it exists in OSCAR's `icd9` table |

Everything else appears with a reason and an unticked box: out of province (including Ontario),
failed or missing check digit, unsigned note, no code matched, low-confidence match. A visit with
**no note is never billable** — no note, no AI call, no claim, checkbox disabled.

Claims are created **Not-Submitted** (`billingstatus = 'O'`). Teleplan submission stays a separate,
deliberate action in OSCAR's own screen.

## The fee code is not fixed at 13437

This is the one place the tool deliberately departs from "the visit is always 13437". **13437 is
banded 2–49.** The GP telehealth *visit* family is:

| Age | Code | Fee |
|---|---|---|
| 0–1 | 13237 | $41.42 |
| 2–49 | 13437 | $38.61 |
| 50–59 | 13537 | $41.42 |
| 60–69 | 13637 | $43.29 |
| 70–79 | 13737 | $48.76 |
| 80+ | 13837 | $56.47 |

Billing 13437 for a 60-year-old under-bills by $4.68 *and* trips OSCAR's own validation
(`BillingCreateBillingAction.validateServiceCodeList`). The clinic already bills these bands by
hand — the history holds 13437, 13537 and 13637.

The band boundaries are read from OSCAR's `ctl_billingservice_age_rules` at run time, not hard-coded,
so an MSP change to the boundaries is picked up without editing this code. `DayBilling.VISIT_FEE_CODES`
only says which codes are in the family. Consultation (`134x6`) and counselling (`134x8`) are
deliberately excluded — those are clinical judgements about the nature of the visit.

## Files installed on the OSCAR box

| Path | What |
|---|---|
| `WEB-INF/classes/mymd/billing/DayBilling.class` | discovery, note versioning, redaction, health-card rules, dx validation, dry-run harness |
| `WEB-INF/classes/mymd/billing/BillingWriter.class` | the only thing that writes a claim |
| `WEB-INF/classes/mymd/billing/DxClient.class` | outbound HTTPS to Health Assist |
| `WEB-INF/classes/mymd/billing/Config.class` | settings, fails closed |
| `WEB-INF/classes/mymd/billing/BillingCandidate.class` | the row model |
| `/opt/tomcat9/webapps/oscar/mymd/dayBilling.jsp` | sweep, results, review table |
| `provider/appointmentprovideradminday.jsp` | **"Bill Day" nav link**, directly after Lab Import, inside the same `_admin` `security:oscarSec` block |
| `/var/lib/OscarDocument/oscar/mymd_billing.properties` | URL, shared secret, dry-run flag. `600 tomcat:tomcat`, outside the web root |
| `oscar_db.mymd_billing_log` | audit trail + the double-billing guard |

Sources live beside this doc in `docs/oscar/billing/`.

## Install / reinstall after a WAR redeploy

```bash
W=/opt/tomcat9/webapps/oscar
CP="$W/WEB-INF/classes:$(sudo find $W/WEB-INF/lib -name '*.jar' | tr '\n' ':')$(sudo find /opt/tomcat9/lib -name '*.jar' | tr '\n' ':')"
sudo javac -nowarn -cp "$CP" -d /tmp/billbuild *.java
sudo mkdir -p $W/WEB-INF/classes/mymd/billing
sudo cp /tmp/billbuild/mymd/billing/*.class $W/WEB-INF/classes/mymd/billing/
sudo cp dayBilling.jsp $W/mymd/dayBilling.jsp
sudo chown -R tomcat:tomcat $W/WEB-INF/classes/mymd $W/mymd/dayBilling.jsp
```

`javac` must run under **sudo**: `/opt/tomcat9/lib` is `drwxr-x--- tomcat tomcat`, so an ordinary
login cannot read `servlet-api.jar` and `BillingWriter` will not compile. The WAR's own
`WEB-INF/lib` *is* readable, which is why the other four classes compile without it and only this
one fails — a confusing way to lose ten minutes.

**Copying the `.class` files does nothing until the webapp reloads.** Unlike a JSP, which Jasper
recompiles on demand, classes under `WEB-INF/classes` are held by the webapp classloader for the
life of the context. Replace them and OSCAR keeps running the version it loaded at startup — the
file on disk is right, the running code is not, and the only symptom is that your fix appears to
have had no effect at all. Clearing the Jasper work directory does **not** help; that is only for
JSPs.

```bash
sudo touch /opt/tomcat9/webapps/oscar/WEB-INF/web.xml   # Host has autoDeploy="true"
```

Takes ~25 s and **logs out everyone signed into OSCAR**, so pick the moment. Confirm it actually
happened rather than assuming:

```bash
sudo grep -a "Reloading Context with name \[/oscar\]" /opt/tomcat9/logs/catalina.out | tail -2
```

You want a "has started" *and* an "is completed". `NotSerializableException` and "web application
instance has been stopped already" in the log during a reload are ordinary shutdown noise from the
old context, not failures.

To check which version is actually live, grep the class on disk for a string only the new build
contains — but remember that proves the *disk*, not the JVM:

```bash
sudo grep -ac "Save Bill" /opt/tomcat9/webapps/oscar/WEB-INF/classes/mymd/billing/BillingWriter.class
```

Nav link (Lab Import must already be installed — the patcher anchors on it):

```bash
sudo python3 patch_daybilling_nav.py
```

Log table:

```bash
sudo mysql oscar_db < mymd_billing_log.sql
```

JSP compile check, without waiting for a user to hit it:

```bash
W=/opt/tomcat9/webapps/oscar
CP="$W/WEB-INF/classes:$(sudo find $W/WEB-INF/lib -name '*.jar' | tr '\n' ':')$(sudo find /opt/tomcat9/lib /opt/tomcat9/bin -name '*.jar' | tr '\n' ':')"
sudo java -cp "$CP" org.apache.jasper.JspC -uriroot $W -d /tmp/jspc-bill -compile mymd/dayBilling.jsp
```

"Generation completed with [0] errors" plus a `dayBilling_jsp.class` means good.

If a class or JSP was edited, clear the compiled copy — Jasper's auto-recompile cannot be trusted
on this box:

```bash
sudo sh -c 'rm -f /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/mymd/dayBilling_jsp.*'
sudo sh -c 'rm -f /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/provider/appointmentprovideradminday_jsp.*'
```

**`sudo sh -c '...'` matters.** `/opt/tomcat9/work` is `tomcat`-only, so writing `sudo rm -f
<path>/foo_jsp.*` lets your *login* shell expand the glob, which it cannot read — the pattern
matches nothing, `rm` gets a literal `*`, and it **exits 0 having done nothing**. Same trap as
`javac` needing sudo for `/opt/tomcat9/lib`. Verify rather than assume:

```bash
sudo grep -c dayBilling /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/provider/appointmentprovideradminday_jsp.java
```

## Settings

`/var/lib/OscarDocument/oscar/mymd_billing.properties`, `600 tomcat:tomcat`:

```properties
healthassist.url = https://physician.health-assist.org
billing.secret   = <matches OSCAR_BILLING_BRIDGE_SECRET in the app>
dryrun           = true
```

Read on every request, so rotating the secret needs no restart. **Fails closed**: unreadable file,
missing URL or missing secret all mean no AI suggestions and dry run forced on. `dryrun` is only
off when it says exactly `false`.

The app side needs `OSCAR_BILLING_BRIDGE_SECRET` set in Azure App Service.

## The offline harness — how to debug this

Runs without Tomcat, without a session, without a browser, and **writes nothing whatever the
flags**:

```bash
W=/opt/tomcat9/webapps/oscar
CP="/tmp/billbuild:$W/WEB-INF/classes:$(sudo find $W/WEB-INF/lib -name '*.jar' | tr '\n' ':')"
sudo java -cp "$CP" mymd.billing.DayBilling --provider 100 --date 2026-08-06 --no-llm --verbose
```

Put the build directory **first** on the classpath or the deployed classes shadow your rebuild.
`--no-llm` skips the app round trip entirely. Names are shown as initials by default because this
lands in terminal scrollback and shell history; pass `--names` when you actually need them.

## The captured claim — what one 13437 actually writes

Captured 2026-08-07 from a claim made by hand through OSCAR's own BC billing form, by snapshotting
the billing tables before and after. (A before/after diff rather than the MySQL general log: the
general log records *every* query on the box while it is on, including other people's PHI, and the
row diff answers the same question without that.)

**A claim is four rows:** one `billing`, one `billingmaster`, one `billing_history`, one
`billingnote`. `billactivity` and `billingdetail` are untouched.

| `billing` | value | where it comes from |
|---|---|---|
| `appointment_no` | 96 | the appointment |
| `billing_date` | 2026-08-04 | the **service** date |
| `update_date` | 2026-08-07 | the day the claim was made |
| `total` | 38.61 | looked up from `billingservice.value` |
| `status` | `O` | Not Submitted |
| `visittype` | `V|` | **char(2) truncation of `V|Virtual Care`** |
| `provider_ohip_no` | 67199 | resolved from the provider record |
| `billingtype` | MSP | |
| `content`, `visitdate`, `*_time` | NULL | unused |

| `billingmaster` | value | where it comes from |
|---|---|---|
| `billingstatus` | `O` | |
| `billing_code` | 13437 | form `service` |
| `dx_code1` | 462 | form `xml_diagnostic_detail1` |
| `service_date` | 20260804 | `yyyyMMdd` |
| `service_location` | `V` | **char(1) truncation of the same `V|Virtual Care`** |
| `practitioner_no`, `payee_no` | 67199 | the **MSP number**, not provider_no 100 |
| `datacenter` | S1865 | Teleplan config |
| `name_verify` | `H GR` | derived by OSCAR from the patient name |
| `bill_amount` | 38.61 | looked up |
| `billing_unit` | 1.0 | default; the form has no unit field for the main service code |
| `claimcode` / `paymentMethod` / `mva_claim_code` / `icbc_claim_no` | C02 / 6 / N / 00000000 | defaults |

`billing_history` mirrors the amount and status, but its `practitioner_no` is **100** (the provider
number) where `billingmaster` uses **67199** (the MSP number) — worth knowing before reading either
one as a provider key.

**This is the case for replaying OSCAR's actions rather than inserting rows.** The MSP number, the
data centre, the fee amount, the truncation of `visittype` into two columns two different ways, and
`name_verify` are all derived by OSCAR. Hand-written INSERTs would have had to reproduce every one
of them, and `name_verify` in particular was not guessable.

**Two things the capture corrected:**

- `xml_visittype` must be the whole `V|Virtual Care` string, not `V`. billingBC.jsp defaults the
  field from the `visittype` property (its lines ~894–901); the replay skips the JSP, so it has to
  be passed. `BillingWriter.serviceLocation()` now reads the property.
- OSCAR sets `appointment.status` to `BS` (Billed) itself. Nothing to do — and it means a billed
  visit drops out of the sweep on the status filter as well as the unbilled join.

## Verify before billing for real

`dryrun=true` until every step below has passed. Step 1 is done; step 2 is the next gate.

1. ~~Capture a hand-made claim.~~ **Done 2026-08-07** — see the section above.

2. **Diff the dry-run parameters against the capture.** With `dryrun=true`, click Bill Day, then
   read `SELECT detail FROM mymd_billing_log WHERE decision='DRYRUN'`. Those are the exact
   parameters that would have been dispatched. They must line up with what OSCAR sent itself.

3. **One real claim on a test demographic.** Set `dryrun=false`. Then check it
   renders identically to the hand-made one in OSCAR's own billing screen, that
   `SELECT billingstatus FROM billingmaster WHERE billing_no = ?` is `'O'`, and that the row set
   matches the table above modulo primary keys and timestamps.

4. **Delete and reprocess it through OSCAR's own UI.** This is the completeness test — partially
   formed claims blow up exactly there, which is the code path that holds the `demographic.ver`
   NULL NPE. If OSCAR can delete and reprocess the claim, the row set is complete.

5. **One real patient, one claim, submitted by hand** to Teleplan. Confirm acceptance in the return
   file under `oscar/billing/download/`. **Do not run a whole day until MSP has accepted one real
   claim.**

6. **One supervised real day.** Reconcile the results page against the day sheet.

## If a claim fails partway

`BillingSaveBillingAction` flips the appointment to Billed (`BS`) *before* it finishes writing the
claim, and the three dispatched actions manage their own connections, so this cannot be wrapped in
one transaction. A failure late in that action therefore leaves a visit **marked billed with no
claim** — and because `BS` is not a billable status, the sweep will never show it again.

Detect it:

```sql
SELECT a.appointment_no, a.appointment_date, a.status, a.provider_no
FROM appointment a
LEFT JOIN billing b ON b.appointment_no = a.appointment_no AND b.status <> 'D'
WHERE a.status IN ('B','BS') AND a.demographic_no <> 0 AND b.billing_no IS NULL;
```

Repair it by reading the real prior status out of OSCAR's own archive rather than guessing —
`appointmentArchive` keeps every previous version:

```sql
SELECT status, updatedatetime FROM appointmentArchive
WHERE appointment_no = ? ORDER BY id DESC LIMIT 5;
```

This happened once, on 2026-08-07, from the `submit` NPE described below. One appointment; restored
from `FS`.

## Rollback

- **Nav link**: restore the `.oscarbak.<timestamp>` the patcher wrote, then clear the Jasper work
  directory for `appointmentprovideradminday_jsp.*`.
- **Feature**: `rm` the JSP and `WEB-INF/classes/mymd/billing/`. Nothing else in OSCAR references
  them.
- **Claims**: `SELECT billing_no FROM mymd_billing_log WHERE run_id = ? AND decision = 'BILLED'`,
  then delete each **through OSCAR's own UI**, not by SQL. Only valid **before** Teleplan
  submission — after that the correction path is MSP's and this tool has no part in it.

## What was confirmed on the box (2026-08-06)

Recorded because most of it is not guessable and all of it is load-bearing.

**The write is three Struts actions sharing a session bean**, not one INSERT:

```
/billing.do                      BillingAction.fillBean()       builds BillingSessionBean
/billing/CA/BC/CreateBilling.do  BillingCreateBillingAction     validation ONLY
/billing/CA/BC/SaveBilling.do    BillingSaveBillingAction       saveBill() -> the actual rows
```

`CreateBilling` writes nothing — it is `validateServiceCodeList`, `validateDxCodeList`,
`validateCDMCodeConditions`, `validateCodeLastBilled` and friends. Replaying all three in process
therefore buys OSCAR's own MSP validation for free, which is why `BillingWriter` drives them
instead of inserting rows. Form properties come from `billingBC.jsp` (`service`,
`xml_diagnostic_detail1..3`, `xml_vdate`, `xml_visittype`, `xml_provider`, …).

**Schema:**

- `billing.appointment_no` exists and is indexed → the unbilled join is exact, not a same-day guess.
- `billingmaster.dx_code1/2/3` are `varchar(5)`; `billing_code` `varchar(10)`.
- **`billingmaster.phn` is `varchar(10)`** — this is the concrete reason Ontario's 2-letter version
  code cannot ride along on a claim.
- `billingstatus_types`: `O` = Bill MSP – Not Submitted, `B` = Submitted, `D` = Deleted.
- `appointment.status`: `F`/`FS` = Done (billable), `B`/`BS` = Billed, `C` = Cancelled, `N` = No
  Show, `t`/`tS` = To Do. OSCAR appends `S` when the appointment is signed off.
- `casemgmt_note.appointmentNo` (camelCase) is **100% populated** here — 93 of 93 notes over 90
  days — so notes scope to a visit exactly. Those 93 notes span 84 `uuid`s, so note versioning is
  real and the "latest row per uuid" grouping is required, not defensive.
- `ctl_servicecodes_dxcodes` is **empty**, so there is no service-code → dx-code restriction
  configured; validation is against `icd9` (15,364 rows: 989 three-char, 6,149 four-char, 8,225
  five-char).
- `visittype = V|Virtual Care` in `oscar_mcmaster.properties` — the service-location default.

**BC PHN check digit** (mod 11, weights `2,4,8,5,10,9,7,3` over digits 2–9, remainder 0 or 1 is
invalid) was validated against this clinic's own data: **every** PHN on an MSP-accepted claim
passes, and the only failures are OSCAR's `0000000000` placeholder.

**Outbound HTTPS from the box to `physician.health-assist.org` works** (HTTP 200). Note the
direction: this feature is OSCAR → app, so unlike the pharmacy bridge it needs **no nginx change**,
no new port and no device-certificate exemption.

## Related

- `docs/oscar/lab-import-install.md` — the nav patcher anchors on the Lab Import `<li>`, so Lab
  Import must be reinstalled first.
- `infrastructure/oscar-patches/README.md` — register of everything hand-installed on this box.
- `src/lib/billing/health-card.ts` and `src/lib/redact-patient-name.ts` — the executable specs the
  Java ports in `DayBilling` are checked against. Change one, change both.
