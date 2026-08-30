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

  const layouts = [
    { x: '62%', y: '12%', z: 'rotate(-8deg)', w: 190 },
    { x: '78%', y: '42%', z: 'rotate(6deg)', w: 150 },
    { x: '55%', y: '58%', z: 'rotate(-14deg)', w: 130 },
    { x: '84%', y: '8%', z: 'rotate(12deg)', w: 110 },
  ];

  photos.slice(0, layouts.length).forEach((photo, index) => {
    const layout = layouts[index];
    const card = el('div', { class: 'photo-card' });
    const img = el('img', { src: photo.thumbUrl, alt: '' });
    img.loading = 'lazy';
    card.append(img);
    card.style.cssText = [
      `position:absolute`,
      `left:${layout.x}`,
      `top:${layout.y}`,
      `width:${layout.w}px`,
      `transform:${layout.z}`,
      `box-shadow:0 20px 50px rgba(0,0,0,0.55)`,
    ].join(';');
    scene.append(card);
  });

  mount.append(scene);
  return { destroy: () => scene.remove() };
}
