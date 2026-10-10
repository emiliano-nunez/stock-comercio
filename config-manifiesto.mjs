/*
 * El manifiesto de la PWA, en un solo lugar.
 *
 * Vive aparte de `vite.config.js` por el mismo motivo que `config-comun.mjs`:
 * las dos cosas que lo necesitan son la compilación y las pruebas. Si el
 * manifiesto estuviera escrito adentro del config de Vite, la única forma de
 * verificarlo sería compilar primero y leer el `dist/`, que es mirar el efecto
 * y no la causa: un campo que falta se ve recién en el build, y en el orden del
 * pipeline (`verificar`, `test`, `build`) el test corre ANTES de compilar, así
 * que ni siquiera habría un `dist/` que leer.
 *
 * Acá se testea lo que se compila, porque es literalmente el mismo objeto.
 */
import { base } from './config-comun.mjs';

/*
 * La identidad de la app para el sistema.
 *
 * Sin `id`, los lanzadores derivan la identidad de `start_url`. El problema con
 * eso es que `start_url` depende de `VITE_BASE_PATH`, que cambia entre deploys
 * (raíz en Netlify, subdirectorio en github pages de proyecto): con la
 * identidad atada a la dirección, un cambio de ruta no actualiza la app
 * instalada, la duplica. Con `id` fijo en la ruta de publicación, la app es la
 * misma mientras la ruta no cambie, y si cambia se nota enseguida.
 */
const id = base;

export const MANIFIESTO = {
  name: 'DepoApp',
  short_name: 'DepoApp',
  description: 'Control de inventario local-first para comerciantes',

  id,

  // vite-plugin-pwa pone 'en' si no se dice nada, y eso es lo que algunos
  // lanzadores usan para decidir el idioma de la app instalada.
  lang: 'es',
  dir: 'ltr',

  // El color de la barra del sistema y del splash tienen que ser el verde
  // de la cabecera, que es el mismo degradado que el ícono. Con el verde
  // oscuro anterior, la barra del navegador en el celular instalado salía
  // oscura encima de una cabecera clara.
  theme_color: '#bbf7d0',
  background_color: '#f0fdf4',
  display: 'standalone',

  // 'any' y no 'portrait': portrait deja la app instalada sin poder girar, y
  // en una tablet o en un celular puesto de costado el inventario se ve
  // apretado de costado sin motivo. El ícono de la app ya estaba pensado
  // cuadrado, así que girar no rompe nada.
  orientation: 'any',

  // scope y start_url tienen que ser la ruta de publicación, no "/". En
  // github pages de proyecto, con "/" la PWA instalada abre el perfil de
  // github del usuario en vez de la app, y el service worker queda
  // registrado fuera del directorio donde vive.
  scope: base,
  start_url: base,

  /*
   * Los ocho tamaños, todos con propósito 'any' y sólo uno como maskable.
   *
   * Antes los ocho decían 'any maskable', que suena a "sirve para las dos
   * cosas" pero en la práctica es peor: el maskable se recorta dentro de un
   * círculo con una zona segura del 80%, y estos iconos tienen el cuadrado
   * lleno hasta el borde con esquinas redondeadas, así que Android se comía
   * las esquinas del degradado y dejaba el emoji justo en el filo del corte.
   *
   * El único maskable es el de abajo, dibujado para eso: fondo a sangre (sin
   * esquinas que transparentar) y la marca centrada, que es lo que aguanta
   * cualquier forma que el lanzador elija (círculo, cuadrado redondeado,
   * gota). Ver `generar-iconos.mjs`, que lo genera aparte.
   */
  icons: [
    {
      src: 'icons/icon-72x72.png',
      sizes: '72x72',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: 'icons/icon-96x96.png',
      sizes: '96x96',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: 'icons/icon-128x128.png',
      sizes: '128x128',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: 'icons/icon-144x144.png',
      sizes: '144x144',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: 'icons/icon-152x152.png',
      sizes: '152x152',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: 'icons/icon-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: 'icons/icon-384x384.png',
      sizes: '384x384',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: 'icons/icon-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: 'icons/icon-512x512-maskable.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable'
    }
  ],

  categories: ['business', 'productivity'],

  /*
   * Sin `screenshots`.
   *
   * Antes estaba `screenshots: []`, un arreglo vacío. Un campo vacío no es lo
   * mismo que un campo ausente: algunos lanzadores lo leen como "hay
   * capturas", las buscan, no encuentran nada y la ficha de instalación queda
   * con el hueco. Sin el campo, el lanzador muestra lo que sí existe.
   */

  /*
   * Los atajos van con la ruta de publicación adelante, por la misma razón
   * que `start_url`, y con la barra final: `base + '#scan'` con base
   * '/stock-comercio' (sin barra) da '/stock-comercio#scan', que el navegador
   * lee como un ancla y no como una app con un atajo. Ver `config-comun.mjs`.
   */
  shortcuts: [
    {
      name: 'Escanear producto',
      short_name: 'Escanear',
      description: 'Abrir escáner de código de barras',
      url: `${base}#scan`,
      icons: [{ src: 'icons/scan-shortcut.png', sizes: '96x96' }]
    },
    {
      name: 'Agregar producto',
      short_name: 'Agregar',
      description: 'Crear nuevo producto',
      url: `${base}#add`,
      icons: [{ src: 'icons/add-shortcut.png', sizes: '96x96' }]
    }
  ]
};
