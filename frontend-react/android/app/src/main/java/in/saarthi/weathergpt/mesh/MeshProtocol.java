package in.saarthi.weathergpt.mesh;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The mesh wire format and its rules. No Android imports, so it runs in plain
 * JVM unit tests.
 *
 * A message is one JSON object:
 *   {"v":1,"t":type,"id":16hex,"o":nodeId,"k":pubkeyB64,"ts":epochSec,
 *    "exp":epochSec,"h":hops,"hl":hopLimit (0 = unlimited),"p":payloadJson,"s":sigB64}
 * The origin signs v|t|id|o|ts|exp|hl|p with ECDSA P-256 (SHA-256, DER). The
 * hop count "h" is the only field relays change, so it is left out of the
 * signature. The node id is the first 8 bytes of sha256(public key), so nobody
 * can send under someone else's id.
 */
public final class MeshProtocol {
    private MeshProtocol() {}

    public static final int VERSION = 1;
    public static final int MAX_MESSAGE_BYTES = 1500;
    public static final int MAX_NOTE_CHARS = 140;
    /** Clock skew we tolerate between phones (phones without network drift). */
    public static final long MAX_FUTURE_SEC = 15 * 60;

    public static final String SOS = "sos";
    public static final String SOS_UPDATE = "sos_upd";
    public static final String SAFE = "safe";
    public static final String REPORT = "report";
    public static final String ALERT = "alert";

    /** Per-type rules: hop limit (0 = until it expires), lifetime, min gap per origin. */
    public static final class Rule {
        public final int hopLimit;
        public final long ttlSec;
        public final long minGapSec;
        public final int priority; // lower = sent first when syncing

        Rule(int hopLimit, long ttlSec, long minGapSec, int priority) {
            this.hopLimit = hopLimit;
            this.ttlSec = ttlSec;
            this.minGapSec = minGapSec;
            this.priority = priority;
        }
    }

    private static final Map<String, Rule> RULES = new HashMap<>();
    static {
        // An SOS travels to every phone it can reach, for 72 hours.
        RULES.put(SOS, new Rule(0, 72 * 3600, 60, 0));
        RULES.put(SOS_UPDATE, new Rule(0, 72 * 3600, 5, 1));
        RULES.put(ALERT, new Rule(0, 48 * 3600, 0, 2));
        RULES.put(SAFE, new Rule(7, 24 * 3600, 120, 3));
        RULES.put(REPORT, new Rule(5, 12 * 3600, 30, 4));
    }

    public static Rule rule(String type) {
        return RULES.get(type);
    }

    public static boolean knownType(String type) {
        return RULES.containsKey(type);
    }

    // ------------------------------------------------------------------ ids

    private static final SecureRandom RANDOM = new SecureRandom();

    public static String newId() {
        byte[] b = new byte[8];
        RANDOM.nextBytes(b);
        return hex(b);
    }

    public static String nodeId(byte[] publicKeyDer) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(publicKeyDer);
            byte[] first = new byte[8];
            System.arraycopy(d, 0, first, 0, 8);
            return hex(first);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    public static byte[] unhex(String s) {
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    static boolean isHexId(String s) {
        return s != null && s.matches("[0-9a-f]{16}");
    }

    // -------------------------------------------------------------- signing

    /** Something that can sign with the phone's key (AndroidKeyStore in the app, a soft key in tests). */
    public interface Signer {
        byte[] publicKeyDer();

        byte[] sign(byte[] data) throws Exception;
    }

    public static byte[] signedBytes(JSONObject m) {
        String s = m.optInt("v") + "|" + m.optString("t") + "|" + m.optString("id") + "|" + m.optString("o")
            + "|" + m.optLong("ts") + "|" + m.optLong("exp") + "|" + m.optInt("hl") + "|" + m.optString("p");
        return s.getBytes(StandardCharsets.UTF_8);
    }

    /** Build and sign a new message from this phone. */
    public static JSONObject create(Signer signer, String type, JSONObject payload, long nowSec) throws Exception {
        Rule r = rule(type);
        if (r == null) throw new IllegalArgumentException("unknown message type " + type);
        byte[] pub = signer.publicKeyDer();
        JSONObject m = new JSONObject();
        m.put("v", VERSION);
        m.put("t", type);
        m.put("id", newId());
        m.put("o", nodeId(pub));
        m.put("k", Base64.getEncoder().encodeToString(pub));
        m.put("ts", nowSec);
        m.put("exp", nowSec + r.ttlSec);
        m.put("h", 0);
        m.put("hl", r.hopLimit);
        m.put("p", payload.toString());
        m.put("s", Base64.getEncoder().encodeToString(signer.sign(signedBytes(m))));
        if (m.toString().getBytes(StandardCharsets.UTF_8).length > MAX_MESSAGE_BYTES) {
            throw new IllegalArgumentException("message too large");
        }
        return m;
    }

    /** Why a message was refused, or null when it is valid. */
    public static String check(JSONObject m, long nowSec, String trustedAlertKey) {
        if (m == null) return "not json";
        if (m.toString().getBytes(StandardCharsets.UTF_8).length > MAX_MESSAGE_BYTES) return "too large";
        if (m.optInt("v", -1) != VERSION) return "bad version";
        String t = m.optString("t");
        Rule r = rule(t);
        if (r == null) return "unknown type";
        if (!isHexId(m.optString("id")) || !isHexId(m.optString("o"))) return "bad id";
        long ts = m.optLong("ts", -1), exp = m.optLong("exp", -1);
        if (ts <= 0 || exp <= ts) return "bad time";
        if (ts > nowSec + MAX_FUTURE_SEC) return "from the future";
        if (exp <= nowSec) return "expired";
        if (exp - ts > r.ttlSec) return "lifetime too long";
        int h = m.optInt("h", -1), hl = m.optInt("hl", -1);
        if (h < 0 || hl < 0 || hl > 50) return "bad hops";
        if (hl > 0 && h > hl) return "hop limit passed";
        if (r.hopLimit > 0 && (hl == 0 || hl > r.hopLimit)) return "hop limit too high";
        String p = m.optString("p", null);
        if (p == null) return "no payload";
        JSONObject payload;
        try {
            payload = new JSONObject(p);
        } catch (JSONException e) {
            return "payload not json";
        }
        if (payload.optString("note", "").length() > MAX_NOTE_CHARS) return "note too long";
        try {
            byte[] pub = Base64.getDecoder().decode(m.optString("k"));
            if (!nodeId(pub).equals(m.optString("o"))) return "origin does not match key";
            if (ALERT.equals(t) && (trustedAlertKey == null || !trustedAlertKey.equals(m.optString("k")))) {
                return "alert not signed by the server";
            }
            PublicKey key = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(pub));
            Signature v = Signature.getInstance("SHA256withECDSA");
            v.initVerify(key);
            v.update(signedBytes(m));
            if (!v.verify(Base64.getDecoder().decode(m.optString("s")))) return "bad signature";
        } catch (Exception e) {
            return "bad signature";
        }
        return null;
    }

