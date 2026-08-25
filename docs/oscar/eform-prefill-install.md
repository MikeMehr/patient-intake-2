# eForm prefill from the transcription page ("Create requisition")

The transcription page's Recommendations box offers **Create requisition** (imaging)
and **Create lab requisition** (labs) when the page was launched from the OSCAR
eChart Transcribe button. Clicking one:

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
scp -i ~/.ssh/oscar_server infrastructure/oscar-patches/eform-fax/patch_eform_prefill.py manucher@10.9.0.1:/tmp/
ssh -i ~/.ssh/oscar_server manucher@10.9.0.1
sudo python3 /tmp/patch_eform_prefill.py 3 7
```

Idempotent (skips a form that already has `haPrefill`). Writes a hex backup of
each `form_html` to `/var/lib/OscarDocument/oscar/mymd_eform_backups/` first.
Rollback: `UPDATE eform SET form_html=UNHEX('<backup file contents>') WHERE fid=N;`

The patch lives in the **database**, not the webapp, so a WAR redeploy does NOT
wipe it — but restoring an eForm from an old backup or re-importing the form
would.

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
