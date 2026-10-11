/*
 * Genera los PNG del icono de la app a partir de `public/icons/icon.svg`.
 *
 * Antes lo generaba `generate-icons.js` con el paquete `canvas`, que nunca estuvo
 * en las dependencias: el script no corría desde que se creó y los PNG del repo
 * eran de una versión vieja. Este lo hace con el navegador que ya está en la
 * máquina.
 *
 * El dibujo es de línea y va con colores escritos, así que no hay que resolver
 * fuentes ni currentColor para rasterizarlo. Aun así se genera del SVG y no se
 * escribe el PNG a mano como sí se hacen los dos iconos de los accesos directos
 * (ver `generar-iconos-accesos.mjs`): el SVG es la única fuente del dibujo, y
 * generar desde ahí es lo que garantiza que los diez tamaños y el favicon son
 * el mismo ícono y no once reinterpretaciones.
 *
 * Uso: node generar-iconos.mjs             (todo: tamaños, maskable y favicon)
 *       node generar-iconos.mjs 180        (sólo el de 180)
 *       node generar-iconos.mjs maskable   (sólo el maskable)
 *       node generar-iconos.mjs favicon    (sólo el favicon.ico)
 *
 * Con argumentos sólo se regenera lo pedido. Sin argumentos sale todo, que es
 * lo normal después de tocar el SVG, pero regenerar los tamaños que ya están
 * también reescribe archivos commiteados que no cambian: pone ruido en el diff
 * por un montón de bytes idénticos.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TODOS = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const FAVICON = 72;
const pedidos = process.argv.slice(2);
const tamanoPedidos = pedidos.filter((p) => /^\d+$/.test(p)).map(Number);
const TAMANOS = pedidos.length === 0 ? TODOS : TODOS.filter((t) => tamanoPedidos.includes(t));
const quiereMaskable = pedidos.length === 0 || pedidos.includes('maskable');
const quiereFavicon = pedidos.length === 0 || pedidos.includes('favicon');

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
const svgOriginal = readFileSync(svg, 'utf8');

/*
 * Pinta un SVG a un PNG del tamaño dado, con el navegador.
 *
 * El HTML y el SVG van a un directorio temporal y el PNG sale directo al
 * destino, así que no hay un archivo intermedio que limpiar después.
 *
 * El fondo va transparente (`--default-background-color=00000000`) y la escala
 * va forzada a 1: sin eso, en una pantalla de doble densidad el PNG saldría del
 * doble de píxeles con el nombre del tamaño chico adentro.
 */
function pantallazo(nombre, contenidoSvg, tam, destino) {
  const archivoSvg = join(trabajo, `${nombre}.svg`);
  const html = join(trabajo, `${nombre}.html`);
  writeFileSync(archivoSvg, contenidoSvg, 'utf8');
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${tam}px;height:${tam}px}</style>
<img src="${nombre}.svg" width="${tam}" height="${tam}">`,
    'utf8'
  );

  execFileSync(navegador, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${tam},${tam}`,
    `--screenshot=${destino}`,
    `file:///${html.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });
}

for (const tam of TAMANOS) {
  const nombre = `icon-${tam}x${tam}.png`;
  pantallazo(`icono-${tam}`, svgOriginal, tam, join(salida, nombre));
  console.log(`  ${nombre}`);
}

/*
 * El maskable, que es otro dibujo y no el mismo PNG con otro nombre.
 *
 * Diferencias con el icono normal, las dos por la misma razón: el sistema lo
 * recorta después, dentro de una forma que elige él (círculo, cuadrado
 * redondeado, gota) y con una zona segura del 80%, o sea un círculo de radio
 * 204.8 sobre los 512 del lienzo.
 *
 *   1. Sin esquinas redondeadas: el `rx="96"` del rectángulo deja las cuatro
 *      esquinas transparentes, y fuera del círculo de recorte eso se ve como
 *      fondo raro en los iconos del escritorio. El fondo va a sangre.
 *   2. La marca más chica: el `scale(16)` del dibujo pasa a `scale(12)`, con
 *      el translate recalculado para que quede centrada igual. A 16 la marca
 *      se acerca a 170 del centro y cualquier forma de recorte más chica que
 *      el círculo se come un pedazo del trazo. A 12 queda holgada.
 *
 * Se genera del SVG original con dos reemplazos, no con un SVG aparte: si un
 * día cambia el degradado o la caja, el maskable cambia solo, y no hay un
 * archivo que se olvide de actualizar. Los dos textos que se buscan son los
 * del `icon.svg` de al lado: si cambian ahí, hay que cambiarlos acá.
 */
if (quiereMaskable) {
  const svgMaskable = svgOriginal
    .replace(' rx="96"', '')
    .replace('translate(64 60) scale(16)', 'translate(112 109) scale(12)');
  pantallazo('maskable', svgMaskable, 512, join(salida, 'icon-512x512-maskable.png'));
  console.log('  icon-512x512-maskable.png');
}

/*
 * El favicon, el mismo dibujo y el mismo degradado, a sangre.
 *
 * Va sin las esquinas redondeadas por el motivo del maskable, y con la marca
 * al tamaño normal: el `.ico` se pinta sobre el fondo que el navegador elija
 * para la pestaña, y las esquinas transparentes se ven ahí como un recorte
 * raro. Este archivo era un tercer diseño (cuadrado verde liso con la caja
 * blanca) que no tenía nada que ver ni con el icono ni con el encabezado.
 *
 * El `.ico` no es un dibujo sino un contenedor: adentro va el PNG tal cual,
 * con 22 bytes de cabecera delante —una entrada, declarada como de 72x72 y
 * reconocida por la magia del PNG, no por un códec—.
 */
if (quiereFavicon) {
  const svgFavicon = svgOriginal.replace(' rx="96"', '');
  const png = join(trabajo, 'favicon.png');
  pantallazo('favicon', svgFavicon, FAVICON, png);
  escribirIco(png, resolve('public/favicon.ico'), FAVICON);
  console.log('  favicon.ico');
}

/**
 * Envuelve un PNG en un `.ico` de una sola entrada.
 *
 * @param {string} pngRuta   el PNG ya renderizado
 * @param {string} icoRuta   adónde se escribe el `.ico`
 * @param {number} tam       el lado del icono, en píxeles
 */
function escribirIco(pngRuta, icoRuta, tam) {
  const png = readFileSync(pngRuta);

  const cabecera = Buffer.alloc(6);
  cabecera.writeUInt16LE(0, 0); // reservado, tiene que ser cero
  cabecera.writeUInt16LE(1, 2); // tipo 1: icono (el 2 es cursor)
  cabecera.writeUInt16LE(1, 4); // una sola entrada

  const entrada = Buffer.alloc(16);
  entrada.writeUInt8(tam > 255 ? 0 : tam, 0); // ancho; 0 significa 256
  entrada.writeUInt8(tam > 255 ? 0 : tam, 1); // alto
  entrada.writeUInt8(0, 2); // colores en la paleta; 0 = más de 256
  entrada.writeUInt8(0, 3); // reservado
  entrada.writeUInt16LE(1, 4); // planos de color
  entrada.writeUInt16LE(32, 6); // bits por píxel
  entrada.writeUInt32LE(png.length, 8);
  entrada.writeUInt32LE(cabecera.length + entrada.length, 12); // dónde empieza el PNG

  writeFileSync(icoRuta, Buffer.concat([cabecera, entrada, png]));
}

rmSync(trabajo, { recursive: true, force: true });
console.log('  iconos regenerados');
