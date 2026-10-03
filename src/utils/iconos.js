/**
 * Los iconos de la app, en SVG y en línea.
 *
 * Van en línea y no en archivo por dos razones: el trazo toma el color con
 * `currentColor`, así que el mismo icono sirve en el tema claro, en el oscuro
 * y en el violeta del estado elegido; y no hay que hacer un archivo por tamaño
 * ni acordarse de registrarlos en el manifiesto.
 *
 * El trazo es de 1.75px sobre una caja de 24, con las puntas redondeadas: es lo
 * que hace que se lean como un conjunto y no como dibujos pegados.
 *
 * Todos usan `aria-hidden`: el botón que los contiene lleva el `aria-label` con
 * el texto, y es ese el que lee el lector de pantalla. Un ícono sin nombre al
 * lado de un botón con nombre hace que lo lea dos veces.
 */
const NS = 'http://www.w3.org/2000/svg';

const trazo = (d, relleno = false) => `
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"
       xmlns="${NS}"
       ${relleno
         ? 'fill="currentColor"'
         : 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"'}>
    ${d}
  </svg>`;

/**
 * Los que la app usa hoy, más los que ya estaban en emoji.
 *
 * Los nombres van en español y son los mismos en las dos formas: el HTML pide
 * `icono('editar')` y `ICONOS.editar`.
 */
export const ICONOS = {
  // La fila de acciones de la tarjeta de inventario.
  duplicar: trazo('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  editar: trazo('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  eliminar: trazo('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>'),

  // La cabecera.
  camara: trazo('<path d="M3 8a2 2 0 0 1 2-2h2.5l1.2-2h6.6L16.5 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="12.5" r="3.2"/>'),
  escanear: trazo('<path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M3.5 12h17"/>'),
  mas: trazo('<path d="M12 5v14M5 12h14"/>'),
  lapiz: trazo('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),

  // Formulario.
  galeria: trazo('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m4 17 5-4.5 3.5 3 3-2.5L20 17"/>'),
  buscar: trazo('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.6-3.6"/>'),
  verificar: trazo('<path d="m4 12.5 5 5L20 6.5"/>'),

  // Varios.
  bombilla: trazo('<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 1.9v.2h5.2v-.2c0-.7.3-1.4.9-1.9A6 6 0 0 0 12 3Z"/>'),
  etiqueta: trazo('<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9Z"/><circle cx="7.5" cy="7.5" r="1.3"/>'),
  alerta: trazo('<path d="M12 3.5 22 20H2Z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>'),
  historial: trazo('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/>'),
};

/**
 * Devuelve el SVG de un ícono por su nombre.
 *
 * @param {string} nombre  la clave en `ICONOS`
 * @param {string} [clase] clase extra para el <svg>, si hace falta
 * @returns {string} el SVG, o cadena vacía si el nombre no existe
 */
export function icono(nombre, clase = '') {
  const svg = ICONOS[nombre];
  if (!svg) return '';
  return clase ? svg.replace('<svg ', `<svg class="${clase}" `) : svg;
}