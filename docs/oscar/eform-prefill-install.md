# eForm prefill from the transcription page ("Create requisition")

The transcription page's Recommendations box offers **Create requisition**
(imaging), **Create lab requisition** (labs), **Create consultation**
(referrals), and **Create prescription** (explicitly dictated medications) when
the page was launched from the OSCAR eChart Transcribe button. Clicking one:

1. POSTs the recommendation text to `/api/physician/transcription/requisition-prefill`,
   which uses Azure OpenAI to extract a structured order and maps it onto eForm
   element ids (`src/lib/oscar/eform-prefill-maps.ts`), returning a fill-spec
   `{v:1, fid, demographicNo, checks:[ids], fields:{id:value}}`.
2. Opens (synchronously, to beat the popup blocker) a new window at
   `https://<oscar>/oscar/eform/efmformadd_data.jsp?fid=N&demographic_no=D&ha_prefill=B`
   where `B` = base64url(JSON fill-spec). The OSCAR origin is always the
   server-resolved `openerOrigin` from the launch allow-list, never a URL param.
3. A script patched into the eForm's `form_html` applies the spec on window load:
   checkbox → `.checked = true`, box-style text input → `value = 'X'`, free text →
   set when empty / append when `oscarDB=` substitution already filled something.
   Boxes not named in the spec are never touched.

Because the spec carries element ids only, changing WHAT gets filled is an
app-repo change; the OSCAR patch never needs re-running for that.

## Install (on the OSCAR box)

```
scp -i ~/.ssh/oscar_server infrastructure/oscar-patches/eform-fax/patch_eform_prefill.py \
    infrastructure/oscar-patches/eform-fax/patch_consultation_prefill.py \
    infrastructure/oscar-patches/eform-fax/patch_rx_prefill.py manucher@10.9.0.1:/tmp/
ssh -i ~/.ssh/oscar_server manucher@10.9.0.1
sudo python3 /tmp/patch_eform_prefill.py 3 7
sudo python3 /tmp/patch_consultation_prefill.py
sudo python3 /tmp/patch_rx_prefill.py
```

All are idempotent (they skip when the script is already present). The eForm
patch writes a hex backup of each `form_html` to
`/var/lib/OscarDocument/oscar/mymd_eform_backups/` first
(rollback: `UPDATE eform SET form_html=UNHEX('<backup file contents>') WHERE fid=N;`);
the consultation and Rx patches leave a `.oscarbak.<timestamp>` beside the JSP
and delete the compiled copy so Tomcat recompiles without a restart.

The eForm patch lives in the **database**, so a WAR redeploy does NOT wipe it —
but restoring an eForm from an old backup or re-importing the form would. The
consultation patch (`ConsultationFormRequest.jsp`) and the Rx patch
(`oscarRx/SearchDrug3.jsp`) edit **webapp JSPs**, so a WAR redeploy DOES wipe
them — re-run both after redeploys like the other JSP patches.

## Patched forms and their field maps

### fid=3 — "* Lab Requisition" (form `FormName`)

Test boxes are text inputs whose value becomes `'X'`; ids come from
`mapLabTestsToEformFields` (`src/lib/lab-requisition-mapping.ts`). Free text:
`DiagnosisAndIndications`, `subject`, `AdditionalTestInstructions` (unmapped
tests land here).

### fid=7 — "1 - CT/XR/US Req - FHA" (form `MedicalImagingForm`)

NOTE: the screenshot URL `efmshowform_data.jsp?fdid=104` is a saved-instance id
(`eform_data.fdid`); the form id is 7. Field map (read from live form_html
2026-08-24):

| What | Element | Type |
|---|---|---|
| X-ray modality box | `Xray` | text, `'X'` |
| Ultrasound modality box | `Ultrasound` | text, `'X'` (Doppler also maps here) |
| CT modality box | `CT` | text, `'X'` |
| Interventional/angio box | `SpecialProcedures` | text, `'X'` (unused by prefill) |
| Exam requested line | `ExamRequestedText` | text (no id — matched by name) |
| RELEVANT HISTORY (left box) | `RelevantHistory` | textarea |
| REASON FOR EXAM (right box) | `RelevantHistoryText` | textarea (yes, really) |
| Chart subject | `subject` | text (bottom bar, no id) |

Side and body-part checkboxes exist only in the yellow quick-pick panel
(`LazySelect` form) and merely append words to `ExamRequestedText`, so the
prefill puts side/body-part into the exam text instead. Risk-factor boxes
(PregnantYes/No, DiabeticYes/No, anticoagulants, dialysis, …) are deliberately
never emitted by the app-side mapping: unknown information is never ticked.

### Consultation Request — `ConsultationFormRequest.jsp` (not an eForm)

