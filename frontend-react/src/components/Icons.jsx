// Hand-drawn SVG set. Pictograms (48 grid, full colour) carry meaning for
// people who do not read: weather, hazards, roles. Line icons (24 grid,
// currentColor) are the controls. Status pictograms (warning, shield-ok,
// question) take currentColor so the verdict tone paints them.

const SUN = '#FFB020';
const CLOUD = '#FFFFFF';
const CLOUD_EDGE = '#8796AA';
const DARK = '#6B7A90';
const RAIN = '#2F7BEA';
const BOLT = '#FFC400';

const cloud = (y = 0, fill = CLOUD, edge = CLOUD_EDGE) => (
  <path
    d={`M13 ${33 + y}h22a7 7 0 0 0 1-13.9A10 10 0 0 0 16.5 ${17.5 + y}A7.6 7.6 0 0 0 13 ${33 + y}z`}
    fill={fill} stroke={edge} strokeWidth="2" strokeLinejoin="round"
  />
);
const rays = (cx, cy, r1, r2, w = 3) => [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
  const rad = (a * Math.PI) / 180;
  return (
    <line key={a} x1={cx + r1 * Math.cos(rad)} y1={cy + r1 * Math.sin(rad)}
      x2={cx + r2 * Math.cos(rad)} y2={cy + r2 * Math.sin(rad)}
      stroke={SUN} strokeWidth={w} strokeLinecap="round" />
  );
});
const drops = (xs, y1, len, color = RAIN) => xs.map((x) => (
  <line key={x} x1={x} y1={y1} x2={x - 3} y2={y1 + len} stroke={color} strokeWidth="3" strokeLinecap="round" />
));

