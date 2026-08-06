# Lab import: LifeLabs/Excelleris PDF → OSCAR Lab Results

Turns a lab-result PDF already filed in OSCAR into a real HL7 lab, so the values land in the
eChart **Lab Results** tab and trend, instead of sitting in a flat pile of Documents.

Needed because there is no direct Excelleris → OSCAR feed: results are downloaded from Excelleris
Launchpad as PDFs. The PDF stays filed as a Document and remains the source of truth; this creates
a structured view of it alongside.

**None of this lives in git's deployment path — it is installed by hand on the OSCAR server and a
WAR redeploy will wipe it.** This document is the recovery procedure.

## Files installed on the OSCAR box

| Path | What |
|---|---|
| `/opt/tomcat9/webapps/oscar/WEB-INF/classes/mymd/lab/LabPdfParser.class` | PDF → structured results |
| `/opt/tomcat9/webapps/oscar/WEB-INF/classes/mymd/lab/Hl7Builder.class` | results → HL7 v2.3 ORU^R01 |
| `/opt/tomcat9/webapps/oscar/mymd/labImport.jsp` | review screen + ingest |
| `provider/appointmentprovideradminday.jsp` (~line 1540) | **"Lab Import" top-nav link**, added directly after the existing Health Assist link. Inside the `_admin` `security:oscarSec` block, so it is admin-gated like that one. Backup `.oscarbak.20260805174613` |

Sources live beside this doc in `docs/oscar/lab-import/`.

## Reinstall after a WAR redeploy

```bash
W=/opt/tomcat9/webapps/oscar
CP=$(ls $W/WEB-INF/lib/*.jar | tr '\n' ':')$W/WEB-INF/classes
sudo javac -nowarn -cp "$CP" -d /tmp/labbuild LabPdfParser.java Hl7Builder.java
sudo mkdir -p $W/WEB-INF/classes/mymd/lab
sudo cp /tmp/labbuild/mymd/lab/*.class $W/WEB-INF/classes/mymd/lab/
sudo cp labImport.jsp $W/mymd/labImport.jsp
sudo chown -R tomcat:tomcat $W/WEB-INF/classes/mymd $W/mymd/labImport.jsp
```

Validate the JSP compiles without waiting for a user to hit it:

```bash
W=/opt/tomcat9/webapps/oscar
sudo java -cp "$(ls /opt/tomcat9/lib/*.jar /opt/tomcat9/bin/*.jar | tr '\n' ':')$(ls $W/WEB-INF/lib/*.jar | tr '\n' ':')$W/WEB-INF/classes" \
  org.apache.jasper.JspC -uriroot $W -d /tmp/jspc-lab -compile mymd/labImport.jsp
```

"Generation completed with [0] errors" plus a `labImport_jsp.class` under `/tmp/jspc-lab` means good.
If a class was edited, clear `/opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/mymd/labImport_jsp.*`
— Jasper's auto-recompile cannot be trusted on this box.

## Required OSCAR setting

```properties
HL7TEXT_LABS=yes    # in WEB-INF/classes/oscar_mcmaster.properties
```

**Without this the import silently appears to do nothing.** `CommonLabResultData.populateLabResultsData`
gates each lab type behind one of these flags (`CML_LABS`, `MDS_LABS`, `PATHNET_LABS`,
`HL7TEXT_LABS`, `Epsilon_LABS`); with `HL7TEXT_LABS=no` the eChart never calls
`Hl7textResultsData.populateHL7ResultsData`, so labs sit correctly in `hl7TextInfo` with the
patient attached and the Lab Results tab still shows an empty section. This box shipped with `no`
and nothing surfaced it, because no lab had ever been loaded.

Requires a **Tomcat restart** — `OscarProperties` is read once at startup.

## Use

`https://oscar.mymdonline.ca/oscar/mymd/labImport.jsp?documentNo=<n>`

**Loading the page writes nothing.** It parses, matches the patient, checks for a duplicate and
shows everything for review. Only *Approve and import* writes to the database, so the page doubles
as a dry run.

## How it works, and why

