/**
 * GET /api/oscar-sync/script.js?t=TOKEN — the JS the bookmarklet loads and runs.
 *
 * Served from the app (rather than living inside the bookmark) so the logic can be fixed and
 * redeployed without the physician ever having to re-create their bookmark. The bookmark only
 * carries the token and this URL.
 *
 * The script auto-detects which origin it was dropped into:
 *   - on oscar.mymdonline.ca  → writes queued specialists into OSCAR
 *   - on pathwaysbc.ca        → grabs the current profile's contact info
 * so ONE bookmark covers both halves of the flow, and clicking it in the wrong place explains
 * itself rather than failing silently.
 *
 * Not secret: it's gated on the token only so a bare crawl of the URL doesn't hand out a working
 * copy. Everything sensitive stays server-side behind the /api/oscar-sync/* routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/oscar-sync-bookmarklet";

export const runtime = "nodejs";

function buildScript(apiBase: string, token: string): string {
  // Written as one self-contained IIFE in plain ES5-ish JS: it runs inside OSCAR's own pages,
  // which are old JSPs, so no bundling/transpiling is available to it.
  return `(function () {
  var API = ${JSON.stringify(apiBase)};
  var T = ${JSON.stringify(token)};

  function panel() {
    var existing = document.getElementById("__mymd_sync_panel");
    if (existing) existing.remove();
    var d = document.createElement("div");
    d.id = "__mymd_sync_panel";
    d.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:2147483647;width:360px;max-height:70vh;overflow:auto;" +
      "background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.18);" +
      "font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;padding:14px 16px";
    document.body.appendChild(d);
    return d;
  }

  var p = panel();
  function show(html) { p.innerHTML = '<div style="font-weight:600;margin-bottom:8px">Specialist sync</div>' + html +
    '<div style="margin-top:10px"><button id="__mymd_close" style="font:inherit;padding:4px 10px;border:1px solid #cbd5e1;' +
    'background:#fff;border-radius:6px;cursor:pointer">Close</button></div>';
    var b = document.getElementById("__mymd_close"); if (b) b.onclick = function () { p.remove(); }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]; }); }

  // ---------- PathwaysBC: grab this profile's contact info ----------
  async function runPathways() {
    var m = location.pathname.match(/\\/specialists\\/(\\d+)/);
    if (!m) { show('<div>Open a specialist\\'s <b>profile page</b> on PathwaysBC first, then click this again.</div>'); return; }
    var container = document.querySelector(".span7half") || document.body;
    show("<div>Reading this profile…</div>");
    try {
      var res = await fetch(API + "/api/oscar-sync/contact?t=" + encodeURIComponent(T), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathwaysId: Number(m[1]), pageText: container.innerText }),
      });
      var data = await res.json();
      if (!res.ok) { show('<div style="color:#b91c1c">' + esc(data.error || "Failed.") + "</div>"); return; }
      show('<div><b>' + esc(data.name) + "</b> contact info saved:</div><div style=\\"margin-top:6px;color:#475569\\">" +
        esc(data.contact.phone) + (data.contact.fax ? " &middot; fax " + esc(data.contact.fax) : "") +
        "<br>" + esc(data.contact.clinicAddress) + "</div>" +
        '<div style="margin-top:10px">Now open <b>OSCAR</b> and click this bookmark again to add them.</div>');
    } catch (e) { show('<div style="color:#b91c1c">' + esc(e.message) + "</div>"); }
  }

  // ---------- OSCAR: write queued specialists in ----------
  var VALID_SALUTATIONS = { "Dr.": 1, "Mr.": 1, "Mrs.": 1, "Miss": 1, "Ms.": 1 };
  function referralNo(b) {
    if (!b) return "";
    var d = String(b).replace(/\\D/g, "");
    if (d.length === 6) return d;
    if (d.length === 5) return "0" + d;
    return "";
  }
  function firstName(full, last) {
    // Drop a trailing practice name — PathwaysBC appends it to some entries
    // ("Golmehr Sajjady (Aspire Bariatric & Lifestyle Clinic)") and it otherwise defeats the
    // suffix match, dumping the whole string into OSCAR's first-name field.
    var n = String(full).trim().replace(/\\s*\\([^)]*\\)\\s*$/, "").trim() || String(full).trim();
    var l = String(last).trim();
    if (l && n.toLowerCase().slice(-l.length) === l.toLowerCase()) {
      var f = n.slice(0, n.length - l.length).trim();
      if (f) return f;
    }
    return n;
  }

  /**
   * Did the record at specId turn out to be the person we just posted?
   *
   * Tolerant on purpose: OSCAR truncates long values, and a too-strict comparison marks a
   * successfully-created record as failed — which leaves it orphaned (present in OSCAR, recorded
   * as failed here). Seen live: a 29-specialist run created 27 records but only recorded 26.
   */
  function lastNameMatches(oscarLastName, expected) {
    if (!oscarLastName) return false;
    var a = String(oscarLastName).toLowerCase().replace(/[^a-z]/g, "");
    var b = String(expected).toLowerCase().replace(/[^a-z]/g, "");
    if (!a || !b) return false;
    return a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }
  function payloadFor(c) {
    return {
      specId: "", firstName: firstName(c.name, c.lastName), lastName: c.lastName, proLetters: "",
      address: c.address || "", annotation: "Added from PathwaysBC. Full office details: https://pathwaysbc.ca/specialists/" + c.pathwaysId,
      phone: c.phone || "", fax: c.fax || "", privatePhoneNumber: "", cellPhoneNumber: "", pagerNumber: "",
      salutation: VALID_SALUTATIONS[c.honorific] ? c.honorific : "", website: "", email: c.email || "",
      specType: c.specialization, referralNo: referralNo(c.billingNumber), institution: "0", department: "0",
      eDataUrl: "", eDataOscarKey: "", eDataServiceKey: "", eDataServiceName: "", hideFromView: "false",
      eformId: "0", whichType: "1", transType: "Add Specialist",
    };
  }
  function form(o) { var b = []; for (var k in o) b.push(encodeURIComponent(k) + "=" + encodeURIComponent(o[k])); return b.join("&"); }
  async function services() {
    var html = await fetch("/oscar/oscarEncounter/oscarConsultationRequest/config/ShowAllServices.jsp", { credentials: "include" }).then(function (r) { return r.text(); });
    var doc = new DOMParser().parseFromString(html, "text/html");
    return Array.prototype.map.call(doc.querySelectorAll('a[href*="ShowAllServices.do"]'), function (a) {
      var u = new URL(a.getAttribute("href"), location.href);
      return { id: u.searchParams.get("serviceId"), name: a.textContent.trim() };
    });
  }
  /**
   * Order- and punctuation-independent key for comparing a PathwaysBC name ("Naveed Malek")
   * against OSCAR's rendering ("Malek Naveed", sometimes with a literal leading "*"). Mirrors
   * normalizeNameTokens in src/lib/oscar/specialist-reconcile.ts.
   */
  function nameKey(raw) {
    return String(raw || "").toLowerCase().replace(/[^a-z\\s]/g, " ").split(/\\s+/)
      .filter(function (t) { return t; }).sort().join("|");
  }

  /**
   * OSCAR answers a request from a dead session with the login page rather than a 401, so a long
   * run would otherwise sail on marking every remaining specialist FAILED — and FAILED rows are
   * not retried, so an expiry would permanently poison hundreds of records. Detect it and abort.
   */
  function assertSession(html) {
    if (/name=["']?(password|pin)["']?/i.test(html) && /login/i.test(html)) {
      var e = new Error("SESSION_LOST");
      e.sessionLost = true;
      throw e;
    }
    return html;
  }

  async function servicePage(id) {
    var html = assertSession(await fetch("/oscar/oscarEncounter/ShowAllServices.do?serviceId=" + encodeURIComponent(id), { credentials: "include" }).then(function (r) { return r.text(); }));
    var doc = new DOMParser().parseFromString(html, "text/html");
    var boxes = Array.prototype.slice.call(doc.querySelectorAll('input[name="specialists"]'));
    return {
      all: boxes.map(function (b) { return Number(b.value); }),
      checked: boxes.filter(function (b) { return b.checked || b.hasAttribute("checked"); }).map(function (b) { return Number(b.value); }),
      names: boxes.map(function (b) {
        var tr = b.closest("tr"), tds = tr ? tr.querySelectorAll("td") : null;
        return tds && tds[1] ? tds[1].textContent.trim() : "";
      }),
    };
  }
  async function verify(specId) {
    var html = assertSession(await fetch("/oscar/oscarEncounter/EditSpecialists.do?specId=" + specId, { credentials: "include" }).then(function (r) { return r.text(); }));
    var doc = new DOMParser().parseFromString(html, "text/html");
    var el = doc.querySelector('[name="lastName"]');
    return el ? el.value : null;
  }

  var ADD_SERVICE_PAGE = "/oscar/oscarEncounter/oscarConsultationRequest/config/AddService.jsp";

  /**
   * Creates a consultation service by reading OSCAR's own Add Service form and replaying it,
   * rather than hardcoding field names. AddSpecialist.do taught us that lesson: it silently
   * no-ops if you miss a hidden dispatch field, so mirror whatever the live form actually has.
   */
  async function addService(name) {
    var html = await fetch(ADD_SERVICE_PAGE, { credentials: "include" }).then(function (r) { return r.text(); });
    var doc = new DOMParser().parseFromString(html, "text/html");
    var f = doc.querySelector('form[action*="AddService"]') || doc.querySelector("form");
    if (!f) throw new Error("Couldn't read OSCAR's Add Service form — is your OSCAR session still open?");

    // Collect fields from the DOCUMENT, not the form. OSCAR's markup leaves the <form> element
    // empty with its inputs as siblings, and form.elements is empty on a DOMParser document
    // regardless — verified live 2026-08-11: both f.elements and f.querySelectorAll returned
    // nothing while the same page rendered the field fine in the browser.
    var params = new URLSearchParams(), namedField = false;
    Array.prototype.forEach.call(doc.querySelectorAll("input, select, textarea"), function (el) {
      if (!el.name) return;
      if (el.type === "text" || el.tagName === "TEXTAREA") { params.set(el.name, name); namedField = true; }
      else if (el.type === "checkbox" || el.type === "radio") { if (el.checked) params.set(el.name, el.value); }
      else if (el.type !== "submit" && el.type !== "button") { params.set(el.name, el.value || ""); }
    });
    if (!namedField) throw new Error("OSCAR's Add Service form had no text field to put the name in");

    var action = new URL(f.getAttribute("action") || ADD_SERVICE_PAGE, location.origin + ADD_SERVICE_PAGE).href;
    await fetch(action, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
    });
  }

  /**
   * PathwaysBC and OSCAR name the same specialty differently, and creating the PathwaysBC
   * spelling as a new OSCAR service yields near-duplicates of services the clinic already uses
   * ("Obstetrics / Gynecology" beside the existing "Obstetrics and Gynecology") — confusing at
   * the point of referral. Keep in step with OSCAR_SERVICE_ALIASES in
   * src/lib/oscar/specialist-sync-plan.ts.
   */
  var SERVICE_ALIASES = {
    "family medicine": "GP",
    "orthopedics": "Orthopaedics",
    "obstetrics / gynecology": "Obstetrics and Gynecology",
    "physical medicine & rehabilitation": "Physical Medicine",
    "pain medicine": "Pain Management & Prolotherapy",
    "psychiatry: adult": "Psychiatry",
    "psychiatry: child and youth": "Psychiatry - Child/Adol",
    "psychiatry: geriatric": "Geriatrics- psychiatry",
    "addiction medicine": "Mental Health & Addictions",
    "midwifery": "Mid Wife",
    "allergy & immunology": "Allergist",
    "anesthesiology": "Anesthesiologist",
    "genetics": "Geneticist",
    "geriatric medicine": "Geriatrics",
    "ent / otolaryngology": "ENT",
    "medical imaging": "Imaging",
    "oral & maxillofacial surgery": "Oral surgeon"
  };
  function oscarServiceNameFor(spec) {
    return SERVICE_ALIASES[String(spec).trim().toLowerCase()] || spec;
  }

  /** Specialties among the ready candidates that OSCAR has no service for, after aliasing. */
  function missingServiceNames(ready, svc) {
    var have = {};
    svc.forEach(function (s) { have[s.name.trim().toLowerCase()] = 1; });
    var missing = [], seen = {};
    ready.forEach(function (c) {
      var wanted = oscarServiceNameFor(c.specialization);
      var key = String(wanted).trim().toLowerCase();
      if (!have[key] && !seen[key]) { seen[key] = 1; missing.push(wanted); }
    });
    return missing;
  }

  async function runOscar() {
    // OSCAR's day sheet reloads itself on a timer (autoRefresh), which kills a run partway
    // through — confirmed live: the first real attempt died silently mid-write. Send them to a
    // static page instead of letting it fail.
    if (/providercontrol\\.jsp/i.test(location.pathname)) {
      show('<div>This page reloads itself on a timer, which would interrupt the sync.</div>' +
        '<div style="margin-top:8px">Open <a href="/oscar/oscarEncounter/oscarConsultationRequest/config/ShowAllServices.jsp">' +
        'Consultation settings</a>, then click this bookmark there.</div>');
      return;
    }
    show("<div>Checking the queue…</div>");
    var q;
    try {
      q = await fetch(API + "/api/oscar-sync/candidates?t=" + encodeURIComponent(T)).then(function (r) { return r.json(); });
    } catch (e) { show('<div style="color:#b91c1c">Couldn\\'t reach Health Assist: ' + esc(e.message) + "</div>"); return; }
    if (q.error) { show('<div style="color:#b91c1c">' + esc(q.error) + "</div>"); return; }

    var pending = q.needsContact || [];
    if (!q.ready || !q.ready.length) {
      var msg = "<div>Nothing queued is ready to add.</div>";
      if (pending.length) {
        msg += '<div style="margin-top:8px">' + pending.length + " waiting on contact info. Open each one\\'s " +
          "PathwaysBC profile and click this bookmark there first:<ul style=\\"margin:6px 0 0 18px;padding:0\\">" +
          pending.map(function (c) { return '<li><a href="https://pathwaysbc.ca/specialists/' + c.pathwaysId +
            '" target="_blank" rel="noopener">' + esc(c.name) + "</a></li>"; }).join("") + "</ul></div>";
      }
      show(msg); return;
    }

    var svc = await services();

    // PathwaysBC and OSCAR use different words for the same specialty (PathwaysBC "Family
    // Medicine" vs OSCAR "GP", and ~26 others). Rather than guess a mapping — filing a referral
    // under the wrong specialty is worse than stopping — offer to create the missing service and
    // let the physician decide.
    var missing = missingServiceNames(q.ready, svc);
    if (missing.length) {
      show("<div>OSCAR has no consultation service matching " + (missing.length === 1 ? "this specialty" : "these specialties") + ":</div>" +
        '<ul style="margin:6px 0 0 18px;padding:0">' + missing.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul>" +
        '<div style="margin-top:10px"><button id="__mymd_addsvc" style="font:inherit;padding:6px 12px;border:0;background:#0f172a;' +
        'color:#fff;border-radius:6px;cursor:pointer">Create ' + (missing.length === 1 ? "it" : "them") + " in OSCAR</button></div>" +
        '<div style="margin-top:8px;color:#475569">Then click the bookmark again to add the specialist(s).</div>');
      var btn = document.getElementById("__mymd_addsvc");
      if (btn) btn.onclick = async function () {
        show("<div>Creating " + missing.length + " service(s)…</div>");
        var made = [], failed = [];
        for (var m = 0; m < missing.length; m++) {
          try { await addService(missing[m]); made.push(missing[m]); }
          catch (e) { failed.push(missing[m] + " — " + (e && e.message || e)); }
        }
        var after = await services(), stillMissing = missingServiceNames(q.ready, after);
        var out = made.length ? "<div>&#10003; Created: " + made.map(esc).join(", ") + "</div>" : "";
        failed.forEach(function (fl) { out += '<div style="color:#b91c1c">&#10007; ' + esc(fl) + "</div>"; });
        if (stillMissing.length) out += '<div style="margin-top:8px;color:#b91c1c">Still missing: ' + stillMissing.map(esc).join(", ") + "</div>";
        else out += '<div style="margin-top:10px">Now click the bookmark again to add the specialist(s).</div>';
        show(out);
      };
      return;
    }

    // ---- batch write ----
    // Built for thousands, not ones. The naive shape (re-read the full ~1,600-row roster before
    // and after every single add) is 2 heavy fetches per specialist and simply doesn't finish at
    // bulk scale. Instead: read the roster once, allocate specIds by increment (OSCAR assigns
    // them sequentially), verify each add against the CHEAP per-specialist page, and replace each
    // service's membership once at the end rather than per specialist.
    show("<div>Reading OSCAR's current specialist list…</div>");
    var snapshot = await servicePage(svc[0].id);
    var maxId = snapshot.all.length ? Math.max.apply(null, snapshot.all) : 0;

    // Names already in OSCAR, so a bulk run can't quietly create duplicates of specialists who
    // are already there (from the original migration, or an earlier run).
    var existingNames = {};
    snapshot.names.forEach(function (n) { existingNames[nameKey(n)] = 1; });

    var results = [], added = 0, skipped = 0, failed = 0, samples = [], sessionLost = false;
    var membership = {};   // serviceId -> current member ids (loaded lazily, one fetch per service)
    var touched = {};      // serviceId -> service name, for the membership write at the end

    async function flushResults() {
      if (!results.length) return;
      var batch = results; results = [];
      try {
        await fetch(API + "/api/oscar-sync/result?t=" + encodeURIComponent(T), {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ results: batch }),
        });
      } catch (e) { results = batch.concat(results); }  // keep them for the next attempt
    }

    for (var i = 0; i < q.ready.length; i++) {
      var c = q.ready[i];
      if (i % 10 === 0) {
        show("<div>Adding specialists to OSCAR…</div><div style=\\"margin-top:6px\\">" + (i + 1) + " of " + q.ready.length +
          " &middot; " + added + " added, " + skipped + " already there, " + failed + " failed</div>" +
          '<div style="margin-top:8px;color:#475569">Leave this tab open until it finishes.</div>');
      }
      try {
        var target = null;
        for (var j = 0; j < svc.length; j++) {
          if (svc[j].name.trim().toLowerCase() === String(oscarServiceNameFor(c.specialization)).trim().toLowerCase()) { target = svc[j]; break; }
        }
        if (!target) {
          failed++;
          results.push({ linkId: c.linkId, status: "FAILED", errorMessage: 'No OSCAR service named "' + c.specialization + '"' });
          continue;
        }

        if (existingNames[nameKey(c.name)]) {
          skipped++;
          results.push({ linkId: c.linkId, status: "FAILED", errorMessage: "Already in OSCAR under this name — skipped to avoid a duplicate." });
          continue;
        }

        if (membership[target.id] === undefined) {
          membership[target.id] = (await servicePage(target.id)).checked;
          touched[target.id] = target.name;
        }

        await fetch("/oscar/oscarEncounter/AddSpecialist.do", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(payloadFor(c)),
        });

        // OSCAR hands out specIds sequentially, so the new one should be maxId+1 — but confirm it
        // really is this person before recording it, because AddSpecialist.do fails by silently
        // re-rendering the form rather than erroring.
        var newId = maxId + 1;
        var ln = await verify(newId);
        if (!lastNameMatches(ln, c.lastName)) {
          // Either the add was rejected, or the id drifted (someone else writing concurrently).
          // Re-read the roster to resync rather than guessing again.
          var re = await servicePage(target.id);
          var reMax = re.all.length ? Math.max.apply(null, re.all) : maxId;
          var reName = reMax > maxId ? await verify(reMax) : null;
          if (lastNameMatches(reName, c.lastName)) {
            newId = reMax;
          } else {
            maxId = reMax;
            failed++;
            results.push({ linkId: c.linkId, status: "FAILED", errorMessage: "OSCAR did not create the record (validation rejected it)." });
            continue;
          }
        }

        maxId = newId;
        existingNames[nameKey(c.name)] = 1;
        if (membership[target.id].indexOf(newId) === -1) membership[target.id].push(newId);
        added++;
        if (samples.length < 5) samples.push(c.name + " — " + target.name);
        results.push({ linkId: c.linkId, status: "LINKED", oscarSpecId: String(newId), oscarServiceName: target.name });
      } catch (e) {
        if (e && e.sessionLost) { sessionLost = true; break; }
        failed++;
        results.push({ linkId: c.linkId, status: "FAILED", errorMessage: String(e && e.message || e) });
      }
      if (results.length >= 25) await flushResults();
    }

    // UpdateServiceSpecialists REPLACES a service's whole membership, so this must post the full
    // list — and doing it once per service instead of once per specialist is most of the speedup.
    show("<div>Filing " + added + " specialist(s) under their consultation services…</div>");
    var serviceErrors = [];
    for (var sid in touched) {
      try {
        var body = "serviceId=" + encodeURIComponent(sid);
        var mem = membership[sid];
        for (var k = 0; k < mem.length; k++) body += "&specialists=" + encodeURIComponent(mem[k]);
        await fetch("/oscar/oscarEncounter/UpdateServiceSpecialists.do", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body,
        });
      } catch (e) { serviceErrors.push(touched[sid] + " — " + (e && e.message || e)); }
    }

    await flushResults();

    var out = "";
    if (sessionLost) {
      out += '<div style="color:#b91c1c;font-weight:600">Your OSCAR session ended, so the run stopped here.</div>' +
        '<div style="margin-top:6px">Everything below was saved. Log back into OSCAR, then click the bookmark ' +
        "again — it picks up exactly where it left off.</div><div style=\\"margin-top:10px\\"></div>";
    }
    out += "<div><b>" + added + "</b> added to OSCAR.</div>";
    if (skipped) out += "<div>" + skipped + " already in OSCAR — skipped.</div>";
    if (failed) out += '<div style="color:#b91c1c">' + failed + " couldn\\'t be added.</div>";
    if (samples.length) out += '<div style="margin-top:8px;color:#475569">e.g. ' + samples.map(esc).join("; ") + "</div>";
    serviceErrors.forEach(function (se) { out += '<div style="color:#b91c1c">Service update failed: ' + esc(se) + "</div>"; });
    if (results.length) out += '<div style="margin-top:8px;color:#b91c1c">' + results.length +
      " result(s) couldn\\'t be saved back to Health Assist — re-click to retry those.</div>";
    if (pending.length) out += '<div style="margin-top:10px;color:#475569">' + pending.length +
      " still waiting on contact info from PathwaysBC.</div>";
    show(out);
  }

  if (/pathwaysbc\\.ca$/.test(location.hostname.replace(/^www\\./, ""))) runPathways();
  else if (/oscar\\.mymdonline\\.ca$/.test(location.hostname)) runOscar();
  else show("<div>Open this on an <b>OSCAR</b> page or a <b>PathwaysBC</b> specialist profile, then click the bookmark.</div>");
})();`;
}

/**
 * The public origin to call back into — NOT request.nextUrl.origin, which behind Azure App
 * Service's proxy resolves to the internal container address (e.g. https://b2e1181e325d:8080)
 * and is unreachable from the physician's browser. Confirmed live: the first deploy baked that
 * internal host into the script and every call died with "Failed to fetch".
 */
function resolveApiBase(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return new NextResponse("// Unauthorized", { status: 401, headers: { "Content-Type": "application/javascript" } });
  }
  const token = request.nextUrl.searchParams.get("t") || "";
  const apiBase = resolveApiBase(request);
  return new NextResponse(buildScript(apiBase, token), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
