/**
 * Helpers para interpolar datos del usuario dentro de plantillas que terminan en
 * innerHTML.
 *
 * Sin escapar, un nombre como `Café <b>10</b>` inyecta etiquetas y
 * `Aceite "AES"` cierra el atributo alt="...", dejando el botón de editar
 * asociado al producto equivocado.
 */

export function esc(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Como esc(), pero además escapa " para que no cierre un atributo. */
export function escAttr(texto) {
  return esc(texto).replace(/"/g, '&quot;');
}

export function fmtPrecio(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
