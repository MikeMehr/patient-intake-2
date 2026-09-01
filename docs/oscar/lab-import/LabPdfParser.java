package mymd.lab;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses a BC lab report PDF into structured results.
 *
 * Two layouts are supported, because the same result arrives in two shapes depending on where it
 * is fetched from:
 *
 *   EXCELLERIS -- the Launchpad report. Columns are
 *       "Test Name(s) | Result | Abn | Reference Range | Units | Date/Time Completed | Status",
 *       sections are all-caps codes (HEMA, CHEM6) on their own line above each table, and every
 *       result row carries its own completion timestamp.
 *
 *   LIFELABS -- the report LifeLabs prints directly. Columns are
 *       "Test | Flag | Result | Reference Range - Units | Test Loc",
 *       sections are mixed-case headings distinguished only by indent, there is no per-row
 *       timestamp (the collection time in the header covers the whole report), and the
 *       identifiers are labelled differently ("PHN:" not "Health #:", "Lab No:" not
 *       "Accession #:").
 *
 * Both are read the same way: rather than guessing with regex where "Result" ends and "Abn"
 * begins -- which breaks immediately on rows that omit a column, e.g. "Colour YELLOW" (no
 * abn/range/units) or "Squamous Epithelial Cells Neg /HPF" (no abn/range) -- this assigns every
 * word to a column by its X coordinate. Column boundaries are derived from the report's own
 * header row, so a layout shift moves the boundaries with it instead of silently misreading
 * values.
 *
 * The same geometry separates the kinds of non-result line, which text alone cannot tell apart:
 * headings sit in the name column, narrative comments are indented into the result column, and
 * page furniture is right-aligned.
 *
 * Nothing here guesses. A row that does not parse cleanly is recorded as a warning for the
 * review screen rather than being dropped or approximated -- a wrong lab value reaching a chart
 * is a patient-safety problem, not a bug.
 */
public class LabPdfParser extends PDFTextStripper {

    // ---------- model ----------

    public static class Result {
        public String testName = "", value = "", abnFlag = "", refRange = "", units = "";
        public String obsDate = "", obsTime = "", status = "", group = "";
        public final List<String> comments = new ArrayList<>();
        public String toString() {
            return String.format("%-30s | %-8s | %-3s | %-12s | %-8s | %s %s | %s",
                    testName, value, abnFlag, refRange, units, obsDate, obsTime, status);
        }
    }

    public static class Section {
        public final String code;
        public final List<Result> results = new ArrayList<>();
        public final List<String> notes = new ArrayList<>();
        public Section(String c) { code = c; }
    }

    public static class Report {
        public String patientName = "", dob = "", sex = "", phn = "";
        public String accession = "", dateOfService = "", reportStatus = "", requestingClient = "";
        /** Excelleris "Client Ref. #" = the requesting practitioner's MSP number, which is what
         *  OSCAR matches against provider.ohip_no to route the lab to an inbox. */
        public String clientRef = "";
        /** Which layout this report was read as -- "EXCELLERIS", "LIFELABS", or "" if neither. */
        public String layout = "";
        /** Everyone the lab copied the report to besides the ordering practitioner, exactly as
         *  printed -- people ("DESANGHERE Ms. NANCY") and clinics ("PRIMARY CARE CENTRE SURREY
         *  URGENT") alike. Shown as "cc:" on OSCAR's lab display via OBR-28. */
        public final List<String> ccDocs = new ArrayList<>();
        public final List<Section> sections = new ArrayList<>();
        public final List<String> warnings = new ArrayList<>();
        public int resultCount() {
            int n = 0;
            for (Section s : sections) n += s.results.size();
            return n;
        }
    }

    // ---------- word/line extraction ----------

    private static class Word {
        final String text; final float x, xEnd, y;
        Word(String t, float x, float xEnd, float y) { this.text = t; this.x = x; this.xEnd = xEnd; this.y = y; }
    }

    private final List<Word> words = new ArrayList<>();

    public LabPdfParser() throws Exception { super(); setSortByPosition(true); }

    @Override
    protected void writeString(String text, List<TextPosition> positions) {
        StringBuilder buf = new StringBuilder();
        float startX = -1, endX = -1, y = 0;
        for (TextPosition p : positions) {
            String c = p.getUnicode();
            if (c == null) continue;
            if (c.trim().isEmpty()) {
                if (buf.length() > 0) { words.add(new Word(buf.toString(), startX, endX, y)); buf.setLength(0); startX = -1; }
                continue;
            }
            if (startX < 0) startX = p.getXDirAdj();
            endX = p.getXDirAdj() + p.getWidthDirAdj();
            y = p.getYDirAdj();
            buf.append(c);
        }
        if (buf.length() > 0) words.add(new Word(buf.toString(), startX, endX, y));
    }

