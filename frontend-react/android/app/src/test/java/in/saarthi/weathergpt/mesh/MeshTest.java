package in.saarthi.weathergpt.mesh;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The mesh's rules, run on the JVM: signing, validation, framing, the store,
 * and flooding across a chain of simulated phones.
 */
public class MeshTest {
    static final long NOW = 1_790_000_000L;

    static final class SoftSigner implements MeshProtocol.Signer {
        final KeyPair kp;

        SoftSigner() throws Exception {
            KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
            g.initialize(new ECGenParameterSpec("secp256r1"));
            kp = g.generateKeyPair();
        }

        @Override
        public byte[] publicKeyDer() {
            return kp.getPublic().getEncoded();
        }

        @Override
        public byte[] sign(byte[] data) throws Exception {
            Signature s = Signature.getInstance("SHA256withECDSA");
            s.initSign(kp.getPrivate());
            s.update(data);
            return s.sign();
        }
    }

    static JSONObject sosPayload() throws Exception {
        return new JSONObject().put("lat", 17.385).put("lon", 78.4867).put("need", "medical").put("note", "Leg injured");
    }

    // ------------------------------------------------------------ protocol

    @Test
    public void signedMessageVerifies() throws Exception {
        JSONObject m = MeshProtocol.create(new SoftSigner(), "sos", sosPayload(), NOW);
        assertNull(MeshProtocol.check(m, NOW, null));
        assertEquals(0, m.getInt("hl"));
        assertEquals(NOW + 72 * 3600, m.getLong("exp"));
    }

    @Test
    public void tamperingIsRefused() throws Exception {
        JSONObject m = MeshProtocol.create(new SoftSigner(), "sos", sosPayload(), NOW);
        JSONObject moved = new JSONObject(m.toString()).put("p", sosPayload().put("lat", 18.0).toString());
        assertEquals("bad signature", MeshProtocol.check(moved, NOW, null));
        JSONObject longer = new JSONObject(m.toString()).put("exp", NOW + 72 * 3600 + 10);
        assertEquals("lifetime too long", MeshProtocol.check(longer, NOW, null));
    }

    @Test
    public void nobodyCanSendUnderAnotherNodeId() throws Exception {
        SoftSigner a = new SoftSigner(), b = new SoftSigner();
        JSONObject m = MeshProtocol.create(a, "sos", sosPayload(), NOW);
        m.put("o", MeshProtocol.nodeId(b.publicKeyDer()));
        assertEquals("origin does not match key", MeshProtocol.check(m, NOW, null));
    }

    @Test
    public void hopCountIsNotSignedSoRelaysCanRaiseIt() throws Exception {
        JSONObject m = MeshProtocol.create(new SoftSigner(), "safe", new JSONObject().put("name", "Ravi"), NOW);
        JSONObject f = MeshProtocol.forwarded(m);
        assertEquals(1, f.getInt("h"));
        assertNull(MeshProtocol.check(f, NOW, null));
    }

    @Test
    public void hopLimitedTypesStopAtTheirLimit() throws Exception {
        JSONObject m = MeshProtocol.create(new SoftSigner(), "safe", new JSONObject(), NOW);
        m.put("h", 7);
        assertNull(MeshProtocol.check(m, NOW, null));
        assertFalse(MeshProtocol.mayForward(m));
        m.put("h", 8);
        assertEquals("hop limit passed", MeshProtocol.check(m, NOW, null));
        JSONObject sos = MeshProtocol.create(new SoftSigner(), "sos", sosPayload(), NOW).put("h", 40);
        assertTrue("an SOS has no hop limit", MeshProtocol.mayForward(sos));
    }

    @Test
    public void expiredAndFutureMessagesAreRefused() throws Exception {
        JSONObject m = MeshProtocol.create(new SoftSigner(), "report", new JSONObject(), NOW);
        assertEquals("expired", MeshProtocol.check(m, NOW + 13 * 3600, null));
        assertEquals("from the future", MeshProtocol.check(m, NOW - 3600, null));
    }

    @Test
    public void alertsNeedTheServerKey() throws Exception {
        SoftSigner server = new SoftSigner();
        JSONObject a = MeshProtocol.create(server, "alert", new JSONObject().put("headline", "Cyclone"), NOW);
        String key = Base64.getEncoder().encodeToString(server.publicKeyDer());
        assertNull(MeshProtocol.check(a, NOW, key));
        assertEquals("alert not signed by the server", MeshProtocol.check(a, NOW, null));
        JSONObject fake = MeshProtocol.create(new SoftSigner(), "alert", new JSONObject().put("headline", "x"), NOW);
        assertEquals("alert not signed by the server", MeshProtocol.check(fake, NOW, key));
    }

