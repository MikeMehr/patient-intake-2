// Fill-spec for prefilling OSCAR eForms from the transcription page.
//
// The spec travels as a base64url JSON blob in the `ha_prefill` query param of
// OSCAR's eForm-add URL (/oscar/eform/efmformadd_data.jsp?fid=N&demographic_no=D).
// A small script patched into each eForm's form_html (see
// infrastructure/oscar-patches/eform-fax/patch_eform_prefill.py) decodes it and
// applies values. The spec is deliberately dumb — element ids/names and plain
// string values only — so all clinical mapping stays in this repo and the
// OSCAR-side script never needs re-patching to iterate.

export type FillSpec = {
  v: 1;
  fid: number;
  // Echoed for the OSCAR-side wrong-patient guard: the injected script aborts
  // when this doesn't match the demographic_no the form was opened for.
  demographicNo: string;
  // Element ids/names to tick: real checkbox -> .checked, box-style text input -> 'X'.
  checks: string[];
  // Free-text element ids/names -> value (set if empty, append otherwise).
  fields: Record<string, string>;
  // <select> ids/names -> option to choose, matched by option value first, then
  // case-insensitive visible text (used by the Consultation Request page: the
  // service select matches by text, urgency by value). eForm-side scripts that
  // predate this key simply ignore it.
  selects?: Record<string, string>;
  // Prescriptions to stage on the Rx3 pad (SearchDrug3.jsp). The OSCAR-side
  // script searches each item, auto-adds only a confident name+strength match,
  // and falls back to seeding the search box otherwise.
  rx?: RxItem[];
};

export type RxItem = {
  // Drug search term — generic name only, no strength or form.
  search: string;
  // Dose strength as dictated ("500 mg"); its digit groups gate the auto-add match.
  strength: string;
  // OSCAR-parseable sig, e.g. "1 tab PO BID PRN pain" — parseIntr() structures it.
  sig: string;
  // Dispense quantity ("40", "150 mL"); "" when not dictated.
  quantity: string;
  // Refills; "0" when not dictated.
  repeats: string;
};

// The imaging requisition is fid=7 ("1 - CT/XR/US Req - FHA"); the screenshot
// URL's fdid=104 was a saved-instance id, not the form id.
export const EFORM_FIDS = { labs: 3, imaging: 7 } as const;

export const OSCAR_EFORM_ADD_PATH = "/oscar/eform/efmformadd_data.jsp";

// The Consultation Request page is a stock JSP, not an eForm — it takes the
// patient as `de` and gets its own ha_prefill reader from
// infrastructure/oscar-patches/eform-fax/patch_consultation_prefill.py.
export const OSCAR_CONSULTATION_PATH =
  "/oscar/oscarEncounter/oscarConsultationRequest/ConsultationFormRequest.jsp";

// Rx3 entry point. choosePatient.do initializes the Rx session then struts-
// FORWARDS to SearchDrug3.jsp, so the browser URL (and ha_prefill) stays on the
// choosePatient.do query string. Empty providerNo is fine — the Rx session uses
// the logged-in provider. Prefill applied by patch_rx_prefill.py.
export const OSCAR_RX_PATH = "/oscar/oscarRx/choosePatient.do";

// Keep the encoded URL comfortably inside Tomcat's ~8KB request-line budget.
const MAX_SPEC_JSON_CHARS = 4000;
const MAX_SHORT_FIELD_CHARS = 160;
const MAX_LONG_FIELD_CHARS = 700;
const MAX_RX_ITEMS = 10;
const RX_FIELD_CAPS: Record<keyof RxItem, number> = {
  search: 80,
  strength: 40,
  sig: 200,
  quantity: 20,
  repeats: 3,
};

// Fields clipped first when the spec is over budget, in this order.
const LONG_TEXT_FIELDS = [
  "AdditionalTestInstructions",
  "RelevantHistory",
  "RelevantHistoryText",
  "DiagnosisAndIndications",
  "clinicalInformation",
  "reasonForConsultation",
];

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export type ClampResult = { spec: FillSpec; truncated: boolean };

