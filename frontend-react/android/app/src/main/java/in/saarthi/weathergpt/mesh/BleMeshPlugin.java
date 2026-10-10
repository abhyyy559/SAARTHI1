package in.saarthi.weathergpt.mesh;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.content.Intent;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The bridge between the web app and the Bluetooth mesh. The web app calls
 * window.Capacitor.Plugins.BleMesh.*; see src/mesh/meshClient.js.
 */
@CapacitorPlugin(
    name = "BleMesh",
    permissions = {
        @Permission(alias = "scan", strings = { Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "connect", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "advertise", strings = { Manifest.permission.BLUETOOTH_ADVERTISE }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    }
)
public class BleMeshPlugin extends Plugin {
    private MeshEngine engine;
    private String launchView;

    private final MeshEngine.Listener listener = new MeshEngine.Listener() {
        @Override
        public void onMessage(JSONObject message, boolean mine) {
            JSObject ev = new JSObject();
            ev.put("message", toJs(message));
            ev.put("mine", mine);
            notifyListeners("message", ev, true);
        }

        @Override
        public void onStatus(JSONObject status) {
            notifyListeners("status", toJs(status));
        }
    };

    @Override
    public void load() {
        engine = MeshEngine.get(getContext());
        engine.addListener(listener);
        Intent i = getActivity() == null ? null : getActivity().getIntent();
        if (i != null) launchView = i.getStringExtra("view");
    }

    @Override
    protected void handleOnDestroy() {
        if (engine != null) engine.removeListener(listener);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        String view = intent.getStringExtra("view");
        if (view != null) {
            JSObject ev = new JSObject();
            ev.put("view", view);
            notifyListeners("open", ev, true);
        }
    }

    // ------------------------------------------------------------ permissions

    /** The permissions the relay needs on this Android version. */
    private String[] requiredAliases() {
        if (Build.VERSION.SDK_INT >= 31) return new String[] { "scan", "connect", "advertise" };
        return new String[] { "location" };
    }

    /** Everything worth asking for: the relay's, plus location (SOS position) and notifications. */
    private String[] askAliases() {
        List<String> out = new ArrayList<>();
        for (String a : requiredAliases()) out.add(a);
        if (!out.contains("location")) out.add("location");
        if (Build.VERSION.SDK_INT >= 33) out.add("notifications");
        return out.toArray(new String[0]);
    }

    private boolean granted(String[] aliases) {
        for (String a : aliases) if (getPermissionState(a) != PermissionState.GRANTED) return false;
        return true;
    }

    private JSObject permissionSummary() {
        JSObject p = new JSObject();
        p.put("bluetooth", granted(requiredAliases()));
        p.put("location", getPermissionState("location") == PermissionState.GRANTED);
        p.put("notifications", Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED);
        return p;
    }

    // ---------------------------------------------------------------- methods

    @PluginMethod
    public void start(PluginCall call) {
        if (!granted(askAliases()) && !call.getBoolean("silent", false)) {
            requestPermissionForAliases(askAliases(), call, "afterPermissions");
            return;
        }
        startRelay(call);
    }

    @PermissionCallback
    private void afterPermissions(PluginCall call) {
        startRelay(call);
    }

    private void startRelay(PluginCall call) {
        if (!granted(requiredAliases())) {
            JSObject r = statusJs();
            r.put("started", false);
            call.resolve(r);
            return;
        }
        MeshService.start(getContext());
        JSObject r = statusJs();
        r.put("started", true);
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        MeshService.stop(getContext());
        engine.stop();
        call.resolve(statusJs());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusJs());
    }

    private JSObject statusJs() {
        JSObject s = toJs(engine.status());
        s.put("permissions", permissionSummary());
        s.put("background", MeshService.isRunning());
        return s;
    }

    @PluginMethod
    public void send(PluginCall call) {
        String type = call.getString("type");
        JSObject payload = call.getObject("payload", new JSObject());
        try {
            JSONObject m = engine.send(type, payload);
            JSObject r = new JSObject();
            r.put("message", toJs(m));
            call.resolve(r);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void ingest(PluginCall call) {
        JSObject m = call.getObject("message");
        JSObject r = new JSObject();
        String why = m == null ? "no message" : engine.ingest(m);
        r.put("accepted", why == null);
        if (why != null) r.put("reason", why);
        call.resolve(r);
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray out = new JSArray();
        JSONArray ms = engine.messages();
        for (int i = 0; i < ms.length(); i++) out.put(toJs(ms.optJSONObject(i)));
        JSObject r = new JSObject();
        r.put("messages", out);
        r.put("nodeId", engine.nodeId());
        call.resolve(r);
    }

    @PluginMethod
    public void setAlertKey(PluginCall call) {
        engine.setTrustedAlertKey(call.getString("key"));
        call.resolve();
    }

    @PluginMethod
    public void launchView(PluginCall call) {
        JSObject r = new JSObject();
        r.put("view", launchView);
        launchView = null;
        call.resolve(r);
    }

    @PluginMethod
    public void enableBluetooth(PluginCall call) {
        BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        if (a == null) {
            call.reject("This phone has no Bluetooth");
            return;
        }
        if (a.isEnabled()) {
            call.resolve(statusJs());
            return;
        }
        if (Build.VERSION.SDK_INT >= 31 && getPermissionState("connect") != PermissionState.GRANTED) {
            call.reject("Bluetooth permission is off");
            return;
        }
        startActivityForResult(call, new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), "afterEnable");
    }

    @ActivityCallback
    private void afterEnable(PluginCall call, ActivityResult result) {
        if (call == null) return;
        call.resolve(statusJs());
    }

    // ---------------------------------------------------------------- helpers

    private static JSObject toJs(JSONObject o) {
        try {
            return JSObject.fromJSONObject(o);
        } catch (Exception e) {
            return new JSObject();
        }
    }
}
