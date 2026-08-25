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
};

// The imaging requisition is fid=7 ("1 - CT/XR/US Req - FHA"); the screenshot
// URL's fdid=104 was a saved-instance id, not the form id.
export const EFORM_FIDS = { labs: 3, imaging: 7 } as const;

export const OSCAR_EFORM_ADD_PATH = "/oscar/eform/efmformadd_data.jsp";

// Keep the encoded URL comfortably inside Tomcat's ~8KB request-line budget.
const MAX_SPEC_JSON_CHARS = 4000;
const MAX_SHORT_FIELD_CHARS = 160;
const MAX_LONG_FIELD_CHARS = 700;

// Fields clipped first when the spec is over budget, in this order.
const LONG_TEXT_FIELDS = [
  "AdditionalTestInstructions",
  "RelevantHistory",
  "RelevantHistoryText",
  "DiagnosisAndIndications",
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

  for (const field of LONG_TEXT_FIELDS) {
    if (JSON.stringify(clamped).length <= MAX_SPEC_JSON_CHARS) break;
    if (clamped.fields[field]) {
      truncated = true;
      clamped = { ...clamped, fields: { ...clamped.fields, [field]: truncate(clamped.fields[field], 200) } };
    }
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
