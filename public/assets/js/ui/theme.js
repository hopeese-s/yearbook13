/**
 * Theme switcher: handles Dark / Light Liquid Glass theme toggling with localStorage persistence.
 */

const STORAGE_KEY = 'ims13-theme';

export function getTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme) {
  const target = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', target);
  localStorage.setItem(STORAGE_KEY, target);
  updateToggleButtons(target);
  return target;
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  return setTheme(next);
}

function updateToggleButtons(theme) {
  const btns = document.querySelectorAll('.theme-toggle');
  for (const btn of btns) {
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.innerHTML = theme === 'dark' ? '<span aria-hidden="true">☀️</span>' : '<span aria-hidden="true">🌙</span>';
  }
}

export function initTheme(button) {
  const current = document.documentElement.getAttribute('data-theme') || getTheme();
  setTheme(current);

  if (button) {
    button.classList.add('theme-toggle');
    button.addEventListener('click', () => toggleTheme());
    updateToggleButtons(current);
  }
}