Opened as `ConsultationFormRequest.jsp?de=<demographicNo>&ha_prefill=B`;
`patch_consultation_prefill.py` injects the reader before `</body>`. One request
per referral — for multiple referrals the transcription page queues them and the
button becomes "Create next consultation (N left)". The spec uses a `selects`
map in addition to `fields`:

| What | Element | Matching |
|---|---|---|
| Service | `service` select | by visible option TEXT (case-insensitive; exact, then contains) — options are built client-side, so the script waits up to ~6 s for them, then fires `onchange` so the specialist list loads |
| Urgency | `urgency` select | by option VALUE: `2` = Non-Urgent, `1` = Urgent, `3` = Return |
| Reason for Consultation | `reasonForConsultation` | textarea |
| Pertinent clinical information | `clinicalInformation` | textarea |

The wrong-patient guard checks `spec.demographicNo` against the `de` URL param
(falling back to the hidden `#demographicNo` input). An unmatched service name
just leaves the select untouched for the physician to pick.

### Prescriptions — `oscarRx/SearchDrug3.jsp` (Rx3, not an eForm)

Opened as `choosePatient.do?providerNo=&demographicNo=D&ha_prefill=B` (the
struts FORWARD to SearchDrug3.jsp keeps the query string; empty `providerNo` is
fine — the Rx session uses the logged-in provider). The spec carries an `rx`
array: `[{search, strength, sig, quantity, repeats}]`, capped at 10 items.
Sources: the "Prescriptions" recommendation lists ONLY prescriptions the
physician explicitly dictated in the transcript.

For each item, sequentially, `patch_rx_prefill.py`'s script replays a human
autocomplete pick: POST `searchDrug.do?method=jsonSearch` → **confident-match
gate** → `WriteScript.do?parameterValue=createNewRx` (Ajax.Updater into
`#rxText`, evalScripts) → fill `instructions_<rand>` + `parseIntr()`,
`quantity_<rand>` + `updateQty()`, `repeats_<rand>`, `updateCurrentInteractions()`.

**Confident-match gate** (the drug search has historically returned wrong drugs
outside category 13 / generic-name search): a result is auto-added only when it
is not inactive, its name contains every word of the dictated drug name, AND it
contains every digit group of the dictated strength. Anything else is NOT added:
the first unmatched drug is seeded into the search box and an amber banner lists
each unmatched item with its dictated sig for the physician to add by hand.

**Safety exception**: alone among the prefill scripts, this one performs network
calls — two fixed same-origin OSCAR endpoints, all params URL-encoded, replaying
exactly what a human click does in the physician's own session. Spec data is
never eval'd or innerHTML'd (banner uses createTextNode). The custom-drug path
(`newCustomDrug`) is never used — it bypasses allergy/interaction checking.
Nothing is signed or saved by the script; the physician reviews, edits, and
prints/saves as usual, and OSCAR's own interaction/duplicate warnings fire per
added drug. Reloading the Rx page re-stages the items (visible; delete the
extra rows).

## `ha_prefill` format and safety

base64url (`+/`→`-_`, padding stripped) of UTF-8 JSON:

```json
{"v":1,"fid":7,"demographicNo":"42","checks":["Xray"],"fields":{"ExamRequestedText":"X-ray right knee"}}
```

The injected script:

- no-ops unless `ha_prefill` is present (saved instances `efmshowform_data.jsp?fdid=N`
  never carry it) and the param is ≤ 8 KB;
- aborts with an alert when `spec.demographicNo` ≠ the form's `demographic_no`
  (URL or form-action `efmdemographic_no`) — wrong-patient guard;
- only ever assigns `.value` / `.checked` — no eval, no innerHTML, no element
  creation, no network — because the param is attacker-influenceable URL data
  landing in a logged-in EMR page;
- appends rather than clobbers fields `oscarDB=` substitution already filled;
- marks the form dirty via `setFlag()` / `setDirtyFlag()` (each in try/catch).

The app clamps the spec (~4 KB JSON) so the URL stays inside Tomcat's request-line
budget; over-long text is clipped and the page tells the physician to review.

## Smoke test

1. Open a TEST patient's eChart → Transcribe → generate a SOAP note mentioning
   imaging and blood work.
2. In Recommendations, open *Imaging requisitions* → **Create requisition**: the
   FHA imaging form opens with the right modality boxes `X`'d, exam line,
   history and reason filled — and nothing else ticked.
3. *Recommended labs* → **Create lab requisition**: mapped tests `X`'d, unmapped
   ones in Additional Test Instructions.
4. Reopen a previously SAVED instance of each form (`fdid=` URL) — must look and
   behave exactly as before.
5. Save / Print / Fax / Save-to-chart buttons still work on both forms.
