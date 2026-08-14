/*
 * Health Assist AI — "Transcribe" button for the OSCAR eChart encounter window.
 *
 * Installed on the OSCAR server with a single line before </body> of the
 * encounter JSP:
 *
 *   <script src="https://physician.health-assist.org/oscar/echart-transcribe.js" defer></script>
 *
 * See docs/oscar/echart-transcribe-install.md for the install and the
 * post-WAR-redeploy checklist.
 *
 * What it does:
 *   1. Adds a Transcribe button to the encounter toolbar.
 *   2. Opens the Health Assist transcription page in a popup, carrying the
 *      current demographic number.
 *   3. Receives the finished note back via postMessage and APPENDS it to the
 *      encounter note textarea.
 *
 * It deliberately does NOT save the encounter. The physician reviews the text
 * and clicks OSCAR's own Save, so OSCAR remains the system of record and no
 * OSCAR write API is involved.
 *
 * It also adds a Chart Attachment button, which files a photo or form the
 * patient attached when booking into this patient's OSCAR Documents. That
 * upload runs HERE rather than server-side: OSCAR publishes no document API,
 * and its DMS form is authenticated by the session cookie that only this page
 * holds. See docs/oscar/add-document-contract.md.
 */
(function () {
  "use strict";

  var APP_ORIGIN = "https://physician.health-assist.org";
  var LAUNCH_PATH = "/launch/oscar";
  var MAX_TEXT = 200000;
  var WINDOW_NAME = "healthassistTranscribe";

  // ── Current patient ───────────────────────────────────────────────────
  // Verified on oscar.mymdonline.ca (newEncounterLayout.jsp): the page defines
  // a JS global `demographicNo`, and `caseManagementEntryForm` carries a
  // demographicNo field. Other builds vary, so keep the fallback chain.
  function currentDemographicNo() {
    var form = document.forms["caseManagementEntryForm"];
    var el =
      (form && (form.demographicNo || form.demographic_no)) ||
      document.getElementById("demographicNo") ||
      document.querySelector('input[name="demographic_no"],input[name="demographicNo"]');
    if (el && el.value) return String(el.value).trim();
    if (typeof window.demographicNo === "string" && /^\d+$/.test(window.demographicNo)) {
      return window.demographicNo;
    }
    var m =
      /[?&]demographicNo=(\d+)/.exec(window.location.search) ||
      /[?&]demographic_no=(\d+)/.exec(window.location.search);
    return m ? m[1] : "";
  }

  // ── The encounter note field ──────────────────────────────────────────
  // Verified on oscar.mymdonline.ca: the eChart creates ONE note editor at a
  // time with a dynamic id "caseNote_note<noteId>", and keeps that id in the
  // JS global `caseNote` (see js/newCaseManagementView.js.jsp). The plain
  // "caseNote_note" id is the older CaseManagementEntry.jsp form.
  function noteTextarea() {
    if (typeof window.caseNote === "string" && window.caseNote) {
      var active = document.getElementById(window.caseNote);
      if (active && active.tagName === "TEXTAREA") return active;
    }
    var dyn = document.querySelector('textarea[id^="caseNote_note"]');
    if (dyn) return dyn;
    var form = document.forms["caseManagementEntryForm"];
    return (
      document.getElementById("caseNote_note") ||
      document.querySelector('textarea[name="caseNote_note"]') ||
      (form && form.querySelector ? form.querySelector("textarea") : null) ||
      null
    );
  }

  // ── Launch ────────────────────────────────────────────────────────────
  var popup = null;

  function openTranscribe() {
    var demo = currentDemographicNo();
    if (!demo) {
      window.alert("Could not determine which patient this chart is for.");
      return;
    }

    // Reuse the named window so a second click focuses the existing session
    // instead of orphaning a half-finished dictation.
    if (popup && !popup.closed) {
      popup.focus();
      return;
    }

    var url =
      APP_ORIGIN +
      LAUNCH_PATH +
      "?demographicNo=" +
      encodeURIComponent(demo) +
      "&origin=" +
      encodeURIComponent(window.location.origin);

    var width = 1180;
    var height = 920;
    var features =
      "width=" + width +
      ",height=" + height +
      ",left=" + Math.max(0, Math.floor((screen.width - width) / 2)) +
      ",top=" + Math.max(0, Math.floor((screen.height - height) / 2)) +
      ",resizable=yes,scrollbars=yes,menubar=no,toolbar=no,location=yes,status=no";

    // NOTE: no "noopener". window.opener is what carries the finished note
    // back to this page; adding noopener silently breaks the whole feature.
    popup = window.open(url, WINDOW_NAME, features);

    if (!popup) {
      window.alert(
        "Your browser blocked the Health Assist window.\n\n" +
          "Allow pop-ups for this site, then click Transcribe again.",
      );
    }
  }

  // ── Button ────────────────────────────────────────────────────────────
  // The eChart header (newEncounterHeader.jsp) renders a "Next Appt:" link
  // with an inline font-size of 14.3px. The button sits right beside it, and
  // both are drawn ~20% smaller than the header default per Dr. Mehraein's
  // preference (button ≈10px, Next Appt 14.3px → 11.4px).
  function findNextApptLink() {
    var header = document.getElementById("header");
    if (!header) return null;
    var links = header.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) {
      if (/next\s*appt/i.test(links[i].textContent || "")) return links[i];
    }
    return null;
  }

  function openDocumentsPage() {
    // Regular named window (not the transcription popup) — the Documents
    // dashboard is a full page for sending photo/document requests to
    // patients. Reusing the name focuses an already-open window.
    //
    // Routed through /launch/oscar (the SameSite=Strict bounce) exactly like
    // Transcribe: opening /org/documents directly is a cross-site navigation,
    // so the session cookie would be withheld and a logged-in doctor would
    // still land on the org login page. The demographic number rides along so
    // the Documents page can prefill the patient's name and email.
    var demo = currentDemographicNo();
    var url =
      APP_ORIGIN + LAUNCH_PATH + "?target=documents" +
      (demo ? "&demographicNo=" + encodeURIComponent(demo) : "");
    var win = window.open(url, "healthassistDocs");
    if (!win) {
      window.alert(
        "Your browser blocked the Health Assist window.\n\n" +
          "Allow pop-ups for this site, then click Request Docs again.",
      );
    }
  }

  function openAttachments() {
    // Same Strict-cookie bounce as Transcribe, and likewise WITHOUT "noopener":
    // this popup posts the file bytes back through window.opener, and the upload
    // below runs here, in the physician's authenticated OSCAR session.
    var demo = currentDemographicNo();
    if (!demo) {
      window.alert("Could not determine which patient this chart is for.");
      return;
    }
    var url =
      APP_ORIGIN + LAUNCH_PATH + "?target=attachment&demographicNo=" +
      encodeURIComponent(demo) +
      "&origin=" + encodeURIComponent(window.location.origin);
    var win = window.open(url, "healthassistAttachments");
    if (!win) {
      window.alert(
        "Your browser blocked the Health Assist window.\n\n" +
          "Allow pop-ups for this site, then click Chart Attachment again.",
      );
    }
  }

  /**
   * Tell the doctor there is something waiting, without making them click to find out.
   *
   * The count comes from a public count-only endpoint because this page is cross-site to
   * Health Assist and carries none of its cookies. Fails silently: if Health Assist is
   * unreachable the button simply stays plain, which is the pre-badge behaviour.
   */
  function flagPendingAttachments(btn) {
    var demo = currentDemographicNo();
    if (!demo) return;

    fetch(
      APP_ORIGIN + "/api/emr/oscar/attachment-count?demographicNo=" + encodeURIComponent(demo),
      { method: "GET", credentials: "omit", mode: "cors" },
    )
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var count = data && typeof data.count === "number" ? data.count : 0;
        if (count < 1) return;

        btn.textContent = "Chart Attachment (" + count + ")";
        btn.title =
          count === 1
            ? "1 file the patient attached when booking is waiting to be filed"
            : count + " files the patient attached when booking are waiting to be filed";

        // Amber rather than the resting purple: on a screen this dense, colour change
        // reads before motion does. The pulse then catches the eye that is scanning past.
        btn.style.background = "#b45309";
        btn.style.borderColor = "#b45309";
        btn.style.boxShadow = "0 0 0 0 rgba(180,83,9,0.7)";

        if (!document.getElementById("haAttachPulseStyle")) {
          var style = document.createElement("style");
          style.id = "haAttachPulseStyle";
          style.textContent =
            "@keyframes haAttachPulse{" +
            "0%{box-shadow:0 0 0 0 rgba(180,83,9,.7)}" +
            "70%{box-shadow:0 0 0 7px rgba(180,83,9,0)}" +
            "100%{box-shadow:0 0 0 0 rgba(180,83,9,0)}}" +
            // Stops after ~8 pulses. A control that blinks forever stops being a
            // signal and becomes wallpaper — and it is next to a note the doctor
            // is trying to read.
            "#haChartAttachmentBtn.ha-pulse{animation:haAttachPulse 1.4s ease-out 8}" +
            "@media (prefers-reduced-motion:reduce){" +
            "#haChartAttachmentBtn.ha-pulse{animation:none}}";
          document.head.appendChild(style);
        }
        btn.className = "ha-pulse";
      })
      .catch(function () {});
  }

  function makeHeaderButton(id, label, title, background, onClick) {
    var btn = document.createElement("button");
    btn.id = id;
    btn.type = "button";
    btn.textContent = label;
    btn.title = title;
    btn.style.cssText =
      "margin:0 0 0 6px;padding:2px 8px;cursor:pointer;font:10px sans-serif;" +
      "border:1px solid " + background + ";background:" + background + ";color:#fff;" +
      "border-radius:4px;vertical-align:middle";
    btn.onclick = onClick;
    return btn;
  }

  function addButton() {
    if (document.getElementById("haTranscribeBtn")) return;

    var transcribeBtn = makeHeaderButton(
      "haTranscribeBtn",
      "Transcribe",
      "Dictate this encounter with Health Assist AI",
      "#047857",
      openTranscribe,
    );
    var docsBtn = makeHeaderButton(
      "haRequestDocsBtn",
      "Request Docs",
      "Request photos or documents from the patient via Health Assist",
      "#1d4ed8",
      openDocumentsPage,
    );
    var attachBtn = makeHeaderButton(
      "haChartAttachmentBtn",
      "Chart Attachment",
      "File a photo or form the patient attached when booking into this chart",
      "#7c3aed",
      openAttachments,
    );

    flagPendingAttachments(attachBtn);

    // The clinic's own "Email Patient" link is emitted by OSCAR's header JSP
    // (casemgmt/newEncounterHeader.jsp, styled there to match these buttons).
    // It belongs with this group, so move it in alongside them — it stays put
    // in its stock header position if this script never loads.
    var emailBtn = document.getElementById("mymdEmailPatientBtn");

    var nextAppt = findNextApptLink();
    if (nextAppt) {
      // Shrink the Next Appt link by ~20% (inline 14.3px → 11.4px), then put
      // the buttons immediately after it on the same line.
      nextAppt.style.fontSize = "11.4px";
      var span = nextAppt.querySelector("span");
      if (span) span.style.fontSize = "11.4px";
      // Inserted back-to-front so the final order reads Email Patient,
      // Transcribe, Request Docs, Chart Attachment.
      nextAppt.parentNode.insertBefore(attachBtn, nextAppt.nextSibling);
      nextAppt.parentNode.insertBefore(docsBtn, attachBtn);
      nextAppt.parentNode.insertBefore(transcribeBtn, docsBtn);
      if (emailBtn) nextAppt.parentNode.insertBefore(emailBtn, transcribeBtn);
      return;
    }

    // Fallbacks for layouts without the Next Appt header link.
    var host =
      document.getElementById("header") ||
      document.getElementById("encounterToolbar") ||
      document.querySelector(".EncounterTitleBar") ||
      document.getElementById("topBar");
    if (host) {
      if (emailBtn) host.appendChild(emailBtn);
      host.appendChild(transcribeBtn);
      host.appendChild(docsBtn);
      host.appendChild(attachBtn);
    } else {
      transcribeBtn.style.cssText += ";position:fixed;top:6px;right:8px;z-index:99999";
      docsBtn.style.cssText += ";position:fixed;top:6px;right:90px;z-index:99999";
      attachBtn.style.cssText += ";position:fixed;top:6px;right:190px;z-index:99999";
      document.body.appendChild(transcribeBtn);
      document.body.appendChild(docsBtn);
      document.body.appendChild(attachBtn);
    }
  }

  // ── File an attachment into this patient's chart ───────────────────────
  // Runs HERE, on the OSCAR page, because only this context carries the
  // physician's OSCAR session cookie. Health Assist has no OSCAR session and
  // OSCAR publishes no document API, so driving the DMS module's own form is
  // the only way in. Contract recorded in docs/oscar/add-document-contract.md.

  function oscarContextPath() {
    // The eChart defines `ctx` (e.g. "/oscar"). Fall back to the first path
    // segment so this still works if that global ever disappears.
    if (typeof window.ctx === "string" && window.ctx) return window.ctx;
    var m = /^\/[^/]+/.exec(window.location.pathname);
    return m ? m[0] : "";
  }

  function currentProviderNo() {
    if (typeof window.providerNo === "string" && /^\d+$/.test(window.providerNo)) {
      return window.providerNo;
    }
    return "";
  }

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /** Images file as "photo"; everything else (forms, PDFs) as "others". */
  function docTypeFor(contentType) {
    return /^image\//i.test(contentType || "") ? "photo" : "others";
  }

  /**
   * AddEditDocumentAction.addDocument does an UNGUARDED Integer.parseInt on this
   * (line 297 of the deployed build) — an empty string throws NumberFormatException
   * and the add is silently abandoned. OSCAR's own rows use 0 for "no appointment",
   * so never send "". When the eChart was opened from the day sheet the real
   * appointment number is in the URL, and using it links the document to that visit.
   */
  function currentAppointmentNo() {
    var m = /[?&]appointmentNo=(\d+)/.exec(window.location.search);
    return m ? m[1] : "0";
  }

  function fileAttachmentToChart(data, demo) {
    var providerNo = currentProviderNo();
    if (!providerNo) {
      return Promise.resolve({ ok: false, error: "Could not identify the logged-in provider." });
    }

    var form = new FormData();
    // The DMS form posts the patient id under BOTH spellings; send both.
    form.append("function", "demographic");
    form.append("functionId", demo);
    form.append("functionid", demo);
    form.append("mode", "add");
    form.append("Submit", "Add");
    form.append("docType", docTypeFor(data.contentType));
    form.append("docDesc", String(data.description || "Patient booking attachment").slice(0, 255));
    form.append("docCreator", providerNo);
    form.append("observationDate", today());
    form.append("curUser", providerNo);
    form.append("parentAjaxId", "");
    form.append("appointmentNo", currentAppointmentNo());
    form.append(
      "docFile",
      new File([data.buffer], String(data.filename || "attachment"), {
        type: data.contentType || "application/octet-stream",
      }),
    );

    return fetch(oscarContextPath() + "/dms/addEditDocument.do", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    })
      .then(function (res) {
        if (!res.ok) return { ok: false, error: "OSCAR returned " + res.status + "." };
        return res.text().then(function (html) {
          if (/securityError/i.test(res.url || "")) {
            return { ok: false, error: "Your OSCAR account cannot add documents." };
          }

          // THE success signal is the redirect. A successful add ends in a 302 to
          // documentReport.jsp (res.redirected === true once fetch has followed it);
          // a failure re-renders the form as a plain 200. Scraping the HTML for an
          // error string is not enough on its own — when addDocument throws, the
          // page comes back looking perfectly normal, which is exactly how the
          // first live attempt reported success while filing nothing.
          if (res.redirected) return { ok: true };

          if (/<font class="warning">\s*Error:/i.test(html)) {
            return { ok: false, error: "OSCAR rejected the document." };
          }
          return {
            ok: false,
            error: "OSCAR did not file the document. Check the OSCAR logs for the reason.",
          };
        });
      })
      .catch(function () {
        return { ok: false, error: "Could not reach OSCAR." };
      });
  }

  // ── Receive the finished note ─────────────────────────────────────────
  window.addEventListener(
    "message",
    function (event) {
      // Pin the sender. Without this any page could inject text into a chart.
      if (event.origin !== APP_ORIGIN) return;

      var data = event.data;
      if (!data || data.source !== "healthassist") return;

      // Attachment → the patient's OSCAR Documents.
      if (data.type === "healthassist.document.insert") {
        var attachDemo = currentDemographicNo();
        var reply = function (payload) {
          try {
            payload.source = "oscar";
            payload.type = "healthassist.document.ack";
            payload.requestId = data.requestId;
            event.source.postMessage(payload, event.origin);
          } catch (e) {}
        };

        // Same wrong-patient guard as the note path: the doctor may have moved
        // this window to another chart while the popup was open.
        if (String(data.demographicNo || "") !== String(attachDemo)) {
          reply({ ok: false, error: "The chart open here is for a different patient." });
          return;
        }
        if (!attachDemo) {
          reply({ ok: false, error: "Could not determine which patient this chart is for." });
          return;
        }
        if (!data.buffer || typeof data.buffer.byteLength !== "number" || !data.buffer.byteLength) {
          reply({ ok: false, error: "The file was empty." });
          return;
        }

        fileAttachmentToChart(data, attachDemo).then(reply);
        return;
      }

      if (data.type !== "healthassist.soap.insert") return;
      if (typeof data.text !== "string" || !data.text) return;
      if (data.text.length > MAX_TEXT) return;

      // Wrong-patient guard: the doctor may have navigated this window to a
      // different chart while dictating. Never paste a note into the wrong one.
      var demo = currentDemographicNo();
      if (String(data.demographicNo || "") !== String(demo)) {
        window.alert(
          "This note was dictated for a different patient than the chart now open.\n\n" +
            "Nothing was inserted.",
        );
        return;
      }

      var ta = noteTextarea();
      if (!ta) {
        window.alert(
          "No encounter note is open in this chart.\n\n" +
            "Open (or start) a note in the eChart, then click Send to OSCAR note again — " +
            "or use Copy SOAP and paste it in.",
        );
        return;
      }

      // Insert ABOVE any existing content, never replace. OSCAR's Rx module
      // writes prescriptions into the open note before the doctor dictates, so
      // prepending keeps the SOAP (Subjective/Objective/Assessment/Plan) on
      // top and the prescription below the plan — the order Dr. Mehraein
      // wants. Anything already typed in the note survives, just lower down.
      var existing = ta.value;
      ta.value = data.text + "\n" + (existing && existing.trim() ? "\n" + existing : "");

      // Let OSCAR's dirty-tracking / autosave notice the change.
      try {
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (e) {}
      try {
        ta.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {}

      // The note was inserted at the top, so show the top.
      ta.focus();
      try {
        ta.selectionStart = ta.selectionEnd = 0;
      } catch (e) {}
      ta.scrollTop = 0;

      // Acknowledge, so the popup knows the text actually landed. Without this
      // it would mark the note exported even when nothing was inserted.
      try {
        event.source.postMessage(
          {
            source: "oscar",
            type: "healthassist.soap.ack",
            requestId: data.requestId,
          },
          event.origin,
        );
      } catch (e) {}
    },
    false,
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addButton);
  } else {
    addButton();
  }
})();
