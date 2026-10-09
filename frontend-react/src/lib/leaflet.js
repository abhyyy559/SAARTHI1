// Leaflet with the heat plugin. The plugin expects a global `L`, so it is set
// here before the plugin module runs (imports evaluate in order).
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

window.L = L;
export default L;