    /** Group words into visual lines by Y, preserving left-to-right order. */
    private List<List<Word>> toLines() {
        List<List<Word>> lines = new ArrayList<>();
        List<Word> cur = new ArrayList<>();
        float curY = Float.NaN;
        for (Word w : words) {
            if (!Float.isNaN(curY) && Math.abs(w.y - curY) >= 2.0f) {
                if (!cur.isEmpty()) lines.add(cur);
                cur = new ArrayList<>();
            }
            curY = w.y;
            cur.add(w);
        }
        if (!cur.isEmpty()) lines.add(cur);
        return lines;
    }

    // ---------- shared helpers ----------

    /**
     * Widest gap that still means "same word".
     *
     * PDFBox splits on its own spacing heuristic, which on these reports breaks the first letter
     * off a heading ("H" + "ematology" -- the two glyphs actually overlap by 0.06pt). Re-joining
     * only fragments whose glyphs are within a point of touching is safe: the narrowest real
     * space measured on either report's smallest font is 1.87pt.
     */
    private static final float GLUE = 1.0f;

    private static String join(List<Word> ws) {
        StringBuilder sb = new StringBuilder();
        Word prev = null;
        for (Word w : ws) {
            if (prev != null && w.x - prev.xEnd >= GLUE) sb.append(' ');
            sb.append(w.text);
            prev = w;
        }
        return sb.toString();
    }

    private static int columnOf(float x, float[] bounds) {
        for (int i = 0; i < bounds.length; i++) if (x < bounds[i]) return i;
        return bounds.length;
    }

    /**
     * Narrowest gap that starts a new cell.
     *
     * Text set inside one cell can run past the next column's boundary -- a comment printed in the
     * Result column, "-This is a laboratory validated assay.", overruns into Reference Range, and
     * assigning each word to the column its own x falls in tore the sentence in half and filed
     * "validated assay." as that test's reference range. What actually separates columns is
     * whitespace: on these reports the widest gap inside a cell is 3.04pt (an ordinary word space)
     * while the narrowest gap between two columns is 20.50pt (Excelleris "Abn" to "Reference
     * Range"). Breaking at 8pt sits clear of both.
     *
     * Erring low is the safe direction. Too low only splits a cell at a wide space, which is what
     * this code did before anyway; too high would swallow a genuine neighbouring column and file a
     * reference range as part of a result.
     */
    private static final float CELL_BREAK = 8.0f;

    /**
     * Split a line into per-column word lists using the given boundaries.
     *
     * Words are grouped into runs of touching text first, and a whole run takes the column its
     * FIRST word starts in, so a run that overruns a boundary stays in one piece.
     */
    private static List<List<Word>> cellsOf(List<Word> line, float[] bounds) {
        List<List<Word>> cells = new ArrayList<>();
        for (int i = 0; i <= bounds.length; i++) cells.add(new ArrayList<Word>());
        int col = 0;
        Word prev = null;
        for (Word w : line) {
            if (prev == null || w.x - prev.xEnd >= CELL_BREAK) col = columnOf(w.x, bounds);
            cells.get(col).add(w);
            prev = w;
        }
        return cells;
    }

    /**
     * Column boundaries from a header row: midpoints between the starts of the given labels, taken
     * in order. Extra header words ("Range", "Loc", "-") are skipped, so a label spelled across
     * several words contributes only its first token.
     */
    private static float[] boundsFrom(List<Word> header, String[] labels) {
        List<Float> starts = new ArrayList<>();
        int k = 0;
        for (Word w : header) {
            if (k < labels.length && w.text.equals(labels[k])) { starts.add(w.x); k++; }
        }
        if (starts.size() != labels.length) return null;
        float[] bounds = new float[labels.length - 1];
        for (int i = 0; i < bounds.length; i++) bounds[i] = (starts.get(i) + starts.get(i + 1)) / 2f;
        return bounds;
    }

    /**
     * Tightest vertical gap that can separate two INDEPENDENT lines.
     *
     * A value too long for its column wraps, and the continuation prints as a line of its own --
     * which used to be filed as a narrative comment, splitting "Mixed flora suggestive of
     * urethral / and/or fecal contamination" so that the half carrying the clinical meaning sat
     * in an annotation the provider could scroll past. A continuation is recognised, and joined
     * back into the value, only when all three of these hold:
     *
     *   1. it is the very next visual line: the measured leading inside a wrapped cell is
     *      11.04pt against 12.48pt between result rows, so 13pt covers it with margin;
     *   2. it starts at the SAME x as the value it continues (wrapping is left-aligned within
     *      the cell), and every word of the line sits in the value column;
     *   3. the line above actually overran its column boundary -- a full line is the only kind
     *      that wraps, so a short value ("90", "Negative") can never claim a continuation, which
     *      is what keeps a genuine interpretive comment under a numeric result out of the value
     *      and the trend graph safe.
     */
    private static final float WRAP_LEADING = 13f;

