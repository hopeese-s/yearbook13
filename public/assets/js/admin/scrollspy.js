/** Scrollspy (Phase 7): highlights the sidebar link for the visible section. */

export function initScrollspy(nav, sections, { offset = 110 } = {}) {
  if (!nav || sections.length === 0) return { destroy: () => {} };
  const links = new Map();
  for (const link of nav.querySelectorAll('a[href^="#"]')) {
    links.set(link.getAttribute('href').slice(1), link);
  }

  function update() {
    let current = sections[0]?.id;
    for (const section of sections) {
      if (section.getBoundingClientRect().top - offset <= 0) current = section.id;
    }
    for (const [id, link] of links) {
      link.classList.toggle('active', id === current);
      if (id === current) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  }

  const onScroll = () => update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();

  return {
    destroy() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    },
  };
}
