<%--
  MyMD: read a PDF about to be faxed and suggest who it should be faxed BACK to.

  Called by fax/newFax.jsp from the operator's browser the moment a PDF is chosen (uploaded from
  disk, or a chart document ticked). Finds the SENDER's fax number on the page — a pharmacy's fax
  on a refill request, the From line of a cover sheet — reverse-matches it against the fax address
  book, and returns a rendered PNG of the page the number was read from so the operator can see it
  with their own eyes before anything is sent.

  Two tiers:
    1. Local PDFBox text extraction + label-proximity heuristic. Free, ~instant, works even when
       the Health Assist bridge is disabled. Enough for any PDF with a text layer.
    2. Inbound SRFax faxes are raster scans with NO text layer, so when tier 1 finds essentially no
       text the PDF goes down the existing fax-triage road (mymd_fax.properties → Health Assist →
       Azure OCR + model), which now also returns senderFaxNumber/senderFaxPage. Cached in
       mymd_fax_triage under a content-addressed ref ("dest|" + sha256 of the bytes) so each
       physical file is OCR'd once.

  This endpoint only ever SUGGESTS. It never queues a fax, never writes a chart, and fails soft:
  any error returns {"reason":"..."} and newFax.jsp behaves exactly as it did before.

  Not in git's deploy path; a WAR redeploy wipes it. Repo copy:
  infrastructure/oscar-patches/fax/faxDestSuggest.jsp — see docs/oscar/fax-triage-install.md.
