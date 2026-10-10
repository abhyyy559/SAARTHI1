package in.saarthi.weathergpt.mesh;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Flooding with store and forward. It knows nothing about Bluetooth: the BLE
 * engine hands it links and frames, so the whole routing logic is unit-tested
 * with fake links.
 *
 * Frames between two phones (JSON):
 *   {"c":"hello","n":nodeId,"inv":[ids]}  sent when a link comes up
 *   {"c":"want","ids":[ids]}              the ids the other phone lacks
 *   {"c":"msg","m":{message}}             one message
 *
 * A new valid message is stored, shown to the user, and sent to every other
 * linked phone after a small random delay (so phones in one room don't all
 * transmit at once). Duplicates stop at the first phone that has seen the id,
 * which is what ends the flood.
 */
public final class MeshRouter {

    public interface Link {
        String key();

        void send(byte[] frame);
    }

    public interface Scheduler {
        void schedule(Runnable task, long delayMs);
    }

    public interface Clock {
        long nowSec();
    }

    public interface Listener {
        /** A new message reached this phone (mine = this phone sent it). */
        void onMessage(JSONObject message, boolean mine);

        void onPeersChanged(int peers);
    }

    private static final int INVENTORY_MAX = 300;
    private static final int WANT_MAX = 300;
    private static final int PER_LINK_PER_MINUTE = 240;

    private final MeshStore store;
    private final MeshProtocol.Signer signer;
    private final Scheduler scheduler;
    private final Clock clock;
    private final Listener listener;
    private final MeshProtocol.RateLimiter limiter = new MeshProtocol.RateLimiter();
    private final Random random = new Random();
    private final Map<String, Link> links = new HashMap<>();
    private final Map<String, String> linkNode = new HashMap<>();
    private final Map<String, long[]> budget = new HashMap<>();
    private final String myNode;
    private volatile String trustedAlertKey;

    public MeshRouter(MeshStore store, MeshProtocol.Signer signer, Scheduler scheduler, Clock clock, Listener listener) {
        this.store = store;
        this.signer = signer;
        this.scheduler = scheduler;
        this.clock = clock;
        this.listener = listener;
        this.myNode = MeshProtocol.nodeId(signer.publicKeyDer());
    }

    public String nodeId() {
        return myNode;
    }

    public void setTrustedAlertKey(String key) {
        trustedAlertKey = key == null || key.isEmpty() ? null : key;
    }

    public synchronized int peerCount() {
        return new HashSet<>(linkNode.values()).size();
    }

    public synchronized Set<String> peerNodes() {
        return new HashSet<>(linkNode.values());
    }

    public synchronized boolean hasPeer(String node) {
        return linkNode.containsValue(node);
    }

    // ------------------------------------------------------------- links

    public void linkUp(Link link) {
        synchronized (this) {
            links.put(link.key(), link);
        }
        JSONObject hello = new JSONObject();
        try {
            hello.put("c", "hello");
            hello.put("n", myNode);
            JSONArray inv = new JSONArray();
            for (String id : forwardableInventory()) inv.put(id);
            hello.put("inv", inv);
        } catch (Exception ignored) {
            return;
        }
        link.send(bytes(hello));
    }

    public void linkDown(String key) {
        int peers;
        synchronized (this) {
            links.remove(key);
            linkNode.remove(key);
            budget.remove(key);
            peers = peerCount();
        }
        listener.onPeersChanged(peers);
    }

    private List<String> forwardableInventory() {
        List<String> out = new ArrayList<>();
        for (JSONObject m : store.live(clock.nowSec())) {
            if (out.size() >= INVENTORY_MAX) break;
            if (MeshProtocol.mayForward(m)) out.add(m.optString("id"));
        }
        return out;
    }

    // ------------------------------------------------------------ frames

