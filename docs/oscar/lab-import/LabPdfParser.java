package mymd.lab;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Parses a BC/LifeLabs lab report PDF into structured results.
 *
 * The report is a table with left-aligned data columns. Rather than guessing with regex where
 * "Result" ends and "Abn" begins -- which breaks immediately on rows that omit a column, e.g.
 * "Colour YELLOW" (no abn/range/units) or "Squamous Epithelial Cells Neg /HPF" (no abn/range) --
 * this assigns every word to a column by its X coordinate. Column boundaries are derived from
 * the report's own header row ("Test Name(s) Result Abn Reference Range Units Date/Time
 * Completed Status"), so a layout shift moves the boundaries with it instead of silently
 * misreading values.
 *
 * The same geometry separates the three kinds of non-result line, which text alone cannot tell
 * apart: sub-panel headings sit in the name column, narrative comments are indented into the
 * result column, and the repeated patient name at each page break is right-aligned.
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
        final String text; final float x, y;
        Word(String t, float x, float y) { this.text = t; this.x = x; this.y = y; }
    }

    private final List<Word> words = new ArrayList<>();

    public LabPdfParser() throws Exception { super(); setSortByPosition(true); }

    @Override
    protected void writeString(String text, List<TextPosition> positions) {
        StringBuilder buf = new StringBuilder();
        float startX = -1, y = 0;
        for (TextPosition p : positions) {
            String c = p.getUnicode();
            if (c == null) continue;
            if (c.trim().isEmpty()) {
                if (buf.length() > 0) { words.add(new Word(buf.toString(), startX, y)); buf.setLength(0); startX = -1; }
                continue;
            }
            if (startX < 0) startX = p.getXDirAdj();
            y = p.getYDirAdj();
            buf.append(c);
        }
        if (buf.length() > 0) words.add(new Word(buf.toString(), startX, y));
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

    // ---------- parsing ----------

    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern TIME = Pattern.compile("^\\d{2}:\\d{2}:\\d{2}$");
    private static final Pattern SECTION_CODE = Pattern.compile("^[A-Z]{3,}[0-9]*$");
    private static final String PERFORMED_AT = "This and the preceding tests were performed at";

    private static final int NAME = 0, VALUE = 1, ABN = 2, RANGE = 3, UNITS = 4, DATETIME = 5, STATUS = 6;
    private static final int NCOLS = 7;

    private float[] bounds;

    private static String join(List<Word> ws) {
        StringBuilder sb = new StringBuilder();
        for (Word w : ws) { if (sb.length() > 0) sb.append(' '); sb.append(w.text); }
        return sb.toString();
    }

    /**
     * Derive column boundaries from the header row: midpoints between adjacent header label
     * starts. Data is left-aligned and sits slightly left of its label, which these midpoints
     * accommodate.
     */
    private boolean calibrate(List<Word> header) {
        List<Float> starts = new ArrayList<>();
        for (Word w : header) {
            String t = w.text;
            // One entry per logical label; "Test Name(s)", "Reference Range" and
            // "Date/Time Completed" are multi-word, so only their first token counts.
            if (t.equals("Test") || t.equals("Result") || t.equals("Abn") || t.equals("Reference")
                    || t.equals("Units") || t.equals("Date/Time") || t.equals("Status")) {
                starts.add(w.x);
            }
        }
        if (starts.size() != NCOLS) return false;
        bounds = new float[NCOLS - 1];
        for (int i = 0; i < bounds.length; i++) bounds[i] = (starts.get(i) + starts.get(i + 1)) / 2f;
        return true;
    }

    private int columnOf(float x) {
        for (int i = 0; i < bounds.length; i++) if (x < bounds[i]) return i;
        return NCOLS - 1;
    }

    private static boolean isHeaderRow(List<Word> line) {
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

    public Report parse(File pdf) throws Exception {
        Report report = new Report();
        try (PDDocument doc = PDDocument.load(pdf)) {
            getText(doc);
        }
        List<List<Word>> lines = toLines();

        // --- header block: patient identifiers, before the first table starts ---
        for (List<Word> line : lines) {
            if (isHeaderRow(line)) break;
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
            } else if (t.contains("Accession #:")) {
                report.accession = field(t, "Accession #:", null);
            } else if (t.startsWith("Requesting Client:")) {
                report.requestingClient = field(t, "Requesting Client:", "cc:");
            }
        }

        // --- table body ---
        Section section = null;
        Result lastResult = null;
        List<Word> pendingCode = null;
        String group = "";
        boolean inPerformedAt = false;

        for (List<Word> line : lines) {
            String text = join(line);
            if (text.isEmpty() || isFurniture(text)) { pendingCode = null; continue; }

            // The patient name repeats at the top of every page, right-aligned.
            if (!report.patientName.isEmpty() && text.equals(report.patientName)) { pendingCode = null; continue; }

            if (isHeaderRow(line)) {
                if (bounds == null && !calibrate(line)) {
                    report.warnings.add("Could not read the table header layout; the report "
                            + "format may have changed. Line: " + text);
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

            List<List<Word>> cells = new ArrayList<>();
            for (int i = 0; i < NCOLS; i++) cells.add(new ArrayList<Word>());
            for (Word w : line) cells.get(columnOf(w.x)).add(w);

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

                if (r.testName.isEmpty()) {
                    report.warnings.add("Row has a date but no test name, skipped: " + text);
                } else if (r.value.isEmpty()) {
                    report.warnings.add("Test '" + r.testName + "' has no result value: " + text);
                } else {
                    section.results.add(r);
                    lastResult = r;
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
            if (nameColumnOnly) { group = text; inPerformedAt = false; continue; }

            // Performing-lab footer, which wraps onto a second line. It belongs to the section,
            // not to whichever result happened to come last.
            if (text.startsWith(PERFORMED_AT)) inPerformedAt = true;
            if (inPerformedAt) {
                if (section != null) section.notes.add(text);
                continue;
            }

            // Otherwise: narrative indented under the result column.
            if (lastResult != null) lastResult.comments.add(text);
            else if (section != null) section.notes.add(text);
            else report.warnings.add("Text before any section, ignored: " + text);
        }

        if (report.phn.isEmpty()) report.warnings.add("No Health # (PHN) found -- cannot match a patient.");
        if (report.dob.isEmpty()) report.warnings.add("No Date of Birth found -- cannot match a patient.");
        if (report.accession.isEmpty()) report.warnings.add("No Accession # found -- cannot guard against duplicate import.");
        if (report.resultCount() == 0) report.warnings.add("No discrete results found in this report.");
        return report;
    }

    // ---------- debug ----------

    public static void main(String[] args) throws Exception {
        Report r = new LabPdfParser().parse(new File(args[0]));
        System.out.println("Patient   : " + r.patientName + "  DOB=" + r.dob + "  Sex=" + r.sex + "  PHN=" + r.phn);
        System.out.println("Accession : " + r.accession + "   Service=" + r.dateOfService + "   Status=" + r.reportStatus);
        System.out.println("Requesting: " + r.requestingClient);
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
