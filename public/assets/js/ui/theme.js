/**
 * Theme switcher: Dark / Light Liquid Glass, persisted via localStorage.
 */

const STORAGE_KEY = 'ims13-theme';
const THEME_COLORS = { dark: '#0a0c14', light: '#f5f5f7' };

export function getTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme) {
  const target = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', target);
  localStorage.setItem(STORAGE_KEY, target);
  // Update the browser chrome / PWA bar color
  const metaColor = document.querySelector('meta[name="theme-color"]');
  if (metaColor) metaColor.content = THEME_COLORS[target];
  updateToggleButtons(target);
  return target;
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || getTheme();
  return setTheme(current === 'dark' ? 'light' : 'dark');
}

function updateToggleButtons(theme) {
  for (const btn of document.querySelectorAll('.theme-toggle')) {
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
  }
}

export function initTheme(button) {
  // Apply the persisted/preferred theme immediately
  const current = getTheme();
  setTheme(current);

  if (button) {
    button.addEventListener('click', () => toggleTheme());
  }
}
