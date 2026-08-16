import shutil, time

p = "/opt/tomcat9/webapps/oscar/dms/incomingDocs.jsp"
bak = p + ".oscarbak." + time.strftime("%Y%m%d%H%M%S")
shutil.copy2(p, bak)
print("backup:", bak)

s = open(p, encoding="utf-8", errors="surrogateescape").read()
orig = s

# (A) One guard for every caller of addflagprovider.
# OSCAR assigns an absent MRP straight into .value, which turns undefined into the STRING
# "undefined" (length 9), so the length>0 checks at the call sites pass it through and it is
# POSTed as flagproviders=undefined -- silently truncated by MySQL into a providerLabRouting
# row pointing at nobody.
anchor_a = """                function addflagprovider(pfirstname,plastname,provider_no) {
                    //enable Save button whenever a selection is made"""

guard = """                function addflagprovider(pfirstname,plastname,provider_no) {
                    // MyMD: refuse a junk provider. A chart with no MRP yields the STRING
                    // "undefined" here (length 9), so the length>0 checks at the call sites do not
                    // stop it, and it would be POSTed as flagproviders=undefined -- silently
                    // truncated by MySQL into a providerLabRouting row pointing at nobody.
                    if (provider_no === null || provider_no === undefined || provider_no === ""
                        || provider_no === "undefined" || provider_no === "null") { return; }
                    //enable Save button whenever a selection is made"""

assert s.count(anchor_a) == 1, "addflagprovider anchor count=%d" % s.count(anchor_a)
s = s.replace(anchor_a, guard)

# (B) Load the AI prefill script alongside the other page scripts.
# The URL is stamped with the file's own mtime so every redeploy of aiPrefill.js busts browser
# caches by itself. Without this, an updated script silently keeps running its OLD cached version
# in every browser that has visited the page before -- which cost a debugging round on 2026-08-15.
anchor_b = '        <script src="<%= request.getContextPath() %>/js/demographicProviderAutocomplete.js"></script>'
assert s.count(anchor_b) == 1, "script anchor count=%d" % s.count(anchor_b)
s = s.replace(
    anchor_b,
    anchor_b
    + "\n        <!-- MyMD: AI pre-fill for incoming faxes. Inert unless mymd_fax.properties enables it. -->"
    + '\n        <script src="<%= request.getContextPath() %>/mymd/aiPrefill.js?v=<%= new java.io.File('
    + 'application.getRealPath("/mymd/aiPrefill.js")).lastModified() %>"></script>',
)

# (C) Upgrade the save-without-flagging CONFIRM to a hard BLOCK (Fax/Mail/Refile queues).
# Clinic rule (2026-08-15): a document with no flagproviders row reaches no inbox and is
# overlooked; one reflexive OK on a confirm dialog is exactly how that happens. The File queue
# keeps its stock behaviour (no prompt), matching the surrounding pdfDir!="File" condition.
anchor_c = '''                        if (!confirm("<bean:message key="dms.incomingDocs.saveWithoutFlagging" />"))
                        {
                            return false;
                        }'''
block_c = '''                        // MyMD: hard stop, not a confirm -- an unflagged document reaches
                        // no inbox and gets overlooked (clinic rule, 2026-08-15).
                        alert("Flag a provider to review this document.\\nIt will not appear in any inbox otherwise.");
                        return false;'''
assert s.count(anchor_c) == 1, "confirm block count=%d" % s.count(anchor_c)
s = s.replace(anchor_c, block_c)

assert s != orig
open(p, "w", encoding="utf-8", errors="surrogateescape").write(s)
print("patched OK")
