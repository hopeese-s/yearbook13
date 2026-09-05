import { el, clear } from '../ui/dom.js';

/**
 * Weak-device / no-WebGL fallback: a CSS-composed cluster of glass photo
 * cards that mirrors the hero's composition without any rendering cost.
 */
export function renderHeroFallback(mount, photos) {
  clear(mount);
  const scene = el('div', { class: 'hero-fallback', 'aria-hidden': 'true' });
  scene.style.cssText = [
    'position:absolute',
    'inset:0',
    'perspective:900px',
    'overflow:hidden',
  ].join(';');

  const isMobile = window.innerWidth <= 720;
  const layouts = isMobile
    ? [
        { x: '42%', y: '10%', z: 'rotate(-6deg)', w: 140 },
        { x: '58%', y: '40%', z: 'rotate(5deg)', w: 130 },
        { x: '35%', y: '58%', z: 'rotate(-10deg)', w: 120 },
      ]
    : [
        { x: '58%', y: '10%', z: 'rotate(-8deg)', w: 200 },
        { x: '75%', y: '38%', z: 'rotate(6deg)', w: 170 },
        { x: '52%', y: '56%', z: 'rotate(-12deg)', w: 150 },
        { x: '82%', y: '8%', z: 'rotate(10deg)', w: 130 },
        { x: '66%', y: '68%', z: 'rotate(4deg)', w: 140 },
      ];

  photos.slice(0, layouts.length).forEach((photo, index) => {
    const layout = layouts[index];
    const card = el('div', { class: 'photo-card hero-fallback-card' });
    const img = el('img', { src: photo.thumbUrl, alt: photo.caption || '', loading: 'eager' });
    card.append(img);
    card.style.cssText = [
      'position:absolute',
      `left:${layout.x}`,
      `top:${layout.y}`,
      `width:${layout.w}px`,
      `transform:${layout.z}`,
      'border-radius:12px',
      'overflow:hidden',
      'box-shadow:0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.15)',
    ].join(';');
    scene.append(card);
  });

  mount.append(scene);
  return { destroy: () => scene.remove() };
}
