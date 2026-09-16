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