    /** Pull a labelled field out of the header block, e.g. "Health #: 9690986867". */
    private static String field(String text, String label, String stopAt) {
        int i = text.indexOf(label);
        if (i < 0) return "";
        String rest = text.substring(i + label.length()).trim();
        if (stopAt != null) {
            int j = rest.indexOf(stopAt);
            if (j >= 0) rest = rest.substring(0, j);
        }
        return rest.trim();
    }

    // ---------- entry point ----------

    public Report parse(File pdf) throws Exception {
        Report report = new Report();
        try (PDDocument doc = PDDocument.load(pdf)) {
            getText(doc);
        }
        List<List<Word>> lines = toLines();

        // The table header names the layout outright. A report with no discrete results has no
        // table at all -- a narrative-only cytology report, say -- and is identified instead by
        // how it labels the patient, so its identifiers still reach the review screen.
        boolean excellerisLabels = false, lifeLabsLabels = false;
        for (List<Word> line : lines) {
            if (isExcellerisHeaderRow(line)) { report.layout = "EXCELLERIS"; break; }
            if (isLifeLabsHeaderRow(line))   { report.layout = "LIFELABS";   break; }
            String t = join(line);
            if (t.startsWith("Patient Name:") || t.contains("Health #:")) excellerisLabels = true;
            if (t.startsWith("Patient:") || t.startsWith("Lab No:") || t.startsWith("PHN:")) lifeLabsLabels = true;
        }
        if (report.layout.isEmpty() && excellerisLabels) report.layout = "EXCELLERIS";
        else if (report.layout.isEmpty() && lifeLabsLabels) report.layout = "LIFELABS";

        if ("EXCELLERIS".equals(report.layout))      parseExcelleris(report, lines);
        else if ("LIFELABS".equals(report.layout))   parseLifeLabs(report, lines);
        else report.warnings.add("This PDF does not look like a lab report in either layout this "
                + "importer understands (Excelleris Launchpad or LifeLabs). Nothing was read from it.");

        if (report.phn.isEmpty()) report.warnings.add("No Health # (PHN) found -- cannot match a patient.");
        if (report.dob.isEmpty()) report.warnings.add("No Date of Birth found -- cannot match a patient.");
        if (report.accession.isEmpty()) report.warnings.add("No Accession # found -- cannot guard against duplicate import.");
        if (report.resultCount() == 0) report.warnings.add("No discrete results found in this report.");
        return report;
    }

    // ================================================================
    // Excelleris Launchpad layout
    // ================================================================

    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern TIME = Pattern.compile("^\\d{2}:\\d{2}:\\d{2}$");
    private static final Pattern SECTION_CODE = Pattern.compile("^[A-Z]{3,}[0-9]*$");
    private static final String PERFORMED_AT = "This and the preceding tests were performed at";

    private static final int NAME = 0, VALUE = 1, ABN = 2, RANGE = 3, UNITS = 4, DATETIME = 5, STATUS = 6;
    private static final int NCOLS = 7;
    private static final String[] EX_HEADER_LABELS =
            {"Test", "Result", "Abn", "Reference", "Units", "Date/Time", "Status"};

    private static boolean isExcellerisHeaderRow(List<Word> line) {
        String t = join(line);
        return t.startsWith("Test Name(s)") && t.contains("Result") && t.contains("Abn");
    }

    private static boolean isFurniture(String t) {
        return (t.startsWith("Page ") && t.contains(" of "))
                || t.startsWith("Created by:")
                || t.startsWith("Version:")
                || t.startsWith("Detail Results:")
                || t.equals("END OF REPORT");
    }

