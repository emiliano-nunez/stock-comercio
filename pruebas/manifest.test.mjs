/*
 * El manifiesto de la PWA, verificado antes de compilar.
 *
 * Por que existe: el manifiesto es lo que hace instalable la app, y sus campos
 * no se caen con un error -- se caen en silencio. Un `start_url` sin la ruta de
 * publicación instala una app que abre la página equivocada; un icono que falta
 * deja la ficha de instalación sin imagen; un `scope` mal escrito hace que el
 * service worker quede registrado fuera de la app. El build no se queja de
 * ninguno de los tres, y el único momento en que se ven es cuando alguien
 * instala la app en un teléfono.
 *
 * Corre antes del build a propósito: se testea la causa (el objeto que
 * `vite.config.js` le pasa al plugin) y no el efecto (el `.webmanifest` que
 * queda en dist/), que todavía no existe en este punto del pipeline.
 *
 * Entorno node y no jsdom: acá no hay pantalla que simular, y en jsdom
 * `import.meta.url` no es un `file://`, que es lo que `config-comun.mjs` usa
 * para leer package.json. Con este entorno el import directo funciona.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { MANIFIESTO } from '../config-manifiesto.mjs';
import { base } from '../config-comun.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

describe('manifiesto de la PWA', () => {
  it('tiene los campos mínimos de instalación', () => {
    expect(MANIFIESTO.name).toBeTruthy();
    expect(MANIFIESTO.short_name).toBeTruthy();
    expect(MANIFIESTO.display).toBe('standalone');
    expect(MANIFIESTO.description).toBeTruthy();
  });

  it('arranca y se acota en la ruta de publicación', () => {
    // Los dos apuntan a `base` y no a "/": en un deploy en subdirectorio, con
    // "/" la app instalada abre otra página y el service worker queda fuera.
    expect(MANIFIESTO.start_url).toBe(base);
    expect(MANIFIESTO.scope).toBe(base);
    // `id` fijo en la misma ruta: sin él, cambiar de ruta duplica la app
    // instalada en vez de actualizarla.
    expect(MANIFIESTO.id).toBe(base);
  });

  it('declara los dos tamaños que el sistema exige', () => {
    const srcs = MANIFIESTO.icons.map((i) => i.sizes);
    expect(srcs).toContain('192x192');
    expect(srcs).toContain('512x512');
  });

  it('tiene un icono maskable aparte de los normales', () => {
    const maskables = MANIFIESTO.icons.filter((i) => (i.purpose || '').includes('maskable'));
    // Uno solo, y de 512: es el que Android recorta en la pantalla de inicio.
    expect(maskables).toHaveLength(1);
    expect(maskables[0].sizes).toBe('512x512');

    // Los normales no pueden declararse maskable: sus esquinas redondeadas
    // transparentan en el recorte. Ver config-manifiesto.mjs.
    const normales = MANIFIESTO.icons.filter((i) => !(i.purpose || '').includes('maskable'));
    expect(normales.length).toBeGreaterThanOrEqual(8);
    for (const icono of normales) {
      expect(icono.purpose).toBe('any');
    }
  });

  it('todos los iconos apuntan a archivos que existen', () => {
    for (const icono of MANIFIESTO.icons) {
      const ruta = join('public', icono.src);
      expect(existsSync(ruta), `falta ${icono.src}`).toBe(true);
    }
    // Los iconos de los accesos directos, que dieron 404 durante no se sabe
    // cuánto tiempo porque nadie los había generado.
    for (const atajo of MANIFIESTO.shortcuts) {
      for (const icono of atajo.icons) {
        expect(existsSync(join('public', icono.src)), `falta ${icono.src}`).toBe(true);
      }
    }
  });

  it('los accesos directos abren la app y no un ancla suelta', () => {
    expect(MANIFIESTO.shortcuts).toHaveLength(2);

    const urls = MANIFIESTO.shortcuts.map((a) => a.url);
    // Con la barra final de `base`, `${base}#scan` separa ruta de ancla. Sin
    // ella sale '/stock-comercio#scan', que el navegador lee como un ancla
    // dentro de la página y no como una app con un atajo.
    for (const url of urls) {
      expect(url.startsWith(base)).toBe(true);
      expect(url).toMatch(/#(scan|add)$/);
    }
    expect(urls.some((u) => u.endsWith('#scan'))).toBe(true);
    expect(urls.some((u) => u.endsWith('#add'))).toBe(true);
  });

  it('usa los colores de la app', () => {
    // El theme es el verde de la cabecera: con el verde oscuro anterior, la
    // barra de la app instalada salía oscura sobre una cabecera clara.
    expect(MANIFIESTO.theme_color).toBe('#bbf7d0');
    expect(MANIFIESTO.background_color).toBe('#f0fdf4');
  });

  it('está en español y no fija la orientación', () => {
    expect(MANIFIESTO.lang).toBe('es');
    // 'any' y no 'portrait': dejar la app sin poder girar aprieta el
    // inventario en tablet y en celular acostado, sin que nada lo pida.
    expect(MANIFIESTO.orientation).toBe('any');
  });

  it('no declara screenshots vacíos', () => {
    // `screenshots: []` es peor que no tener el campo: algunos lanzadores lo
    // leen, buscan las capturas y dejan el hueco visible en la ficha.
    expect(MANIFIESTO.screenshots ?? []).toHaveLength(0);
  });
});