    public void onFrame(String linkKey, byte[] payload) {
        JSONObject f;
        try {
            f = new JSONObject(new String(payload, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return;
        }
        Link link;
        synchronized (this) {
            link = links.get(linkKey);
        }
        if (link == null) return;
        switch (f.optString("c")) {
            case "hello":
                onHello(link, f);
                break;
            case "want":
                onWant(link, f.optJSONArray("ids"));
                break;
            case "msg":
                if (overBudget(linkKey)) return;
                receive(f.optJSONObject("m"), linkKey);
                break;
            default:
                break;
        }
    }

    private void onHello(Link link, JSONObject f) {
        String node = f.optString("n");
        if (!MeshProtocol.isHexId(node) || node.equals(myNode)) return;
        int peers;
        synchronized (this) {
            linkNode.put(link.key(), node);
            peers = peerCount();
        }
        listener.onPeersChanged(peers);
        JSONArray inv = f.optJSONArray("inv");
        JSONArray want = new JSONArray();
        for (int i = 0; inv != null && i < inv.length() && want.length() < WANT_MAX; i++) {
            String id = inv.optString(i);
            if (MeshProtocol.isHexId(id) && !store.seen(id)) want.put(id);
        }
        if (want.length() == 0) return;
        JSONObject w = new JSONObject();
        try {
            w.put("c", "want");
            w.put("ids", want);
        } catch (Exception ignored) {
            return;
        }
        link.send(bytes(w));
    }

    private void onWant(Link link, JSONArray ids) {
        for (int i = 0; ids != null && i < ids.length() && i < WANT_MAX; i++) {
            JSONObject m = store.get(ids.optString(i));
            if (m == null || !MeshProtocol.mayForward(m) || m.optLong("exp") <= clock.nowSec()) continue;
            try {
                link.send(msgFrame(MeshProtocol.forwarded(m)));
            } catch (Exception ignored) {
                // skip a broken entry
            }
        }
    }

    private synchronized boolean overBudget(String linkKey) {
        long now = clock.nowSec();
        long[] b = budget.get(linkKey);
        if (b == null || now - b[0] >= 60) {
            budget.put(linkKey, new long[] { now, 1 });
            return false;
        }
        b[1]++;
        return b[1] > PER_LINK_PER_MINUTE;
    }

    /** A message from another phone. Returns why it was refused, or null when kept. */
    String receive(JSONObject m, String fromLink) {
        if (m == null) return "empty";
        String id = m.optString("id");
        if (store.seen(id)) return "duplicate";
        String why = MeshProtocol.check(m, clock.nowSec(), trustedAlertKey);
        if (why != null) return why;
        if (!limiter.allow(m)) {
            store.markSeen(id);
            return "rate limited";
        }
        if (!store.add(m)) return "duplicate";
        listener.onMessage(m, false);
        flood(m, fromLink, true);
        return null;
    }

    /** A message from outside the mesh (the server's signed alerts). */
    public String ingest(JSONObject m) {
        return receive(m, null);
    }

    /** Sign and send a new message from this phone. */
    public JSONObject originate(String type, JSONObject payload) throws Exception {
        JSONObject m = MeshProtocol.create(signer, type, payload, clock.nowSec());
        limiter.allow(m);
        store.add(m);
        listener.onMessage(m, true);
        flood(m, null, false);
        return m;
    }

    private void flood(JSONObject m, String exceptLink, boolean jitter) {
        if (!MeshProtocol.mayForward(m)) return;
        final byte[] frame;
        try {
            frame = msgFrame(MeshProtocol.forwarded(m));
        } catch (Exception e) {
            return;
        }
        List<Link> targets = new ArrayList<>();
        synchronized (this) {
            for (Link l : links.values()) if (!l.key().equals(exceptLink)) targets.add(l);
        }
        for (Link l : targets) {
            long delay = jitter ? 100 + random.nextInt(500) : 0;
            scheduler.schedule(() -> l.send(frame), delay);
        }
    }

    private static byte[] msgFrame(JSONObject m) throws Exception {
        JSONObject f = new JSONObject();
        f.put("c", "msg");
        f.put("m", m);
        return bytes(f);
    }

    private static byte[] bytes(JSONObject o) {
        return o.toString().getBytes(StandardCharsets.UTF_8);
    }
}
