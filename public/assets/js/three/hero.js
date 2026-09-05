import * as THREE from '../vendor/three.module.js';
import { roundedTexture, glassFrameMaterial, studioEnvironment } from './materials.js';

/**
 * Floating glass photo-card hero (approved direction).
 *
 * Fallback tiers (approved R7):
 *   - desktop, WebGL on, motion OK  -> full drifting glass cluster + cursor tilt
 *   - prefers-reduced-motion        -> static composed render (no animation)
 *   - no WebGL / weak device        -> CSS fallback (three/fallback.js)
 *
 * Resource bounds: capped pixel ratio, paused rendering when offscreen or
 * when the tab is hidden, full disposal on destroy.
 */

const CARD_COUNT_DESKTOP = 7;
const CARD_COUNT_MOBILE = 5;
const CARD_COUNT_WEAK = 3;

function deviceTier() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const weakDevice = (navigator.hardwareConcurrency ?? 8) <= 4;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  const hasWebGL = Boolean(context);
  // Release the probe context so it does not linger for the page lifetime.
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  return { reducedMotion, weakDevice, hasWebGL, mobile };
}

export async function initHero(mount, photos) {
  const tier = deviceTier();
  const usable = photos.filter((photo) => photo.thumbUrl).slice(0, 14);
  if (usable.length === 0) return { destroy: () => {} };

  if (!tier.hasWebGL) {
    const { renderHeroFallback } = await import('./fallback.js');
    return renderHeroFallback(mount, usable);
  }

  const width = mount.clientWidth || 800;
  const height = mount.clientHeight || 420;

  const renderer = new THREE.WebGLRenderer({ antialias: !tier.weakDevice, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.weakDevice ? 1.25 : 1.75));
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = 'hero-canvas';
  mount.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 60);
  camera.position.set(0, 0, 7.2);

  const envTexture = studioEnvironment(renderer, scene);

  // Lights: one soft key + rim for the glass edges.
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.6);
  rim.position.set(-4, -2, 3);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  const count = tier.mobile ? CARD_COUNT_MOBILE : tier.weakDevice ? CARD_COUNT_WEAK : CARD_COUNT_DESKTOP;
  const chosen = usable.slice(0, count);
  const aspectRatio = height / width;

  const cards = await Promise.all(
    chosen.map(async (photo, index) => {
      try {
        const thumbUrl = photo.id
          ? `/api/photos/${encodeURIComponent(photo.id)}/thumb?proxy=1`
          : photo.thumbUrl;
        const texture = await roundedTexture(thumbUrl);
        const imageAspect = texture.image ? texture.image.width / texture.image.height : 4 / 3;
        // Portrait phones have a narrow horizontal frustum: use smaller cards
        // and a tighter cluster so the whole group stays visible.
        const cardWidth = tier.mobile ? 1.35 : 2.1;
        const cardHeight = cardWidth / imageAspect;

        const photoPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(cardWidth, cardHeight),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
        );
        photoPlane.position.z = 0.012;

        const frame = new THREE.Mesh(
          new THREE.PlaneGeometry(cardWidth + 0.16, cardHeight + 0.16),
          glassFrameMaterial(),
        );

        const card = new THREE.Group();
        card.add(frame, photoPlane);

        // Drifting cluster layout (seeded, deterministic composition).
        // Portrait phones: tighter spread so every card stays in the frustum.
        const angle = (index / count) * Math.PI * 2;
        if (tier.mobile) {
          card.position.x = Math.cos(angle) * 0.85 + (index % 2 === 0 ? 0.35 : -0.2);
          card.position.y = Math.sin(angle) * 1.4 + (index % 3 - 1) * 0.85;
          card.position.z = -0.3 + (index % 3) * 0.3;
        } else {
          card.position.x = Math.cos(angle) * 1.8 + 2.0 + (index % 2 === 0 ? 0.4 : -0.3);
          card.position.y = (Math.sin(angle) * 1.2 + (index % 3 - 1) * 0.6) * aspectRatio * 2.0;
          card.position.z = -0.4 + (index % 4) * 0.35;
        }
        card.rotation.set((index % 3 - 1) * 0.12, (index % 2 === 0 ? 1 : -1) * 0.28, (index % 5 - 2) * 0.1);
        card.userData = {
          baseX: card.position.x,
          baseY: card.position.y,
          phase: index * 1.7,
          floatAmp: 0.08 + (index % 3) * 0.03,
        };
        group.add(card);
        return card;
      } catch {
        return null;
      }
    }),
  );

  const validCards = cards.filter(Boolean);
  if (validCards.length === 0) {
    renderer.dispose();
    renderer.domElement.remove();
    const { renderHeroFallback } = await import('./fallback.js');
    return renderHeroFallback(mount, chosen);
  }

  // Cursor tilt (desktop, motion allowed).
  let targetTiltX = 0;
  let targetTiltY = 0;
  const onPointerMove = (event) => {
    if (tier.reducedMotion) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    targetTiltY = x * 0.22;
    targetTiltX = y * 0.14;
  };
  if (!tier.mobile) window.addEventListener('pointermove', onPointerMove, { passive: true });

  const onResize = () => {
    const w = mount.clientWidth || width;
    const h = mount.clientHeight || height;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    // Reduced-motion renders a single static frame; keep it fresh on resize.
    if (tier.reducedMotion) renderer.render(scene, camera);
  };
  window.addEventListener('resize', onResize, { passive: true });

  // Render only when visible (IntersectionObserver) and when the tab shows.
  let visible = true;
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  observer.observe(mount);
  let tabVisible = !document.hidden;
  const onVisibility = () => {
    tabVisible = !document.hidden;
  };
  document.addEventListener('visibilitychange', onVisibility);

  const clock = new THREE.Clock();
  let rafId = 0;

  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!visible || !tabVisible) return; // bounded rendering work
    const t = clock.getElapsedTime();

    if (!tier.reducedMotion) {
      for (const card of cards) {
        if (!card) continue;
        card.position.y = card.userData.baseY + Math.sin(t * 0.8 + card.userData.phase) * card.userData.floatAmp;
        card.rotation.z += Math.sin(t * 0.4 + card.userData.phase) * 0.0004;
      }
      if (tier.mobile) {
        // No cursor on phones: give the cluster a gentle self-sway instead.
        group.rotation.y = Math.sin(t * 0.35) * 0.14;
        group.rotation.x = Math.sin(t * 0.25) * 0.05;
      } else {
        group.rotation.x += (targetTiltX - group.rotation.x) * 0.06;
        group.rotation.y += (targetTiltY - group.rotation.y) * 0.06;
      }
    } else {
      // Reduced motion: render one static composed frame, then stop.
      renderer.render(scene, camera);
      cancelAnimationFrame(rafId);
      return;
    }
    renderer.render(scene, camera);
  }
  frame();

  return {
    destroy() {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const card of cards) {
        if (!card) continue;
        card.traverse((child) => {
          child.geometry?.dispose?.();
          const material = child.material;
          if (Array.isArray(material)) {
            for (const m of material) m.dispose();
          } else {
            material?.dispose?.();
          }
          if (material?.map) material.map.dispose();
        });
      }
      renderer.dispose();
      envTexture.dispose();
      scene.environment = null;
      renderer.domElement.remove();
    },
  };
}
