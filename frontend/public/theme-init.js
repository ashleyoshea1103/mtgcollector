// Puts the page in the theme chosen in this browser before it's first drawn, so a light-theme
// choice doesn't flash dark. A classic script in <head> runs before the first paint, which the
// app's module script doesn't; the CSP allows it as a file from the site (no inline script).
// The key and the mark are src/lib/theme.ts's, which does everything else with the theme.
try {
  if (localStorage.getItem('mtgcollector-theme') === 'light') document.documentElement.dataset.theme = 'light';
} catch {
  // Storage blocked: the dark theme stands.
}
