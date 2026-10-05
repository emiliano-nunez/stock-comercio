import { defineConfig } from 'vitest/config';
import { base, DEFINES } from './config-comun.mjs';

/*
 * Las pruebas de la app, corriendo de verdad.
 *
 * Esto no es un adorno del pipeline: es lo que reemplaza al navegador. No hay
 * forma de abrir la app desde acá, así que la única manera de saber si levanta es
 * levantarla. Y levanta: un DOM de verdad con jsdom y una base de datos IndexedDB
 * de verdad con fake-indexeddb.
 *
 * Lo que se gana es que los bugs que antes llegaban a la pantalla del usuario y se
 * veían sólo al tocar la app -- un import que faltaba, un método de Dexie que no
 * existe en la versión instalada, un método de la clase tapado por una propiedad --
 * salen acá, con su archivo y su línea.
 *
 * `define` importa los mismos valores que la compilación. Sin esto, el pie del
 * inventario leyera `__VERSION__` sin definir y la prueba del arranque tiraría por
 * un motivo que no tiene que ver con lo que se está probando.
 */
export default defineConfig({
  // El service worker y el manifiesto son de la compilación, no de una prueba: acá
  // no se registran los plugins de Vite.
  base,
  define: DEFINES,
  test: {
    environment: 'jsdom',
    include: ['pruebas/**/*.test.mjs'],
    // Las pruebas comparten la misma base en memoria, y el orden importa: la del
    // arranque abre Dexie. Correrlas en un solo hilo hace que el fallo apunte a
    // una prueba y no a un cruce improbable entre dos.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    // La app tiene su tiempo para arrancar en un teléfono de gama baja; en una
    // prueba de escritorio no lo necesita, y 10 segundos es un techo razonable
    // para que una prueba colgada no deje el proceso esperando.
    testTimeout: 10000
  }
});