import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

/**
 * Ruta en la que se publica la app.
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
 * Se puede sobrescribir con la variable de entorno VITE_BASE_PATH, que es lo
 * que conviene en un deploy automatizado para no editar este archivo.
 */
const RUTA_PUBLICA = process.env.VITE_BASE_PATH || '/';

// La ruta tiene que empezar Y terminar en barra, y el motivo es concreto:
// `base + '#scan'` se concatena sin separador. Con base '/stock-comercio' (sin
// la barra final) el acceso directo salía como '/stock-comercio#scan', y el
// navegador lo leía como un ancla dentro de la página, no como la app con un
// atajo. Hay que normalizar los dos extremos, no sólo el de adelante.
const base = `/${RUTA_PUBLICA.replace(/^\/+|\/+$/g, '')}/`.replace(/\/{2,}/g, '/');

/*
 * La versión que se muestra al pie de la app.
 *
 * Sale de package.json y no de un número escrito en el código, para que las dos
 * cosas no puedan separarse: si el número está en un solo lado, cambiarlo es
 * recordar cambiarlo, y si no se cambia la app dice una versión que ya no es.
 *
 * El prefijo "v" va acá y no en el pie, para que el pie sea sólo el texto que
 * se ve.
 */
const VERSION = readFileSync(new URL('./package.json', import.meta.url), 'utf8');
const NUMERO_VERSION = `v${JSON.parse(VERSION).version}`;

export default defineConfig({
  base,
  define: {
    // Va como texto ya entrecomillado porque así lo pinta el pie y no hace
    // falta para nada más. Si algún día hay que compararlo, se destraba acá.
    __VERSION__: JSON.stringify(NUMERO_VERSION),
  },
  server: {
    hmr: {
      // Desactivar overlay de errores para evitar ruido en consola
      overlay: false,
      // Configuración de reconexión del cliente HMR
      // El cliente de Vite usa backoff exponencial interno (1s, 2s, 4s, 8s... max 30s)
      // No se puede limitar maxRetries desde config, se maneja en main.js
    }
  },
  plugins: [
    VitePWA({
      /*
       * 'prompt' y no 'autoUpdate'.
       *
       * Con autoUpdate la versión nueva se activa sola y en silencio: entra el
       * service worker nuevo, controlando la página, y no se dice nada. Para el
       * usuario es un cambio de versión que aparece solo y nadie le pidió.
       *
       * Con 'prompt' la versión nueva queda esperando a un lado y la app puede
       * avisar y dejar que el usuario elija el momento. Eso alimenta la tarjeta
       * "hay una versión nueva" de App.js. Ver vigilarActualizacion().
       */
      registerType: 'prompt',
      // Lo que hay que meter en la precarga a mano son los archivos que
      // index.html pide y que no entran ni por el manifiesto ni por el
      // agrupado de los assets. Antes pedía 'apple-touch-icon.png', que no
      // existe: el ícono de Apple es 'icons/icon-192x192.png', y el favicon
      // ahora sí está. Un nombre que no existe no rompe el build, sólo no
      // precarga nada.
      includeAssets: ['favicon.ico', 'icons/icon.svg', 'icons/icon-192x192.png'],
      manifest: {
        name: 'Stock Comercio',
        short_name: 'Stock',
        description: 'Control de inventario local-first para comerciantes',
        // vite-plugin-pwa pone 'en' si no se dice nada, y eso es lo que algunos
        // lanzadores usan para decidir el idioma de la app instalada.
        lang: 'es',
        theme_color: '#16a34a',
        background_color: '#f0fdf4',
        display: 'standalone',
        orientation: 'portrait',
        // scope y start_url tienen que ser la ruta de publicación, no "/". En
        // github pages de proyecto, con "/" la PWA instalada abre el perfil de
        // github del usuario en vez de la app, y el service worker queda
        // registrado fuera del directorio donde vive.
        scope: base,
        start_url: base,
        icons: [
          {
            src: 'icons/icon-72x72.png',
            sizes: '72x72',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icons/icon-96x96.png',
            sizes: '96x96',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icons/icon-128x128.png',
            sizes: '128x128',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icons/icon-144x144.png',
            sizes: '144x144',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icons/icon-152x152.png',
            sizes: '152x152',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icons/icon-384x384.png',
            sizes: '384x384',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        categories: ['business', 'productivity'],
        screenshots: [],
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
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    target: 'es2020',
    minify: 'esbuild',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['dexie'],
          scanner: ['html5-qrcode'],
          compression: ['browser-image-compression']
        }
      }
    }
  }
});