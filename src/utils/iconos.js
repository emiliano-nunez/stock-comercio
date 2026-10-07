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
  rayo: trazo('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>'),
  ajuste: trazo('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  lapiz: trazo('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),

  // Formulario.
  galeria: trazo('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m4 17 5-4.5 3.5 3 3-2.5L20 17"/>'),
  buscar: trazo('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.6-3.6"/>'),
  verificar: trazo('<path d="m4 12.5 5 5L20 6.5"/>'),

  // Las etiquetas del formulario, una por campo.
  caja: trazo('<path d="M21 8.5v7a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 15.5v-7a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8.5Z"/><path d="m3.3 7.5 8.7 5 8.7-5"/><path d="M12 21v-8.5"/>'),
  carpeta: trazo('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
  medida: trazo('<path d="M3.5 14.5 14.5 3.5l6 6-11 11z"/><path d="m7 11 2 2"/><path d="m10 8 2 2"/><path d="m13 5 2 2"/>'),
  dinero: trazo('<path d="M20.5 12.5 12 21l-9-9V4.5h7.5z"/><circle cx="8" cy="9" r="1.3"/><path d="M11.5 6.5H8v5"/><path d="M8 9h3"/><path d="M8 11.5h3"/>'),
  calendario: trazo('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>'),
  porcentaje: trazo('<circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="m18.5 5.5-13 13"/>'),
  calculadora: trazo('<rect x="4.5" y="2.5" width="15" height="19" rx="2"/><rect x="7.5" y="5.5" width="9" height="3.5" rx="1"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/>'),
  proveedor: trazo('<path d="M2.5 7.5h10v9h-10z"/><path d="M12.5 10.5h4l4 3.5v2.5h-8z"/><circle cx="6.5" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>'),

  // Varios.
  bombilla: trazo('<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 1.9v.2h5.2v-.2c0-.7.3-1.4.9-1.9A6 6 0 0 0 12 3Z"/>'),
  etiqueta: trazo('<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9Z"/><circle cx="7.5" cy="7.5" r="1.3"/>'),
  alerta: trazo('<path d="M12 3.5 22 20H2Z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>'),
  descargar: trazo('<path d="M12 3.5v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 18.5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/>'),
  subir: trazo('<path d="M12 15V4"/><path d="M7.5 8 12 3.5 16.5 8"/><path d="M4 18.5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/>'),
  refrescar: trazo('<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v4.5H16"/>'),
  ordenar: trazo('<path d="M4 6h13M4 12h9M4 18h5"/><path d="M17 4v16"/><path d="m14 17 3 3 3-3"/>'),
};

/**
 * Devuelve el SVG de un ícono por su nombre.
 *
 * @param {string} nombre  la clave en `ICONOS`
 * @returns {string} el SVG, o cadena vacía si el nombre no existe
 */
export function icono(nombre) {
  return ICONOS[nombre] || '';
}