    private void parseExcelleris(Report report, List<List<Word>> lines) {
        // --- header block: patient identifiers, before the first table starts ---
        for (List<Word> line : lines) {
            if (isExcellerisHeaderRow(line)) break;
            String t = join(line);
            if (t.startsWith("Patient Name:")) {
                report.patientName = field(t, "Patient Name:", "Home Phone:");
                report.dateOfService = field(t, "Date of Service:", null);
            } else if (t.startsWith("Date of Birth:")) {
                report.dob = field(t, "Date of Birth:", "Work Phone:");
            } else if (t.startsWith("Age:")) {
                report.sex = field(t, "Sex:", "Report Status:");
                report.reportStatus = field(t, "Report Status:", null);
            } else if (t.startsWith("Health #:")) {
                report.phn = field(t, "Health #:", "Patient Location:");
                report.clientRef = field(t, "Client Ref. #:", null);
            } else if (t.contains("Accession #:")) {
                report.accession = field(t, "Accession #:", null);
            } else if (t.startsWith("Requesting Client:")) {
                report.requestingClient = field(t, "Requesting Client:", "cc:");
                // Whoever the report was copied to prints after "cc:" on the same line. Kept
                // verbatim as one entry -- the format inside is the lab's business, and the
                // display field this feeds is free text anyway.
                String cc = field(t, "cc:", "Client:");
                if (cc.isEmpty()) cc = field(t, "cc:", null);
                if (!cc.isEmpty()) report.ccDocs.add(cc);
            }
        }

        // --- table body ---
        float[] bounds = null;
        Section section = null;
        Result lastResult = null;
        List<Word> pendingCode = null;
        String group = "";
        boolean inPerformedAt = false;
        // Geometry of the last filed result's value cell, for wrapped-value detection (see
        // WRAP_LEADING). NaN whenever the previous line was not a result or its continuation.
        float wrapY = Float.NaN, wrapX = Float.NaN, wrapEnd = Float.NaN;

        for (List<Word> line : lines) {
            String text = join(line);
            if (text.isEmpty() || isFurniture(text)) { pendingCode = null; continue; }

            // The patient name repeats at the top of every page, right-aligned.
            if (!report.patientName.isEmpty() && text.equals(report.patientName)) { pendingCode = null; continue; }

            if (isExcellerisHeaderRow(line)) {
                if (bounds == null) {
                    bounds = boundsFrom(line, EX_HEADER_LABELS);
                    if (bounds == null) {
                        report.warnings.add("Could not read the table header layout; the report "
                                + "format may have changed. Line: " + text);
                    }
                }
                // A lone token on the preceding line is this table's section code.
                if (pendingCode != null) {
                    String code = pendingCode.get(0).text;
                    if (section == null || !section.code.equals(code)) {
                        section = new Section(code);
                        report.sections.add(section);
                        // Only a genuinely new section breaks the comment chain. The same code
                        // repeating is just a page continuation, whose narrative still belongs
                        // to the result above it.
                        lastResult = null;
                        group = "";
                    }
                }
                pendingCode = null;
                inPerformedAt = false;
                continue;
            }

            // A single all-caps token is a section code only if a table header follows it.
            if (line.size() == 1 && SECTION_CODE.matcher(line.get(0).text).matches()) {
                pendingCode = line;
                continue;
            }
            pendingCode = null;

            if (bounds == null) continue; // nothing parseable before the first header row

            List<List<Word>> cells = cellsOf(line, bounds);

            // A result row is identified by a real date in the datetime column. Narrative text
            // never has one, which is what separates the two reliably.
            String[] dt = join(cells.get(DATETIME)).split("\\s+");
            if (dt.length > 0 && DATE.matcher(dt[0]).matches()) {
                if (section == null) { section = new Section("UNKNOWN"); report.sections.add(section); }
                Result r = new Result();
                r.testName = join(cells.get(NAME));
                r.value    = join(cells.get(VALUE));
                r.abnFlag  = join(cells.get(ABN));
                r.refRange = join(cells.get(RANGE));
                r.units    = join(cells.get(UNITS));
                r.obsDate  = dt[0];
                r.obsTime  = dt.length > 1 && TIME.matcher(dt[1]).matches() ? dt[1] : "";
                r.status   = join(cells.get(STATUS));
                r.group    = group;

                wrapY = Float.NaN;
                if (r.testName.isEmpty()) {
                    report.warnings.add("Row has a date but no test name, skipped: " + text);
                } else if (r.value.isEmpty()) {
                    report.warnings.add("Test '" + r.testName + "' has no result value: " + text);
                } else {
                    section.results.add(r);
                    lastResult = r;
                    List<Word> vc = cells.get(VALUE);
                    wrapY = line.get(0).y; wrapX = vc.get(0).x; wrapEnd = vc.get(vc.size() - 1).xEnd;
                }
                inPerformedAt = false;
                continue;
            }

            // Sub-panel heading ("Hematology Panel", "Electrolytes", "Creatinine/eGFR"):
            // occupies the name column only.
            boolean nameColumnOnly = !cells.get(NAME).isEmpty();
            for (int i = VALUE; i <= STATUS && nameColumnOnly; i++) {
                if (!cells.get(i).isEmpty()) nameColumnOnly = false;
            }
            if (nameColumnOnly) { group = text; inPerformedAt = false; wrapY = Float.NaN; continue; }

            // Performing-lab footer, which wraps onto a second line. It belongs to the section,
            // not to whichever result happened to come last.
            if (text.startsWith(PERFORMED_AT)) inPerformedAt = true;
            if (inPerformedAt) {
                if (section != null) section.notes.add(text);
                wrapY = Float.NaN;
                continue;
            }

            // The wrapped remainder of the value above rejoins it (see WRAP_LEADING); anything
            // else in this position is narrative indented under the result column.
            List<Word> vc = cells.get(VALUE);
            if (lastResult != null && !Float.isNaN(wrapY)
                    && vc.size() == line.size()
                    && line.get(0).y - wrapY > 0f && line.get(0).y - wrapY <= WRAP_LEADING
                    && Math.abs(vc.get(0).x - wrapX) <= 1.5f
                    && wrapEnd >= bounds[VALUE]) {
                lastResult.value += " " + text;
                wrapY = line.get(0).y; wrapEnd = vc.get(vc.size() - 1).xEnd;
                continue;
            }
            wrapY = Float.NaN;
            if (lastResult != null) lastResult.comments.add(text);
            else if (section != null) section.notes.add(text);
            else report.warnings.add("Text before any section, ignored: " + text);
        }
    }

