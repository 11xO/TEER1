// Apply the saved appearance before the application and styles load.
(() => {
  let theme = 'light';
  try { if (localStorage.getItem('teer_theme') === 'dark') theme = 'dark'; } catch { /* Storage is optional. */ }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1220' : '#8b5cf6');
})();