    /**
     * Signed by the server's Python code (backend/services/mesh_service.py)
     * with a Hindi headline. If this stops verifying, phones would refuse
     * every official alert the server puts into the mesh.
     */
    static final String SERVER_SIGNED_ALERT = "{\"v\": 1, \"t\": \"alert\", \"id\": \"00a1b2c3d4e5f607\", \"o\": \"eaa76bba60d57b4a\", "
        + "\"k\": \"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEi13w+Ciaizzcsi7hK4/juR8lpkvtt79w5hgFvFn+Lbu4iF13eM5Rvm6CJ6gRunML7hJ/NktIZ5LG1w6qAre/mA==\", "
        + "\"ts\": 1790000000, \"exp\": 1790003600, \"h\": 0, \"hl\": 0, "
        + "\"p\": \"{\\\"headline\\\":\\\"\\u092d\\u093e\\u0930\\u0940 \\u092c\\u093e\\u0930\\u093f\\u0936 \\u2014 stay indoors\\\",\\\"severity\\\":\\\"ORANGE\\\"}\", "
        + "\"s\": \"MEQCIB37K+s3bhyYHNcbLynlpI3OWhRwNfOmvygLnTxQbbmqAiAiF3RIcEwsnysMSZBEwY9uhvGGajW+geeStX+bcVj+sw==\"}";

    @Test
    public void aServerSignedAlertVerifiesOnThePhone() throws Exception {
        JSONObject a = new JSONObject(SERVER_SIGNED_ALERT);
        assertNull(MeshProtocol.check(a, 1790000010L, a.getString("k")));
        assertTrue(new JSONObject(a.getString("p")).getString("headline").startsWith("भारी"));
        a.put("p", a.getString("p").replace("ORANGE", "RED"));
        assertEquals("bad signature", MeshProtocol.check(a, 1790000010L, a.getString("k")));
    }

    @Test
    public void longNotesAreRefused() throws Exception {
        StringBuilder note = new StringBuilder();
        for (int i = 0; i < 141; i++) note.append('a');
        SoftSigner s = new SoftSigner();
        JSONObject m = MeshProtocol.create(s, "sos", new JSONObject().put("note", note.toString()), NOW);
        assertEquals("note too long", MeshProtocol.check(m, NOW, null));
    }

    @Test
    public void rateLimitDropsFloodsFromOneOrigin() throws Exception {
        SoftSigner s = new SoftSigner();
        MeshProtocol.RateLimiter rl = new MeshProtocol.RateLimiter();
        assertTrue(rl.allow(MeshProtocol.create(s, "sos", sosPayload(), NOW)));
        assertFalse(rl.allow(MeshProtocol.create(s, "sos", sosPayload(), NOW + 10)));
        assertTrue(rl.allow(MeshProtocol.create(s, "sos", sosPayload(), NOW + 61)));
        assertTrue("another person is not limited", rl.allow(MeshProtocol.create(new SoftSigner(), "sos", sosPayload(), NOW + 61)));
    }

    // ------------------------------------------------------------- framing

    @Test
    public void framesSurviveTheSmallestMtu() {
        byte[] payload = new byte[1400];
        for (int i = 0; i < payload.length; i++) payload[i] = (byte) i;
        for (int chunk : new int[] { 20, 182, 244, 512 }) {
            List<byte[]> parts = MeshProtocol.fragment(payload, 7, chunk);
            MeshProtocol.Reassembler r = new MeshProtocol.Reassembler();
            byte[] out = null;
            for (byte[] p : parts) {
                assertTrue(p.length <= chunk);
                out = r.accept(p);
            }
            assertArrayEquals(payload, out);
        }
    }

    @Test
    public void aBrokenFrameIsDroppedAndTheNextOneStillArrives() {
        byte[] a = "first frame that is long".getBytes(StandardCharsets.UTF_8);
        byte[] b = "second".getBytes(StandardCharsets.UTF_8);
        List<byte[]> pa = MeshProtocol.fragment(a, 1, 10);
        MeshProtocol.Reassembler r = new MeshProtocol.Reassembler();
        r.accept(pa.get(0)); // the rest of frame 1 is lost
        byte[] out = null;
        for (byte[] p : MeshProtocol.fragment(b, 2, 10)) out = r.accept(p);
        assertArrayEquals(b, out);
    }

    // --------------------------------------------------------------- store

    @Test
    public void storeKeepsSosFirstAndRemembersAcrossRestarts() throws Exception {
        File f = File.createTempFile("mesh", ".json");
        f.delete();
        MeshStore st = new MeshStore(f);
        SoftSigner s = new SoftSigner();
        JSONObject sos = MeshProtocol.create(s, "sos", sosPayload(), NOW);
        JSONObject rep = MeshProtocol.create(s, "report", new JSONObject(), NOW + 5);
        assertTrue(st.add(rep));
        assertTrue(st.add(sos));
        assertFalse("duplicate", st.add(sos));
        assertEquals(sos.getString("id"), st.live(NOW).get(0).getString("id"));
        MeshStore again = new MeshStore(f);
        assertEquals(2, again.size());
        assertTrue(again.seen(sos.getString("id")));
        assertEquals(1, again.prune(NOW + 13 * 3600)); // the report expired
        f.delete();
    }

