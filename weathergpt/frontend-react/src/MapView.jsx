// Lazy-loaded route: keeps Leaflet (and its ~150 kB) out of the initial bundle
// until the operator actually opens the map.
import ViewHead from './components/ViewHead';
import MapPanel from './components/MapPanel';
import RouteCheck from './components/RouteCheck';

export default function MapView() {
  return (
    <>
      <ViewHead titleKey="viewMap" subKey="viewMapSub" />
      <MapPanel />
      <RouteCheck />
    </>
  );
}
