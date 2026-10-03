/**
 * Compara textos como los escribe la gente, no como los mide la máquina.
 *
 * Saca tildes, pasa a minúsculas, junta espacios y recorta. "Limón", "limon" y
 * "  LIMON " dan la misma clave, y con un `toLowerCase()` a secas no: la búsqueda
 * encontraría uno y dejaría al otro escondido sin avisar.
 *
 * La tilde no se borra, se separa de la letra y se tira el signo combinante, así
 * que el resultado sigue siendo legible.
 */
export function normalizarTexto(texto) {
  return (texto ?? '')
    .toString()
    .normalize('NFD')
    // lo que queda al separar la tilde de la letra
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
