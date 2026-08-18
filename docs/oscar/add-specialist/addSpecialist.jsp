<%--
  MyMD: add one consultation specialist from a pasted PathwaysBC profile.

  Opened from the "Add Specialist" nav item. The physician pastes the text of a PathwaysBC
  specialist profile, this page sends it (server-side, fax-triage bridge pattern) to Health Assist
  for AI extraction, and the extracted fields prefill a review form. The physician edits anything,
  picks the consultation service, and clicks Add — at which point THIS BROWSER performs OSCAR's own
  AddSpecialist.do / UpdateServiceSpecialists.do calls, exactly like the bulk sync bookmarklet
  (src/app/api/oscar-sync/script.js/route.ts). The model never writes; the physician always can.

  Why the write is client-side: OSCAR's oscarEncounter/*.do actions sit behind the nginx mTLS
  device-cert gate and a session cookie, so only an enrolled, logged-in browser can reach them.
  Why extraction is server-side: the app keys stay off this box; the JSP only holds a shared
  secret, read per request from CONFIG_PATH (fails closed, rotate without restart).

  AddSpecialist.do fails by silently re-rendering the form (200 OK, no insert) on a missing
  phone/address, a bad referralNo, or a referralNo collision — so nothing here trusts the POST:
  every add is verified by reading the new record back, and the failure message says what to try.

  Not in git's deploy path; a WAR redeploy wipes it. See docs/oscar/add-specialist-install.md.
--%>
<%@ page contentType="text/html; charset=UTF-8" trimDirectiveWhitespaces="true" %>
<%@ page import="java.io.*, java.util.*" %>
<%@ page import="java.net.HttpURLConnection, java.net.URL" %>
<%@ page import="com.google.gson.Gson, com.google.gson.JsonObject" %>
<%!
    static final String CONFIG_PATH = "/var/lib/OscarDocument/oscar/mymd_specialist.properties";
    static final String ENDPOINT = "/api/emr/oscar/specialist-extract";

    static String nz(String s) { return s == null ? "" : s.trim(); }
%>
<%
    String user = (String) session.getAttribute("user");

    // ---------------------------------------------------------------------------------------------
    // Mode 1: extraction proxy. POST ?action=extract with a "text" form field; answers JSON.
    // Fails soft, always: every problem is {"reason":"..."} and the page falls back to manual entry.
    // ---------------------------------------------------------------------------------------------
    if ("extract".equals(request.getParameter("action"))) {
        response.setContentType("application/json; charset=UTF-8");
        Gson gson = new Gson();
        JsonObject outJson = new JsonObject();

        if (user == null) { outJson.addProperty("reason", "no_session"); out.print(gson.toJson(outJson)); return; }
        if (!"POST".equals(request.getMethod())) { outJson.addProperty("reason", "bad_method"); out.print(gson.toJson(outJson)); return; }

        String text = nz(request.getParameter("text"));
        if (text.length() < 20) { outJson.addProperty("reason", "no_text"); out.print(gson.toJson(outJson)); return; }
        if (text.length() > 20000) text = text.substring(0, 20000);

        try {
            // --- config, fails closed (same contract as mymd_fax.properties) ---------------------
            Properties cfg = new Properties();
            File cfgFile = new File(CONFIG_PATH);
            if (!cfgFile.canRead()) { outJson.addProperty("reason", "not_configured"); out.print(gson.toJson(outJson)); return; }
            FileInputStream cfgIn = new FileInputStream(cfgFile);
            try { cfg.load(cfgIn); } finally { cfgIn.close(); }

            String baseUrl = nz(cfg.getProperty("healthassist.url"));
            String secret  = nz(cfg.getProperty("specialist.secret"));
            boolean enabled = "true".equals(nz(cfg.getProperty("enabled")));
            if (!enabled || baseUrl.isEmpty() || secret.isEmpty()) {
                outJson.addProperty("reason", "disabled");
                out.print(gson.toJson(outJson));
                return;
            }

            // --- call Health Assist --------------------------------------------------------------
            JsonObject req = new JsonObject();
            req.addProperty("text", text);
            req.addProperty("providerNo", user);

            URL url = new URL(baseUrl.replaceAll("/+$", "") + ENDPOINT);
            HttpURLConnection http = (HttpURLConnection) url.openConnection();
            http.setRequestMethod("POST");
            http.setConnectTimeout(10000);
            // Text-only model call — no OCR, so far quicker than fax triage.
            http.setReadTimeout(60000);
            http.setDoOutput(true);
            http.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            http.setRequestProperty("x-mymd-specialist-secret", secret);
            OutputStream os = http.getOutputStream();
            try { os.write(gson.toJson(req).getBytes("UTF-8")); } finally { os.close(); }

            int code = http.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? http.getInputStream() : http.getErrorStream();
            StringBuilder sb = new StringBuilder();
            if (is != null) {
                BufferedReader br = new BufferedReader(new InputStreamReader(is, "UTF-8"));
                String line;
                try { while ((line = br.readLine()) != null) sb.append(line); } finally { br.close(); }
            }
            http.disconnect();

            if (code < 200 || code >= 300) {
                outJson.addProperty("reason", "http_" + code);
                out.print(gson.toJson(outJson));
                return;
            }

            // Relay the app's JSON verbatim; the browser-side validation is the app's job.
            out.print(sb.toString());
        } catch (Throwable t) {
            outJson.addProperty("reason", "error");
            out.print(gson.toJson(outJson));
        }
        return;
    }

    // ---------------------------------------------------------------------------------------------
    // Mode 2: the page.
    // ---------------------------------------------------------------------------------------------
    if (user == null) { response.sendRedirect("../index.jsp"); return; }
