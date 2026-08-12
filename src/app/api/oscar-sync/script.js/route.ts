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
    var n = String(full).trim(), l = String(last).trim();
    if (l && n.toLowerCase().slice(-l.length) === l.toLowerCase()) {
      var f = n.slice(0, n.length - l.length).trim();
      if (f) return f;
    }
    return n;
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
  async function servicePage(id) {
    var html = await fetch("/oscar/oscarEncounter/ShowAllServices.do?serviceId=" + encodeURIComponent(id), { credentials: "include" }).then(function (r) { return r.text(); });
    var doc = new DOMParser().parseFromString(html, "text/html");
    var boxes = Array.prototype.slice.call(doc.querySelectorAll('input[name="specialists"]'));
    return {
      all: boxes.map(function (b) { return Number(b.value); }),
      checked: boxes.filter(function (b) { return b.checked || b.hasAttribute("checked"); }).map(function (b) { return Number(b.value); }),
    };
  }
  async function verify(specId) {
    var html = await fetch("/oscar/oscarEncounter/EditSpecialists.do?specId=" + specId, { credentials: "include" }).then(function (r) { return r.text(); });
    var doc = new DOMParser().parseFromString(html, "text/html");
    var el = doc.querySelector('[name="lastName"]');
    return el ? el.value : null;
  }

  async function runOscar() {
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

    show("<div>Adding " + q.ready.length + " specialist(s) to OSCAR…</div>");
    var svc = await services(), results = [], lines = [];

    for (var i = 0; i < q.ready.length; i++) {
      var c = q.ready[i];
      try {
        var target = null;
        for (var j = 0; j < svc.length; j++) {
          if (svc[j].name.trim().toLowerCase() === String(c.specialization).trim().toLowerCase()) { target = svc[j]; break; }
        }
        if (!target) {
          results.push({ linkId: c.linkId, status: "FAILED", errorMessage: 'No OSCAR service named "' + c.specialization + '"' });
          lines.push("&#10007; " + esc(c.name) + " — no OSCAR service named &ldquo;" + esc(c.specialization) + "&rdquo;");
          continue;
        }
        var before = await servicePage(target.id);
        var beforeMax = before.all.length ? Math.max.apply(null, before.all) : 0;

        await fetch("/oscar/oscarEncounter/AddSpecialist.do", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form(payloadFor(c)),
        });

        var after = await servicePage(target.id);
        var afterMax = after.all.length ? Math.max.apply(null, after.all) : 0;
        if (afterMax <= beforeMax) {
          results.push({ linkId: c.linkId, status: "FAILED", errorMessage: "OSCAR did not create the record (validation rejected it)." });
          lines.push("&#10007; " + esc(c.name) + " — OSCAR rejected it");
          continue;
        }
        var newId = afterMax, ln = await verify(newId);
        if (!ln || ln.toLowerCase() !== String(c.lastName).toLowerCase()) {
          results.push({ linkId: c.linkId, status: "FAILED", errorMessage: "Couldn't verify new specId " + newId });
          lines.push("&#10007; " + esc(c.name) + " — couldn't verify");
          continue;
        }
        var members = after.checked.slice();
        if (members.indexOf(newId) === -1) members.push(newId);
        var body = "serviceId=" + encodeURIComponent(target.id);
        for (var k = 0; k < members.length; k++) body += "&specialists=" + encodeURIComponent(members[k]);
        await fetch("/oscar/oscarEncounter/UpdateServiceSpecialists.do", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body,
        });

        results.push({ linkId: c.linkId, status: "LINKED", oscarSpecId: String(newId), oscarServiceName: target.name });
        lines.push("&#10003; " + esc(c.name) + " — added under " + esc(target.name));
      } catch (e) {
        results.push({ linkId: c.linkId, status: "FAILED", errorMessage: String(e && e.message || e) });
        lines.push("&#10007; " + esc(c.name) + " — " + esc(e && e.message || e));
      }
    }

    try {
      await fetch(API + "/api/oscar-sync/result?t=" + encodeURIComponent(T), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ results: results }),
      });
    } catch (e) { lines.push('<span style="color:#b91c1c">(Added in OSCAR, but couldn\\'t update Health Assist: ' + esc(e.message) + ")</span>"); }

    var out = "<div>" + lines.join("</div><div>") + "</div>";
    if (pending.length) out += '<div style="margin-top:10px;color:#475569">' + pending.length +
      " more waiting on contact info from PathwaysBC.</div>";
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
