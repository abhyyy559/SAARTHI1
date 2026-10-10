// Leaflet + the heat plugin share one binding.
//
// leaflet.heat is a UMD plugin that assigns onto a *global* `L`. A static ESM
// import of it is hoisted above this module's body, so the plugin would run
// before `window.L` exists and throw. The plugin is therefore loaded on
// demand, after the binding is in place — `loadHeatLayer()` resolves once
// `L.heatLayer` is a real function, and the map renders its heat layer only
// then. A failed load leaves the circle markers intact: the map still works,
// minus the blur.
import L from 'leaflet';

if (typeof window !== 'undefined' && !window.L) {
  window.L = L;
}

let pending = null;

export function heatLayerAvailable() {
  return typeof window !== 'undefined'
    && typeof window.L === 'object'
    && window.L !== null
    && typeof window.L.heatLayer === 'function';
}

export function loadHeatLayer() {
  if (heatLayerAvailable()) return Promise.resolve(true);
  if (!pending) {
    pending = import('leaflet.heat')
      .then(() => heatLayerAvailable())
      .catch(() => false);
  }
  return pending;
}

export default L;