    /** True when a relay may pass this message on (after it adds one hop). */
    public static boolean mayForward(JSONObject m) {
        int hl = m.optInt("hl");
        return hl == 0 || m.optInt("h") + 1 <= hl;
    }

    /** A copy with one more hop, for sending on. */
    public static JSONObject forwarded(JSONObject m) throws JSONException {
        JSONObject c = new JSONObject(m.toString());
        c.put("h", m.optInt("h") + 1);
        return c;
    }

    // ------------------------------------------------------- rate limiting

    /** Remembers when each origin last sent each type; drops floods. */
    public static final class RateLimiter {
        private final Map<String, Long> last = new HashMap<>();

        public synchronized boolean allow(JSONObject m) {
            Rule r = rule(m.optString("t"));
            if (r == null) return false;
            if (r.minGapSec == 0) return true;
            String key = m.optString("o") + "/" + m.optString("t");
            long ts = m.optLong("ts");
            Long prev = last.get(key);
            if (prev != null && Math.abs(ts - prev) < r.minGapSec) return false;
            last.put(key, ts);
            if (last.size() > 5000) last.clear();
            return true;
        }
    }

    // ------------------------------------------------------------- framing

    /** Header: sequence (2 bytes), chunk index (2), chunk count (2). */
    public static final int HEADER = 6;
    public static final int MAX_FRAME_BYTES = 64 * 1024;

    /** Split one payload into BLE writes of at most chunkSize bytes each (header included). */
    public static List<byte[]> fragment(byte[] payload, int seq, int chunkSize) {
        int body = Math.max(1, chunkSize - HEADER);
        int count = Math.max(1, (payload.length + body - 1) / body);
        if (count > 0xFFFF) throw new IllegalArgumentException("payload too large");
        List<byte[]> out = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            int from = i * body;
            int len = Math.min(body, payload.length - from);
            byte[] c = new byte[HEADER + Math.max(0, len)];
            c[0] = (byte) (seq >> 8);
            c[1] = (byte) seq;
            c[2] = (byte) (i >> 8);
            c[3] = (byte) i;
            c[4] = (byte) (count >> 8);
            c[5] = (byte) count;
            if (len > 0) System.arraycopy(payload, from, c, HEADER, len);
            out.add(c);
        }
        return out;
    }

    /** Puts chunks from one link back together. One instance per link. */
    public static final class Reassembler {
        private int seq = -1;
        private int expected;
        private int next;
        private java.io.ByteArrayOutputStream buf;

        /** Returns the whole payload once its last chunk arrives, else null. */
        public byte[] accept(byte[] chunk) {
            if (chunk == null || chunk.length < HEADER) return null;
            int s = ((chunk[0] & 0xFF) << 8) | (chunk[1] & 0xFF);
            int i = ((chunk[2] & 0xFF) << 8) | (chunk[3] & 0xFF);
            int n = ((chunk[4] & 0xFF) << 8) | (chunk[5] & 0xFF);
            if (n == 0 || i >= n) return null;
            if (i == 0) {
                seq = s;
                expected = n;
                next = 0;
                buf = new java.io.ByteArrayOutputStream();
            }
            // Chunks arrive in order on one GATT link; anything else is a broken frame.
            if (buf == null || s != seq || n != expected || i != next) {
                buf = null;
                return null;
            }
            buf.write(chunk, HEADER, chunk.length - HEADER);
            next++;
            if (buf.size() > MAX_FRAME_BYTES) {
                buf = null;
                return null;
            }
            if (next == expected) {
                byte[] whole = buf.toByteArray();
                buf = null;
                return whole;
            }
            return null;
        }
    }
}
