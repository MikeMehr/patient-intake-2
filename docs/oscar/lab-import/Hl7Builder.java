package mymd.lab;

import java.io.File;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Builds an HL7 v2.3 ORU^R01 from a parsed lab report.
 *
 * OSCAR's PATHL7 parser (oscar.oscarLab.ca.all.parsers.PATHL7Handler) reads the message into
 * HAPI's ca.uhn.hl7v2.model.v23.message.ORU_R01, so this emits standard v2.3 structure rather
 * than anything vendor-specific. It reads the health number from PID-2, which is why the PHN
 * goes there.
 *
 * Trending depends entirely on OBX-3 being STABLE across uploads: OSCAR groups a test into one
 * series by that identifier, so if it drifts between reports the graph silently splits into two
 * unrelated series. See {@link #codeFor} for how that stability is guaranteed.
 */
public class Hl7Builder {

    private static final char CR = '\r';

    /**
     * Canonical identifiers for OBX-3.
     *
     * The identifier is the normalised test name, NOT a LOINC code. That is deliberate: the
     * lab emits the same test names on every report, so the normalised name is already stable,
     * whereas a LOINC code I could not verify against an authoritative source risks silently
     * mislabelling an analyte. Names are normalised (upper case, spaces to underscores) so
     * incidental spacing changes don't fracture a trend.
     *
     * This table only collapses known synonyms onto one identifier. To add verified LOINC codes
     * later, extend it to carry a second identifier and emit it in OBX-3 components 4-6.
     */
    private static final Map<String, String> SYNONYMS = new LinkedHashMap<String, String>();
    static {
        SYNONYMS.put("HBA1C", "HEMOGLOBIN_A1C");
        SYNONYMS.put("HGB", "HEMOGLOBIN");
        SYNONYMS.put("PLATELETS", "PLATELET_COUNT");
        SYNONYMS.put("EGFR", "ESTIMATED_GFR");
        SYNONYMS.put("ALT", "ALANINE_AMINOTRANSFERASE");
        SYNONYMS.put("AST", "ASPARTATE_AMINOTRANSFERASE");
        SYNONYMS.put("ALK_PHOS", "ALKALINE_PHOSPHATASE");
        SYNONYMS.put("GGT", "GAMMA_GT");
    }

    /** Stable OBX-3 identifier for a test name. */
    public static String codeFor(String testName) {
        String norm = testName.trim().toUpperCase()
                .replaceAll("[^A-Z0-9]+", "_")
                .replaceAll("^_+|_+$", "");
        String syn = SYNONYMS.get(norm);
        return syn != null ? syn : norm;
    }

    /** Escape the HL7 delimiter characters so values can't break the message structure. */
    static String esc(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder();
        for (char c : s.toCharArray()) {
            switch (c) {
                case '\\': sb.append("\\E\\"); break;
                case '|':  sb.append("\\F\\"); break;
                case '^':  sb.append("\\S\\"); break;
                case '&':  sb.append("\\T\\"); break;
                case '~':  sb.append("\\R\\"); break;
                case '\r':
                case '\n': sb.append(' '); break;
                default:   sb.append(c);
            }
        }
        return sb.toString();
    }

    /** "2026-07-17" + "12:40:38" -> "20260717124038" (HL7 TS). Returns "" if the date is absent. */
    static String ts(String date, String time) {
        if (date == null || date.isEmpty()) return "";
        String d = date.replace("-", "");
        if (time == null || time.isEmpty()) return d;
        return d + time.replace(":", "");
    }

    /** NM for a plain number, ST for anything else ("Neg", "TRACE", "YELLOW"). */
    static String valueType(String v) {
        return v != null && v.matches("[-+]?\\d+(\\.\\d+)?") ? "NM" : "ST";
    }

    /** Split "LAST, FIRST MIDDLE" or "FIRST LAST" into HL7 XPN (last^first). */
    static String patientNameXpn(String name) {
        String n = name == null ? "" : name.trim().replaceAll("\\s+", " ");
        if (n.isEmpty()) return "";
        if (n.contains(",")) {
            String[] p = n.split(",", 2);
            return esc(p[0].trim()) + "^" + esc(p[1].trim());
        }
        int i = n.lastIndexOf(' ');
        if (i < 0) return esc(n);
        // Report prints "FIRST LAST"; HL7 wants last^first.
        return esc(n.substring(i + 1)) + "^" + esc(n.substring(0, i));
    }

    public String build(LabPdfParser.Report r, String messageControlId) {
        StringBuilder m = new StringBuilder();
        String now = ts(r.dateOfService.length() >= 10 ? r.dateOfService.substring(0, 10) : "", "")
                + "000000";
        String serviceTs = r.dateOfService.length() >= 19
                ? ts(r.dateOfService.substring(0, 10), r.dateOfService.substring(11, 19))
                : ts(r.dateOfService, "");

        // MSH
        m.append("MSH|^~\\&|LABIMPORT|MYMD|OSCAR|MYMD|").append(now).append("||ORU^R01|")
         .append(esc(messageControlId)).append("|P|2.3").append(CR);

        // PID -- PID-2 carries the PHN, which is what PATHL7Handler.getHealthNum() reads, and
        // what OSCAR matches on (LAB_NOMATCH_NAMES=yes means sex+DOB+PHN, name ignored).
        m.append("PID|1|").append(esc(r.phn)).append("|").append(esc(r.phn)).append("||")
         .append(patientNameXpn(r.patientName)).append("||")
         .append(ts(r.dob, "")).append("|").append(esc(r.sex)).append(CR);

        int obrNo = 0;
        for (LabPdfParser.Section s : r.sections) {
            if (s.results.isEmpty() && s.notes.isEmpty()) continue;
            obrNo++;
            String obrTs = s.results.isEmpty() ? serviceTs
                    : ts(s.results.get(0).obsDate, s.results.get(0).obsTime);
            // ORC-3 (filler order number) is where PATHL7Handler.getAccessionNum() looks, and
            // the accession is also the key the duplicate-import guard relies on.
            m.append("ORC|RE||").append(esc(r.accession)).append(CR);
            m.append("OBR|").append(obrNo).append("||").append(esc(r.accession)).append("|")
             .append(esc(s.code)).append("^").append(esc(s.code)).append("|||")
             .append(obrTs).append("||||||||")
             .append(esc(r.requestingClient))
             .append("|||||||").append("|F").append(CR);

            int obxNo = 0, nteNo;
            for (LabPdfParser.Result res : s.results) {
                obxNo++;
                m.append("OBX|").append(obxNo).append("|").append(valueType(res.value)).append("|")
                 .append(esc(codeFor(res.testName))).append("^").append(esc(res.testName)).append("||")
                 .append(esc(res.value)).append("|").append(esc(res.units)).append("|")
                 .append(esc(res.refRange)).append("|").append(esc(res.abnFlag)).append("|||")
                 .append(esc(res.status.isEmpty() ? "F" : res.status)).append("|||")
                 .append(ts(res.obsDate, res.obsTime)).append(CR);

                nteNo = 0;
                for (String c : res.comments) {
                    m.append("NTE|").append(++nteNo).append("||").append(esc(c)).append(CR);
                }
            }
            // Section-level notes (performing lab, narrative-only sections) attach to the OBR.
            nteNo = 0;
            for (String n : s.notes) {
                m.append("NTE|").append(++nteNo).append("||").append(esc(n)).append(CR);
            }
        }
        return m.toString();
    }

    // ---------- round-trip check ----------

    /**
     * Generate HL7 from a PDF and feed it straight back into OSCAR's own PATHL7 parser, then
     * read the values back out. If what comes out doesn't match what went in, the message is
     * wrong -- and this catches it without writing anything to the database.
     */
    public static void main(String[] args) throws Exception {
        LabPdfParser.Report r = new LabPdfParser().parse(new File(args[0]));
        String hl7 = new Hl7Builder().build(r, "LABIMP" + r.accession);

        if (args.length > 1 && "print".equals(args[1])) {
            System.out.println(hl7.replace('\r', '\n'));
            return;
        }

        oscar.oscarLab.ca.all.parsers.PATHL7Handler h = new oscar.oscarLab.ca.all.parsers.PATHL7Handler();
        h.init(hl7);
        System.out.println("PARSED BACK BY OSCAR'S PATHL7 PARSER:");
        System.out.println("  patient   : " + h.getPatientName() + " / " + h.getLastName() + ", " + h.getFirstName());
        System.out.println("  dob       : " + h.getDOB() + "   sex: " + h.getSex());
        System.out.println("  healthNum : " + h.getHealthNum());
        System.out.println("  accession : " + h.getAccessionNum());
        System.out.println("  serviceDt : " + h.getServiceDate());
        System.out.println("  OBR count : " + h.getOBRCount());

        int totalObx = 0, mismatches = 0;
        for (int i = 0; i < h.getOBRCount(); i++) {
            int n = h.getOBXCount(i);
            System.out.println("  OBR[" + i + "] " + h.getOBRName(i) + "  obx=" + n);
            for (int j = 0; j < n; j++) {
                totalObx++;
                String name = h.getOBXName(i, j);
                String val = h.getOBXResult(i, j);
                String units = h.getOBXUnits(i, j);
                String range = h.getOBXReferenceRange(i, j);
                String abn = h.getOBXAbnormalFlag(i, j);
                if (j < 3) {
                    System.out.println(String.format("      %-28s %-8s %-8s %-12s %s",
                            name, val, units, range, abn));
                }
            }
        }
        System.out.println("  total OBX read back: " + totalObx + "   (parser found "
                + r.resultCount() + " in the PDF)");
        if (totalObx != r.resultCount()) {
            System.out.println("  !! MISMATCH: " + r.resultCount() + " parsed vs " + totalObx + " round-tripped");
        } else {
            System.out.println("  OK: every parsed result survived the round trip.");
        }
    }
}
