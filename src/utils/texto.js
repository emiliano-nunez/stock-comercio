
/**
 * La fecha de compra es un día, no un instante: la elige el usuario en un
 * `<input type="date">` y llega como "2026-03-12".
 *
 * Pasarla por `new Date()` la corre un día entero para cualquiera que esté al
 * oeste de UTC, porque "2026-03-12" se interpreta como medianoche UTC y al
 * pasarlo a la zona local son las 21 del día anterior. Por eso se desarma el
 * texto: son tres números que ya están en el orden que se quiere mostrar.
 */
export function fechaEnDia(fecha) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha || ''));
  if (!partes) return '';
  return `${partes[3]}/${partes[2]}/${partes[1]}`;
}

export function normalizarTexto(texto) {
  return (texto ?? '')
    .toString()
    .normalize('NFD')

    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
