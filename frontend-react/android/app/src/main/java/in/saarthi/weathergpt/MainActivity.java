package in.saarthi.weathergpt;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import in.saarthi.weathergpt.mesh.BleMeshPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The Bluetooth SOS relay lives in this app, not in an npm package.
        registerPlugin(BleMeshPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
