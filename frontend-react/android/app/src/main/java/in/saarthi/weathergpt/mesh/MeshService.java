package in.saarthi.weathergpt.mesh;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps the Bluetooth relay alive while the app is in the background, so a
 * phone in someone's pocket still passes SOS messages on. Android requires a
 * visible notification for this; it is the quiet "SOS relay is on" one.
 */
public class MeshService extends Service {
    private static volatile boolean running;

    public static boolean isRunning() {
        return running;
    }

    public static void start(Context ctx) {
        ContextCompat.startForegroundService(ctx, new Intent(ctx, MeshService.class));
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, MeshService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        MeshEngine engine = MeshEngine.get(this);
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE : 0;
        try {
            ServiceCompat.startForeground(this, MeshNotifier.ONGOING_ID, engine.notifier().ongoing(0), type);
        } catch (Exception e) {
            // Missing Bluetooth permission (Android 14 checks it here): run in the foreground app only.
            stopSelf();
            engine.start();
            return START_NOT_STICKY;
        }
        running = true;
        engine.start();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        MeshEngine.get(this).stop();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
