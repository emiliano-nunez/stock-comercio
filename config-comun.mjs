/*
 * Lo que la app y las pruebas necesitan saber del build, en un solo lugar.
 *
 * Uso: lo importan `vite.config.js` (para compilar) y `vitest.config.js` (para
 * probar). Vive aparte porque las dos necesitan lo mismo y antes cada una lo sacaba
 * por su cuenta, con el resultado de que la app se dibujaba con la versión del
 * build y las pruebas con otra: un número distinto y la fecha de siempre, sin que
 * nadie lo notara.
 */
import { readFileSync } from 'node:fs';

/**
 * La ruta en la que se publica la app.
 *
 * Todo lo que dependa de dónde vive la app tiene que salir de este valor: los
 * assets que genera Vite, el alcance del service worker, la dirección con la que
 * arranca la PWA instalada y sus accesos directos. Si cada uno se escribiera por
 * su cuenta, en un deploy que no sea la raíz se rompe por lo menos uno, y la
 * falla es silenciosa: pantalla en blanco, o una PWA instalada que abre la
 * página equivocada.
 *
 *   Netlify, o github pages de usuario (el repo se llama "usuario.github.io"):
 *     '/'
 *   Github pages de proyecto (el repo se llama, por ejemplo, "stock-comercio"):
 *     '/stock-comercio/'
 *
 * Se puede sobrescribir con la variable de entorno VITE_BASE_PATH, que es lo que
 * conviene en un deploy automatizado para no editar los archivos.
 */
const RUTA_PUBLICA = process.env.VITE_BASE_PATH || '/';

// La ruta tiene que empezar Y terminar en barra, y el motivo es concreto:
// `base + '#scan'` se concatena sin separador. Con base '/stock-comercio' (sin
// la barra final) el acceso directo salía como '/stock-comercio#scan', y el
// navegador lo leía como un ancla dentro de la página, no como la app con un
// atajo. Hay que normalizar los dos extremos, no sólo el de adelante.
export const base = `/${RUTA_PUBLICA.replace(/^\/+|\/+$/g, '')}/`.replace(/\/{2,}/g, '/');

/*
 * La versión que se muestra al pie de la app.
 *
 * Sale de package.json y no de un número escrito en el código, para que las dos
 * cosas no puedan separarse: si el número está en un solo lado, cambiarlo es
 * recordar cambiarlo, y si no se cambia la app dice una versión que ya no es.
 *
 * El prefijo "v" va acá y no en el pie, para que el pie sea sólo el texto que se
 * ve.
 */
const VERSION = readFileSync(new URL('./package.json', import.meta.url), 'utf8');
export const NUMERO_VERSION = `v${JSON.parse(VERSION).version}`;

/*
 * La fecha y hora de la compilación, acá y no en el código.
 *
 * El número de versión lo sube una persona y se desactualiza sin que se note: el
 * pie decía una versión vieja y no había forma de saber cuánto hacía que no se
 * recompilaba. Con la fecha al lado, cualquier compilación vieja se ve a simple
 * vista.
 */
export const FECHA_BUILD = new Date().toISOString();

/*
 * Lo que se reemplaza al compilar, y que el código usa como si fuera una variable
 * normal. Van como texto ya entrecomillado porque así los pinta el pie y no hace
 * falta para nada más. Si algún día hay que compararlos, se destraban acá.
 */
export const DEFINES = {
  __VERSION__: JSON.stringify(NUMERO_VERSION),
  __FECHA_BUILD__: JSON.stringify(FECHA_BUILD)
};