/**
 * Helpers para construir HTML con datos del usuario.
 *
 * Los nombres de productos y categorías se interpolan en plantillas que
 * terminan en innerHTML. Sin escapar, un nombre como `Café <b>10</b>` inyecta
 * etiquetas y `Aceite "AES"` rompe el atributo alt="...", dejando el botón de
 * editar asociado al producto equivocado.
 */

/**
 * Escapa texto para insertarlo en el contenido de un elemento.
 * Sustituye & < > por sus entidades HTML.
 */
export function esc(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapa texto para insertarlo dentro de un atributo HTML con comillas dobles.
 * Aplica además esc(), y escapa " para que no cierre el atributo.
 */
export function escAttr(texto) {
  return esc(texto).replace(/"/g, '&quot;');
}

/**
 * Formatea un número como precio en pesos.
 * Devuelve string vacío para valores no numéricos, para no imprimir "NaN".
 */
export function fmtPrecio(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
