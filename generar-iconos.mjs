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
 * Uso: node generar-iconos.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TAMANOS = [72, 96, 128, 144, 152, 192, 384, 512];

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

rmSync(trabajo, { recursive: true, force: true });
console.log('  los ocho iconos quedaron regenerados');
