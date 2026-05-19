import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import {
  createSoapDraftVersion,
  createTranscriptionEncounter,
  resolveWorkforceScope,
  upsertTranscriptionSessionPointer,
} from "@/lib/transcription-store";
import { HEALTHASSIST_SNAPSHOT_LABEL } from "@/lib/transcription-policy";

/**
 * Split a wound care note (SUBJECTIVE / OBJECTIVE / ASSESSMENT / PLAN all-caps headers)
 * into SOAP draft fields so it can be persisted using the existing soap_note_versions table.
 */
function parseWoundCareNoteAsSoap(note: string): {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
} {
  const MAX = 5900;
  const sections: Record<string, string> = {
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
  };

  // Split on all-caps section headers that appear at the start of a line
  const parts = note.split(/^(SUBJECTIVE|OBJECTIVE|ASSESSMENT|PLAN)\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i].toLowerCase();
    const content = (parts[i + 1] ?? "").trim();
    if (key in sections) {
      sections[key] = content.slice(0, MAX);
    }
  }

  // Ensure required fields have content
  if (!sections.subjective) sections.subjective = "Wound care note generated.";
  if (!sections.assessment) sections.assessment = "See wound care note.";
  if (!sections.plan) sections.plan = note.slice(0, MAX);

  return sections as { subjective: string; objective: string; assessment: string; plan: string };
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  const session = await getCurrentSession();
  if (!session || session.userType !== "provider") {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required." }, { status });
    logRequestMeta("/api/physician/transcription/wound-care-snapshot", requestId, status, Date.now() - started);
    return res;
  }

  const physicianId = getEffectivePhysicianId(session);
  const scope = resolveWorkforceScope({
    userType: session.userType,
    userId: physicianId,
    organizationId: session.organizationId || null,
  });
  if (!scope) {
    status = 403;
    const res = NextResponse.json({ error: "Workforce access required." }, { status });
    logRequestMeta("/api/physician/transcription/wound-care-snapshot", requestId, status, Date.now() - started);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
    logRequestMeta("/api/physician/transcription/wound-care-snapshot", requestId, status, Date.now() - started);
    return res;
  }

  const { note, transcript } = (body || {}) as { note?: string; transcript?: string };

  if (!note || typeof note !== "string" || note.trim().length < 5) {
    status = 400;
    const res = NextResponse.json({ error: "note is required." }, { status });
    logRequestMeta("/api/physician/transcription/wound-care-snapshot", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const { encounterId } = await createTranscriptionEncounter({
      physicianId,
      patientId: null,
      scope,
      chiefComplaint: "Wound care",
    });

    const draft = parseWoundCareNoteAsSoap(note);

    const { soapVersionId, version } = await createSoapDraftVersion({
      encounterId,
      patientId: null,
      physicianId,
      draft,
      transcript: typeof transcript === "string" ? transcript.slice(0, 30_000) : "",
    });

    await upsertTranscriptionSessionPointer({
      physicianId,
      patientId: null,
      encounterId,
      soapVersionId,
      previewSummary: draft.subjective.slice(0, 280) || null,
    });

    const res = NextResponse.json({
      soapVersionId,
      encounterId,
      version,
      lifecycleState: "DRAFT",
      snapshotLabel: HEALTHASSIST_SNAPSHOT_LABEL,
    });
    logRequestMeta("/api/physician/transcription/wound-care-snapshot", requestId, status, Date.now() - started);
    return res;
  } catch (err) {
    status = 500;
    console.error("[wound-care-snapshot] failed:", err);
    const res = NextResponse.json({ error: "Failed to save wound care snapshot." }, { status });
    logRequestMeta("/api/physician/transcription/wound-care-snapshot", requestId, status, Date.now() - started);
    return res;
  }
}
