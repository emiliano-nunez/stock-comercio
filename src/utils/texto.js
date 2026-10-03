
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

/**
 * La fecha y hora de la compilación, corta y legible.
 *
 * `__FECHA_BUILD__` es el instante de la compilación en UTC, que es lo que arma
 * `toISOString`. Acá se pasa a la hora local de quien está mirando, que es lo que
 * significa "cuándo se compiló": antes se pintaban los números de UTC tal cual, así
 * que una compilación de las 18 salía en el pie como las 21.
 *
 * El comentario de `fechaEnDia` de arriba dice que no hay que pasar la fecha por
 * `new Date`, y es cierto: allí el texto es un día suelto ("2026-03-12") que
 * `new Date` lo toma como medianoche UTC y al pasarlo a local se corre un día
 * entero para cualquiera al oeste de UTC. Acá no pasa eso, porque el texto trae
 * además la hora y la `Z`: es un instante, no un día, y no hay forma de que al
 * convertirlo se corra la fecha.
 *
 * El formato se arma con los números de la fecha local y no con `toLocaleString`,
 * porque el que sale de latter trae una coma y depende del idioma del navegador.
 */
export function fechaYHora(iso) {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';

  const dos = (n) => String(n).padStart(2, '0');
  const dia = dos(fecha.getDate());
  const mes = dos(fecha.getMonth() + 1);
  const anio = fecha.getFullYear();
  const hora = dos(fecha.getHours());
  const minuto = dos(fecha.getMinutes());

  return `${dia}/${mes}/${anio} ${hora}:${minuto}`;
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