--%>
<%@ page contentType="application/json; charset=UTF-8" trimDirectiveWhitespaces="true" %>
<%@ page import="java.util.*, java.io.*, java.sql.*, java.security.MessageDigest" %>
<%@ page import="java.net.HttpURLConnection, java.net.URL" %>
<%@ page import="org.apache.commons.fileupload.servlet.ServletFileUpload, org.apache.commons.fileupload.disk.DiskFileItemFactory, org.apache.commons.fileupload.FileItem" %>
<%@ page import="org.oscarehr.util.LoggedInInfo, org.oscarehr.util.SpringUtils, org.oscarehr.util.DbConnectionFilter, org.oscarehr.managers.SecurityInfoManager, org.oscarehr.common.dao.DocumentDao" %>
<%@ page import="oscar.OscarProperties" %>
<%@ page import="org.apache.pdfbox.pdmodel.PDDocument, org.apache.pdfbox.text.PDFTextStripper, org.apache.pdfbox.rendering.PDFRenderer, org.apache.pdfbox.rendering.ImageType" %>
<%@ page import="com.google.gson.Gson, com.google.gson.JsonObject, com.google.gson.JsonArray, com.google.gson.JsonParser, com.google.gson.JsonElement" %>
<%!
    static final String AB_FILE = "/var/lib/OscarDocument/oscar/fax_addressbook.tsv";
    static final String CONFIG_PATH = "/var/lib/OscarDocument/oscar/mymd_fax.properties";
    static final String ENDPOINT = "/api/emr/oscar/fax-triage";

    // Mirrors newFax.jsp's upload caps, and the app side's 10 MB OCR ceiling.
    static final long MAX_UPLOAD_BYTES  = 25L * 1024 * 1024;
    static final long MAX_REQUEST_BYTES = 30L * 1024 * 1024;
    static final long MAX_OCR_BYTES     = 10L * 1024 * 1024;

    // The clinic's own numbers, never a valid destination suggestion. The cover page prints the
    // clinic fax TWICE, so a previously-sent fax that gets re-uploaded leads with 6046283830.
    // 6043986518 is the SRFax inbound DID (fax_config.faxNumber holds only the 6046283830
    // caller ID): senders hand-write it in a cover sheet's To block, which is exactly where the
    // picker found it on an inbound Fraser Health cover (2026-08-18).
    static final Set<String> CLINIC_NUMBERS =
        new HashSet<String>(Arrays.asList("6046283830", "6048807919", "6043986518"));

    static String nz(String s) { return s == null ? "" : s.trim(); }

    static String str(JsonObject o, String k) {
        if (o == null || !o.has(k) || o.get(k).isJsonNull()) return "";
        try { return nz(o.get(k).getAsString()); } catch (Exception e) { return ""; }
    }

    static int intOf(JsonObject o, String k) {
        if (o == null || !o.has(k) || o.get(k).isJsonNull()) return 0;
        try { return o.get(k).getAsInt(); } catch (Exception e) { return 0; }
    }

    static String docDir() {
        String dir = OscarProperties.getInstance().getProperty("DOCUMENT_DIR", "/var/lib/OscarDocument/oscar/document");
        if (!dir.endsWith("/")) dir += "/";
        return dir;
    }

    // Same TSV newFax.jsp renders its picker from: group <tab> name <tab> 10-digit-fax.
    static List<String[]> readAddressBook() {
        List<String[]> rows = new ArrayList<String[]>();
        File f = new File(AB_FILE);
        if (!f.exists()) return rows;
        BufferedReader br = null;
        try {
            br = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            String line;
            while ((line = br.readLine()) != null) {
                if (line.trim().isEmpty()) continue;
                String[] p = line.split("\t", -1);
                if (p.length >= 3) rows.add(new String[]{p[0], p[1], p[2]});
            }
        } catch (Exception e) {}
        finally { if (br != null) try { br.close(); } catch (Exception e) {} }
        return rows;
    }

    // Chart access, copied from newFax.jsp: DocumentDao.findByDemographicId scopes through
    // ctl_document, so a guessed docNo outside this chart simply is not in the map.
    static LinkedHashMap<String,org.oscarehr.common.model.Document> chartDocsById(String demographicNo) {
        LinkedHashMap<String,org.oscarehr.common.model.Document> m =
            new LinkedHashMap<String,org.oscarehr.common.model.Document>();
        if (demographicNo == null || !demographicNo.matches("[0-9]+")) return m;
        try {
            DocumentDao dao = SpringUtils.getBean(DocumentDao.class);
            List<org.oscarehr.common.model.Document> list = dao.findByDemographicId(demographicNo);
            if (list == null) return m;
            for (org.oscarehr.common.model.Document d : list) m.put(String.valueOf(d.getDocumentNo()), d);
        } catch (Exception e) {}
        return m;
    }

    // Basename only, so a crafted docfilename cannot walk out of the document dir.
    static File chartFile(org.oscarehr.common.model.Document d) throws Exception {
        if (d.getDocfilename() == null || d.getDocfilename().trim().length() == 0)
            throw new Exception("no file");
        File f = new File(docDir(), new File(d.getDocfilename()).getName());
        if (!f.isFile()) throw new Exception("missing");
        return f;
    }

    static byte[] readAll(File f) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        InputStream in = null;
        try {
            in = new FileInputStream(f);
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        } finally { if (in != null) try { in.close(); } catch (Exception ig) {} }
        return bo.toByteArray();
    }

    static String sha256hex(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] d = md.digest(data);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < d.length; i++) sb.append(String.format("%02x", d[i]));
        return sb.toString();
    }

    // ---- the number heuristic (pure statics — paste into jshell to spot-check) ------------------

    // NANP: area code and exchange both [2-9]xx. Tolerates 1-, dots, dashes, spaces, parens.
    // The digit lookarounds stop it grabbing ten digits out of a longer run (a PHN, an account no).
    static final java.util.regex.Pattern NUM = java.util.regex.Pattern.compile(
        "(?<!\\d)(?:\\+?1[\\s.\\-]?)?\\(?([2-9]\\d{2})\\)?[\\s.\\-]?([2-9]\\d{2})[\\s.\\-]?(\\d{4})(?!\\d)");
    // Anchored at the end so the label must sit immediately before the number's lookback window.
    static final java.util.regex.Pattern FAX_LABEL = java.util.regex.Pattern.compile(
        "(?i)(?:\\bfax\\b|facsimile|\\bfx\\b)\\s*(?:#|no\\.?|number)?\\s*[:.\\-]?\\s*\\(?$");
    static final java.util.regex.Pattern ANTI_LABEL = java.util.regex.Pattern.compile(
        "(?i)(?:\\btel(?:ephone)?\\b|\\bphone\\b|\\bph\\b|\\bcell\\b|\\bmobile\\b|\\bvoice\\b|"
        + "\\bphn\\b|\\bmsp\\b|health\\s*(?:no|number|#))\\s*[:.\\-]?\\s*\\(?$");
    // Cover sheets label BOTH numbers "Fax": "To ... Fax <ours>" then "From ... (FAX: <theirs>)".
    // These two look at a wider window than the label patterns (which are anchored right before
    // the number) so they can see the To/From on the line above, and they break that tie: the
    // sender's number outranks the recipient's. Weights are below the +4 label bonus on purpose —
    // context alone never beats an explicit "Fax:" label, it only orders equally-labelled rivals.
    static final java.util.regex.Pattern SENDER_CTX = java.util.regex.Pattern.compile(
        "(?i)\\b(?:from|sender|reply\\s*to|return\\s*fax)\\b");
    static final java.util.regex.Pattern RECIPIENT_CTX = java.util.regex.Pattern.compile(
        "(?i)\\b(?:to|attn|attention|recipient|deliver)\\b");

    /** Distinct candidate numbers across all pages, exclusions applied. */
    static Set<String> distinctCandidates(List<String> pages, Set<String> exclude) {
        Set<String> found = new LinkedHashSet<String>();
        for (String pageText : pages) {
            java.util.regex.Matcher m = NUM.matcher(pageText);
            while (m.find()) {
                String digits = m.group(1) + m.group(2) + m.group(3);
                if (!exclude.contains(digits)) found.add(digits);
            }
        }
        return found;
    }

    /**
     * Best fax-number candidate across pages, or null.
     * Returns { tenDigits, "1"-based page, "labeled"|"only" }.
     *
     * A "Fax:"-labelled number wins outright — but when several numbers are labelled "Fax" (a
     * cover sheet labels the recipient's AND the sender's), nearby From/To context orders them:
     * sender context outranks recipient context. A number in a To block is also no longer
     * "labelled" on its own (4-2=2), so it can only be suggested as the document's single
     * distinct number. An unlabelled number is accepted only when it is the single distinct
     * number in the whole document (nothing to confuse it with). A number labelled Tel/Phone/PHN
     * is never accepted on its own. Earliest page wins ties (strict > keeps the first best).
     */
    static String[] pickFaxNumber(List<String> pages, Set<String> exclude) {
        int bestScore = Integer.MIN_VALUE; String bestNum = null; int bestPage = 0;
        for (int p = 0; p < pages.size(); p++) {
            java.util.regex.Matcher m = NUM.matcher(pages.get(p));
            while (m.find()) {
                String digits = m.group(1) + m.group(2) + m.group(3);
                if (exclude.contains(digits)) continue;
                String before = pages.get(p).substring(Math.max(0, m.start() - 25), m.start());
                String context = pages.get(p).substring(Math.max(0, m.start() - 80), m.start());
                int score = 0;
                if (FAX_LABEL.matcher(before).find())  score += 4;   // "Fax: " right before it
                if (ANTI_LABEL.matcher(before).find()) score -= 3;   // "Tel: " / "PHN " right before it
                if (SENDER_CTX.matcher(context).find())    score += 2;   // "From ..." nearby
                if (RECIPIENT_CTX.matcher(context).find()) score -= 2;   // "To ..." nearby
                if (score > bestScore) { bestScore = score; bestNum = digits; bestPage = p + 1; }
            }
        }
        if (bestNum == null) return null;
        if (bestScore >= 4) return new String[]{ bestNum, String.valueOf(bestPage), "labeled" };
        if (bestScore >= 0 && distinctCandidates(pages, exclude).size() == 1)
            return new String[]{ bestNum, String.valueOf(bestPage), "only" };
        return null;
    }

    static String formatFax(String d) {
        if (d == null || d.length() != 10) return nz(d);
        return d.substring(0, 3) + "-" + d.substring(3, 6) + "-" + d.substring(6);
    }