    @Test
    public void aFullStoreDropsReportsBeforeSos() throws Exception {
        MeshStore st = new MeshStore(null);
        SoftSigner s = new SoftSigner();
        JSONObject sos = MeshProtocol.create(s, "sos", sosPayload(), NOW);
        st.add(sos);
        for (int i = 0; i < MeshStore.MAX_MESSAGES + 20; i++) {
            st.add(MeshProtocol.create(s, "report", new JSONObject(), NOW));
        }
        assertEquals(MeshStore.MAX_MESSAGES, st.size());
        assertNotNull(st.get(sos.getString("id")));
    }

    // -------------------------------------------------------------- router

    /** Phones in a line, A - B - C - D, each linked only to its neighbours. */
    static final class Net {
        final List<Phone> phones = new ArrayList<>();
        final List<Runnable> pending = new ArrayList<>();
        long now = NOW;

        Phone phone() throws Exception {
            Phone p = new Phone(this);
            phones.add(p);
            return p;
        }

        void link(Phone a, Phone b) {
            String ab = "to-" + phones.indexOf(b), ba = "to-" + phones.indexOf(a);
            a.router.linkUp(new FakeLink(ab, b, ba));
            b.router.linkUp(new FakeLink(ba, a, ab));
            settle();
        }

        void settle() {
            for (int i = 0; i < 10_000 && !pending.isEmpty(); i++) pending.remove(0).run();
        }
    }

    static final class FakeLink implements MeshRouter.Link {
        final String key;
        final Phone to;
        final String backKey;
        int frames;

        FakeLink(String key, Phone to, String backKey) {
            this.key = key;
            this.to = to;
            this.backKey = backKey;
        }

        @Override
        public String key() {
            return key;
        }

        @Override
        public void send(byte[] frame) {
            frames++;
            to.net.pending.add(() -> to.router.onFrame(backKey, frame));
        }
    }

    static final class Phone {
        final Net net;
        final MeshRouter router;
        final Map<String, JSONObject> got = new HashMap<>();

        Phone(Net net) throws Exception {
            this.net = net;
            router = new MeshRouter(new MeshStore(null), new SoftSigner(), (task, delay) -> net.pending.add(task),
                () -> net.now, new MeshRouter.Listener() {
                    @Override
                    public void onMessage(JSONObject m, boolean mine) {
                        got.put(m.optString("id"), m);
                    }

                    @Override
                    public void onPeersChanged(int peers) {}
                });
        }
    }

    @Test
    public void anSosHopsDownTheWholeChain() throws Exception {
        Net net = new Net();
        Phone a = net.phone(), b = net.phone(), c = net.phone(), d = net.phone();
        net.link(a, b);
        net.link(b, c);
        net.link(c, d);
        JSONObject sos = a.router.originate("sos", sosPayload());
        net.settle();
        String id = sos.getString("id");
        for (Phone p : net.phones) assertTrue(p.got.containsKey(id));
        assertEquals(3, d.got.get(id).getInt("h"));
        assertEquals("b is linked to a and c", 2, b.router.peerCount());
    }

    @Test
    public void aPhoneThatArrivesLaterStillGetsTheSos() throws Exception {
        Net net = new Net();
        Phone a = net.phone(), b = net.phone(), late = net.phone();
        net.link(a, b);
        JSONObject sos = a.router.originate("sos", sosPayload());
        net.settle();
        // a walks away; later b meets a newcomer, who learns of the SOS from b.
        net.link(b, late);
        assertTrue(late.got.containsKey(sos.getString("id")));
    }

    @Test
    public void floodsEndBecauseEveryPhoneDropsRepeats() throws Exception {
        Net net = new Net();
        Phone a = net.phone(), b = net.phone(), c = net.phone();
        net.link(a, b);
        net.link(b, c);
        net.link(c, a); // a loop
        a.router.originate("sos", sosPayload());
        net.settle();
        assertTrue("the loop settles", net.pending.isEmpty());
        for (Phone p : net.phones) assertEquals(1, p.got.size());
    }

    @Test
    public void forgedMessagesAreNotPassedOn() throws Exception {
        Net net = new Net();
        Phone a = net.phone(), b = net.phone(), c = net.phone();
        net.link(a, b);
        net.link(b, c);
        JSONObject forged = MeshProtocol.create(new SoftSigner(), "sos", sosPayload(), NOW);
        forged.put("p", sosPayload().put("note", "changed").toString());
        assertEquals("bad signature", b.router.ingest(forged));
        net.settle();
        assertTrue(c.got.isEmpty());
    }
}
