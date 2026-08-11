/**
 * OSCAR specialist sync — BROWSER-CONSOLE SCRIPT, not a `node` script.
 *
 * OSCAR's mTLS device-cert gate (see reference_oscar_device_cert_gate.md in project memory)
 * means oscarEncounter/*.do can only be reached from an already-authenticated, cert-enrolled
 * browser session — there is no way to run this unattended from a server. This mirrors
 * src/lib/oscar/specialist-sync-plan.ts in plain JS for the same reason scripts/pathways-sync.js
 * mirrors src/lib/pathways/parse.ts: this file can't import the app's TS module graph.
 *
 * HOW TO RUN A SYNC:
 *   1. Get this org's QUEUED candidates as JSON — from the app's DB:
 *        SELECT l.id AS "linkId", d.id AS "bcSpecialistId", d.pathways_id AS "pathwaysId",
 *               d.name, d.last_name AS "lastName", d.honorific, d.specialization, d.city,
 *               d.billing_number AS "billingNumber", l.requested_by_provider_no AS "requestedByProviderNo",
 *               c.clinic_address AS "address", c.phone, c.fax, c.email
 *        FROM bc_specialist_oscar_link l JOIN bc_specialist_directory d ON d.id = l.bc_specialist_id
 *        LEFT JOIN bc_specialist_contact_cache c ON c.bc_specialist_id = d.id
 *        WHERE l.organization_id = '<org id>' AND l.status = 'QUEUED' ORDER BY l.queued_at;
 *      (this is exactly what getQueuedOscarSyncCandidates() in src/lib/pathways-directory.ts returns)
 *   2. In a Chrome tab already logged into oscar.mymdonline.ca, open DevTools console (or run via
 *      an automation tool's JS-eval) on any oscar.mymdonline.ca page.
 *   3. Paste this whole file, then run:  await runOscarSpecialistSync(CANDIDATES)
 *      after replacing the CANDIDATES placeholder below with the JSON from step 1.
 *   4. The resolved array is the sync result — feed it back via recordOscarSyncOutcome() (or the
 *      equivalent SQL UPDATE) for each linkId so bc_specialist_oscar_link reflects reality.
 *
 * Every write is followed by a live re-fetch to confirm it actually happened — OSCAR's
 * AddSpecialist.do silently no-ops (200 OK, form re-render, no insert) on a referralNo collision
 * or validation failure rather than erroring, so "the POST didn't throw" is not proof of success.
 *
 * IMPORTANT — confirmed live 2026-08-11: AddSpecialist.do REJECTS a submission with no phone or
 * no address ("Please enter Phone" / "Please enter Address"). bc_specialist_contact_cache is
 * empty until a contact-info scraper is built, so most candidates can't be synced yet — this
 * script SKIPS (not fails) anything missing phone+address rather than submitting a doomed write.
 */

const CANDIDATES = []; // <-- replace with the JSON from step 1 before running

// ---- mirrors src/lib/oscar/specialist-sync-plan.ts ----

function normalizeReferralNo(billingNumber) {
  if (!billingNumber) return "";
  const digits = billingNumber.replace(/\D/g, "");
  if (digits.length === 6) return digits;
  if (digits.length === 5) return digits.padStart(6, "0");
  return "";
}

function deriveFirstName(fullName, lastName) {
  const trimmedName = fullName.trim();
  const trimmedLast = lastName.trim();
  if (trimmedLast && trimmedName.toLowerCase().endsWith(trimmedLast.toLowerCase())) {
    const firstName = trimmedName.slice(0, trimmedName.length - trimmedLast.length).trim();
    if (firstName) return firstName;
  }
  return trimmedName;
}

const VALID_SALUTATIONS = new Set(["Dr.", "Mr.", "Mrs.", "Miss", "Ms."]);
function normalizeSalutation(honorific) {
  if (!honorific) return "";
  return VALID_SALUTATIONS.has(honorific) ? honorific : "";
}

function buildAnnotation(pathwaysId) {
  return `Added from PathwaysBC. Full office details: https://pathwaysbc.ca/specialists/${pathwaysId}`;
}

/** OSCAR's hard requirement — check this BEFORE attempting a write, not after. */
function candidateHasRequiredContactInfo(candidate) {
  return Boolean(candidate.phone && candidate.phone.trim()) && Boolean(candidate.address && candidate.address.trim());
}

function buildAddSpecialistPayload(candidate) {
  return {
    specId: "",
    firstName: deriveFirstName(candidate.name, candidate.lastName),
    lastName: candidate.lastName,
    proLetters: "",
    address: candidate.address || "",
    annotation: buildAnnotation(candidate.pathwaysId),
    phone: candidate.phone || "",
    fax: candidate.fax || "",
    privatePhoneNumber: "",
    cellPhoneNumber: "",
    pagerNumber: "",
    salutation: normalizeSalutation(candidate.honorific),
    website: "",
    email: candidate.email || "",
    specType: candidate.specialization,
    referralNo: normalizeReferralNo(candidate.billingNumber),
    institution: "0",
    department: "0",
    eDataUrl: "",
    eDataOscarKey: "",
    eDataServiceKey: "",
    eDataServiceName: "",
    hideFromView: "false",
    eformId: "0",
    // Struts action-mapping dispatch — the form's submit button IS transType=name/value.
    whichType: "1",
    transType: "Add Specialist",
  };
}

