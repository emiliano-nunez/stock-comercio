/*
 * Genera los dos iconos de los accesos directos que el manifiesto declara y que
 * no existen: al instalar la PWA esos dos dan 404.
 *
 * Se escriben los PNG a mano en vez de usar un rasterizador porque en el
 * proyecto no hay ninguno, y tampoco se puede agregar una dependencia para dos
 * archivos. Lo que hay que dibujar son rectángulos y un degradado, que es
 * justamente lo que se puede escribir sin librería.
 *
 * Van con el mismo lenguaje visual del icono de la app: cuadrado de esquinas
 * redondeadas, degradado verde y una marca blanca. La marca no es el emoji del
 * icono de la app sino un dibujo, porque un emoji necesita una fuente que acá
 * no hay y el resultado sería una caja vacía.
 *
 * Uso: node generar-iconos-accesos.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const TAM = 96;
const RADIO = 18;

/*
 * El mismo verde del icono de la app: el degradado va de `verde-100` a
 * `verde-200`, que es el fondo de la cabecera.
 *
 * La marca va en verde oscuro y no en blanco: sobre el verde claro el blanco
 * queda en 1.2 a 1 y no se ve. `marcaOscura` es el replacement de `blanco` en las
 * dos funciones de abajo.
 */
const VERDE_A = [0xdc, 0xfc, 0xe7];
const VERDE_B = [0xbb, 0xf7, 0xd0];
const MARCA = [0x14, 0x53, 0x2d];

const px = new Uint8Array(TAM * TAM * 4);

const mezclar = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Un punto está dentro de un cuadrado con las esquinas redondeadas. */
const dentro = (x, y) => {
  const r = RADIO;
  const cx = Math.min(Math.max(x, r), TAM - 1 - r);
  const cy = Math.min(Math.max(y, r), TAM - 1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
};

const pintar = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= TAM || y >= TAM) return;
  const i = (y * TAM + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
};

const fondo = () => {
  for (let y = 0; y < TAM; y++) {
    for (let x = 0; x < TAM; x++) {
      if (!dentro(x, y)) continue;
      pintar(x, y, ...mezclar(VERDE_A, VERDE_B, (x + y) / (2 * (TAM - 1))));
    }
  }
};

const marca = (x, y) => pintar(x, y, ...MARCA);
const rect = (x0, y0, w, h, fn) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) fn(x, y);
};

/** El acceso directo de escanear: un código de barras con su línea de lectura. */
const marcaEscanear = () => {
  // Las barras, de ancho variable como las de un EAN de verdad.
  const barras = [[26, 3], [32, 5], [40, 2], [45, 4], [52, 2], [58, 6], [67, 3]];
  for (const [x, w] of barras) rect(x, 26, w, 44, marca);
  // La línea de lectura, más fina y con los cabezales a los costados.
  rect(22, 56, 52, 3, marca);
  rect(22, 50, 3, 6, marca);
  rect(71, 50, 3, 6, marca);
};

/** El acceso directo de agregar: un más con la misma traza. */
const marcaMas = () => {
  rect(42, 24, 12, 48, marca);
  rect(24, 42, 48, 12, marca);
};

/* ---------------------------------------------------------------- PNG ---- */

const tablaCrc = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = tablaCrc[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const trozo = (tipo, datos) => {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
};

/** Arma el PNG:IHDR, un IDAT con las filas filtradas en 0 y el IEND. */
const png = () => {
  const crudo = Buffer.alloc(TAM * (TAM * 4 + 1));
  for (let y = 0; y < TAM; y++) {
    crudo[y * (TAM * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * TAM * 4, TAM * 4).copy(crudo, y * (TAM * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(TAM, 0);
  ihdr.writeUInt32BE(TAM, 4);
  ihdr[8] = 8;   // bits por canal
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
};

const guardar = (nombre, marca) => {
  px.fill(0);
  fondo();
  marca();
  const datos = png();
  writeFileSync(`public/icons/${nombre}`, datos);
  console.log(`  ${nombre}  ${datos.length} bytes`);
};

guardar('scan-shortcut.png', marcaEscanear);
guardar('add-shortcut.png', marcaMas);
console.log('  los dos accesos directos ya existen');