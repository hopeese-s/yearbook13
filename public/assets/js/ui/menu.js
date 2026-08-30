import { el } from './dom.js';

/** Hamburger menu: toggles the dock on small screens. */
export function initMenu() {
  const button = document.getElementById('menu-btn');
  const dock = document.getElementById('dock');
  if (!button || !dock) return;

  const setOpen = (open) => {
    button.setAttribute('aria-expanded', String(open));
    dock.classList.toggle('open', open);
  };

  button.addEventListener('click', () => {
    setOpen(button.getAttribute('aria-expanded') !== 'true');
  });

  dock.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });

  window.addEventListener(
    'resize',
    () => {
      if (window.innerWidth > 720) setOpen(false);
    },
    { passive: true },
  );
}

/** Build filter chips into a container; returns a setter for the active value. */
export function initChips(container, values, { onSelect } = {}) {
  container.replaceChildren();
  const make = (label, value, active) =>
    el('button', {
      class: `chip${active ? ' active' : ''}`,
      type: 'button',
      text: label,
      'aria-pressed': String(active),
      onclick: () => onSelect?.(value),
    });

  container.append(make('All', '', true));
  for (const value of values) container.append(make(value, value, false));

  return {
    setActive(value) {
      for (const chip of container.querySelectorAll('.chip')) {
        const isActive = chip.textContent === (value || 'All');
        chip.classList.toggle('active', isActive);
        chip.setAttribute('aria-pressed', String(isActive));
      }
    },
  };
}
