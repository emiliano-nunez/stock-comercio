import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { base, DEFINES } from './config-comun.mjs';
import { MANIFIESTO } from './config-manifiesto.mjs';

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
      /*
       * Sin `includeAssets`.
       *
       * Antes listaba 'favicon.ico', 'icons/icon.svg' e
       * 'icons/icon-192x192.png'. Los tres ya entran solos por el
       * `globPatterns` de abajo, que barre dist/ entero: lo que hacía esa
       * línea era meterlos una SEGUNDA vez en la precarga, y con revisión
       * distinta, así que Workbox las trataba como dos entradas distintas.
       * El resultado era un sw.js con el favicon declarado dos veces, que
       * confunde a cualquiera que lo lea y hace que una actualización del
       * archivo actualice una entrada y no la otra.
       *
       * Lo que index.html pide y no está en dist/ simplemente no existe, y
       * ahí hacía falta listarlo. Pero todo lo que pide está en dist/: los
       * íconos los copia Vite desde public/ y los assets los genera él.
       */
      manifest: MANIFIESTO,
      /*
       * Sin `runtimeCaching` para Google Fonts.
       *
       * Antes había dos reglas, CacheFirst para fonts.googleapis.com y para
       * fonts.gstatic.com, con dos cachés de diez entradas y un año de vida.
       * No servían para nada: la app no carga ninguna fuente remota.
       * `--fuente` en tokens.css es `system-ui, -apple-system, ...`, que son
       * las del sistema, y no hay ni una referencia a Google Fonts en todo
       * src/. Eran dos reglas que nunca se disparaban y dos cachés que nunca
       * se llenaban.
       *
       * Si algún día se carga una fuente de ahí, la regla vuelve junto con la
       * fuente, no antes.
       *
       * tampoco hace falta listar el ícono maskable en `globPatterns`: el
       * comodín de extensión png ya lo barre, y ponerlo a mano sería repetir
       * el duplicado de arriba con otro archivo.
       */
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      },
      /*
       * `includeManifestIcons: false`.
       *
       * Por defecto el plugin suma a la precarga los iconos que declara el
       * manifiesto, además de los que encuentra el `globPatterns` de arriba.
       * Son los MISMOS archivos: los dos caminos dan con los de public/icons,
       * y el sw.js salía con cada icono declarado dos veces, once duplicados
       * en total. Workbox los descuenta al instalar (es la misma URL), pero
       * el sw.js queda ilegible y, peor, un icono puede actualizarse por un
       * camino y no por el otro.
       *
       * Se apaga el del manifiesto y no el glob, porque el glob también trae
       * los assets compilados y el favicon, que no están en el manifiesto.
       * Lo único que se pierde es la redundancia. Va como opción del plugin y
       * no adentro de `workbox`: ahí workbox-build valida las llaves y no
       * acepta ninguna que no conozca.
       */
      includeManifestIcons: false
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