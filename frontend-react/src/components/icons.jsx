// Inline SVG icon set - vector only, never emoji chrome. 24x24 stroke paths.
const P = {
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm6-3a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.94V22h2v-2.06A8 8 0 0 0 20 12h-2z',
  speaker: 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a3.5 3.5 0 0 0-2-3.15v6.3a3.5 3.5 0 0 0 2-3.15z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
  shield: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3zm-1.2 14.5-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-6.9 7z',
  radio: 'M12 8a4 4 0 1 0 4 4M12 8a8 8 0 0 1 8 8M12 12h.01M5 5l14 14',
  layers: 'm12 2 9 5-9 5-9-5 9-5zm-9 10 9 5 9-5M3 17l9 5 9-5',
  drop: 'M12 2s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.6 4.2 2.5-.8 1.3L11 13.5V7h2v5.6z',
  check: 'm5 13 4 4L19 7',
  send: 'M3 11.5 21 3l-8.5 18-2.5-7.5L3 11.5z',
  route: 'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12 2a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 16h5a4 4 0 0 0 0-8H8',
  alert: 'M12 3 2 21h20L12 3zm0 7v4m0 3.5v.5',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm7 6h-3a15 15 0 0 0-1.3-3.3A8 8 0 0 1 19 8zM12 4a14 14 0 0 1 1.9 4h-3.8A14 14 0 0 1 12 4zM4.1 14h3.1a15 15 0 0 0 1 3.4A8 8 0 0 1 4.1 14zm3.1-6H4.1a8 8 0 0 1 3.1-3.3A15 15 0 0 0 7.2 8zm2.5 4h4.6a14 14 0 0 1-1.4 4h-1.8a14 14 0 0 1-1.4-4zm6.1 6h-3.1a15 15 0 0 0-1-3.4 8 8 0 0 0 4.1 3.4zm-1-5.4h3.1a8 8 0 0 0-4.1-3.9c.4 1.2.8 2.5 1 3.9z',
  file: 'M6 2h8l5 5v15H6V2zm8 1.5V8h4.5M9 13h7M9 17h7',
  home: 'M3 10.4 12 3l9 7.4M5.5 9.3V20h5v-6h3v6h5V9.3',
  chat: 'M4 4h16v12H9l-5 4V4z',
  bell: 'M12 3a6 6 0 0 0-6 6v3.5L4.5 15.5h15L18 12.5V9a6 6 0 0 0-6-6zM9.8 19a2.2 2.2 0 0 0 4.4 0',
  map: 'm9 4 6 2 6-2v14l-6 2-6-2-6 2V6l6-2zm0 0v14m6-12v14',
  chart: 'M4 20V10m5.5 10V4m5.5 16v-7m5.5 7V8',
  sun: 'M12 4.5v-2m0 19v-2M19.5 12h2m-19 0h2m12.9-5.4 1.4-1.4M4.2 19.8l1.4-1.4m0-12.8L4.2 4.2m15.6 15.6-1.4-1.4M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z',
  moon: 'M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z',
  monitor: 'M3.5 4.5h17v11h-17v-11zm5 15h7m-3.5-4v4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  refresh: 'M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 4v5h-5',
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm4.6 11.1 4 4',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9.5H5V11z',
  offline: 'M2.5 2.5l19 19M8.5 16a5 5 0 0 1 7 0M5.2 12.2a10 10 0 0 1 3.4-2m6.8.3a10 10 0 0 1 3.4 1.7M12 20h.01',

  // --- hazards. One glyph per threat a farmer, driver or fisherman actually
  // --- faces, so the threat is readable before any word is.
  cloud: 'M7 18h10a4 4 0 0 0 .3-8A6 6 0 0 0 6 11.2 3.5 3.5 0 0 0 7 18z',
  rain: 'M7 15h10a4 4 0 0 0 .3-8A6 6 0 0 0 6 8.2 3.5 3.5 0 0 0 7 15zM8.5 18l-1 3M12 18l-1 3M15.5 18l-1 3',
  storm: 'M7 14h10a4 4 0 0 0 .3-8A6 6 0 0 0 6 7.2 3.5 3.5 0 0 0 7 14zM13 16l-3 4h3l-1.5 3',
  wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h9',
  wave: 'M2 11c2-3 4-3 6 0s4 3 6 0 4-3 6 0M2 17c2-3 4-3 6 0s4 3 6 0 4-3 6 0',
  snow: 'M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9',
  fog: 'M4 9h16M6 13h13M4 17h11',
  heat: 'M12 4.5v-2m6.4 3.6 1.4-1.4M4.2 19.8l1.4-1.4M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM6 20c1.5 1.2 3 1.2 4.5 0S13.5 18.8 15 20',
  flood: 'M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 20c2-2 4-2 6 0s4 2 6 0 4-2 6 0M6 10l6-6 6 6',
  mountain: 'M3 20l6-11 4 7 2.5-4L21 20H3z',
  flame: 'M12 3s5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s1 2 2 2c0-3 2-6 2-8z',
  thermometer: 'M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z',

  // --- livelihoods. The app speaks to a farmer, a driver and a fisherman, so
  // --- they can pick their own world by picture rather than by reading.
  boat: 'M3 15h18l-3 5H6l-3-5zM12 3v12M12 3l6 9h-6',
  fish: 'M2.5 12c3-4.5 6.5-6 9.5-6s6.5 1.5 9.5 6c-3 4.5-6.5 6-9.5 6s-6.5-1.5-9.5-6zM16 12h.01',
  truck: 'M3 6h11v10H3V6zm11 4h4l3 3v3h-7v-6zM7 19.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zm10 0a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
  crop: 'M12 21V9M12 9c0-3 2-5 5-5 0 3-2 5-5 5zM12 13c0-3-2-5-5-5 0 3 2 5 5 5z',

  // --- actions and status the low-literacy pass leans on.
  sos: 'M6 3h3l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 8a8 8 0 0 0-16 0',
  translate: 'M4 6h9M8.5 6V4M6 6c0 5-1.5 8-4 10M10 6c0 5 1.5 8 4 10M13 20l4-9 4 9M14.5 17h5',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  wifi: 'M2.5 9a15 15 0 0 1 19 0M6 12.5a10 10 0 0 1 12 0M9.5 16a5 5 0 0 1 5 0M12 19.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01',
  chevron: 'm9 6 6 6-6 6',
  download: 'M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 19h16',
  stop: 'M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V7a1.5 1.5 0 0 1 3 0v8a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5v-2l-1.5-2a1.5 1.5 0 0 1 2.5-1.6L8 13',
};

export default function Icon({ name, size = 18, className = 'icon' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={P[name] || P.activity} />
    </svg>
  );
}