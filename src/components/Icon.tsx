// Line icons drawn for Village Restock (24px grid, stroke = currentColor).
const PATHS = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  circle: <circle cx="12" cy="12" r="8" />,
  back: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  more: <><circle cx="5.5" cy="12" r="1.1" /><circle cx="12" cy="12" r="1.1" /><circle cx="18.5" cy="12" r="1.1" /></>,
  reset: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.3" /></>,
  warn: <><path d="M12 3.5l9 16H3z" /><path d="M12 10v4.5M12 17.5v.3" /></>,
  box: <><path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4z" /><path d="M3.5 7.5L12 11.5l8.5-4M12 11.5v9" /></>,
  logo: <><path d="M6.4 6.2L12 17l5.6-10.8" strokeWidth="2.6" /><path d="M9.6 20h4.8" stroke="#E4CC9C" strokeWidth="2" /></>,
  bar: <><path d="M5.5 4.5h13L12 12z" /><path d="M12 12v7M8.5 19.5h7" /><path d="M15.2 4.5l2.3-2" /><circle cx="9.6" cy="7.2" r="1" /></>,
  kitchen: <><path d="M7.2 14a3.6 3.6 0 0 1-.4-7.15A4.6 4.6 0 0 1 12 4a4.6 4.6 0 0 1 5.2 2.85A3.6 3.6 0 0 1 16.8 14" /><path d="M7.2 12.5V20h9.6v-7.5M7.2 17h9.6" /></>,
  candy: <><path d="M6 10l1.5 10h9L18 10z" /><path d="M10 10l.4 10M14 10l-.4 10" /><path d="M6.4 10a2.1 2.1 0 0 1 1.3-3.8A2.4 2.4 0 0 1 12 5a2.4 2.4 0 0 1 4.3 1.2 2.1 2.1 0 0 1 1.3 3.8" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>,
  layers: <><path d="M12 4l8.5 4.5L12 13 3.5 8.5z" /><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16L12 20.5l8.5-4.5" /></>,
  tag: <><path d="M3.5 12.2V4.5h7.7l9.3 9.3-7.7 7.7z" /><circle cx="8" cy="9" r="1.4" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r=".9" fill="currentColor" /><circle cx="4.5" cy="12" r=".9" fill="currentColor" /><circle cx="4.5" cy="18" r=".9" fill="currentColor" /></>,
  cog: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>,
  home: <path d="M4 11l8-7 8 7v9h-5.5v-6h-5v6H4z" />,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  out: <><path d="M14 4.5h4.5v15H14" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  archive: <><rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5" /><path d="M5 9v10.5h14V9M10 13h4" /></>,
  wifioff: <><path d="M2.5 9a14 14 0 0 1 19 0M5.8 12.6a9 9 0 0 1 12.4 0M9.2 16.1a4 4 0 0 1 5.6 0" /><path d="M3.5 3.5l17 17" /></>,
  sync: <path d="M19.5 11A7.5 7.5 0 0 0 6.3 6.6L4.5 8.5M4.5 4v4.5H9M4.5 13a7.5 7.5 0 0 0 13.2 4.4l1.8-1.9M19.5 20v-4.5H15" />,
  half: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></>,
  skip: <><path d="M5 5.5l9 6.5-9 6.5z" /><path d="M18.5 5.5v13" /></>,
  minus: <path d="M5 12h14" />,
  flag: <path d="M5.5 21V4M5.5 4h11l-2.2 4.2 2.2 4.3h-11" />,
  play: <><path d="M8.5 5.8v12.4L18.5 12z" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  moon: <><path d="M18.5 14.6A7.2 7.2 0 0 1 9.4 5.5a7.2 7.2 0 1 0 9.1 9.1z" /></>,
  bolt: <><path d="M13 3.5L5.5 13.2h5.6L10.5 20.5l7.5-9.7h-5.6z" /></>,
  camera: <><path d="M3.5 8h3.2l2-2.8h6.6l2 2.8h3.2v11h-17z" /><circle cx="12" cy="13.2" r="3.4" /></>,
  copy: <><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" /><path d="M15.5 8.5V4H4v11.5h4.5" /></>,
  save: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></>,
  task: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12.2l2.8 2.8L16 9.5" /></>,
  user: <><circle cx="12" cy="8.5" r="3.6" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  wifi: <><path d="M2.5 9a14 14 0 0 1 19 0M5.8 12.6a9 9 0 0 1 12.4 0M9.2 16.1a4 4 0 0 1 5.6 0" /><circle cx="12" cy="19.5" r=".9" fill="currentColor" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10" r="2.3" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
