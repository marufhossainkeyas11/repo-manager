// Mirrors --bp-mobile / --bp-tablet in styles/base.css and the media
// queries in styles/responsive.css. CSS custom properties can't be read
// inside a @media query, so these numbers are a deliberate, commented
// duplication (see section 4.1 of the redesign plan) — if you change a
// breakpoint, change it in both places.
export const MOBILE_MAX = 640;
export const TABLET_MAX = 1024;

export function isMobile() { return window.innerWidth <= MOBILE_MAX; }
export function isTabletOrBelow() { return window.innerWidth <= TABLET_MAX; }
export function isDesktop() { return window.innerWidth > TABLET_MAX; }