    // ================================================================
    // LifeLabs layout
    // ================================================================

    private static final int LL_NAME = 0, LL_FLAG = 1, LL_VALUE = 2, LL_RANGE = 3, LL_UNITS = 4, LL_LOC = 5;
    private static final String[] LL_HEADER_LABELS =
            {"Test", "Flag", "Result", "Reference", "Units", "Test"};

    /**
     * Header-block labels, longest first so "Patient's Phone:" is not mistaken for "Patient:".
     * Every value in the block runs from its label to the start of the next one, which is what
     * makes fields sharing a line ("PHN: 9809250242 BC   Collected on: Aug 10 2026 16:43")
     * separable without hard-coding which pairs sit together.
     */
    private static final String[] LL_LABELS = {
            "Patient's Phone:", "Date of Birth:", "Collected on:", "Reported by:", "Reported on:",
            "Reported to:", "Requisition #:", "Requisition:", "Patient ID:", "Printed for:",
            "Printed on:", "Ordered by:", "Telephone:", "Toll Free:", "Copy to:", "Patient:",
            "Lab No:", "Sex:", "PHN:", "Age:", "Fax:"
    };
    /** Not fields, but they still end the value before them. */
    private static final String[] LL_STOPS = { "Page" };

    private static final Pattern LL_MONTH_DATE = Pattern.compile(
            "([A-Z][a-z]{2})\\s+(\\d{1,2}),?\\s+(\\d{4})(?:\\s+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?");
    private static final String MONTHS = "JanFebMarAprMayJunJulAugSepOctNovDec";
    /** "FINAL RESULTS" / "PRELIMINARY RESULTS" -- the whole-report status, printed under the table. */
    private static final Pattern LL_STATUS_LINE = Pattern.compile(
            "^(FINAL|PRELIMINARY|PARTIAL|INTERIM|CORRECTED|AMENDED)\\s+RESULTS?$");
    /** "BRL: Burnaby Reference Laboratory, ..." -- the performing-lab legend for a Test Loc code. */
    private static final Pattern LL_LEGEND = Pattern.compile("^([A-Z]{2,6}):\\s\\S.*");

    private static boolean isLifeLabsHeaderRow(List<Word> line) {
        String t = join(line);
        return t.startsWith("Test ") && t.contains("Flag") && t.contains("Result")
                && t.contains("Reference") && t.contains("Units");
    }

    /**
     * True for a line of the patient/ordering block that tops every page.
     *
     * Anchored on the label starting the line AND on the line starting in a margin column, so a
     * narrative comment that happens to begin "Telephone: ..." -- indented into the result column
     * -- cannot end the table early and silently truncate the report.
     */
    private static boolean isLifeLabsBlockLine(List<Word> line, String text) {
        float x = line.get(0).x;
        if (x >= 200f && x <= 380f) return false;
        for (String lab : LL_LABELS) if (text.startsWith(lab)) return true;
        return false;
    }

    /** Every label position in a line, keyed by index, longest label winning at a tie. */
    private static TreeMap<Integer, String> labelPositions(String t) {
        TreeMap<Integer, String> at = new TreeMap<>();
        for (String[] set : new String[][] { LL_LABELS, LL_STOPS }) {
            for (String lab : set) {
                int i = 0;
                while ((i = t.indexOf(lab, i)) >= 0) {
                    String cur = at.get(i);
                    if (cur == null || cur.length() < lab.length()) at.put(i, lab);
                    i++;
                }
            }
        }
        return at;
    }

    /** Read every labelled field on a header-block line. The first page's values win. */
    private static void harvest(String text, Map<String, String> out) {
        TreeMap<Integer, String> at = labelPositions(text);
        List<Integer> keys = new ArrayList<>(at.keySet());
        for (int k = 0; k < keys.size(); k++) {
            int i = keys.get(k);
            String label = at.get(i);
            int from = i + label.length();
            int to = k + 1 < keys.size() ? keys.get(k + 1) : text.length();
            if (from > to) continue;
            String value = text.substring(from, to).trim();
            if (!value.isEmpty() && !out.containsKey(label)) out.put(label, value);
        }
    }

