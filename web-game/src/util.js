export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const $ = (root, sel) => root.querySelector(sel);
export const $$ = (root, sel) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function fmt(v, d = 1) {
  return Number.isFinite(v) ? v.toFixed(d) : '-';
}

export const SOURCE_LABEL = { measured: '측정', derived: '측정유래', estimated: '추정' };

export function tag(source) {
  return `<span class="tag ${source}">${SOURCE_LABEL[source] ?? source}</span>`;
}

export function newId(prefix = 'rec') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${Math.random().toString(36).slice(2, 6)}`;
}