/**
 * Enforces per-field and whole-spec size caps so the resulting URL never
 * exceeds the server's request-line limit. Clips long free-text fields first;
 * as a last resort drops free-text entirely and keeps the checks.
 */
export function clampFillSpec(spec: FillSpec): ClampResult {
  let truncated = false;
  const fields: Record<string, string> = {};
  for (const [key, raw] of Object.entries(spec.fields)) {
    const value = raw.trim();
    if (!value) continue;
    const max = LONG_TEXT_FIELDS.includes(key) ? MAX_LONG_FIELD_CHARS : MAX_SHORT_FIELD_CHARS;
    const clipped = truncate(value, max);
    if (clipped !== value) truncated = true;
    fields[key] = clipped;
  }
  let clamped: FillSpec = { ...spec, fields };
  if (spec.selects) {
    const selects: Record<string, string> = {};
    for (const [key, raw] of Object.entries(spec.selects)) {
      const value = raw.trim();
      if (value) selects[key] = truncate(value, MAX_SHORT_FIELD_CHARS);
    }
    clamped = { ...clamped, selects };
  }
  if (spec.rx) {
    const rx: RxItem[] = [];
    for (const item of spec.rx) {
      if (!item.search.trim()) {
        truncated = true;
        continue;
      }
      const capped = {} as RxItem;
      for (const key of Object.keys(RX_FIELD_CAPS) as (keyof RxItem)[]) {
        const value = (item[key] ?? "").trim();
        capped[key] = truncate(value, RX_FIELD_CAPS[key]);
        if (capped[key] !== value) truncated = true;
      }
      rx.push(capped);
    }
    if (rx.length > MAX_RX_ITEMS) truncated = true;
    clamped = { ...clamped, rx: rx.slice(0, MAX_RX_ITEMS) };
  }

  for (const field of LONG_TEXT_FIELDS) {
    if (JSON.stringify(clamped).length <= MAX_SPEC_JSON_CHARS) break;
    if (clamped.fields[field]) {
      truncated = true;
      clamped = { ...clamped, fields: { ...clamped.fields, [field]: truncate(clamped.fields[field], 200) } };
    }
  }
  while (
    JSON.stringify(clamped).length > MAX_SPEC_JSON_CHARS &&
    (clamped.rx?.length ?? 0) > 1
  ) {
    truncated = true;
    clamped = { ...clamped, rx: clamped.rx!.slice(0, -1) };
  }
  if (JSON.stringify(clamped).length > MAX_SPEC_JSON_CHARS) {
    truncated = true;
    clamped = { ...clamped, fields: {} };
  }
  return { spec: clamped, truncated };
}

/** UTF-8 -> base64url (no padding), matching the decoder in the injected eForm script. */
export function encodeFillSpecParam(spec: FillSpec): string {
  const json = JSON.stringify(spec);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildEformAddUrl(oscarOrigin: string, spec: FillSpec): string {
  const params = new URLSearchParams({
    fid: String(spec.fid),
    demographic_no: spec.demographicNo,
    ha_prefill: encodeFillSpecParam(spec),
  });
  return `${oscarOrigin}${OSCAR_EFORM_ADD_PATH}?${params.toString()}`;
}

export function buildConsultationRequestUrl(oscarOrigin: string, spec: FillSpec): string {
  const params = new URLSearchParams({
    de: spec.demographicNo,
    ha_prefill: encodeFillSpecParam(spec),
  });
  return `${oscarOrigin}${OSCAR_CONSULTATION_PATH}?${params.toString()}`;
}

export function buildRxUrl(oscarOrigin: string, spec: FillSpec): string {
  const params = new URLSearchParams({
    providerNo: "",
    demographicNo: spec.demographicNo,
    ha_prefill: encodeFillSpecParam(spec),
  });
  return `${oscarOrigin}${OSCAR_RX_PATH}?${params.toString()}`;
}
