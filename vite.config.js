import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { base, DEFINES } from './config-comun.mjs';

export default defineConfig({
  base,
  define: DEFINES,
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
       * 'autoUpdate' y no 'prompt'.
       *
       * La tarjeta de "hay una versión nueva" rasegaba mucho mejor con 'prompt',
       * pero ese camino tiene un agujero que la deja inútil: la tarjeta vive
       * dentro del bundle, así que el usuario que tiene la versión vieja, que
       * es justo a quien hay que avisarle, no tiene el código que avisa. Nunca
       * ve la tarjeta. Y como con 'prompt' nada se activa solo, queda atrapado
       * en la versión vieja sin enterarse.
       *
       * Con 'autoUpdate' el service worker nuevo entra solo y toma el control.
       * La app nunca queda atrapada en una versión vieja, que es lo que importa.
       * La tarjeta pasa a avisar otra cosa, que sí se puede saber: que ya se
       * descargó algo nuevo y que un toque lo trae. Ver vigilarActualizacion().
       */
      registerType: 'autoUpdate',
      // Lo que hay que meter en la precarga a mano son los archivos que
      // index.html pide y que no entran ni por el manifiesto ni por el
      // agrupado de los assets. Antes pedía 'apple-touch-icon.png', que no
      // existe: el ícono de Apple es 'icons/icon-192x192.png', y el favicon
      // ahora sí está. Un nombre que no existe no rompe el build, sólo no
      // precarga nada.
      includeAssets: ['favicon.ico', 'icons/icon.svg', 'icons/icon-192x192.png'],
      manifest: {
        name: 'DepoApp',
        short_name: 'DepoApp',
        description: 'Control de inventario local-first para comerciantes',
        // vite-plugin-pwa pone 'en' si no se dice nada, y eso es lo que algunos
        // lanzadores usan para decidir el idioma de la app instalada.
        lang: 'es',
        // El color de la barra del sistema y del splash tienen que ser el verde
        // de la cabecera, que es el mismo degradado que el ícono. Con el verde
        // oscuro anterior, la barra del navegador en el celular instalado salía
        // oscura encima de una cabecera clara.
        theme_color: '#bbf7d0',
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