**Parsing is by column geometry, not regex.** Every word is assigned to a column by its X
coordinate, with boundaries derived from the report's own header row (`Test Name(s) Result Abn
Reference Range Units Date/Time Completed Status`). This is not over-engineering: rows routinely
omit columns — `Colour YELLOW` has no abnormal flag, range or units; `Squamous Epithelial Cells
Neg /HPF` skips two — and any regex that assumes fixed field order silently misreads them. Because
the boundaries come from the header, a layout change moves them rather than corrupting values.

The same geometry separates the three kinds of non-result line, which text alone cannot tell apart:

- sub-panel headings (`Hematology Panel`, `Electrolytes`) sit in the **name** column
- narrative comments are indented into the **result** column
- the patient name repeated at each page break is **right-aligned**

A result row is identified by a real date in the datetime column; narrative never has one.

**Nothing is guessed.** A row that does not parse cleanly becomes a warning on the review screen
rather than being dropped or approximated. A narrative-only report (e.g. cytology) imports nothing
and says so, rather than silently succeeding with zero results.

### Safety controls

- **Wrong-patient guard.** OSCAR runs `LAB_NOMATCH_NAMES=yes`, so it matches labs on
  **sex + DOB + PHN and ignores the name entirely** — a wrong PHN would file results onto another
  patient's chart with no visible error. The review screen therefore shows the demographic that
  will actually receive the results, and refuses to import unless the PHN resolves to exactly one
  chart *and* that chart is the one the PDF is filed under.
- **Duplicate guard.** Keyed on accession via `Hl7TextInfoDao.searchByAccessionNumber`. Re-importing
  would double-post a result and distort the trend, so it is blocked behind an explicit override.
- **Physician review.** Every value is editable before commit; what is approved is what is written.

### HL7 details worth knowing

Emitted as **HL7 v2.3 ORU^R01**, because OSCAR's PATHL7 parser reads it into HAPI's
`ca.uhn.hl7v2.model.v23.message.ORU_R01`. PATHL7 is deliberate: it is already the configured
`LAB_TYPE` for BC/Excelleris, so records stay consistent if a real feed is ever enabled.

Four field placements are load-bearing, and every one of them fails *silently* — the message still
parses and imports, the value just goes nowhere. All four were caught by round-trip testing:

- **PHN goes in PID-2** — `PATHL7Handler.getHealthNum()` reads `PID.getPatientIDExternalID()`.
- **Accession goes in ORC-3** — `getAccessionNum()` reads `ORC.getFillerOrderNumber()`. Without an
  ORC segment the accession comes back empty and the duplicate guard stops working.
- **Ordering provider goes in OBR-16, and must be the MSP number, not a name** — `getDocNums()`
  reads `OBR.getOrderingProvider(0).getIDNumber()`, and `MessageUploader` resolves it with
  `select provider_no from provider where ohip_no = <id>`. A name resolves to nothing, leaving
  `providerLabRouting.provider_no` empty so the lab reaches no one's inbox. The number comes from
  the report's **"Client Ref. #"** header field (e.g. 67199 → `provider_no` 100).
- **Section code goes in OBR-24** (Diagnostic Service Section ID) — this is the *label the eChart
  displays*. `MessageUploader` joins `getObservationHeader()` across OBRs with `/` into
  `hl7TextInfo.discipline`, and `DemographicLab.jsp` renders that as the link text. Leave OBR-24
  empty and the lab imports perfectly but shows up as a nameless row (just `**`) in Lab Results.
  Populated, it reads `GENERAL/HAEM1/CHEM1/…`, matching how other OSCAR installs display labs.
  Note `discipline` is `varchar(100)`.

Because an off-by-one in a pipe-delimited segment is invisible, `Hl7Builder` assembles OBR by field
**number** into an array rather than by counting `|` characters. That bug is precisely how the
provider first landed in OBR-15.

The round-trip harness is the way to check all of this without touching the database:

```bash
W=/opt/tomcat9/webapps/oscar
CP=$(ls $W/WEB-INF/lib/*.jar | tr '\n' ':')$W/WEB-INF/classes
sudo java -cp /tmp/labgate:$CP mymd.lab.Hl7Builder <report.pdf>          # parse back via OSCAR
sudo java -cp /tmp/labgate:$CP mymd.lab.Hl7Builder <report.pdf> print    # raw HL7
```

It generates the message, feeds it to OSCAR's own `PATHL7Handler`, and reads the values back —
confirming the OBX count matches the PDF and that `docNums` is non-empty. Put `/tmp/labgate`
**first** on the classpath or the deployed classes in `WEB-INF/classes` shadow your rebuild.

Ingest calls `MessageUploader.routeReport(loggedInInfo, "PATHL7", "PATHL7", hl7, fileId)` directly.
The PATHL7 *upload handler* expects an XML envelope wrapping HL7; calling `routeReport` in-process
skips that envelope entirely. `routeReport` writes `hl7TextInfo`, `hl7TextMessage`,
`patientLabRouting`, `providerLabRouting` **and `measurements`** — which is where trending comes from.

**OBX-3 must stay stable across uploads or trends silently split into two unrelated series.**
`Hl7Builder.codeFor()` uses the normalised test name (upper case, non-alphanumerics to underscores)
rather than a LOINC code — the lab emits consistent names, so the normalised name is inherently
stable, whereas an unverified LOINC code risks mislabelling an analyte. A small synonym table
collapses known variants. To add LOINC later, verify the codes against an authoritative source and
emit them in OBX-3 components 4–6, leaving component 1 unchanged.

## Verify

```sql
SELECT * FROM hl7TextInfo ORDER BY lab_no DESC LIMIT 5;
SELECT * FROM providerLabRouting WHERE lab_type='HL7' ORDER BY id DESC LIMIT 5;
SELECT COUNT(*) FROM measurements;
```

Then in the UI: the lab appears in the provider's lab inbox, acknowledges normally, and shows under
Lab Results in the eChart. The real proof of trending is importing a **second** report for the same
test on a later date and confirming both plot as one series.

## Known limits

- Only tested against the BC/LifeLabs report layout. A different lab's format needs its own check —
  the header-derived columns adapt, but the header-block field labels (`Health #:`, `Accession #:`)
  are matched by name.
- Narrative-only reports (cytology, pathology) yield no discrete results by design; keep filing
  those as Documents.
- Related: [`reference_oscar_srfax_doc_perms`](../../CLAUDE.md) — a faxed PDF owned by anyone other
  than `tomcat` cannot be read here either.
