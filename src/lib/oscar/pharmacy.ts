/**
 * Client for the OSCAR pharmacy bridge.
 *
 * OSCAR publishes no pharmacy REST endpoint — `PharmacyService`/`RxWebService` are registered in
 * applicationContextREST.xml but do not appear in the live WADL, and the only writer of the
 * patient→pharmacy link (`RxManagePharmacyAction.setPreferred`) needs a logged-in OSCAR session.
 * So the clinic runs a small standalone bridge service beside OSCAR, reachable through a single
 * nginx path that is exempt from the device-cert gate and authenticated by a shared secret.
 * See infrastructure/oscar-patches/README.md.
 *
 * Transport only — nothing here touches our own database. The Postgres side of the directory
 * lives in @/lib/pharmacy-directory.
 */

import { query } from "@/lib/db";
import { oscarFetch } from "@/lib/oscar/client";
import { assertSafeOutboundUrl } from "@/lib/outbound-url";

export type OscarPharmacy = {
  pharmacyId: string;
  name: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  phone: string;
  fax: string;
  email: string;
};

export type PharmacyBridgeError = { error: string; status: number };

export type PharmacyBridgeConfig = { url: string; secret: string };

const SECRET_HEADER = "X-MyMD-Pharmacy-Secret";
const BRIDGE_PATH = "/mymd/pharmacy-bridge";

/** The patient is waiting on this one, so it gets a much shorter budget than the 20 s default. */
const LINK_TIMEOUT_MS = 8_000;
/** A full directory pull is ~1500 rows of JSON; it runs in the background, so it can take its time. */
const LIST_TIMEOUT_MS = 60_000;

const NUMERIC_RE = /^\d{1,10}$/;

/**
 * Resolve the bridge URL and secret for an organization.
 *
 * Returns null — rather than throwing — when the secret is unset or the org has no OSCAR
 * connection, because "not configured" is a normal state that callers record as SKIPPED.
 *
 * getOscarCredsForOrg deliberately returns `restBase`, not `base_url`, so this reads the base URL
 * itself. Note it does NOT require status='connected': the bridge has its own authentication and
 * works fine while the OAuth tokens are expired, which is exactly when you still want the
 * directory to keep syncing.
 */
export async function getPharmacyBridgeConfig(orgId: string): Promise<PharmacyBridgeConfig | null> {
  const secret = process.env.OSCAR_PHARMACY_BRIDGE_SECRET;
  if (!secret) return null;

  const override = process.env.OSCAR_PHARMACY_BRIDGE_URL;
  let candidate: string;

  if (override) {
    candidate = override;
  } else {
    const res = await query<{ base_url: string }>(
      `SELECT base_url FROM emr_connections
       WHERE organization_id = $1 AND vendor = 'OSCAR'
       LIMIT 1`,
      [orgId],
    );
    const baseUrl = res.rows[0]?.base_url;
    if (!baseUrl) return null;
    // base_url is `https://host/oscar`; the bridge sits beside the webapp, not inside it.
    let origin: string;
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      return null;
    }
    candidate = `${origin}${BRIDGE_PATH}`;
  }

  // base_url is settable by an org admin, so this is a real SSRF surface.
  let safe: URL;
  try {
    safe = assertSafeOutboundUrl(candidate, { label: "OSCAR pharmacy bridge URL" });
  } catch (err) {
    console.error(`[oscar/pharmacy] rejected bridge URL for org ${orgId}:`, (err as Error).message);
    return null;
  }

  return { url: safe.toString(), secret };
}

export type BridgeResponse = { ok: true; json: Record<string, unknown> } | PharmacyBridgeError;

/**
 * Exported because the bridge has outgrown pharmacies: the same service, path, and secret also
 * answer MSP eligibility checks (op=check_elig, used by @/lib/oscar/msp-coverage).
 */
