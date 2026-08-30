/** Tiny DOM helpers shared by all frontend modules. */

// Variadic children: el('div', {}, child1, child2) AND el('div', {}, [child1, child2])
// both work — components call it both ways.
export function el(tag, props = {}, ...childArgs) {
  const node = document.createElement(tag);
  const children = childArgs.length === 1 && Array.isArray(childArgs[0]) ? childArgs[0] : childArgs;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // caller-provided markup only
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function show(node) {
  node.hidden = false;
}

export function hide(node) {
  node.hidden = true;
}

/** Render one of the standard states (loading / empty / error) into a panel. */
export function renderState(panel, { kind, title, detail }) {
  clear(panel);
  panel.hidden = false;
  if (kind === 'loading') {
    panel.append(
      el('div', { class: 'state-spinner', role: 'status' }),
      el('span', { class: 'muted', text: detail ?? 'Loading…' }),
    );
    return;
  }
  if (kind === 'empty') {
    panel.append(el('p', { class: 'state-title', text: title ?? 'Nothing here yet' }),
      el('span', { class: 'muted', text: detail ?? '' }));
    return;
  }
  panel.append(
    el('p', { class: 'state-title', text: title ?? 'Something went wrong' }),
    el('span', { class: 'muted', text: detail ?? 'Please try again later.' }),
    el('button', { class: 'btn', type: 'button', text: 'Retry', onclick: () => window.location.reload() }),
  );
}
