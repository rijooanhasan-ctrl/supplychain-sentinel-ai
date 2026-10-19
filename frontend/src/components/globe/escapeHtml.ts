/**
 * Strict HTML escaping helper for user-supplied strings (supplier/warehouse names).
 * Used when building tooltips or HTML strings for 3D globe overlays.
 */

export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Creates a safe DOM text node inside a container element, ensuring
 * scripts or HTML tags are never interpreted by the browser.
 */
export function createSafeElement(tag: string, text: string, className?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  el.textContent = text;
  return el;
}