export async function postToBridge(
  orgId: string,
  params: Record<string, string>,
  timeoutMs: number,
): Promise<BridgeResponse> {
  const config = await getPharmacyBridgeConfig(orgId);
  if (!config) {
    return { error: "Pharmacy bridge is not configured for this clinic", status: 503 };
  }

  const body = new URLSearchParams(params).toString();

  let res: Response;
  try {
    res = await oscarFetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        [SECRET_HEADER]: config.secret,
      },
      body,
      timeoutMs,
    });
  } catch (err) {
    // Network error or timeout. Log the message only — never the config, which carries the secret.
    console.error(
      `[oscar/pharmacy] bridge request failed for org ${orgId} (op=${params.op}):`,
      (err as Error).message,
    );
    return { error: "Could not reach the clinic's pharmacy bridge", status: 503 };
  }

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    console.error(`[oscar/pharmacy] non-JSON bridge response for org ${orgId}: status=${res.status}`);
    return { error: "Pharmacy bridge returned an unexpected response", status: 502 };
  }

  if (!res.ok) {
    // The bridge's own error strings are safe (no schema, no secret) and are the only useful
    // signal staff have when a link fails, so they are worth surfacing.
    const detail = typeof json.error === "string" ? json.error : `status ${res.status}`;
    console.error(`[oscar/pharmacy] bridge error for org ${orgId} (op=${params.op}): ${detail}`);
    return { error: detail, status: res.status };
  }

  return { ok: true, json };
}

function toPharmacy(raw: unknown): OscarPharmacy | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pharmacyId = String(r.pharmacyId ?? "").trim();
  const name = String(r.name ?? "").trim();
  if (!pharmacyId || !name) return null;
  return {
    pharmacyId,
    name,
    address: String(r.address ?? "").trim(),
    city: String(r.city ?? "").trim(),
    province: String(r.province ?? "").trim(),
    postalCode: String(r.postalCode ?? "").trim(),
    phone: String(r.phone ?? "").trim(),
    fax: String(r.fax ?? "").trim(),
    email: String(r.email ?? "").trim(),
  };
}

/** Every active pharmacy in the clinic's OSCAR directory. Drives the local mirror. */
export async function listOscarPharmacies(
  orgId: string,
): Promise<{ pharmacies: OscarPharmacy[] } | PharmacyBridgeError> {
  const res = await postToBridge(orgId, { op: "list" }, LIST_TIMEOUT_MS);
  if (!("ok" in res)) return res;

  const raw = res.json.pharmacies;
  if (!Array.isArray(raw)) {
    return { error: "Pharmacy bridge returned no pharmacy list", status: 502 };
  }
  return { pharmacies: raw.map(toPharmacy).filter((p): p is OscarPharmacy => p !== null) };
}

/** Make `pharmacyId` the patient's preferred pharmacy in OSCAR. */
export async function linkOscarPharmacy(
  orgId: string,
  args: { demographicNo: string; pharmacyId: string },
): Promise<{ ok: true } | PharmacyBridgeError> {
  // The bridge validates these too; checking here keeps a malformed id from ever leaving the app.
  if (!NUMERIC_RE.test(args.demographicNo) || !NUMERIC_RE.test(args.pharmacyId)) {
    return { error: "demographicNo and pharmacyId must be numeric", status: 400 };
  }

  const res = await postToBridge(
    orgId,
    { op: "link", demographicNo: args.demographicNo, pharmacyId: args.pharmacyId },
    LINK_TIMEOUT_MS,
  );
  if (!("ok" in res)) return res;
  return { ok: true };
}

/**
 * Add a pharmacy to OSCAR's shared directory.
 *
 * Not called from the booking flow by default — see PHARMACY_BRIDGE_ALLOW_UPSERT. Writing to that
 * table from anonymous public input would let a stranger add a row (including the fax number
 * prescriptions get sent to) that OSCAR's own pickers then offer to clinicians.
 */
export async function upsertOscarPharmacy(
  orgId: string,
  input: {
    name: string;
    address?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    phone?: string;
    fax?: string;
  },
): Promise<{ pharmacyId: string } | PharmacyBridgeError> {
  const name = input.name.trim();
  if (!name) return { error: "name is required", status: 400 };

  const res = await postToBridge(
    orgId,
    {
      op: "upsert",
      name,
      address: input.address ?? "",
      city: input.city ?? "",
      province: input.province ?? "",
      postalCode: input.postalCode ?? "",
      phone1: input.phone ?? "",
      fax: input.fax ?? "",
    },
    LINK_TIMEOUT_MS,
  );
  if (!("ok" in res)) return res;

  const pharmacyId = String(res.json.pharmacyId ?? "").trim();
  if (!pharmacyId) {
    return { error: "Pharmacy bridge did not return a pharmacy id", status: 502 };
  }
  return { pharmacyId };
}

/** Whether the booking flow may create OSCAR pharmacy rows from free-text input. Off by default. */
export function isPharmacyUpsertEnabled(): boolean {
  return process.env.PHARMACY_BRIDGE_ALLOW_UPSERT === "true";
}
