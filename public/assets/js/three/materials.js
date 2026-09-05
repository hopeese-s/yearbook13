import * as THREE from '../vendor/three.module.js';

/** Shared Three.js material/texture builders for the glass photo-card hero. */

/** Load an image URL into a rounded-corner texture (canvas, anisotropic). */
export function roundedTexture(url, radiusRatio = 0.06) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 640 / Math.max(image.width, image.height));
        canvas.width = Math.max(2, Math.round(image.width * scale));
        canvas.height = Math.max(2, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d');
        const radius = Math.min(canvas.width, canvas.height) * radiusRatio;

        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.arcTo(canvas.width, 0, canvas.width, canvas.height, radius);
        ctx.arcTo(canvas.width, canvas.height, 0, canvas.height, radius);
        ctx.arcTo(0, canvas.height, 0, 0, radius);
        ctx.arcTo(0, 0, canvas.width, 0, radius);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        resolve(texture);
      } catch (err) {
        reject(err);
      }
    };
    image.onerror = () => reject(new Error(`Failed to load hero image: ${url}`));
    image.src = url;
  });
}

/** Physically-glassy frame material (Liquid Glass in three.js terms). */
export function glassFrameMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 0.92,
    thickness: 0.6,
    roughness: 0.12,
    metalness: 0,
    ior: 1.45,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
    transparent: true,
    opacity: 0.96,
    envMapIntensity: 1.2,
  });
}

/** Ambient studio environment (gradient room) — cheap, no HDR download. */
export function studioEnvironment(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(20, 24, 16);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#e3ecf8');
  gradient.addColorStop(0.5, '#fafbfd');
  gradient.addColorStop(1, '#e9e6f2');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 16, 256);
  const gradientTexture = new THREE.CanvasTexture(canvas);
  gradientTexture.colorSpace = THREE.SRGBColorSpace;
  mat.map = gradientTexture;
  envScene.add(new THREE.Mesh(geo, mat));
  const envTexture = pmrem.fromScene(envScene, 0.04).texture;
  scene.environment = envTexture;
  pmrem.dispose();
  return envTexture;
}
