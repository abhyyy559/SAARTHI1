package in.saarthi.weathergpt.mesh;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Every message this phone holds, so it can hand them to phones it meets
 * later (store and forward). Plain Java, so it is unit-tested on the JVM.
 *
 * Capped at MAX_MESSAGES: when full, the lowest-priority, oldest message goes
 * first, so an SOS is the last thing ever dropped. Ids stay in "seen" after a
 * message is dropped or expires, so it is never accepted twice.
 */
public final class MeshStore {
    public static final int MAX_MESSAGES = 500;
    private static final int MAX_SEEN = 4000;

    private final Map<String, JSONObject> messages = new LinkedHashMap<>();
    private final LinkedHashSet<String> seen = new LinkedHashSet<>();
    private final File file;

    public MeshStore(File file) {
        this.file = file;
        load();
    }

    public synchronized boolean seen(String id) {
        return seen.contains(id);
    }

    public synchronized void markSeen(String id) {
        seen.add(id);
        if (seen.size() > MAX_SEEN) {
            String oldest = seen.iterator().next();
            seen.remove(oldest);
        }
    }

    /** Keep a valid message. Returns false when it was already known. */
    public synchronized boolean add(JSONObject m) {
        String id = m.optString("id");
        if (seen.contains(id) || messages.containsKey(id)) return false;
        markSeen(id);
        messages.put(id, m);
        trim();
        save();
        return true;
    }

    public synchronized JSONObject get(String id) {
        return messages.get(id);
    }

    public synchronized int size() {
        return messages.size();
    }

    /** Live messages, most urgent type first, newest first within a type. */
    public synchronized List<JSONObject> live(long nowSec) {
        prune(nowSec);
        List<JSONObject> out = new ArrayList<>(messages.values());
        Collections.sort(out, (a, b) -> {
            int pa = priority(a), pb = priority(b);
            if (pa != pb) return Integer.compare(pa, pb);
            return Long.compare(b.optLong("ts"), a.optLong("ts"));
        });
        return out;
    }

    /** Ids to offer a newly met phone, most urgent first. */
    public synchronized List<String> inventory(long nowSec, int max) {
        List<String> ids = new ArrayList<>();
        for (JSONObject m : live(nowSec)) {
            if (ids.size() >= max) break;
            ids.add(m.optString("id"));
        }
        return ids;
    }

    /** Drop expired messages. Returns how many went. */
    public synchronized int prune(long nowSec) {
        List<String> gone = new ArrayList<>();
        for (Map.Entry<String, JSONObject> e : messages.entrySet()) {
            if (e.getValue().optLong("exp") <= nowSec) gone.add(e.getKey());
        }
        for (String id : gone) messages.remove(id);
        if (!gone.isEmpty()) save();
        return gone.size();
    }

    private static int priority(JSONObject m) {
        MeshProtocol.Rule r = MeshProtocol.rule(m.optString("t"));
        return r == null ? 99 : r.priority;
    }

    private void trim() {
        while (messages.size() > MAX_MESSAGES) {
            String victim = null;
            int worst = -1;
            long oldest = Long.MAX_VALUE;
            for (JSONObject m : messages.values()) {
                int p = priority(m);
                long ts = m.optLong("ts");
                if (p > worst || (p == worst && ts < oldest)) {
                    worst = p;
                    oldest = ts;
                    victim = m.optString("id");
                }
            }
            messages.remove(victim);
        }
    }

    private void load() {
        if (file == null || !file.exists()) return;
        try {
            String raw = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
            JSONObject root = new JSONObject(raw);
            JSONArray ms = root.optJSONArray("messages");
            JSONArray ss = root.optJSONArray("seen");
            for (int i = 0; ss != null && i < ss.length(); i++) seen.add(ss.getString(i));
            for (int i = 0; ms != null && i < ms.length(); i++) {
                JSONObject m = ms.getJSONObject(i);
                messages.put(m.optString("id"), m);
                seen.add(m.optString("id"));
            }
        } catch (Exception ignored) {
            // A damaged file must never stop the mesh from starting.
        }
    }

    private void save() {
        if (file == null) return;
        try {
            JSONObject root = new JSONObject();
            JSONArray ms = new JSONArray();
            for (JSONObject m : messages.values()) ms.put(m);
            JSONArray ss = new JSONArray();
            for (String id : seen) ss.put(id);
            root.put("messages", ms);
            root.put("seen", ss);
            File tmp = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(root.toString().getBytes(StandardCharsets.UTF_8));
            }
            if (!tmp.renameTo(file)) {
                file.delete();
                tmp.renameTo(file);
            }
        } catch (Exception ignored) {
            // Persistence is best effort; the in-memory store keeps working.
        }
    }
}
