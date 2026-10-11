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

/**
 * Precio para mostrar: entero con punto de miles (es-ES separa miles con "."
 * y decimales con ","), sin decimales.
 *
 * Los precios de esta app se cargan en pesos enteros y las decimales que
 * aparecían sólo ensuciaban la tarjeta: `$1.500,00` lee igual que `$1.500` y
 * ocupa el doble. El valor guardado no se toca, sólo lo que se pinta.
 */
export function fmtPrecio(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('es-ES', { maximumFractionDigits: 0 });
}