    /** "Dec 04 1977" -> {"1977-12-04", ""}; "Aug 10 2026 16:43" -> {"2026-08-10", "16:43:00"}. */
    private static String[] llDateTime(String s) {
        if (s == null) return new String[] { "", "" };
        Matcher m = LL_MONTH_DATE.matcher(s);
        if (!m.find()) return new String[] { "", "" };
        int mi = MONTHS.indexOf(m.group(1));
        if (mi < 0) return new String[] { "", "" };
        String date = String.format("%s-%02d-%02d", m.group(3), mi / 3 + 1, Integer.parseInt(m.group(2)));
        String time = m.group(4) == null ? ""
                : String.format("%02d:%s:%s", Integer.parseInt(m.group(4)), m.group(5),
                        m.group(6) == null ? "00" : m.group(6));
        return new String[] { date, time };
    }

    /** What a line inside the LifeLabs table is. Geometry decides; text alone cannot. */
    private static final int L_SKIP = 0, L_RESULT = 1, L_HEADING = 2, L_NARRATIVE = 3,
                             L_LEGEND_NOTE = 4, L_STATUS = 5, L_ORPHAN = 6;

    private static int classify(List<List<Word>> cells, String text) {
        boolean hasName = !cells.get(LL_NAME).isEmpty();
        boolean hasValue = !cells.get(LL_VALUE).isEmpty();
        if (hasName && hasValue) return L_RESULT;
        // Nothing in the name column: either narrative indented under the results, or a bare
        // Test Loc code ("BRL") sitting off to the right.
        if (!hasName) return hasValue ? L_NARRATIVE : L_SKIP;
        if (LL_STATUS_LINE.matcher(text).matches()) return L_STATUS;
        // "BRL: Burnaby Reference Laboratory, ..." -- a performing-lab legend, not a section. No
        // section heading on these reports carries a colon.
        if (LL_LEGEND.matcher(text).matches()) return L_LEGEND_NOTE;
        // A named row with a range or units but no value is a result we failed to read, not a
        // heading. Saying so beats silently dropping it.
        if (!cells.get(LL_RANGE).isEmpty() || !cells.get(LL_UNITS).isEmpty()) return L_ORPHAN;
        return L_HEADING;
    }

