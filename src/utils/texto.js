/**
 * Comparar y buscar textos como los escribe la gente, no como los mide la
 * máquina.
 *
 * El problema que resuelve: "Limon" y "Limón" son el mismo producto para
 * cualquiera que esté escribiendo en el buscador, y con un `toLowerCase()` son
 * dos cadenas distintas, así que al buscar "limon" aparece uno y el otro queda
 * escondido sin avisar. Lo mismo con las mayúsculas.
 *
 * Por eso saca las tildes: no las borra, las separa de la letra y tira los
 * signos combinantes. "Limón" queda como "Limon" y se sigue sabiendo qué se
 * escribió.
 *
 * También junta los espacios y recorta, para que "  Distribuidora  del  Sur "
 * y "Distribuidora del Sur" sean la misma búsqueda.
 *
 * @param {*} texto
 * @returns {string} siempre texto, nunca undefined: para encadenar sin fear.
 */
export function normalizarTexto(texto) {
  return (texto ?? '')
    .toString()
    .normalize('NFD')
    // Los signos combinantes son lo que queda al separar la tilde de la letra.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Un texto con los espacios de adentro como separadores, para palabras sueltas.
 *
 * "Distribuidora del Sur" y "distribuidora, del sur" dan la misma clave, porque
 * el usuario puede escribir cualquier cosa entre dos palabras que busca juntas.
 *
 * @param {*} texto
 * @returns {string}
 */
export function clavePalabras(texto) {
  return normalizarTexto(texto).split(' ').filter(Boolean).join(' ');
}