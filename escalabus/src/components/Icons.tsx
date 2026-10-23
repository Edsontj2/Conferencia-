import type { ReactNode } from 'react';

/** Ícones em linha (estilo traço), sem dependências externas. */
function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}
export const Icon = {
  home: () => <Svg><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></Svg>,
  calendar: () => <Svg><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 9.5h18M8 3v3M16 3v3" /><path d="M7.5 13.5h3M13.5 13.5h3M7.5 17h3" /></Svg>,
  report: () => <Svg><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /><path d="M9 12h7M9 15.5h7M9 19h4" /></Svg>,
  history: () => <Svg><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7.5V12l3 2" /></Svg>,
  people: () => <Svg><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.6c2.6-.3 4.8 1.3 5.5 4.4" /></Svg>,
  route: () => <Svg><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></Svg>,
  bus: () => <Svg><rect x="4" y="3" width="16" height="15" rx="3" /><path d="M4 11h16M8 21v-3M16 21v-3" /><circle cx="8" cy="14.5" r=".8" fill="currentColor" /><circle cx="16" cy="14.5" r=".8" fill="currentColor" /></Svg>,
  clock: () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></Svg>,
  settings: () => <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>,
  logout: () => <Svg><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></Svg>,
  menu: () => <Svg><path d="M4 6h16M4 12h16M4 18h16" /></Svg>,
  close: () => <Svg><path d="M6 6l12 12M18 6 6 18" /></Svg>,
  chevronLeft: () => <Svg><path d="m15 18-6-6 6-6" /></Svg>,
  alert: () => <Svg><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17.5v.1" /></Svg>,
  check: () => <Svg><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></Svg>,
  dice: () => <Svg><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /><circle cx="15" cy="9" r="1" fill="currentColor" /><circle cx="9" cy="15" r="1" fill="currentColor" /></Svg>,
  edit: () => <Svg size={17}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></Svg>,
  trash: () => <Svg size={17}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></Svg>,
  swap: () => <Svg size={17}><path d="M7 4 3 8l4 4" /><path d="M3 8h13" /><path d="m17 20 4-4-4-4" /><path d="M21 16H8" /></Svg>,
  power: () => <Svg size={17}><path d="M12 3v8" /><path d="M6.3 7.3a8 8 0 1 0 11.4 0" /></Svg>,
  shuffle: () => <Svg><path d="M3 7h3.5c2 0 3.4 1 4.5 2.7l2 3.6C14.1 15 15.5 16 17.5 16H21" /><path d="M3 17h3.5c1.4 0 2.5-.5 3.4-1.4" /><path d="M14 8.4c.9-.9 2-1.4 3.5-1.4H21" /><path d="m18 4 3 3-3 3M18 13l3 3-3 3" /></Svg>,
  pdf: () => <Svg><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /><path d="M9 16h6M12 11v5" /></Svg>,
  whatsapp: () => <Svg><path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3z" /><path d="M9 8.5c0 3.5 2.5 6.5 6.5 6.5l1-1.6-2-1-.9.8c-1-.4-2.3-1.6-2.8-2.8l.8-.9-1-2L9 8.5z" /></Svg>,
  eraser: () => <Svg><path d="m7 21-4-4 11-11 7 7-8 8z" /><path d="M7 21h13M10 10l7 7" /></Svg>,
  plus: () => <Svg><path d="M12 5v14M5 12h14" /></Svg>,
  search: () => <Svg size={18}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>,
  user: () => <Svg size={16}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></Svg>,
  chart: () => <Svg><path d="M5 21V10M12 21V4M19 21v-7" /></Svg>,
  chevronRight: () => <Svg><path d="m9 18 6-6-6-6" /></Svg>,
  upload: () => <Svg><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></Svg>,
  image: () => <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></Svg>,
  wifiOff: () => <Svg><path d="M2 2l20 20" /><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.4-1.7M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 11 5" /><path d="M12 20h.01" /></Svg>,
};
