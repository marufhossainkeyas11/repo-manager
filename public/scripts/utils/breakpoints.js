// Kept in sync with the @media queries in styles/responsive.css. CSS
// can't read these JS constants directly (no bundler/preprocessor here),
// so this is a documented known-limitation duplication — if you change a
// breakpoint here, change the matching @media rule in responsive.css too.
export const MOBILE_MAX = 640;
export const TABLET_MAX = 1024;

export function isMobile() { return window.innerWidth <= MOBILE_MAX; }
export function isTablet() { return window.innerWidth > MOBILE_MAX && window.innerWidth <= TABLET_MAX; }
export function isDesktop() { return window.innerWidth > TABLET_MAX; }