    private void parseLifeLabs(Report report, List<List<Word>> lines) {
        Map<String, String> f = new LinkedHashMap<>();
        float[] bounds = null;

        // --- pass 1: header fields, column geometry, and how far a section heading is indented ---
        // Sub-panels ("Differential") are set in from their section ("Hematology") by nothing but
        // whitespace, so the outermost heading indent on the page is what tells the two apart.
        float sectionIndent = Float.MAX_VALUE;
        boolean inTable = false;
        // The cc list ("Reported to:", "Copy to:") is the one header value long enough to wrap,
        // and its continuation prints as a bare line with no label of its own -- "DESANGHERE Ms.
        // NANCY, MEHRAEIN Dr. MANUCHER, PRIMARY" / "CARE CENTRE SURREY URGENT". A bare line is
        // rejoined to the value above only when it starts at the SAME x the value did (wrapping
        // is left-aligned under the value, well clear of the label margin) and follows it
        // immediately; anything else clears the expectation.
        String contLabel = null;
        float contX = Float.NaN;
        for (List<Word> line : lines) {
            String text = join(line);
            if (text.isEmpty()) continue;
            if (isLifeLabsHeaderRow(line)) {
                contLabel = null;
                if (bounds == null) {
                    bounds = boundsFrom(line, LL_HEADER_LABELS);
                    if (bounds == null) {
                        report.warnings.add("Could not read the table header layout; the report "
                                + "format may have changed. Line: " + text);
                        break;
                    }
                }
                inTable = true;
                continue;
            }
            if (isLifeLabsBlockLine(line, text)) {
                contLabel = null;
                for (String lab : new String[] { "Reported to:", "Copy to:" }) {
                    if (!text.startsWith(lab) || f.containsKey(lab)) continue;
                    // First word of the value = first word past the label's own tokens.
                    int consumed = 0, len = 0;
                    for (Word w : line) {
                        len += (len > 0 ? 1 : 0) + w.text.length();
                        consumed++;
                        if (len >= lab.length()) break;
                    }
                    if (consumed < line.size()) { contLabel = lab; contX = line.get(consumed).x; }
                }
                harvest(text, f);
                if (contLabel != null && !f.containsKey(contLabel)) contLabel = null;
                inTable = false;
                continue;
            }
            if (contLabel != null && !inTable && Math.abs(line.get(0).x - contX) <= 2f) {
                f.put(contLabel, f.get(contLabel) + " " + text);
                continue;
            }
            contLabel = null;
            if (!inTable || bounds == null) continue;

            List<List<Word>> cells = cellsOf(line, bounds);
            if (classify(cells, text) == L_HEADING) {
                sectionIndent = Math.min(sectionIndent, cells.get(LL_NAME).get(0).x);
            }
        }

        // --- identifiers ---
        report.patientName = nz(f.get("Patient:"));
        report.accession   = nz(f.get("Lab No:"));
        report.sex         = nz(f.get("Sex:"));
        // "9809250242 BC" -- the province suffix is not part of the number OSCAR matches on.
        report.phn         = nz(f.get("PHN:")).replaceAll("\\s+[A-Za-z]{2}$", "").replaceAll("[^0-9A-Za-z]", "");
        report.dob         = llDateTime(nz(f.get("Date of Birth:")))[0];

        String[] collected = llDateTime(nz(f.get("Collected on:")));
        if (!collected[0].isEmpty()) {
            report.dateOfService = collected[0] + " " + (collected[1].isEmpty() ? "00:00:00" : collected[1]);
        } else {
            report.warnings.add("No collection date found -- the result will be dated by the lab's report date instead.");
            String[] reported = llDateTime(nz(f.get("Reported on:")));
            if (!reported[0].isEmpty()) {
                report.dateOfService = reported[0] + " " + (reported[1].isEmpty() ? "00:00:00" : reported[1]);
                collected = reported;
            }
        }
        if (!nz(f.get("Date of Birth:")).isEmpty() && report.dob.isEmpty()) {
            report.warnings.add("Could not read the date of birth '" + f.get("Date of Birth:") + "'.");
        }

        // --- ordering practitioner, and the MSP number the lab is routed by ---
        // The MSP number is not printed as such: it is embedded in the Excelleris practitioner ID
        // on the "Printed for:" line (MEH67199M -> 67199, matched against provider.ohip_no). That
        // line says who printed the report, so it is only safe to route by when it names the same
        // practitioner the report was ordered by.
        String orderedBy = nz(f.get("Ordered by:"));
        if (orderedBy.isEmpty()) orderedBy = nz(f.get("Reported to:"));
        report.requestingClient = llProviderName(orderedBy);

        // Everyone else the lab reported or copied the result to is the cc list. The ordering
        // practitioner appears in "Reported to:" as well, and repeating them there would only
        // clutter the display's cc field.
        for (String key : new String[] { "Reported to:", "Copy to:" }) {
            for (String entry : nz(f.get(key)).split(",")) {
                entry = entry.trim().replaceAll("\\s+", " ");
                if (entry.isEmpty() || entry.equalsIgnoreCase(orderedBy.trim().replaceAll("\\s+", " "))) continue;
                if (!report.ccDocs.contains(entry)) report.ccDocs.add(entry);
            }
        }

        String printedFor = nz(f.get("Printed for:"));
        int bar = printedFor.indexOf('|');
        String printedId = bar >= 0 ? printedFor.substring(0, bar).trim() : "";
        String printedName = bar >= 0 ? printedFor.substring(bar + 1).trim() : "";
        Matcher pid = Pattern.compile("^[A-Za-z]{2,4}(\\d{4,6})[A-Za-z]?$").matcher(printedId);
        if (pid.matches() && !orderedBy.isEmpty() && printedName.equalsIgnoreCase(orderedBy)) {
            report.clientRef = pid.group(1);
        } else {
            report.warnings.add("Could not read the ordering practitioner's MSP number from this "
                    + "report. It will import into the chart, but it will not appear in anyone's "
                    + "lab inbox for acknowledgement.");
        }

        if (bounds == null) return; // no readable table; the identifiers above are still worth showing

        // --- pass 2: the table ---
        Section section = null;
        Result lastResult = null;
        String group = "";
        String reportStatus = "";
        inTable = false;
        // Geometry of the last filed result's value cell, for wrapped-value detection (see
        // WRAP_LEADING). NaN whenever the previous line was not a result or its continuation.
        float wrapY = Float.NaN, wrapX = Float.NaN, wrapEnd = Float.NaN;

        for (List<Word> line : lines) {
            String text = join(line);
            if (text.isEmpty()) continue;
            if (isLifeLabsHeaderRow(line)) { inTable = true; continue; }
            if (isLifeLabsBlockLine(line, text)) { inTable = false; continue; }
            if (!inTable) continue;

            List<List<Word>> cells = cellsOf(line, bounds);
            switch (classify(cells, text)) {
                case L_RESULT: {
                    if (section == null) { section = new Section("UNKNOWN"); report.sections.add(section); }
                    Result r = new Result();
                    r.testName = join(cells.get(LL_NAME));
                    r.value    = join(cells.get(LL_VALUE));
                    r.abnFlag  = join(cells.get(LL_FLAG));
                    r.refRange = join(cells.get(LL_RANGE));
                    r.units    = join(cells.get(LL_UNITS));
                    // No per-row timestamp on this layout: every result on the report comes off
                    // the one collection, which is the date a trend should plot against anyway.
                    r.obsDate  = collected[0];
                    r.obsTime  = collected[1];
                    r.group    = group;
                    section.results.add(r);
                    lastResult = r;
                    List<Word> vc = cells.get(LL_VALUE);
                    wrapY = line.get(0).y; wrapX = vc.get(0).x; wrapEnd = vc.get(vc.size() - 1).xEnd;
                    break;
                }
                case L_HEADING: {
                    float x = cells.get(LL_NAME).get(0).x;
                    if (x <= sectionIndent + 6f) {
                        section = new Section(text);
                        report.sections.add(section);
                        lastResult = null;
                        group = "";
                    } else {
                        group = text;
                    }
                    wrapY = Float.NaN;
                    break;
                }
                case L_STATUS:
                    reportStatus = text;
                    wrapY = Float.NaN;
                    break;
                case L_LEGEND_NOTE:
                    if (section != null) section.notes.add(text);
                    wrapY = Float.NaN;
                    break;
                case L_NARRATIVE: {
                    // The wrapped remainder of the value above rejoins it (see WRAP_LEADING);
                    // anything else here is a genuine narrative comment.
                    List<Word> vc = cells.get(LL_VALUE);
                    if (lastResult != null && !Float.isNaN(wrapY)
                            && vc.size() == line.size()
                            && line.get(0).y - wrapY > 0f && line.get(0).y - wrapY <= WRAP_LEADING
                            && Math.abs(vc.get(0).x - wrapX) <= 1.5f
                            && wrapEnd >= bounds[LL_VALUE]) {
                        lastResult.value += " " + text;
                        wrapY = line.get(0).y; wrapEnd = vc.get(vc.size() - 1).xEnd;
                        break;
                    }
                    wrapY = Float.NaN;
                    if (lastResult != null) lastResult.comments.add(text);
                    else if (section != null) section.notes.add(text);
                    break;
                }
                case L_ORPHAN:
                    report.warnings.add("Test '" + join(cells.get(LL_NAME))
                            + "' has no result value: " + text);
                    wrapY = Float.NaN;
                    break;
                default:
                    break;
            }
        }

        report.reportStatus = reportStatus;
        String code = hl7Status(reportStatus);
        for (Section s : report.sections) for (Result r : s.results) r.status = code;
        if (!"F".equals(code)) {
            report.warnings.add("This report is marked '" + (reportStatus.isEmpty() ? "(no status printed)" : reportStatus)
                    + "', not final. The values will be filed as such and may be revised by the lab.");
        }
    }

