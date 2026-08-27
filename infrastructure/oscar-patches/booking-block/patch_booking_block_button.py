#!/usr/bin/env python3
"""Add a "Block online booking" toggle to the Master Chart patient detail page
(demographiceditdemographic.jsp).

Appends a script block at end of file that inserts the button beside the visible
"Export this Demographic" button at runtime — the page carries two alternate
button-row markups (classic vs workflow_enhance), so a DOM lookup is sturdier
than patching either row's JSP source. The button talks to the same-origin proxy
mymd/bookingBlock.jsp (which holds the app secret server-side); the flag itself
lives in the Health Assist app's booking_blocks table, and blocked patients are
told to email the clinic when they try to book online.

Run on the OSCAR box: sudo python3 patch_booking_block_button.py
Then: sudo rm -rf /opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/demographic
"""
import shutil
import sys
import time

PATH = "/opt/tomcat9/webapps/oscar/demographic/demographiceditdemographic.jsp"

MARKER = "MyMD booking-block button"

SNIPPET = """
<%-- MyMD booking-block button (2026-08-27) — see infrastructure/oscar-patches/booking-block/ --%>
<script>
(function () {
    var m = /[?&]demographic_no=(\\d+)/.exec(window.location.search);
    var demoNo = m ? m[1] : null;
    if (!demoNo) {
        var f = document.getElementsByName("demographic_no")[0];
        if (f && /^\\d+$/.test(f.value)) demoNo = f.value;
    }
    if (!demoNo) return;

    // The visible Export button marks the master-chart action row; skip silently on
    // variants (popups, print views) that don't render it.
    var anchor = null;
    var inputs = document.querySelectorAll("input[type=button]");
    for (var i = 0; i < inputs.length; i++) {
        var oc = inputs[i].getAttribute("onclick") || "";
        if (oc.indexOf("demographicExport.jsp") !== -1 && inputs[i].offsetParent !== null) anchor = inputs[i];
    }
    if (!anchor || !anchor.parentNode) return;

    var btn = document.createElement("input");
    btn.type = "button";
    btn.id = "mymdBookingBlockBtn";
    btn.className = "btn";
    btn.value = "Online booking: checking...";
    btn.disabled = true;
    btn.style.marginLeft = "4px";
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);

    function render(blocked) {
        btn.disabled = false;
        btn.setAttribute("data-blocked", blocked ? "1" : "0");
        btn.value = blocked ? "Online booking BLOCKED \\u2014 click to allow" : "Block online booking";
        btn.style.backgroundColor = blocked ? "#c9302c" : "";
        btn.style.color = blocked ? "#fff" : "";
    }
    function fail() {
        btn.value = "Booking block: unavailable";
        btn.disabled = true;
    }
    function call(action, cb) {
        var xhr = new XMLHttpRequest();
        xhr.open(action === "status" ? "GET" : "POST",
                 "../mymd/bookingBlock.jsp?action=" + action + "&demographic_no=" + demoNo, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            try {
                var j = JSON.parse(xhr.responseText);
                if (j && typeof j.blocked === "boolean") { cb(j.blocked); return; }
            } catch (e) {}
            fail();
        };
        xhr.send();
    }
    btn.onclick = function () {
        var blocked = btn.getAttribute("data-blocked") === "1";
        var msg = blocked
            ? "Allow this patient to book online again?"
            : "Block this patient from booking online?\\n\\nWhen they try to book, they will be asked to email the clinic instead.";
        if (!window.confirm(msg)) return;
        btn.disabled = true;
        btn.value = "Saving...";
        call(blocked ? "unblock" : "block", render);
    };
    call("status", render);
})();
</script>
"""

src = open(PATH, encoding="utf-8").read()
if MARKER in src:
    print("ALREADY PATCHED")
    sys.exit(0)
backup = PATH + ".oscarbak." + time.strftime("%Y%m%d%H%M%S")
shutil.copy2(PATH, backup)
open(PATH, "w", encoding="utf-8").write(src + SNIPPET)
print("PATCHED OK (backup: %s)" % backup)