function matchOscarService(specialization, services) {
  const target = specialization.trim().toLowerCase();
  return services.find((s) => s.name.trim().toLowerCase() === target) ?? null;
}

// ---- OSCAR transport ----

async function fetchServicesList() {
  const html = await fetch("/oscar/oscarEncounter/oscarConsultationRequest/config/ShowAllServices.jsp", {
    credentials: "include",
  }).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll('a[href*="ShowAllServices.do"]')).map((a) => {
    const url = new URL(a.getAttribute("href"), location.href);
    return { id: url.searchParams.get("serviceId"), name: a.textContent.trim() };
  });
}

/** ShowAllServices.do?serviceId=N lists ALL specialists (the "all" ids), checked = this service's current members. */
async function fetchSpecialistsPage(serviceId) {
  const html = await fetch(`/oscar/oscarEncounter/ShowAllServices.do?serviceId=${encodeURIComponent(serviceId)}`, {
    credentials: "include",
  }).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  const boxes = Array.from(doc.querySelectorAll('input[name="specialists"]'));
  return {
    all: boxes.map((b) => Number(b.value)),
    checked: boxes.filter((b) => b.checked || b.hasAttribute("checked")).map((b) => Number(b.value)),
  };
}

async function fetchSpecialistDetail(specId) {
  const html = await fetch(`/oscar/oscarEncounter/EditSpecialists.do?specId=${specId}`, {
    credentials: "include",
  }).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  const get = (name) => doc.querySelector(`[name="${name}"]`)?.value ?? null;
  return { specId: get("specId"), firstName: get("firstName"), lastName: get("lastName") };
}

async function postAddSpecialist(payload) {
  const body = new URLSearchParams(payload).toString();
  await fetch("/oscar/oscarEncounter/AddSpecialist.do", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

/** REPLACES the service's full membership — always pass the complete desired list, not a delta. */
async function postUpdateServiceSpecialists(serviceId, specIds) {
  const params = new URLSearchParams();
  params.set("serviceId", String(serviceId));
  for (const id of specIds) params.append("specialists", String(id));
  await fetch("/oscar/oscarEncounter/UpdateServiceSpecialists.do", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

// ---- orchestration ----

async function runOscarSpecialistSync(candidates) {
  const services = await fetchServicesList();
  const results = [];

  for (const candidate of candidates) {
    try {
      const service = matchOscarService(candidate.specialization, services);
      if (!service) {
        results.push({
          linkId: candidate.linkId,
          status: "FAILED",
          errorMessage: `No OSCAR service named "${candidate.specialization}" — add the service manually first.`,
        });
        continue;
      }

      if (!candidateHasRequiredContactInfo(candidate)) {
        results.push({
          linkId: candidate.linkId,
          status: "FAILED",
          errorMessage: "Missing office phone/address — no PathwaysBC contact info cached yet for this specialist.",
        });
        continue;
      }

      const before = await fetchSpecialistsPage(service.id);
      const beforeMax = before.all.length ? Math.max(...before.all) : 0;

      await postAddSpecialist(buildAddSpecialistPayload(candidate));

      const after = await fetchSpecialistsPage(service.id);
      const afterMax = after.all.length ? Math.max(...after.all) : 0;

      if (afterMax <= beforeMax) {
        results.push({
          linkId: candidate.linkId,
          status: "FAILED",
          errorMessage: "AddSpecialist.do did not create a new record — likely a referralNo collision or validation failure.",
        });
        continue;
      }

      const newSpecId = afterMax;
      const verify = await fetchSpecialistDetail(newSpecId);
      if (!verify.lastName || verify.lastName.toLowerCase() !== candidate.lastName.toLowerCase()) {
        results.push({
          linkId: candidate.linkId,
          status: "FAILED",
          errorMessage: `Verification mismatch at specId ${newSpecId} — did not confirm as ${candidate.lastName}.`,
        });
        continue;
      }

      const newMembership = Array.from(new Set([...after.checked, newSpecId]));
      await postUpdateServiceSpecialists(service.id, newMembership);

      results.push({
        linkId: candidate.linkId,
        status: "LINKED",
        oscarSpecId: String(newSpecId),
        oscarServiceName: service.name,
      });
    } catch (err) {
      results.push({ linkId: candidate.linkId, status: "FAILED", errorMessage: String((err && err.message) || err) });
    }
  }

  return results;
}
