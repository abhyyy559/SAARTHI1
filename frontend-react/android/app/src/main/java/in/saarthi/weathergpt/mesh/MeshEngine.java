package in.saarthi.weathergpt.mesh;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.AdvertisingSet;
import android.bluetooth.le.AdvertisingSetCallback;
import android.bluetooth.le.AdvertisingSetParameters;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.ParcelUuid;
import android.util.Log;
import java.io.File;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Phone-to-phone Bluetooth LE mesh.
 *
 * Every phone is both a GATT server (it advertises the SAARTHI service and
 * accepts connections) and a GATT client (it scans for that service and
 * connects). Two phones need only one link between them, so the phone with
 * the smaller node id dials; the other waits, and dials anyway if nothing
 * arrives within a few seconds (one side may not hear the other's adverts).
 *
 * Frames go client->server as writes to RX and server->client as
 * notifications on TX, chunked to the negotiated MTU and sent one at a time
 * (each waits for the previous write/notification to complete).
 *
 * All Bluetooth callbacks are moved onto one "mesh" thread, so the link maps
 * are only touched from that thread.
 */
@SuppressLint("MissingPermission")
public final class MeshEngine {
    private static final String TAG = "SaarthiMesh";

    public static final UUID SERVICE = UUID.fromString("5a3a0001-6b1e-4c1f-9d2a-534141525448");
    static final UUID RX = UUID.fromString("5a3a0002-6b1e-4c1f-9d2a-534141525448");
    static final UUID TX = UUID.fromString("5a3a0003-6b1e-4c1f-9d2a-534141525448");
    static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    /** Bluetooth SIG id reserved for testing / internal use. */
    static final int MANUFACTURER_ID = 0xFFFF;

    private static final int MAX_CLIENT_LINKS = 6;
    private static final long WAIT_FOR_DIAL_MS = 12_000;
    private static final long WATCHDOG_MS = 20_000;
    private static final int MAX_QUEUED_CHUNKS = 3000;

    public interface Listener {
        void onMessage(JSONObject message, boolean mine);

        void onStatus(JSONObject status);
    }

    private static MeshEngine instance;

    public static synchronized MeshEngine get(Context ctx) {
        if (instance == null) instance = new MeshEngine(ctx.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private final HandlerThread thread;
    private final Handler h;
    private final MeshStore store;
    private final MeshNotifier notifier;
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();
    private MeshRouter router;
    private String initError;

    private BluetoothManager manager;
    private BluetoothAdapter adapter;
    private BluetoothGattServer server;
    private BluetoothGattCharacteristic serverTx;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothLeScanner scanner;
    private AdvertisingSet codedSet;
    private boolean running;
    private boolean advertising;
    private boolean scanning;
    private String lastError = "";

    private final Map<String, ClientLink> clients = new HashMap<>();
    private final Map<String, ServerLink> serverLinks = new HashMap<>();
    private final Map<String, Long> firstSeen = new HashMap<>();
    private final Map<String, Long> retryAfter = new HashMap<>();
    private final Map<String, Integer> failures = new HashMap<>();

    private MeshEngine(Context ctx) {
        this.ctx = ctx;
        thread = new HandlerThread("saarthi-mesh");
        thread.start();
        h = new Handler(thread.getLooper());
        store = new MeshStore(new File(ctx.getFilesDir(), "mesh-store.json"));
        notifier = new MeshNotifier(ctx);
        try {
            MeshKeys keys = new MeshKeys();
            router = new MeshRouter(store, keys, (task, delay) -> h.postDelayed(task, delay),
                () -> System.currentTimeMillis() / 1000, new MeshRouter.Listener() {
                    @Override
                    public void onMessage(JSONObject m, boolean mine) {
                        if (!mine) notifier.onIncoming(m);
                        for (Listener l : listeners) l.onMessage(m, mine);
                    }

                    @Override
                    public void onPeersChanged(int peers) {
                        notifier.updateOngoing(peers);
                        publishStatus();
                    }
                });
        } catch (Exception e) {
            initError = "key store unavailable: " + e.getMessage();
            Log.e(TAG, initError, e);
        }
    }

    public void addListener(Listener l) {
        listeners.add(l);
    }

    public void removeListener(Listener l) {
        listeners.remove(l);
    }

    public String nodeId() {
        return router == null ? "" : router.nodeId();
    }

    public void setTrustedAlertKey(String key) {
        if (router != null) router.setTrustedAlertKey(key);
    }

    public MeshNotifier notifier() {
        return notifier;
    }

    // -------------------------------------------------------------- public API

    public void start() {
        h.post(this::startOnThread);
    }

    public void stop() {
        h.post(this::stopOnThread);
    }

    public boolean isRunning() {
        return running;
    }

    /** Sign and flood a message from this phone. Works even with no peers yet: it is kept and handed on later. */
    public JSONObject send(String type, JSONObject payload) throws Exception {
        if (router == null) throw new IllegalStateException(initError);
        return router.originate(type, payload);
    }

    public String ingest(JSONObject m) {
        if (router == null) return initError;
        return router.ingest(m);
    }

    public JSONArray messages() {
        JSONArray out = new JSONArray();
        for (JSONObject m : store.live(System.currentTimeMillis() / 1000)) out.put(m);
        return out;
    }

    public JSONObject status() {
        JSONObject s = new JSONObject();
        try {
            BluetoothAdapter a = adapter();
            s.put("supported", a != null && ctx.getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE));
            s.put("bluetoothOn", a != null && a.isEnabled());
            s.put("running", running);
            s.put("advertising", advertising);
            s.put("scanning", scanning);
            s.put("longRange", codedSet != null);
            s.put("peers", router == null ? 0 : router.peerCount());
            s.put("nodeId", nodeId());
            s.put("stored", store.size());
            s.put("error", initError != null ? initError : lastError);
        } catch (Exception ignored) {
            // a partial status is still useful
        }
        return s;
    }

    private void publishStatus() {
        JSONObject s = status();
        for (Listener l : listeners) l.onStatus(s);
    }

    // ------------------------------------------------------------- lifecycle

    private BluetoothAdapter adapter() {
        if (manager == null) manager = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
        if (adapter == null && manager != null) adapter = manager.getAdapter();
        return adapter;
    }

    private final BroadcastReceiver btState = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            int st = i.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
            if (st == BluetoothAdapter.STATE_ON) h.post(() -> {
                if (running) bringUp();
            });
            else if (st == BluetoothAdapter.STATE_TURNING_OFF || st == BluetoothAdapter.STATE_OFF) h.post(() -> {
                tearDown();
                publishStatus();
            });
        }
    };

    private void startOnThread() {
        if (running) {
            publishStatus();
            return;
        }
        running = true;
        try {
            ctx.registerReceiver(btState, new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED));
        } catch (Exception ignored) {
            // already registered
        }
        bringUp();
        h.postDelayed(watchdog, WATCHDOG_MS);
    }

    private void stopOnThread() {
        running = false;
        h.removeCallbacks(watchdog);
        try {
            ctx.unregisterReceiver(btState);
        } catch (Exception ignored) {
            // not registered
        }
        tearDown();
        publishStatus();
    }

    private void bringUp() {
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled() || router == null) {
            lastError = a == null ? "no bluetooth" : (router == null ? initError : "bluetooth off");
            publishStatus();
            return;
        }
        lastError = "";
        try {
            if (server == null) openServer();
            else if (!advertising) startAdvertising();
            if (!scanning) startScanning();
        } catch (SecurityException e) {
            lastError = "permission missing";
        } catch (Exception e) {
            lastError = String.valueOf(e.getMessage());
            Log.w(TAG, "bring up", e);
        }
        publishStatus();
    }

    private void tearDown() {
        try {
            if (scanner != null && scanning) scanner.stopScan(scanCb);
        } catch (Exception ignored) {
            // adapter already off
        }
        scanning = false;
        try {
            if (advertiser != null) {
                advertiser.stopAdvertising(advCb);
                if (codedSet != null) advertiser.stopAdvertisingSet(codedCb);
            }
        } catch (Exception ignored) {
            // adapter already off
        }
        advertising = false;
        codedSet = null;
        for (ClientLink c : new ArrayList<>(clients.values())) c.close();
        clients.clear();
        for (ServerLink s : new ArrayList<>(serverLinks.values())) if (router != null) router.linkDown(s.key());
        serverLinks.clear();
        try {
            if (server != null) server.close();
        } catch (Exception ignored) {
            // adapter already off
        }
        server = null;
        firstSeen.clear();
    }

    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            long now = System.currentTimeMillis();
            store.prune(now / 1000);
            // A link whose current chunk has waited 15 s is dead; drop it so it can redial.
            for (ClientLink c : new ArrayList<>(clients.values())) {
                if (c.stuckSince > 0 && now - c.stuckSince > 15_000) c.close();
                else if (!c.ready && now - c.openedAt > 25_000) c.close();
            }
            BluetoothAdapter a = adapter();
            if (a != null && a.isEnabled() && (server == null || !advertising || !scanning)) bringUp();
            publishStatus();
            h.postDelayed(this, WATCHDOG_MS);
        }
    };

    // ---------------------------------------------------------------- server

    private void openServer() {
        server = manager.openGattServer(ctx, serverCb);
        if (server == null) throw new IllegalStateException("cannot open GATT server");
        BluetoothGattService svc = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        BluetoothGattCharacteristic rx = new BluetoothGattCharacteristic(RX,
            BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE);
        serverTx = new BluetoothGattCharacteristic(TX, BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ);
        BluetoothGattDescriptor cccd = new BluetoothGattDescriptor(CCCD,
            BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE);
        serverTx.addDescriptor(cccd);
        svc.addCharacteristic(rx);
        svc.addCharacteristic(serverTx);
        server.addService(svc); // advertising starts in onServiceAdded
    }

    private final BluetoothGattServerCallback serverCb = new BluetoothGattServerCallback() {
        @Override
        public void onServiceAdded(int status, BluetoothGattService service) {
            h.post(() -> {
                if (status == BluetoothGatt.GATT_SUCCESS) startAdvertising();
                else lastError = "service add failed " + status;
            });
        }

        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            h.post(() -> {
                String addr = device.getAddress();
                if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    ServerLink s = serverLinks.remove(addr);
                    if (s != null && router != null) router.linkDown(s.key());
                }
            });
        }

        @Override
        public void onMtuChanged(BluetoothDevice device, int mtu) {
            h.post(() -> serverLink(device).mtu = mtu);
        }

        @Override
        public void onDescriptorWriteRequest(BluetoothDevice device, int requestId, BluetoothGattDescriptor d,
                                             boolean prepared, boolean responseNeeded, int offset, byte[] value) {
            if (responseNeeded) server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
            h.post(() -> {
                if (!CCCD.equals(d.getUuid())) return;
                ServerLink s = serverLink(device);
                boolean on = value != null && value.length > 0 && value[0] != 0;
                if (on && !s.subscribed) {
                    s.subscribed = true;
                    router.linkUp(s);
                } else if (!on && s.subscribed) {
                    s.subscribed = false;
                    router.linkDown(s.key());
                }
            });
        }

        @Override
        public void onDescriptorReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattDescriptor d) {
            server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0,
                BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE);
        }

        @Override
        public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset,
                                                BluetoothGattCharacteristic c) {
            server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, new byte[0]);
        }

        @Override
        public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId, BluetoothGattCharacteristic c,
                                                 boolean prepared, boolean responseNeeded, int offset, byte[] value) {
            if (responseNeeded) server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
            if (!RX.equals(c.getUuid()) || value == null) return;
            final byte[] chunk = value.clone();
            h.post(() -> {
                ServerLink s = serverLink(device);
                byte[] whole = s.rx.accept(chunk);
                if (whole == null) return;
                // A client that writes without subscribing still gets a working link one way.
                if (!s.subscribed) {
                    s.subscribed = true;
                    router.linkUp(s);
                }
                router.onFrame(s.key(), whole);
            });
        }

        @Override
        public void onNotificationSent(BluetoothDevice device, int status) {
            h.post(() -> {
                ServerLink s = serverLinks.get(device.getAddress());
                if (s != null) s.onSent();
            });
        }
    };

    private ServerLink serverLink(BluetoothDevice device) {
        ServerLink s = serverLinks.get(device.getAddress());
        if (s == null) {
            s = new ServerLink(device);
            serverLinks.put(device.getAddress(), s);
        }
        return s;
    }

    // ----------------------------------------------------------- advertising

    private byte[] nodeBytes() {
        return MeshProtocol.unhex(nodeId());
    }

    private void startAdvertising() {
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) return;
        advertiser = a.getBluetoothLeAdvertiser();
        if (advertiser == null) {
            lastError = "this phone cannot advertise (it can still receive and relay by dialing out)";
            return;
        }
        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0)
            .build();
        AdvertiseData data = new AdvertiseData.Builder()
            .addServiceUuid(new ParcelUuid(SERVICE))
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .build();
        AdvertiseData scanResponse = new AdvertiseData.Builder()
            .addManufacturerData(MANUFACTURER_ID, nodeBytes())
            .setIncludeDeviceName(false)
            .build();
        advertiser.startAdvertising(settings, data, scanResponse, advCb);
        startCodedAdvertising(a);
    }

    /**
     * Long range: phones with Bluetooth 5 "coded PHY" also advertise on it,
     * which reaches roughly 2-4x further than the normal 1M PHY. Phones that
     * lack it still talk over the normal advert, so this is purely additive.
     */
    private void startCodedAdvertising(BluetoothAdapter a) {
        try {
            if (codedSet != null || !a.isLeCodedPhySupported() || !a.isLeExtendedAdvertisingSupported()) return;
            AdvertisingSetParameters params = new AdvertisingSetParameters.Builder()
                .setLegacyMode(false)
                .setConnectable(true)
                .setScannable(false)
                .setInterval(AdvertisingSetParameters.INTERVAL_MEDIUM)
                .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_HIGH)
                .setPrimaryPhy(BluetoothDevice.PHY_LE_CODED)
                .setSecondaryPhy(BluetoothDevice.PHY_LE_CODED)
                .build();
            AdvertiseData data = new AdvertiseData.Builder()
                .addServiceUuid(new ParcelUuid(SERVICE))
                .addManufacturerData(MANUFACTURER_ID, nodeBytes())
                .setIncludeDeviceName(false)
                .build();
            advertiser.startAdvertisingSet(params, data, null, null, null, codedCb);
        } catch (Exception e) {
            Log.i(TAG, "long-range advert unavailable: " + e.getMessage());
        }
    }

    private final AdvertiseCallback advCb = new AdvertiseCallback() {
        @Override
        public void onStartSuccess(AdvertiseSettings settingsInEffect) {
            h.post(() -> {
                advertising = true;
                publishStatus();
            });
        }

        @Override
        public void onStartFailure(int errorCode) {
            h.post(() -> {
                // ALREADY_STARTED means it is in fact advertising.
                advertising = errorCode == AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED;
                if (!advertising) lastError = "advertise failed " + errorCode;
                publishStatus();
            });
        }
    };

    private final AdvertisingSetCallback codedCb = new AdvertisingSetCallback() {
        @Override
        public void onAdvertisingSetStarted(AdvertisingSet set, int txPower, int status) {
            h.post(() -> {
                codedSet = status == AdvertisingSetCallback.ADVERTISE_SUCCESS ? set : null;
                publishStatus();
            });
        }

        @Override
        public void onAdvertisingSetStopped(AdvertisingSet set) {
            h.post(() -> codedSet = null);
        }
    };

    // -------------------------------------------------------------- scanning

    private void startScanning() {
        BluetoothAdapter a = adapter();
        scanner = a.getBluetoothLeScanner();
        if (scanner == null) return;
        List<ScanFilter> filters = Collections.singletonList(
            new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE)).build());
        ScanSettings.Builder sb = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES);
        try {
            if (a.isLeCodedPhySupported() && a.isLeExtendedAdvertisingSupported()) {
                sb.setLegacy(false).setPhy(ScanSettings.PHY_LE_ALL_SUPPORTED);
            }
        } catch (Exception ignored) {
            // older stack: legacy scanning only
        }
        scanner.startScan(filters, sb.build(), scanCb);
        scanning = true;
    }

    private final ScanCallback scanCb = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            h.post(() -> onSeen(result));
        }

        @Override
        public void onBatchScanResults(List<ScanResult> results) {
            h.post(() -> {
                for (ScanResult r : results) onSeen(r);
            });
        }

        @Override
        public void onScanFailed(int errorCode) {
            h.post(() -> {
                scanning = false;
                lastError = "scan failed " + errorCode; // the watchdog retries
                publishStatus();
            });
        }
    };

    private static String peerNode(ScanResult r) {
        ScanRecord rec = r.getScanRecord();
        if (rec == null) return null;
        byte[] d = rec.getManufacturerSpecificData(MANUFACTURER_ID);
        if (d == null || d.length < 8) return null;
        byte[] id = new byte[8];
        System.arraycopy(d, 0, id, 0, 8);
        return MeshProtocol.hex(id);
    }

    private void onSeen(ScanResult r) {
        if (!running || router == null) return;
        String addr = r.getDevice().getAddress();
        if (clients.containsKey(addr)) return;
        long now = System.currentTimeMillis();
        Long wait = retryAfter.get(addr);
        if (wait != null && now < wait) return;
        String node = peerNode(r);
        if (node != null && (node.equals(nodeId()) || router.hasPeer(node))) return;
        if (serverLinks.containsKey(addr) && serverLinks.get(addr).subscribed) return;
        if (clients.size() >= MAX_CLIENT_LINKS) return;
        boolean myTurn = node != null && nodeId().compareTo(node) < 0;
        if (!myTurn) {
            // The other phone should dial us. Give it a moment, then dial anyway.
            Long first = firstSeen.get(addr);
            if (first == null) {
                firstSeen.put(addr, now);
                return;
            }
            if (now - first < WAIT_FOR_DIAL_MS) return;
        }
        firstSeen.remove(addr);
        dial(r.getDevice());
    }

    private void dial(BluetoothDevice device) {
        ClientLink c = new ClientLink(device);
        clients.put(device.getAddress(), c);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                c.gatt = device.connectGatt(ctx, false, c.cb, BluetoothDevice.TRANSPORT_LE,
                    BluetoothDevice.PHY_LE_1M_MASK | BluetoothDevice.PHY_LE_CODED_MASK);
            } else {
                c.gatt = device.connectGatt(ctx, false, c.cb, BluetoothDevice.TRANSPORT_LE);
            }
        } catch (Exception e) {
            c.close();
        }
    }

    private void backoff(String addr) {
        int n = failures.containsKey(addr) ? failures.get(addr) + 1 : 1;
        failures.put(addr, n);
        long delay = Math.min(120_000, 3_000L * (1L << Math.min(n, 6)));
        retryAfter.put(addr, System.currentTimeMillis() + delay);
    }

    // ------------------------------------------------------------------ links

    /** Chunk queue shared by both link directions: one chunk in flight at a time. */
    private abstract class BleLink implements MeshRouter.Link {
        final String addr;
        final ArrayDeque<byte[]> queue = new ArrayDeque<>();
        final MeshProtocol.Reassembler rx = new MeshProtocol.Reassembler();
        int mtu = 23;
        int seq;
        boolean busy;
        long stuckSince;

        BleLink(String addr) {
            this.addr = addr;
        }

        @Override
        public void send(byte[] frame) {
            h.post(() -> {
                if (queue.size() > MAX_QUEUED_CHUNKS) return; // a hopelessly slow link: drop, the next sync refills
                // ATT write/notify payload is MTU - 3.
                queue.addAll(MeshProtocol.fragment(frame, seq++ & 0xFFFF, mtu - 3));
                pump();
            });
        }

        void pump() {
            if (busy || queue.isEmpty()) return;
            boolean ok;
            try {
                ok = write(queue.peek());
            } catch (Exception e) {
                ok = false;
            }
            if (ok) {
                busy = true;
                stuckSince = System.currentTimeMillis();
            } else {
                h.postDelayed(this::pump, 60); // the stack was busy; try again shortly
            }
        }

        void onSent() {
            queue.poll();
            busy = false;
            stuckSince = 0;
            pump();
        }

        abstract boolean write(byte[] chunk);
    }

    private final class ServerLink extends BleLink {
        final BluetoothDevice device;
        boolean subscribed;

        ServerLink(BluetoothDevice device) {
            super(device.getAddress());
            this.device = device;
        }

        @Override
        public String key() {
            return "s:" + addr;
        }

        @Override
        boolean write(byte[] chunk) {
            if (server == null || !subscribed) return false;
            if (Build.VERSION.SDK_INT >= 33) {
                return server.notifyCharacteristicChanged(device, serverTx, false, chunk) == BluetoothStatusCodes.SUCCESS;
            }
            serverTx.setValue(chunk);
            return server.notifyCharacteristicChanged(device, serverTx, false);
        }
    }

    private final class ClientLink extends BleLink {
        final BluetoothDevice device;
        BluetoothGatt gatt;
        BluetoothGattCharacteristic rxChar;
        boolean ready;
        boolean closed;
        final long openedAt = System.currentTimeMillis();

        ClientLink(BluetoothDevice device) {
            super(device.getAddress());
            this.device = device;
        }

        @Override
        public String key() {
            return "c:" + addr;
        }

        @Override
        boolean write(byte[] chunk) {
            if (gatt == null || rxChar == null) return false;
            if (Build.VERSION.SDK_INT >= 33) {
                return gatt.writeCharacteristic(rxChar, chunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                    == BluetoothStatusCodes.SUCCESS;
            }
            rxChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            rxChar.setValue(chunk);
            return gatt.writeCharacteristic(rxChar);
        }

        void close() {
            if (closed) return;
            closed = true;
            clients.remove(addr);
            if (ready && router != null) router.linkDown(key());
            if (!ready) backoff(addr);
            ready = false;
            try {
                if (gatt != null) {
                    gatt.disconnect();
                    gatt.close();
                }
            } catch (Exception ignored) {
                // already gone
            }
        }

        final BluetoothGattCallback cb = new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
                h.post(() -> {
                    if (closed) return;
                    if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                        g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_BALANCED);
                        if (!g.requestMtu(247)) g.discoverServices();
                    } else {
                        close();
                    }
                });
            }

            @Override
            public void onMtuChanged(BluetoothGatt g, int newMtu, int status) {
                h.post(() -> {
                    if (closed) return;
                    if (status == BluetoothGatt.GATT_SUCCESS) mtu = newMtu;
                    g.discoverServices();
                });
            }

            @Override
            public void onServicesDiscovered(BluetoothGatt g, int status) {
                h.post(() -> {
                    if (closed) return;
                    BluetoothGattService svc = g.getService(SERVICE);
                    if (status != BluetoothGatt.GATT_SUCCESS || svc == null) {
                        close();
                        return;
                    }
                    rxChar = svc.getCharacteristic(RX);
                    BluetoothGattCharacteristic tx = svc.getCharacteristic(TX);
                    if (rxChar == null || tx == null) {
                        close();
                        return;
                    }
                    g.setCharacteristicNotification(tx, true);
                    BluetoothGattDescriptor d = tx.getDescriptor(CCCD);
                    if (d == null) {
                        close();
                        return;
                    }
                    if (Build.VERSION.SDK_INT >= 33) {
                        g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    } else {
                        d.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                        g.writeDescriptor(d);
                    }
                });
            }

            @Override
            public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
                h.post(() -> {
                    if (closed || ready) return;
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        close();
                        return;
                    }
                    ready = true;
                    failures.remove(addr);
                    router.linkUp(ClientLink.this);
                });
            }

            @Override
            public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
                h.post(ClientLink.this::onSent);
            }

            @Override
            public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value) {
                final byte[] chunk = value.clone();
                h.post(() -> receive(chunk));
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
                // Android 12 and older deliver notifications here.
                byte[] v = c.getValue();
                if (v == null) return;
                final byte[] chunk = v.clone();
                h.post(() -> receive(chunk));
            }
        };

        private void receive(byte[] chunk) {
            if (closed || !ready) return;
            byte[] whole = rx.accept(chunk);
            if (whole != null) router.onFrame(key(), whole);
        }
    }
}
