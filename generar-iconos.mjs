/*
 * Genera los PNG del icono de la app a partir de `public/icons/icon.svg`.
 *
 * Antes lo generaba `generate-icons.js` con el paquete `canvas`, que nunca estuvo
 * en las dependencias: el script no corría desde que se creó y los PNG del repo
 * eran de una versión vieja. Este lo hace con el navegador que ya está en la
 * máquina.
 *
 * El ícono tiene un emoji, y el emoji necesita una fuente: por eso no se puede
 * escribir el PNG a mano como sí se hacen los dos iconos de los accesos directos,
 * que son puro dibujo. Ver `generar-iconos-accesos.mjs`.
 *
 * Uso: node generar-iconos.mjs            (todos los tamaños y el maskable)
 *       node generar-iconos.mjs 180       (sólo el de 180)
 *       node generar-iconos.mjs maskable  (sólo el maskable)
 *
 * Con argumentos sólo se regenera lo pedido. Sin argumentos sale todo, que es
 * lo normal después de tocar el SVG, pero regenerar los tamaños que ya están
 * también reescribe archivos commiteados que no cambian: pone ruido en el diff
 * por un montón de bytes idénticos.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TODOS = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const pedidos = process.argv.slice(2);
const tamanoPedidos = pedidos.filter((p) => /^\d+$/.test(p)).map(Number);
const quiereMaskable = pedidos.length === 0 || pedidos.includes('maskable');
const TAMANOS = pedidos.length === 0 ? TODOS : TODOS.filter((t) => tamanoPedidos.includes(t));

const NAVEGADORES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const navegador = NAVEGADORES.find((ruta) => existsSync(ruta));

if (!navegador) {
  console.error('  No se encontro Chrome ni Edge. El SVG esta bien y se puede exportar a mano.');
  process.exit(1);
}

const svg = resolve('public/icons/icon.svg');
const salida = resolve('public/icons');
const trabajo = mkdtempSync(join(tmpdir(), 'icono-'));

copyFileSync(svg, join(trabajo, 'icono.svg'));

for (const tam of TAMANOS) {
  const html = join(trabajo, `icono-${tam}.html`);
  const png = join(trabajo, `icono-${tam}.png`);

  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${tam}px;height:${tam}px}</style>
<img src="icono.svg" width="${tam}" height="${tam}">`,
    'utf8'
  );

  execFileSync(navegador, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${tam},${tam}`,
    `--screenshot=${png}`,
    `file:///${html.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });

  const destino = join(salida, `icon-${tam}x${tam}.png`);
  copyFileSync(png, destino);
  console.log(`  icon-${tam}x${tam}.png`);
}

/*
 * El maskable, que es otro dibujo y no el mismo PNG con otro nombre.
 *
 * Diferencias con el icono normal, las dos por la misma razón: el sistema lo
 * recorta después, dentro de una forma que elige él (círculo, cuadrado
 * redondeado, gota) y con una zona segura del 80%.
 *
 *   1. Sin esquinas redondeadas: el `rx="96"` del rectángulo deja las cuatro
 *      esquinas transparentes, y fuera del círculo de recorte eso se ve como
 *      fondo raro en los iconos del escritorio. El fondo va a sangre.
 *   2. El emoji más chico: en vez de 260 de font-size, 200. Con 260 la marca
 *      llega casi al filo del lienzo y cualquier forma de recorte más chica
 *      que el círculo se come un pedazo. Con 200 queda holgado dentro de la
 *      zona segura.
 *
 * Se genera del SVG original con dos reemplazos, no con un SVG aparte: si un
 * día cambia el degradado o el emoji, el maskable cambia solo, y no hay un
 * archivo que se olvide de actualizar.
 */
if (quiereMaskable) {
  const svgOriginal = readFileSync(svg, 'utf8');
  const svgMaskable = svgOriginal
    .replace(' rx="96"', '')
    .replace('font-size="260"', 'font-size="200"');

  const html = join(trabajo, 'maskable.html');
  const png = join(trabajo, 'maskable.png');
  const archivoSvg = join(trabajo, 'maskable.svg');
  writeFileSync(archivoSvg, svgMaskable, 'utf8');

  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:512px;height:512px}</style>
<img src="maskable.svg" width="512" height="512">`,
    'utf8'
  );

  execFileSync(navegador, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    '--window-size=512,512',
    `--screenshot=${png}`,
    `file:///${html.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });

  const destino = join(salida, 'icon-512x512-maskable.png');
  copyFileSync(png, destino);
  console.log('  icon-512x512-maskable.png');
}

rmSync(trabajo, { recursive: true, force: true });
console.log('  iconos regenerados');