const PICTO = {
  sun: <>{rays(24, 24, 13, 19)}<circle cx="24" cy="24" r="9" fill={SUN} /></>,
  partly: <>{rays(18, 18, 10, 14, 2.5)}<circle cx="18" cy="18" r="7" fill={SUN} />{cloud(4)}</>,
  cloud: <>{cloud(2)}</>,
  drizzle: <>{cloud(-6)}{drops([18, 26, 34], 32, 5)}</>,
  rain: <>{cloud(-6)}{drops([17, 25, 33], 31, 9)}</>,
  'rain-heavy': <>{cloud(-7, '#C9D2DE', DARK)}{drops([14, 21, 28, 35], 30, 11)}</>,
  storm: <>{cloud(-7, '#C9D2DE', DARK)}<path d="M26 27l-7 10h6l-3 9 10-13h-6l3-6z" fill={BOLT} stroke="#E08600" strokeWidth="1.5" strokeLinejoin="round" /></>,
  fog: <>{cloud(-8)}{[30, 36, 42].map((y, i) => <line key={y} x1={10 + i * 3} y1={y} x2={38 - i * 2} y2={y} stroke="#9AA6B6" strokeWidth="3" strokeLinecap="round" />)}</>,
  wind: <g fill="none" stroke="#5D88B8" strokeWidth="3.2" strokeLinecap="round"><path d="M6 18h22a5 5 0 1 0-5-5" /><path d="M6 26h30a5 5 0 1 1-5 5" /><path d="M6 34h14" /></g>,
  drop: <path d="M24 7c6 9 11 15 11 21a11 11 0 0 1-22 0c0-6 5-12 11-21z" fill={RAIN} />,
  humidity: <><path d="M24 7c6 9 11 15 11 21a11 11 0 0 1-22 0c0-6 5-12 11-21z" fill="#7FB3F5" /><path d="M19 30a5 5 0 0 0 5 5" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" /></>,
  thermo: <><rect x="20" y="6" width="8" height="26" rx="4" fill="#fff" stroke="#C0392B" strokeWidth="2" /><circle cx="24" cy="35" r="7" fill="#E5533D" /><rect x="22.5" y="16" width="3" height="18" fill="#E5533D" /></>,
  bolt: <path d="M27 4L12 27h10l-4 17 18-25H26l5-15z" fill={BOLT} stroke="#E08600" strokeWidth="2" strokeLinejoin="round" />,
  cyclone: <g fill="none" stroke="#5B6EE1" strokeWidth="3.5" strokeLinecap="round"><path d="M24 24m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0" /><path d="M29 24c0-9-8-15-18-13" /><path d="M19 24c0 9 8 15 18 13" /></g>,
  waves: <g fill="none" stroke={RAIN} strokeWidth="3.2" strokeLinecap="round">{[16, 25, 34].map((y) => <path key={y} d={`M5 ${y}q4.75-5 9.5 0t9.5 0t9.5 0t9.5 0`} />)}</g>,
  flood: <><path d="M12 24l12-11 12 11v8H12z" fill="#F4E3C3" stroke="#8A6D3B" strokeWidth="2" strokeLinejoin="round" /><rect x="21" y="25" width="6" height="7" fill="#8A6D3B" /><g fill="none" stroke={RAIN} strokeWidth="3" strokeLinecap="round"><path d="M5 34q4.75-4 9.5 0t9.5 0t9.5 0t9.5 0" /><path d="M5 41q4.75-4 9.5 0t9.5 0t9.5 0t9.5 0" /></g></>,
  heat: <>{rays(20, 20, 12, 16, 2.5)}<circle cx="20" cy="20" r="8" fill="#FF7A1A" /><rect x="31" y="18" width="6" height="18" rx="3" fill="#fff" stroke="#C0392B" strokeWidth="2" /><circle cx="34" cy="38" r="5" fill="#E5533D" /></>,
  cold: <g stroke="#3FA7D6" strokeWidth="3" strokeLinecap="round">{[0, 60, 120].map((a) => <line key={a} x1="24" y1="8" x2="24" y2="40" transform={`rotate(${a} 24 24)`} />)}</g>,
  landslide: <><path d="M4 40L20 12l8 12 4-5 12 21z" fill="#B08455" stroke="#7A5530" strokeWidth="2" strokeLinejoin="round" /><circle cx="33" cy="33" r="3" fill="#7A5530" /><circle cx="40" cy="38" r="2.5" fill="#7A5530" /></>,
  alert: <><path d="M24 6L44 41H4z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><rect x="22" y="17" width="4" height="13" rx="2" fill="#fff" /><circle cx="24" cy="35" r="2.4" fill="#fff" /></>,
  warning: <><path d="M24 6L44 41H4z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><rect x="22" y="17" width="4" height="13" rx="2" fill="#fff" /><circle cx="24" cy="35" r="2.4" fill="#fff" /></>,
  'shield-ok': <><path d="M24 5l15 6v11c0 10-6.5 17-15 21C15.5 39 9 32 9 22V11z" fill="currentColor" /><path d="M17 24l5 5 9-10" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></>,
  question: <><circle cx="24" cy="24" r="19" fill="currentColor" /><path d="M18.5 19a5.5 5.5 0 1 1 7.6 5.1c-1.4.6-2.1 1.6-2.1 3.1v1" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" /><circle cx="24" cy="34" r="2.3" fill="#fff" /></>,
  farmer: <><path d="M6 38h36" stroke="#8A6D3B" strokeWidth="4" strokeLinecap="round" /><path d="M24 38V18" stroke="#2E9B4F" strokeWidth="3.5" strokeLinecap="round" /><path d="M24 24c-9 0-13-6-13-12 8 0 13 4 13 12z" fill="#43B864" /><path d="M24 20c0-8 5-12 13-12 0 6-4 12-13 12z" fill="#2E9B4F" /><path d="M12 38v-6M36 38v-5" stroke="#43B864" strokeWidth="3" strokeLinecap="round" /></>,
  boat: <><path d="M22 8v18" stroke="#5B4A3A" strokeWidth="2.5" strokeLinecap="round" /><path d="M23 9l12 15H23z" fill="#F4F1EA" stroke="#9C8B74" strokeWidth="1.5" strokeLinejoin="round" /><path d="M6 27h36l-6 9H12z" fill="#D9603B" stroke="#9E3F22" strokeWidth="2" strokeLinejoin="round" /><path d="M4 41q5-4 10 0t10 0t10 0t10 0" fill="none" stroke={RAIN} strokeWidth="3" strokeLinecap="round" /></>,
  truck: <><rect x="4" y="14" width="24" height="18" rx="2" fill="#F2B233" stroke="#A8761A" strokeWidth="2" /><path d="M28 19h8l6 7v6H28z" fill="#3E7CC9" stroke="#2A5A96" strokeWidth="2" strokeLinejoin="round" /><circle cx="13" cy="35" r="4.5" fill="#333" stroke="#fff" strokeWidth="2" /><circle cx="35" cy="35" r="4.5" fill="#333" stroke="#fff" strokeWidth="2" /></>,
  family: <><circle cx="17" cy="14" r="6" fill="#E59866" /><path d="M7 40c0-9 4.5-15 10-15s10 6 10 15z" fill="#3E7CC9" /><circle cx="33" cy="18" r="5" fill="#C9805A" /><path d="M25 40c0-7 3.5-12 8-12s8 5 8 12z" fill="#D9603B" /></>,
  heart: <path d="M24 41S7 31 7 18.5A8.5 8.5 0 0 1 24 13a8.5 8.5 0 0 1 17 5.5C41 31 24 41 24 41z" fill="#E5533D" />,
};

