/** Focus policy (approved): no default rings; subtle glass glow for keyboard users only. */

export function initFocusPolicy() {
  const onKeyDown = (event) => {
    if (event.key === 'Tab') document.body.classList.add('is-keyboard');
  };
  const onPointer = () => document.body.classList.remove('is-keyboard');

  window.addEventListener('keydown', onKeyDown, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });
}