%><%
    response.setHeader("Cache-Control", "no-store");
    Gson gson = new Gson();
    JsonObject outJson = new JsonObject();

    LoggedInInfo loggedInInfo = LoggedInInfo.getLoggedInInfoFromSession(request);
    if (loggedInInfo == null) {
        outJson.addProperty("reason", "no_session");
        out.print(gson.toJson(outJson));
        return;
    }
    String providerNo = loggedInInfo.getLoggedInProviderNo();

    PDDocument doc = null;
    try {
        // --- get the PDF bytes: an upload, or a re-authorised chart document ---------------------
        byte[] bytes = null;
        if (ServletFileUpload.isMultipartContent(request)) {
            DiskFileItemFactory factory = new DiskFileItemFactory();
            ServletFileUpload upload = new ServletFileUpload(factory);
            upload.setFileSizeMax(MAX_UPLOAD_BYTES);
            upload.setSizeMax(MAX_REQUEST_BYTES);
            List<FileItem> items = upload.parseRequest(request);
            for (FileItem it : items) {
                if (!it.isFormField() && "pdfFile".equals(it.getFieldName()) && it.getSize() > 0) bytes = it.get();
            }
        } else {
            String docNo = nz(request.getParameter("docNo"));
            String demographicNo = nz(request.getParameter("demographicNo"));
            if (!docNo.matches("[0-9]{1,9}") || !demographicNo.matches("[0-9]{1,9}")) {
                outJson.addProperty("reason", "not_found"); out.print(gson.toJson(outJson)); return;
            }
            boolean canReadChart = false;
            try {
                SecurityInfoManager sim = SpringUtils.getBean(SecurityInfoManager.class);
                canReadChart = sim.hasPrivilege(loggedInInfo, "_edoc", "r", null);
            } catch (Exception e) {}
            if (!canReadChart) { outJson.addProperty("reason", "not_found"); out.print(gson.toJson(outJson)); return; }
            // Same scoping newFax.jsp enforces at send time: the doc must be in THIS chart's map.
            org.oscarehr.common.model.Document d = chartDocsById(demographicNo).get(docNo);
            if (d == null) { outJson.addProperty("reason", "not_found"); out.print(gson.toJson(outJson)); return; }
            String ct = d.getContenttype() == null ? "" : d.getContenttype().toLowerCase();
            if (!ct.startsWith("application/pdf")) { outJson.addProperty("reason", "not_pdf"); out.print(gson.toJson(outJson)); return; }
            File f = chartFile(d);
            if (f.length() > MAX_UPLOAD_BYTES) { outJson.addProperty("reason", "too_big"); out.print(gson.toJson(outJson)); return; }
            bytes = readAll(f);
        }

        if (bytes == null || bytes.length < 5) { outJson.addProperty("reason", "not_pdf"); out.print(gson.toJson(outJson)); return; }
        String magic = new String(bytes, 0, 5, "ISO-8859-1");
        if (!"%PDF-".equals(magic)) { outJson.addProperty("reason", "not_pdf"); out.print(gson.toJson(outJson)); return; }

        // --- tier 1: local per-page text extraction ----------------------------------------------
        doc = PDDocument.load(bytes);
        int pageCount = doc.getNumberOfPages();
        List<String> pages = new ArrayList<String>();
        PDFTextStripper stripper = new PDFTextStripper();
        int totalChars = 0;
        for (int p = 1; p <= pageCount; p++) {
            stripper.setStartPage(p); stripper.setEndPage(p);
            String t = stripper.getText(doc);
            totalChars += t.trim().length();
            pages.add(t);
        }
        // Mirrors the app side's MIN_OCR_CHARS: below this the PDF is a scan with no text layer.
        boolean scanned = totalChars < 40;

        String faxNumber = "", source = "", senderFacility = "";
        int pageFound = 0;

        if (!scanned) {
            String[] hit = pickFaxNumber(pages, CLINIC_NUMBERS);
            if (hit == null) { outJson.addProperty("reason", "no_number"); out.print(gson.toJson(outJson)); return; }
            faxNumber = hit[0];
            pageFound = Integer.parseInt(hit[1]);
            source = "text";
        } else {
            // --- tier 2: the fax-triage OCR road ------------------------------------------------
            Properties cfg = new Properties();
            File cfgFile = new File(CONFIG_PATH);
            if (cfgFile.canRead()) {
                FileInputStream cfgIn = new FileInputStream(cfgFile);
                try { cfg.load(cfgIn); } finally { cfgIn.close(); }
            }
            String baseUrl = nz(cfg.getProperty("healthassist.url"));
            String secret = nz(cfg.getProperty("fax.secret"));
            boolean enabled = "true".equals(nz(cfg.getProperty("enabled")));
            if (!enabled || baseUrl.isEmpty() || secret.isEmpty()) {
                outJson.addProperty("reason", "no_text_no_ocr"); out.print(gson.toJson(outJson)); return;
            }
            if (bytes.length > MAX_OCR_BYTES) {
                outJson.addProperty("reason", "too_big_for_ocr"); out.print(gson.toJson(outJson)); return;
            }

            // Content-addressed: the same physical file is OCR'd once, however many times and from
            // whichever mode it is chosen. Cannot collide with faxSuggest's queueId|dir|name refs.
            String ref = sha256hex(("dest|" + sha256hex(bytes)).getBytes("UTF-8")).substring(0, 32);
            Connection conn = DbConnectionFilter.getThreadLocalDbConnection();

            String cached = null;
            PreparedStatement cps = conn.prepareStatement(
                "SELECT payload FROM mymd_fax_triage WHERE fax_ref=? AND payload IS NOT NULL");
            cps.setString(1, ref);
            ResultSet crs = cps.executeQuery();
            if (crs.next()) cached = crs.getString(1);
            crs.close(); cps.close();

            JsonObject ai = null;
            // A payload cached before the senderFaxNumber field existed is a miss, not an answer.
            if (cached != null) {
                JsonElement el = JsonParser.parseString(cached);
                if (el.isJsonObject() && el.getAsJsonObject().has("senderFaxNumber")) ai = el.getAsJsonObject();
            }

            if (ai == null) {
                // The triage endpoint requires the doctype/class/provider lists (they shape its
                // schema); build the same request faxSuggest.jsp builds.
                JsonArray docTypes = new JsonArray();
                PreparedStatement ts = conn.prepareStatement(
                    "SELECT doctype FROM ctl_doctype WHERE module='demographic' AND status<>'I' ORDER BY id");
                ResultSet trs = ts.executeQuery();
                while (trs.next()) docTypes.add(trs.getString(1));
                trs.close(); ts.close();

                JsonArray docClasses = new JsonArray();
                Set<String> seenClass = new LinkedHashSet<String>();
                PreparedStatement cs = conn.prepareStatement("SELECT DISTINCT reportclass FROM ctl_doc_class");
                ResultSet crs2 = cs.executeQuery();
                while (crs2.next()) {
                    String rc = nz(crs2.getString(1));
                    if (rc.equals("Consultant ReportA") || rc.equals("Consultant ReportB")) rc = "Consultant Report";
                    if (!rc.isEmpty()) seenClass.add(rc);
                }
                crs2.close(); cs.close();
                for (String rc : seenClass) docClasses.add(rc);

                JsonArray provs = new JsonArray();
                PreparedStatement ps = conn.prepareStatement(
                    "SELECT first_name,last_name,ohip_no FROM provider WHERE status='1' AND provider_no > 0");
                ResultSet prs = ps.executeQuery();
                while (prs.next()) {
                    JsonObject p = new JsonObject();
                    p.addProperty("name", (nz(prs.getString(1)) + " " + nz(prs.getString(2))).trim());
                    p.addProperty("mspNumber", nz(prs.getString(3)));
                    provs.add(p);
                }
                prs.close(); ps.close();

                JsonArray clinicNums = new JsonArray();
                for (String n : CLINIC_NUMBERS) clinicNums.add(n);

                JsonObject req = new JsonObject();
                req.addProperty("faxRef", ref);
                req.addProperty("pdfBase64", Base64.getEncoder().encodeToString(bytes));
                req.addProperty("providerNo", providerNo);
                req.add("docTypes", docTypes);
                req.add("docClasses", docClasses);
                req.add("knownProviders", provs);
                req.add("clinicFaxNumbers", clinicNums);

                URL url = new URL(baseUrl.replaceAll("/+$", "") + ENDPOINT);
                HttpURLConnection http = (HttpURLConnection) url.openConnection();
                http.setRequestMethod("POST");
                http.setConnectTimeout(10000);
                // OCR polls Azure for up to 45s before the model even runs.
                http.setReadTimeout(150000);
                http.setDoOutput(true);
                http.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                http.setRequestProperty("x-mymd-fax-secret", secret);
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
                    outJson.addProperty("reason", "http_" + code); out.print(gson.toJson(outJson)); return;
                }
                JsonElement parsed = JsonParser.parseString(sb.toString());
                ai = parsed.isJsonObject() ? parsed.getAsJsonObject() : new JsonObject();

                // Content-addressed refs never go stale, so no pruning — replace-on-miss only.
                PreparedStatement ins = conn.prepareStatement(
                    "INSERT INTO mymd_fax_triage (fax_ref,pdf_name,provider_no,reason,payload) VALUES (?,?,?,?,?)");
                ins.setString(1, ref); ins.setString(2, "faxdest"); ins.setString(3, providerNo);
                ins.setString(4, str(ai, "reason"));
                ins.setString(5, sb.toString());
                try { ins.executeUpdate(); } catch (SQLException ignore) { /* raced another tab */ }
                ins.close();
            }

            senderFacility = str(ai, "senderFacility");
            String aiFax = str(ai, "senderFaxNumber").replaceAll("[^0-9]", "");
            if (aiFax.length() == 11 && aiFax.startsWith("1")) aiFax = aiFax.substring(1);
            // Belt and braces: the app validates too, but this number decides where PHI goes.
            if (aiFax.matches("[2-9][0-9]{2}[2-9][0-9]{6}") && !CLINIC_NUMBERS.contains(aiFax)) {
                faxNumber = aiFax;
                int pg = intOf(ai, "senderFaxPage");
                if (pg >= 1 && pg <= pageCount) pageFound = pg;
                source = "ocr";
            } else if (!senderFacility.isEmpty()) {
                // The model named the sender but read no number: a unique address-book name match
                // still gives the operator a number — flagged as weaker evidence, since it came
                // from the book, not the page.
                String match = null;
                for (String[] r : readAddressBook()) {
                    if (r[1].equalsIgnoreCase(senderFacility)) {
                        if (match != null && !match.equals(r[2])) { match = null; break; }   // ambiguous
                        match = r[2];
                    }
                }
                if (match != null && !CLINIC_NUMBERS.contains(match)) {
                    faxNumber = match;
                    source = "ocr-name";
                }
            }
            if (faxNumber.isEmpty()) {
                outJson.addProperty("reason", "no_number"); out.print(gson.toJson(outJson)); return;
            }
        }

        // --- reverse lookup: who answers at that number ------------------------------------------
        // 66 numbers sit on more than one TSV row, so this is one-to-many: a single Pharmacies row
        // wins the headline (the reply-to case this feature exists for), the rest are shown too.
        List<String[]> matches = new ArrayList<String[]>();
        for (String[] r : readAddressBook()) {
            if (faxNumber.equals(nz(r[2]))) matches.add(r);
        }
        String[] primary = null;
        if (matches.size() == 1) primary = matches.get(0);
        else if (matches.size() > 1) {
            for (String[] r : matches) {
                if ("Pharmacies".equalsIgnoreCase(nz(r[0]))) {
                    if (primary != null) { primary = null; break; }   // several pharmacies: first row wins below
                    primary = r;
                }
            }
            if (primary == null) primary = matches.get(0);
        }
        JsonArray alsoListed = new JsonArray();
        for (String[] r : matches) {
            if (r == primary || alsoListed.size() >= 5) continue;
            JsonObject j = new JsonObject();
            j.addProperty("name", nz(r[1]));
            j.addProperty("group", nz(r[0]));
            j.addProperty("fax", nz(r[2]));
            alsoListed.add(j);
        }

        // --- render the page the number was read from --------------------------------------------
        // Works on CCITT raster scans too (rendering never needed a text layer). OCR page unknown
        // (0) → no preview and no "found on page" claim; the number is still shown.
        String previewPng = "";
        if (pageFound >= 1 && pageFound <= pageCount) {
            try {
                PDFRenderer renderer = new PDFRenderer(doc);
                int[] dpis = new int[]{130, 90};
                for (int i = 0; i < dpis.length; i++) {
                    java.awt.image.BufferedImage img = renderer.renderImageWithDPI(pageFound - 1, dpis[i], ImageType.RGB);
                    ByteArrayOutputStream png = new ByteArrayOutputStream();
                    javax.imageio.ImageIO.write(img, "png", png);
                    String b64 = Base64.getEncoder().encodeToString(png.toByteArray());
                    if (b64.length() <= 2000000) { previewPng = b64; break; }
                }
            } catch (Throwable renderErr) { previewPng = ""; }
        }

        outJson.addProperty("faxNumber", faxNumber);
        outJson.addProperty("faxNumberFormatted", formatFax(faxNumber));
        outJson.addProperty("page", pageFound);
        outJson.addProperty("pageCount", pageCount);
        outJson.addProperty("source", source);
        outJson.addProperty("senderName", primary == null ? "" : nz(primary[1]));
        outJson.addProperty("senderGroup", primary == null ? "" : nz(primary[0]));
        outJson.addProperty("senderFacility", senderFacility);
        outJson.add("alsoListedAs", alsoListed);
        outJson.addProperty("previewPng", previewPng);
        outJson.addProperty("reason", "");
        out.print(gson.toJson(outJson));

    } catch (Throwable t) {
        // A failure here must never break the fax page — the operator just types the number.
        try {
            JsonObject err = new JsonObject();
            err.addProperty("reason", "error");
            out.print(gson.toJson(err));
        } catch (Exception ignore) { /* response already committed */ }
    } finally {
        if (doc != null) try { doc.close(); } catch (Exception ignore) {}
    }
%>