const LINE = {
  home: <><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-5h4v5" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /><circle cx="9" cy="10.5" r=".6" /><circle cx="12" cy="10.5" r=".6" /><circle cx="15" cy="10.5" r=".6" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  qr: <><rect x="3.5" y="3.5" width="6" height="6" /><rect x="14.5" y="3.5" width="6" height="6" /><rect x="3.5" y="14.5" width="6" height="6" /><path d="M14 14h3v3h-3zM17 17h3v3M20 14v1M14 20h1" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></>,
  speaker: <><path d="M4 9.5h4l5-4v13l-5-4H4z" /><path d="M16 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  pin: <><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></>,
  refresh: <><path d="M19 12a7 7 0 1 1-2-4.9" /><path d="M19 4v4h-4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  offline: <><path d="M7 18h10a4 4 0 0 0 .7-7.9A6 6 0 0 0 6.5 9.6 4.3 4.3 0 0 0 7 18z" /><path d="M3 3l18 18" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7.5" r=".6" /></>,
  // A ring with square teeth reads as a cog; thin rays around a dot read as a sun.
  gear: <>
    <circle cx="12" cy="12" r="6.3" />
    <circle cx="12" cy="12" r="2.4" />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
      const r = (a * Math.PI) / 180;
      return <line key={a} x1={12 + 6.6 * Math.cos(r)} y1={12 + 6.6 * Math.sin(r)} x2={12 + 9.4 * Math.cos(r)} y2={12 + 9.4 * Math.sin(r)} strokeWidth="3.6" strokeLinecap="butt" />;
    })}
  </>,
  send: <path d="M4 12l16-8-6 16-3-6.5z" />,
  download: <><path d="M12 4v11" /><path d="M7.5 10.5L12 15l4.5-4.5" /><path d="M5 20h14" /></>,
  share: <><circle cx="17.5" cy="6" r="2.5" /><circle cx="6.5" cy="12" r="2.5" /><circle cx="17.5" cy="18" r="2.5" /><path d="M8.7 10.8l6.6-3.6M8.7 13.2l6.6 3.6" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  sparkle: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
};

export function Icon({ name, size = 24, className = '', title }) {
  const label = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
  if (PICTO[name]) {
    return (
      <svg viewBox="0 0 48 48" width={size} height={size} className={`picto ${className}`} {...label}>
        {title ? <title>{title}</title> : null}
        {PICTO[name]}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={`line-icon ${className}`}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...label}>
      {title ? <title>{title}</title> : null}
      {LINE[name] || LINE.info}
    </svg>
  );
}

export const ICON_NAMES = [...Object.keys(PICTO), ...Object.keys(LINE)];
