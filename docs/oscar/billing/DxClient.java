package mymd.billing;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Asks the Health Assist app for a diagnostic code.
 *
 * Outbound only — OSCAR calls the app, not the reverse. That is the whole reason this direction was
 * chosen: nginx's client-certificate gate gets in the way of anything reaching *into* this box (the
 * pharmacy bridge needed an exemption for exactly that), while outbound HTTPS needs nothing.
 *
 * The payload carries the redacted note text, the permitted codes, and OSCAR's internal
 * demographic number. It carries no name, no health card, no date of birth and no appointment
 * time. See /api/emr/oscar/billing-dx for the other side.
 *
 * Every failure here is soft. A refused secret, a timeout, HIPAA_MODE being on in the app — all of
 * them return null, the row becomes one the physician codes by hand, and the sweep carries on.
 * A billing tool that stops working because a model is unavailable is worse than one that asks.
 */
public class DxClient {

    private static final String PATH = "/api/emr/oscar/billing-dx";
    private static final String SECRET_HEADER = "X-MyMD-Billing-Secret";

    /** The physician is watching the sweep run, so these are deliberately tight. */
    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 20000;

    public static class Suggestion {
        public final String code;
        public final String confidence;
        public final String evidence;
        public Suggestion(String code, String confidence, String evidence) {
            this.code = code;
            this.confidence = confidence;
            this.evidence = evidence;
        }
    }

    private final Config cfg;

    public DxClient(Config cfg) {
        this.cfg = cfg;
    }

    /** Returns null whenever a code cannot be obtained, for any reason. */
    public Suggestion suggest(String runId, BillingCandidate bc, List<DayBilling.DxOption> options) {
        if (cfg == null || !cfg.aiEnabled() || options == null || options.isEmpty()) return null;
        if (bc.noteText == null || bc.noteText.trim().isEmpty()) return null;

        HttpURLConnection conn = null;
        try {
            StringBuilder body = new StringBuilder();
            body.append("{\"runId\":").append(json(runId))
                .append(",\"caseRef\":").append(json("appt-" + bc.appointmentNo))
                .append(",\"demographicNo\":").append(bc.demographicNo)
                .append(",\"providerNo\":").append(json(bc.providerNo))
                .append(",\"noteText\":").append(json(bc.noteText))
                .append(",\"candidates\":[");
            for (int i = 0; i < options.size(); i++) {
                DayBilling.DxOption o = options.get(i);
                if (i > 0) body.append(',');
                body.append("{\"code\":").append(json(o.code))
                    .append(",\"description\":").append(json(o.description)).append('}');
            }
            body.append("]}");

            conn = (HttpURLConnection) new URL(cfg.appUrl + PATH).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty(SECRET_HEADER, cfg.secret);

            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream os = conn.getOutputStream();
            os.write(payload);
            os.close();

            int status = conn.getResponseCode();
            if (status != 200) {
                // 503 is the app's HIPAA_MODE kill switch. Not an error here — just no suggestion.
                System.err.println("[mymd.billing] dx suggest HTTP " + status
                        + " for appt " + bc.appointmentNo);
                return null;
            }

            String text = read(conn.getInputStream());
            String code = extract(text, "code");
            if (code == null || code.isEmpty() || "NONE".equals(code)) return null;
            return new Suggestion(code,
                    nz(extract(text, "confidence")),
                    nz(extract(text, "evidence")));
        } catch (Exception e) {
            // Never let a network problem take the sweep down.
            System.err.println("[mymd.billing] dx suggest failed for appt " + bc.appointmentNo
                    + ": " + e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    /**
     * Pull one string field out of the response.
     *
     * A hand-rolled reader rather than a JSON library because the response shape is fixed and
     * tiny — {code, confidence, evidence} — and adding a parser dependency to a class that is
     * hand-compiled onto the box is a cost with no matching benefit. It handles the escapes the
     * app can actually emit; anything it cannot read comes back null and the row goes manual.
     */
    static String extract(String jsonText, String field) {
        if (jsonText == null) return null;
        String key = "\"" + field + "\"";
        int k = jsonText.indexOf(key);
        if (k < 0) return null;
        int colon = jsonText.indexOf(':', k + key.length());
        if (colon < 0) return null;
        int i = colon + 1;
        while (i < jsonText.length() && Character.isWhitespace(jsonText.charAt(i))) i++;
        if (i >= jsonText.length() || jsonText.charAt(i) != '"') return null;
        i++;
        StringBuilder sb = new StringBuilder();
        while (i < jsonText.length()) {
            char ch = jsonText.charAt(i);
            if (ch == '\\' && i + 1 < jsonText.length()) {
                char esc = jsonText.charAt(++i);
                switch (esc) {
                    case 'n': sb.append('\n'); break;
                    case 't': sb.append('\t'); break;
                    case 'r': sb.append('\r'); break;
                    case 'u':
                        if (i + 4 < jsonText.length()) {
                            sb.append((char) Integer.parseInt(jsonText.substring(i + 1, i + 5), 16));
                            i += 4;
                        }
                        break;
                    default: sb.append(esc);
                }
            } else if (ch == '"') {
                return sb.toString();
            } else {
                sb.append(ch);
            }
            i++;
        }
        return null;
    }

    /** Minimal JSON string encoder — enough for note text and codes. */
    static String json(String s) {
        if (s == null) return "\"\"";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (ch < 0x20) sb.append(String.format("\\u%04x", (int) ch));
                    else sb.append(ch);
            }
        }
        return sb.append('"').toString();
    }

    private static String nz(String s) { return s == null ? "" : s; }
}