%>
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Add Specialist</title>
<style>
  body { font: 14px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #f1f5f9; margin: 0; }
  .wrap { max-width: 760px; margin: 24px auto 60px; padding: 0 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #475569; margin: 0 0 18px; }
  .card { background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px 18px; margin-bottom: 16px; }
  .card h2 { font-size: 15px; margin: 0 0 10px; }
  textarea { width: 100%; box-sizing: border-box; font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; }
  label { display: block; font-weight: 600; font-size: 12.5px; margin: 10px 0 2px; }
  label .req { color: #b91c1c; }
  label .hint { font-weight: 400; color: #64748b; }
  input[type=text], select { width: 100%; box-sizing: border-box; font: inherit; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; background: #fff; }
  .cols { display: flex; gap: 12px; } .cols > div { flex: 1; }
  button { font: inherit; padding: 8px 16px; border: 0; border-radius: 6px; background: #0f172a; color: #fff; cursor: pointer; }
  button.secondary { background: #fff; color: #0f172a; border: 1px solid #cbd5e1; }
  button:disabled { background: #94a3b8; cursor: not-allowed; }
  .notice { border-radius: 6px; padding: 8px 12px; margin: 10px 0; font-size: 13px; }
  .notice.warn { background: #fef9c3; border: 1px solid #fde047; }
  .notice.err  { background: #fee2e2; border: 1px solid #fca5a5; }
  .notice.ok   { background: #dcfce7; border: 1px solid #86efac; }
  .notice.info { background: #e0f2fe; border: 1px solid #7dd3fc; }
  .evidence { color: #64748b; font-size: 12.5px; margin-top: 8px; }
  .prefilled { background: #fefce8; }
  #busy { color: #475569; margin-top: 8px; display: none; }
  a { color: #1d4ed8; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Add Specialist</h1>
  <p class="sub">Paste a specialist's PathwaysBC profile, review what was read, and add them to
    OSCAR's consultation list. Nothing is written until you click Add.</p>

  <div class="card" id="pasteCard">
    <h2>1 &middot; Paste the profile</h2>
    <textarea id="pasteText" rows="9" placeholder="Copy the specialist's PathwaysBC profile page text and paste it here &mdash; name, specialty, MSP #, Office Information&hellip;"></textarea>
    <div style="margin-top:10px">
      <button id="extractBtn">Extract with AI</button>
      <button id="manualBtn" class="secondary">Skip &mdash; fill the form manually</button>
    </div>
    <div id="busy">Reading the profile&hellip;</div>
    <div id="extractNotice"></div>
  </div>

  <div class="card" id="formCard" style="display:none">
    <h2>2 &middot; Review &mdash; every field is yours to correct</h2>
    <div id="chooser"></div>
    <div id="dupNotice"></div>
    <div class="cols">
      <div>
        <label>Salutation</label>
        <select id="f_salutation">
          <option value="">-Not Set-</option><option>Dr.</option><option>Mr.</option>
          <option>Mrs.</option><option>Miss</option><option>Ms.</option>
        </select>
      </div>
      <div><label>First name</label><input type="text" id="f_firstName"></div>
      <div><label>Last name</label><input type="text" id="f_lastName"></div>
    </div>
    <div class="cols">
      <div><label>Professional letters <span class="hint">(MD, FRCPC&hellip;)</span></label><input type="text" id="f_proLetters"></div>
      <div><label>Referral # <span class="hint">6 digits or blank &mdash; OSCAR silently rejects anything else</span></label><input type="text" id="f_referralNo"></div>
    </div>
    <div class="cols">
      <div><label>Phone <span class="req">*</span></label><input type="text" id="f_phone"></div>
      <div><label>Fax</label><input type="text" id="f_fax"></div>
    </div>
    <div class="cols">
      <div><label>Email</label><input type="text" id="f_email"></div>
      <div><label>Website</label><input type="text" id="f_website"></div>
    </div>
    <label>Address <span class="req">*</span></label>
    <textarea id="f_address" rows="2"></textarea>
    <label>Annotation</label>
    <textarea id="f_annotation" rows="2"></textarea>
    <label>Consultation service <span class="req">*</span> <span class="hint">which referral category this specialist appears under</span></label>
    <select id="f_service"><option value="">Loading services&hellip;</option></select>
    <div id="serviceNotice"></div>
    <div id="evidence" class="evidence"></div>
    <div style="margin-top:14px">
      <button id="addBtn" disabled>Add to OSCAR</button>
      <span id="addWhy" class="hint" style="margin-left:8px;color:#64748b"></span>
    </div>
    <div id="addNotice"></div>
  </div>

  <div class="card notice ok" id="doneCard" style="display:none"></div>
</div>

<script>
// Write mechanics adapted from the proven bulk-sync bookmarklet
// (src/app/api/oscar-sync/script.js/route.ts in the Health Assist repo). Same traps, same guards:
// AddSpecialist.do silently no-ops instead of erroring, specIds are allocated sequentially, and
// UpdateServiceSpecialists.do REPLACES a service's whole membership.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  var FIELDS = ["salutation", "firstName", "lastName", "proLetters", "referralNo",
                "phone", "fax", "email", "website", "address", "annotation"];

  var services = [];        // [{id, name}]
  var rosterNames = {};     // nameKey -> specId, for the duplicate warning
  var extracted = [];       // specialists returned by the extraction
  var suggestedService = "";

  // ---------- helpers shared with the bookmarklet ----------
  function form(o) { var b = []; for (var k in o) b.push(encodeURIComponent(k) + "=" + encodeURIComponent(o[k])); return b.join("&"); }
  function nameKey(raw) {
    return String(raw || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)
      .filter(function (t) { return t; }).sort().join("|");
  }
  // OSCAR answers a dead session with the login page, not a 401.
  function assertSession(html) {
    if (/name=["']?(password|pin)["']?/i.test(html) && /login/i.test(html)) {
      var e = new Error("Your OSCAR session has ended. Log back in, then reload this page.");
      e.sessionLost = true;
      throw e;
    }
    return html;
  }
  // Tolerant on purpose: OSCAR truncates long values, and a too-strict comparison would call a
  // successfully created record a failure.
  function lastNameMatches(oscarLastName, expected) {
    if (!oscarLastName) return false;
    var a = String(oscarLastName).toLowerCase().replace(/[^a-z]/g, "");
    var b = String(expected).toLowerCase().replace(/[^a-z]/g, "");
    if (!a || !b) return false;
    return a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }

  async function fetchServices() {
    var html = assertSession(await fetch("/oscar/oscarEncounter/oscarConsultationRequest/config/ShowAllServices.jsp",
      { credentials: "include" }).then(function (r) { return r.text(); }));
    var doc = new DOMParser().parseFromString(html, "text/html");
    return Array.prototype.map.call(doc.querySelectorAll('a[href*="ShowAllServices.do"]'), function (a) {
      var u = new URL(a.getAttribute("href"), location.href);
      return { id: u.searchParams.get("serviceId"), name: a.textContent.trim() };
    });
  }
  // The checkbox table on any service's page lists the ENTIRE roster; checked = that service's members.
  async function servicePage(id) {
    var html = assertSession(await fetch("/oscar/oscarEncounter/ShowAllServices.do?serviceId=" + encodeURIComponent(id),
      { credentials: "include" }).then(function (r) { return r.text(); }));
    var doc = new DOMParser().parseFromString(html, "text/html");
    var boxes = Array.prototype.slice.call(doc.querySelectorAll('input[name="specialists"]'));
    return {
      all: boxes.map(function (b) { return Number(b.value); }),
      checked: boxes.filter(function (b) { return b.checked || b.hasAttribute("checked"); }).map(function (b) { return Number(b.value); }),
      names: boxes.map(function (b) {
        var tr = b.closest("tr"), tds = tr ? tr.querySelectorAll("td") : null;
        return { id: Number(b.value), name: tds && tds[1] ? tds[1].textContent.trim() : "" };
      }),
    };
  }
  async function verify(specId) {
    var html = assertSession(await fetch("/oscar/oscarEncounter/EditSpecialists.do?specId=" + specId,
      { credentials: "include" }).then(function (r) { return r.text(); }));
    var doc = new DOMParser().parseFromString(html, "text/html");
    var el = doc.querySelector('[name="lastName"]');
    return el ? el.value : null;
  }
  // Replays OSCAR's own Add Service form rather than hardcoding its fields — AddSpecialist.do
  // taught that lesson (silent no-op on a missed hidden dispatch field). Fields are collected from
  // the DOCUMENT: OSCAR leaves the <form> element empty with its inputs as siblings.
  var ADD_SERVICE_PAGE = "/oscar/oscarEncounter/oscarConsultationRequest/config/AddService.jsp";
  async function addService(name) {
    var html = assertSession(await fetch(ADD_SERVICE_PAGE, { credentials: "include" }).then(function (r) { return r.text(); }));
    var doc = new DOMParser().parseFromString(html, "text/html");
    var f = doc.querySelector('form[action*="AddService"]') || doc.querySelector("form");
    if (!f) throw new Error("Couldn't read OSCAR's Add Service form.");
    var params = new URLSearchParams(), namedField = false;
    Array.prototype.forEach.call(doc.querySelectorAll("input, select, textarea"), function (el) {
      if (!el.name) return;
      if (el.type === "text" || el.tagName === "TEXTAREA") { params.set(el.name, name); namedField = true; }
      else if (el.type === "checkbox" || el.type === "radio") { if (el.checked) params.set(el.name, el.value); }
      else if (el.type !== "submit" && el.type !== "button") { params.set(el.name, el.value || ""); }
    });
    if (!namedField) throw new Error("OSCAR's Add Service form had no text field for the name.");
    var action = new URL(f.getAttribute("action") || ADD_SERVICE_PAGE, location.origin + ADD_SERVICE_PAGE).href;
    await fetch(action, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
  }

  // ---------- page state ----------
  function notice(id, cls, html) { $(id).innerHTML = html ? '<div class="notice ' + cls + '">' + html + "</div>" : ""; }

  function gate() {
    var missing = [];
    if (!$("f_phone").value.trim()) missing.push("phone");
    if (!$("f_address").value.trim()) missing.push("address");
    if (!$("f_service").value) missing.push("a consultation service");
    var ref = $("f_referralNo").value.trim();
    if (ref && !/^\d{6}$/.test(ref)) missing.push("a valid referral # (6 digits or blank)");
    $("addBtn").disabled = missing.length > 0;
    $("addWhy").textContent = missing.length ? "Needs " + missing.join(", ") + "." : "";
  }

  function fillServiceSelect(preselectName) {
    var sel = $("f_service");
    var sorted = services.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var html = '<option value="">&mdash; choose &mdash;</option>';
    for (var i = 0; i < sorted.length; i++) {
      html += '<option value="' + esc(sorted[i].id) + '">' + esc(sorted[i].name) + "</option>";
    }
    sel.innerHTML = html;
    notice("serviceNotice", "", "");
    if (!preselectName) { gate(); return; }

    // Case-insensitive EXACT match only — OSCAR has years of near-duplicate services, and a fuzzy
    // guess would file referrals under the wrong specialty.
    var target = preselectName.trim().toLowerCase(), match = null;
    for (var j = 0; j < sorted.length; j++) {
      if (sorted[j].name.trim().toLowerCase() === target) { match = sorted[j]; break; }
    }
    if (match) {
      sel.value = match.id;
    } else {
      notice("serviceNotice", "warn",
        'OSCAR has no consultation service named "<b>' + esc(preselectName) + '</b>". Pick an existing ' +
        'service above, or <button id="mkSvcBtn" class="secondary" style="padding:2px 10px">Create "' +
        esc(preselectName) + '" in OSCAR</button>');
      var btn = $("mkSvcBtn");
      if (btn) btn.onclick = async function () {
        btn.disabled = true; btn.textContent = "Creating…";
        try {
          await addService(preselectName);
          services = await fetchServices();
          fillServiceSelect(preselectName);
        } catch (e) { notice("serviceNotice", "err", esc(e.message)); }
        gate();
      };
    }
    gate();
  }

  function duplicateCheck() {
    var key = nameKey($("f_firstName").value + " " + $("f_lastName").value);
    if (key && rosterNames[key]) {
      notice("dupNotice", "warn", "A specialist with this name is <b>already in OSCAR</b> " +
        '(<a href="/oscar/oscarEncounter/EditSpecialists.do?specId=' + rosterNames[key] +
        '" target="_blank">open the existing record</a>). Add anyway only if this is a different person.');
    } else {
      notice("dupNotice", "", "");
    }
  }

  function showForm(spec) {
    $("formCard").style.display = "";
    for (var i = 0; i < FIELDS.length; i++) {
      var el = $("f_" + FIELDS[i]);
      var v = spec ? (spec[FIELDS[i]] || "") : "";
      el.value = v;
      el.classList.toggle("prefilled", Boolean(spec && v));
    }
    if (!spec) $("f_annotation").value = "Added from PathwaysBC.";
    suggestedService = spec ? (spec.suggestedOscarService || spec.specialty || "") : "";
    $("evidence").textContent = spec && spec.evidence ? 'Read from the paste: “' + spec.evidence + '”' : "";
    if (services.length) fillServiceSelect(suggestedService);
    duplicateCheck();
    gate();
    $("formCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showChooser() {
    var html = "<div class=\"notice info\">" + extracted.length + " specialists found in the paste — pick one to add (one at a time):</div>";
    for (var i = 0; i < extracted.length; i++) {
      html += '<button class="secondary" style="margin:0 8px 8px 0" data-idx="' + i + '">' +
        esc((extracted[i].firstName + " " + extracted[i].lastName).trim()) +
        (extracted[i].specialty ? " — " + esc(extracted[i].specialty) : "") + "</button>";
    }
    $("chooser").innerHTML = html;
    Array.prototype.forEach.call($("chooser").querySelectorAll("button[data-idx]"), function (b) {
      b.onclick = function () { showForm(extracted[Number(b.getAttribute("data-idx"))]); };
    });
  }

  // ---------- extraction ----------
  var REASONS = {
    no_text: "Paste the profile text first (a few lines at least).",
    not_configured: "AI extraction isn't configured on this server — fill the form manually.",
    disabled: "AI extraction is switched off — fill the form manually.",
    no_session: "Your OSCAR session has ended. Log back in, then reload this page.",
    content_filter: "The AI declined to read this text — fill the form manually.",
    nothing_extracted: "Nothing recognizable in the paste — check it's a PathwaysBC profile, or fill the form manually.",
    model_output_invalid: "The AI's answer was unusable — try again, or fill the form manually.",
    model_error: "The AI service had a problem — try again, or fill the form manually.",
  };

  $("extractBtn").onclick = async function () {
    var text = $("pasteText").value.trim();
    notice("extractNotice", "", "");
    if (text.length < 20) { notice("extractNotice", "warn", REASONS.no_text); return; }
    $("extractBtn").disabled = true; $("busy").style.display = "block";
    try {
      var res = await fetch("addSpecialist.jsp?action=extract", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "text=" + encodeURIComponent(text),
      });
      var data = await res.json();
      if (data.specialists && data.specialists.length) {
        extracted = data.specialists;
        $("chooser").innerHTML = "";
        if (extracted.length > 1) { $("formCard").style.display = ""; showChooser(); showForm(extracted[0]); }
        else showForm(extracted[0]);
        if (data.confidence === "low") {
          notice("extractNotice", "warn", "Low confidence — check every field below against the paste.");
        }
      } else {
        var why = REASONS[data.reason] || ("Extraction failed (" + esc(data.reason || "unknown") + ") — fill the form manually.");
        notice("extractNotice", "warn", why);
        showForm(null);
      }
    } catch (e) {
      notice("extractNotice", "err", esc(e.message));
      showForm(null);
    }
    $("extractBtn").disabled = false; $("busy").style.display = "none";
  };

  $("manualBtn").onclick = function () { $("chooser").innerHTML = ""; extracted = []; showForm(null); };

  // ---------- the add ----------
  $("addBtn").onclick = async function () {
    var btn = $("addBtn");
    btn.disabled = true; btn.textContent = "Adding…";
    notice("addNotice", "", "");
    try {
      var serviceId = $("f_service").value;
      var serviceName = $("f_service").options[$("f_service").selectedIndex].text;
      var lastName = $("f_lastName").value.trim();

      // Fresh snapshot right before writing: current maxId (specIds are sequential) AND the
      // service's current membership, in one request — shrinks both race windows.
      var snap = await servicePage(serviceId);
      var maxId = snap.all.length ? Math.max.apply(null, snap.all) : 0;

      var payload = {
        specId: "",
        firstName: $("f_firstName").value.trim(),
        lastName: lastName,
        proLetters: $("f_proLetters").value.trim(),
        address: $("f_address").value.trim(),
        annotation: $("f_annotation").value.trim(),
        phone: $("f_phone").value.trim(),
        fax: $("f_fax").value.trim(),
        privatePhoneNumber: "", cellPhoneNumber: "", pagerNumber: "",
        salutation: $("f_salutation").value,
        website: $("f_website").value.trim(),
        email: $("f_email").value.trim(),
        specType: serviceName,
        referralNo: $("f_referralNo").value.trim(),
        institution: "0", department: "0",
        eDataUrl: "", eDataOscarKey: "", eDataServiceKey: "", eDataServiceName: "",
        hideFromView: "false", eformId: "0",
        // Struts dispatch — the form's submit button IS transType. Omit these and OSCAR no-ops.
        whichType: "1", transType: "Add Specialist",
      };
      await fetch("/oscar/oscarEncounter/AddSpecialist.do", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(payload),
      });

      // OSCAR hands out specIds sequentially, so the new record should be maxId+1 — but confirm
      // it really is this person, because a rejected add re-renders the form with no error.
      var newId = maxId + 1;
      var ln = await verify(newId);
      if (!lastNameMatches(ln, lastName)) {
        var re = await servicePage(serviceId);
        var reMax = re.all.length ? Math.max.apply(null, re.all) : maxId;
        var reName = reMax > maxId ? await verify(reMax) : null;
        if (lastNameMatches(reName, lastName)) {
          newId = reMax;
          snap = re;
        } else {
          throw new Error("OSCAR did not create the record. Most often that means a referral-number " +
            "collision or a rejected field — try again with Referral # blank.");
        }
      }

      // UpdateServiceSpecialists REPLACES the service's whole membership — post the complete list.
      var membership = snap.checked.slice();
      if (membership.indexOf(newId) === -1) membership.push(newId);
      var body = "serviceId=" + encodeURIComponent(serviceId);
      for (var k = 0; k < membership.length; k++) body += "&specialists=" + encodeURIComponent(membership[k]);
      await fetch("/oscar/oscarEncounter/UpdateServiceSpecialists.do", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body,
      });

      var fullName = (payload.salutation + " " + payload.firstName + " " + lastName).trim();
      $("doneCard").style.display = "";
      $("doneCard").innerHTML = "<b>" + esc(fullName) + "</b> added to OSCAR under <b>" + esc(serviceName) + "</b> " +
        '(<a href="/oscar/oscarEncounter/EditSpecialists.do?specId=' + newId + '" target="_blank">open the record</a>). ' +
        'They now appear in consultation requests for that service. ' +
        '<button id="againBtn" class="secondary" style="margin-left:10px;padding:4px 12px">Add another</button>';
      $("formCard").style.display = "none";
      $("doneCard").scrollIntoView({ behavior: "smooth", block: "start" });
      rosterNames[nameKey(payload.firstName + " " + lastName)] = newId;
      $("againBtn").onclick = function () {
        $("doneCard").style.display = "none";
        $("pasteText").value = "";
        $("chooser").innerHTML = ""; extracted = [];
        notice("extractNotice", "", "");
        $("pasteCard").scrollIntoView({ behavior: "smooth", block: "start" });
      };
    } catch (e) {
      notice("addNotice", "err", esc(e.message));
    }
    btn.disabled = false; btn.textContent = "Add to OSCAR";
    gate();
  };

  FIELDS.forEach(function (f) {
    var el = $("f_" + f);
    el.addEventListener("input", function () {
      el.classList.remove("prefilled");
      gate();
      if (f === "firstName" || f === "lastName") duplicateCheck();
    });
  });
  $("f_service").addEventListener("change", gate);

  // ---------- load OSCAR's services + roster once, in the background ----------
  (async function init() {
    try {
      services = await fetchServices();
      if (!services.length) throw new Error("Couldn't read OSCAR's consultation services list.");
      // Any service's page carries the entire roster — used only for the duplicate warning.
      var snap = await servicePage(services[0].id);
      for (var i = 0; i < snap.names.length; i++) {
        var n = snap.names[i];
        if (n.name) rosterNames[nameKey(n.name)] = n.id;
      }
      if ($("formCard").style.display !== "none") fillServiceSelect(suggestedService);
    } catch (e) {
      notice("extractNotice", "err", esc(e.message));
    }
  })();
})();
</script>
</body>
</html>
