package in.saarthi.weathergpt.mesh;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;

/**
 * Android notifications for the mesh: a quiet ongoing one while relaying,
 * and a loud one for every SOS or relayed official alert that reaches this
 * phone, so it is seen even when the app is closed.
 */
public final class MeshNotifier {
    static final String CH_RELAY = "mesh_relay";
    static final String CH_SOS = "mesh_sos";
    static final int ONGOING_ID = 4100;

    private final Context ctx;

    MeshNotifier(Context ctx) {
        this.ctx = ctx;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            NotificationChannel relay = new NotificationChannel(CH_RELAY, "Bluetooth relay", NotificationManager.IMPORTANCE_LOW);
            relay.setDescription("Shown while this phone passes SOS messages on to others nearby");
            NotificationChannel sos = new NotificationChannel(CH_SOS, "SOS nearby", NotificationManager.IMPORTANCE_HIGH);
            sos.setDescription("Someone near you asked for help");
            sos.enableVibration(true);
            sos.setVibrationPattern(new long[] { 0, 600, 250, 600, 250, 600 });
            nm.createNotificationChannel(relay);
            nm.createNotificationChannel(sos);
        }
    }

    private PendingIntent openApp(String view) {
        Intent i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (i == null) i = new Intent();
        i.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra("view", view);
        return PendingIntent.getActivity(ctx, view.hashCode(), i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    Notification ongoing(int peers) {
        String text = peers == 0
            ? "Looking for phones nearby. SOS messages are kept and passed on."
            : peers == 1 ? "Linked to 1 phone nearby. Passing SOS messages on."
            : "Linked to " + peers + " phones nearby. Passing SOS messages on.";
        return new NotificationCompat.Builder(ctx, CH_RELAY)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle("SAARTHI SOS relay is on")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openApp("nearby"))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    void updateOngoing(int peers) {
        if (!MeshService.isRunning()) return;
        try {
            NotificationManagerCompat.from(ctx).notify(ONGOING_ID, ongoing(peers));
        } catch (SecurityException ignored) {
            // notifications not allowed: the service keeps running regardless
        }
    }

    void onIncoming(JSONObject m) {
        String t = m.optString("t");
        JSONObject p;
        try {
            p = new JSONObject(m.optString("p", "{}"));
        } catch (Exception e) {
            p = new JSONObject();
        }
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        try {
            if (MeshProtocol.SOS.equals(t)) {
                int hops = Math.max(1, m.optInt("h"));
                String who = p.optString("name", "").trim();
                String need = needWord(p.optString("need", ""));
                String title = "SOS nearby" + (who.isEmpty() ? "" : " - " + who);
                String body = need + (hops == 1 ? " · reached you directly" : " · passed through " + hops + " phones")
                    + (p.optString("note", "").isEmpty() ? "" : "\n" + p.optString("note"));
                nm.notify(m.optString("id").hashCode(), new NotificationCompat.Builder(ctx, CH_SOS)
                    .setSmallIcon(android.R.drawable.stat_sys_warning)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body + "\nTap to see where they are."))
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setAutoCancel(true)
                    .setContentIntent(openApp("nearby"))
                    .build());
            } else if (MeshProtocol.SOS_UPDATE.equals(t)) {
                String st = p.optString("st");
                if ("rescued".equals(st) || "cancel".equals(st)) nm.cancel(p.optString("ref").hashCode());
            } else if (MeshProtocol.ALERT.equals(t)) {
                String head = p.optString("headline", p.optString("hazard", "Official alert"));
                nm.notify(m.optString("id").hashCode(), new NotificationCompat.Builder(ctx, CH_SOS)
                    .setSmallIcon(android.R.drawable.stat_sys_warning)
                    .setContentTitle("Official alert (passed phone to phone)")
                    .setContentText(head)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true)
                    .setContentIntent(openApp("alerts"))
                    .build());
            }
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS denied: the app still shows it in Nearby
        }
    }

    private static String needWord(String need) {
        switch (need) {
            case "medical": return "Needs medical help";
            case "trapped": return "Trapped";
            case "water": return "Needs water or food";
            case "fire": return "Fire";
            case "flood": return "Flooding";
            default: return "Needs help";
        }
    }
}
