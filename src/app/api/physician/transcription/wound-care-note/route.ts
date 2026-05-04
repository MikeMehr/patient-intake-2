import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const MAX_TRANSCRIPT_LENGTH = 30_000;
const MAX_BG_TEXT_LENGTH = 15_000;

const systemPrompt = `You are a CMS/Medicare-compliant wound care clinical documentation assistant.
Generate a complete, audit-safe wound care note using precise clinical terminology.
Follow Medicare LCD L38902 documentation standards.

CRITICAL DOCUMENTATION RULES:
- Always document specific tissue type/layer debrided (subcutaneous/muscle and fascia/bone) — never use vague terms like "cleaned" or "debrided" alone
- Include tissue composition percentages (e.g., "60% granulation, 30% fibrinous slough, 10% necrotic eschar") — required for medical necessity
- Include pre- and post-debridement measurements in cm (Length × Width × Depth) when debridement was performed
- State medical necessity explicitly — why this specific patient requires ongoing wound care
- Document healing trajectory (% improvement vs. prior visit, or explain why no improvement and why treatment continues per LCD L38902)
- Address underlying etiology and what is being done about it (vascular status, glycemic control, offloading, nutrition)
- Modifier 25: if both E&M and procedure billed same day, the evaluation must be documented as "significant and separately identifiable"
- Do NOT fabricate measurements not provided — use "___" as placeholder where data is missing
- Use only information from the transcript and wound analyses provided. Do not invent clinical details.

Generate the note in this exact plain-text structure:

SUBJECTIVE
Chief Complaint:
Location of Service:
History of Present Illness (HPI - Established Patient):
[Clinical narrative paragraph — specific and detailed, not vague. Include patient status, acuity, interval history since last visit.]
  Onset/Duration:
  Initial Etiology:
  Number of Wounds:
  Patient-Reported Course:
  Primary Symptoms:
    • Pain: score [0-10], character [aching/burning/sharp], timing [constant/intermittent]
    • Drainage: amount [none/minimal/moderate/heavy], type [serous/serosanguinous/purulent]
    • Odor:
    • Bleeding:
    • Swelling:
    • Systemic symptoms:
  Previous Treatment:
    • Wound care: [dressings | debridement | grafts | advanced therapies]
    • Care support: [home health nurse | family caregiver], frequency:
    • Patient adherence:
  Barriers to Healing:
  Comorbid Risk Factors:
    • Diabetes:
    • Neuropathy:
    • Vascular:
    • Edema/lymphedema:
    • Renal disease:
    • Cardiac disease:
    • Malignancy or prior radiation:
    • Immunosuppression:
    • Smoking:
  Functional Impact:
    • Mobility:
    • ADLs:
    • Occupational/activity limitations:
  Medications affecting wound healing:
    • Anticoagulants:
    • Steroids/Immunosuppressants:
  Patient Goals and Concerns:
  Medical Necessity Statement: [Explicit, patient-specific statement — not generic boilerplate — of why ongoing wound care services are medically necessary for this patient]
Social History:
Review of Systems:
  • Constitutional:
  • Cardiovascular:
  • Endocrine:
  • Skin:
  • Neuro/MSK:

OBJECTIVE
Vital Signs:
Physical Exam:
General Exam:
  • Patient alert and oriented, in no acute distress
  • Vital signs reviewed
Vascular:
  • Pulses:
  • Capillary refill:
  • Skin temperature:
  • Edema:
  • Varicosities/stasis changes:
Neurologic:
  • Protective sensation:
  • Light touch:
  • Vibratory sensation:
  • Motor strength:
Musculoskeletal:
  • Deformities:
  • Range of motion:
  • Gait:
Dermatologic - Wound Exam
[For each wound, use the wound analysis data provided. Populate measurements from AI image analysis. Leave depth/volume as ___ if not available from dictation. DO NOT fabricate values.]
Wound #1:
  • Location:
  • Size: length ___ cm x width ___ cm x depth ___ cm
  • Surface area: ___ sq cm
  • Volume: ___ cu cm
  • Tissue composition: [X% granulation, X% fibrinous slough, X% necrotic eschar, X% epithelial — REQUIRED for Medicare]
  • Borders:
  • Wound base:
  • Periwound:
  • Drainage: amount, type
  • Odor:
  • Signs of infection:
  • Stage (if pressure ulcer):
  • Healing trajectory vs. prior visit: [X% improvement / stable / worsening — REQUIRED for Medicare. If worsening or no improvement, explain why treatment continues.]
  • Post-debridement (if performed): length ___ cm x width ___ cm x depth ___ cm, area ___ sq cm, volume ___ cu cm

ASSESSMENT
Diagnosis: [ICD-10 codes with descriptions if mentioned in transcript]
Medical Decision Making: [complexity: straightforward/low/moderate/high — documents E&M level separately from any procedure]
Disposition:

PLAN
Office Procedures:
  [If debridement or procedure performed — include procedure name + CPT code, indication with medical necessity, per-wound data, depth level reached (subcutaneous/muscle and fascia/bone), instruments used, tissue description, tissue disposition, patient tolerance, post-procedure care. If no procedure, write "None performed this visit."]
Procedure Coding: [CPT code, units, modifiers. Note: if E&M billed same day as procedure, Modifier 25 required and evaluation must be separately identifiable.]
Care Plan:
  Patient Education:
    • Diagnosis and prognosis reviewed with patient and/or caregiver
    • Discussed importance of adherence to prescribed wound care regimen
    • Reinforced need for daily wound inspection, infection monitoring, and strict offloading/compression (if applicable)
    • Education provided regarding nutrition, hydration, glycemic control, smoking cessation, and activity modification
    • Patient advised to seek urgent care for worsening infection signs (increased redness, drainage, odor, swelling, fever)
    • Written and verbal instructions given; patient verbalized understanding
  Treatment Plan:
    • Wound cleansed with:
    • Dressing protocol: [product] applied with change frequency [X/week]
    • Offloading:
    • Compression:
    • Adjunctive therapies considered:
    • Imaging/labs if indicated:
    • Medications:
    • Coordination of care:
  Procedures Performed Today:
  Follow-Up:
    • Patient to return in [X weeks]
    • Earlier follow-up if signs of infection or deterioration occur
    • At follow-up: reassess wound measurements, tissue quality, drainage, and healing trajectory
    • [If at 30-day mark with no measurable improvement: document plan of care revision per LCD L38902]
  Additional Notes:
Nursing Orders:
  • Clean wound with sterile normal saline
  • Apply [dressing] per protocol
  • Secure with [secondary dressing]
  • Change dressing [X/week]
  • Notify provider for any increase in wound drainage, odor, redness, swelling, or fever`;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "AI actions are disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/physician/transcription/wound-care-note", requestId, status, Date.now() - started);
    return res;
  }

  const session = await getCurrentSession();
  if (!session || session.userType !== "provider") {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required." }, { status });
    logRequestMeta("/api/physician/transcription/wound-care-note", requestId, status, Date.now() - started);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
    logRequestMeta("/api/physician/transcription/wound-care-note", requestId, status, Date.now() - started);
    return res;
  }

  const { transcript, woundAnalyses, backgroundText } = (body || {}) as {
    transcript?: string;
    woundAnalyses?: Array<Record<string, string> & { woundNumber?: number }>;
    backgroundText?: string;
  };

  if (!transcript || typeof transcript !== "string" || transcript.trim().length < 5) {
    status = 400;
    const res = NextResponse.json({ error: "transcript is required." }, { status });
    logRequestMeta("/api/physician/transcription/wound-care-note", requestId, status, Date.now() - started);
    return res;
  }

  const trimmedTranscript = transcript.slice(0, MAX_TRANSCRIPT_LENGTH);
  const trimmedBgText = typeof backgroundText === "string"
    ? backgroundText.slice(0, MAX_BG_TEXT_LENGTH)
    : "";

  // Format wound analyses for the AI prompt
  const woundDataText = Array.isArray(woundAnalyses) && woundAnalyses.length > 0
    ? woundAnalyses
        .map((w, i) => {
          const num = w.woundNumber ?? i + 1;
          return [
            `Wound #${num} (from AI image analysis):`,
            `  Length: ${w.length ?? "—"} cm`,
            `  Width: ${w.width ?? "—"} cm`,
            `  Surface area: ${w.surfaceArea ?? "—"}`,
            `  Borders: ${w.borders ?? "—"}`,
            `  Wound base: ${w.woundBase ?? "—"}`,
            `  Tissue composition: ${w.woundBaseComposition ?? "—"}`,
            `  Periwound: ${w.periwound ?? "—"}`,
            `  Drainage type: ${w.drainageType ?? "—"}`,
            `  Signs of infection: ${w.signsOfInfection ?? "—"}`,
            `  Stage: ${w.stage ?? "—"}`,
            `  Notes: ${w.notes ?? ""}`,
          ].join("\n");
        })
        .join("\n\n")
    : "No wound image analysis available.";

  const userContent = [
    "=== PROVIDER TRANSCRIPT ===",
    trimmedTranscript,
    "",
    "=== WOUND IMAGE ANALYSIS DATA ===",
    woundDataText,
    ...(trimmedBgText
      ? ["", "=== BACKGROUND CLINICAL INFORMATION (PMH / SH / Medications) ===", trimmedBgText]
      : []),
  ].join("\n");

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    status = 500;
    const res = NextResponse.json(
      { error: (err as Error).message || "Azure OpenAI is not configured." },
      { status },
    );
    logRequestMeta("/api/physician/transcription/wound-care-note", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_completion_tokens: 4000,
    });

    const note = completion.choices[0]?.message?.content?.trim() ?? "";
    const res = NextResponse.json({ note });
    logRequestMeta("/api/physician/transcription/wound-care-note", requestId, status, Date.now() - started);
    return res;
  } catch (err) {
    status = 500;
    console.error("[wound-care-note] AI call failed:", err);
    const res = NextResponse.json({ error: "Failed to generate wound care note." }, { status });
    logRequestMeta("/api/physician/transcription/wound-care-note", requestId, status, Date.now() - started);
    return res;
  }
}
