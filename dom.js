// Tiny DOM builder; text always goes in via textContent, never as HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v != null) el.setAttribute(k, v);
  }
  el.append(...children.filter((c) => c != null));
  return el;
}