    /** "MEHRAEIN Dr. MANUCHER" -> "MANUCHER MEHRAEIN", matching how the Excelleris report prints it. */
    private static String llProviderName(String s) {
        String n = nz(s).trim().replaceAll("\\s+", " ");
        Matcher m = Pattern.compile("^(\\S+)\\s+(?:Dr\\.?|Mr\\.?|Mrs\\.?|Ms\\.?)\\s+(.+)$").matcher(n);
        return m.matches() ? m.group(2) + " " + m.group(1) : n;
    }

    private static String hl7Status(String printed) {
        String t = nz(printed).toUpperCase();
        if (t.startsWith("FINAL")) return "F";
        if (t.startsWith("CORRECTED") || t.startsWith("AMENDED")) return "C";
        if (t.startsWith("PRELIMINARY") || t.startsWith("PARTIAL") || t.startsWith("INTERIM")) return "P";
        return "";
    }

    private static String nz(String s) { return s == null ? "" : s; }

    // ---------- debug ----------

    public static void main(String[] args) throws Exception {
        Report r = new LabPdfParser().parse(new File(args[0]));
        System.out.println("Layout    : " + r.layout);
        System.out.println("Patient   : " + r.patientName + "  DOB=" + r.dob + "  Sex=" + r.sex + "  PHN=" + r.phn);
        System.out.println("Accession : " + r.accession + "   Service=" + r.dateOfService + "   Status=" + r.reportStatus);
        System.out.println("Requesting: " + r.requestingClient + "   MSP=" + r.clientRef);
        System.out.println("cc        : " + String.join(" | ", r.ccDocs));
        System.out.println("Results   : " + r.resultCount() + " in " + r.sections.size() + " sections");
        for (Section s : r.sections) {
            System.out.println("\n== " + s.code + " ==");
            String g = "";
            for (Result res : s.results) {
                if (!res.group.equals(g)) { g = res.group; System.out.println("  [" + g + "]"); }
                System.out.println("  " + res);
                for (String c : res.comments) System.out.println("        # " + c);
            }
            for (String n : s.notes) System.out.println("  (note) " + n);
        }
        if (!r.warnings.isEmpty()) {
            System.out.println("\n!! WARNINGS (" + r.warnings.size() + ")");
            for (String w : r.warnings) System.out.println("  - " + w);
        }
    }
}
