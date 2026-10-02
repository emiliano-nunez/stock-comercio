// Cuenta las utilidades de Tailwind que quedan en el código.
//
// Sirve para dos cosas: para saber cuánto falta, y para comprobar al final que
// no quedó ninguna. Las clases propias de la app no se cuentan: se detectan por
// forma, y un nombre en español no tiene forma de utilidad de Tailwind.
//
//   node verificar-tailwind.mjs
//   node verificar-tailwind.mjs --detalle   lista dónde está cada una
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = 'src';
const DETALLE = process.argv.includes('--detalle');

/*
 * Cómo se reconoce una utilidad de Tailwind.
 *
 * Se listan los prefijos de propiedad y los valores de estado, y se arma una
 * expresión con ambos. El orden importa: primero los prefijos de estado, que
 * pueden ir delante de cualquier otra cosa.
 */
const ESTADOS = ['hover', 'focus', 'active', 'disabled', 'visited', 'checked', 'group-hover', 'peer-focus', 'dark', 'sm', 'md', 'lg', 'xl', '2xl'];
const PREFIJOS = [
  // proprietary y layout
  'flex', 'inline-flex', 'grid', 'inline-grid', 'block', 'inline-block', 'table',
  'hidden', 'contents', 'static', 'fixed', 'absolute', 'relative', 'sticky',
  // caja
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe',
  'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me',
  'w', 'h', 'size', 'min-w', 'min-h', 'max-w', 'max-h',
  'gap', 'gap-x', 'gap-y', 'space-x', 'space-y', 'inset', 'inset-x', 'inset-y',
  'top', 'right', 'bottom', 'left', 'z',
  // flex y grid
  'justify', 'justify-items', 'justify-self', 'items', 'self',
  'flex-1', 'flex-auto', 'flex-initial', 'flex-none', 'grow', 'shrink',
  'grid-cols', 'grid-rows', 'col-span', 'row-span', 'col-start', 'col-end',
  'order', 'basis', 'place', 'place-items', 'place-content',
  // color
  'text', 'bg', 'border', 'ring', 'outline', 'shadow', 'fill', 'stroke',
  'from', 'via', 'to', 'divide', 'accent', 'caret', 'decoration',
  // forma
  'rounded', 'border', 'shadow', 'outline', 'ring',
  // tipografía
  'font', 'leading', 'tracking', 'whitespace', 'break', 'truncate',
  // efectos
  'opacity', 'blur', 'brightness', 'contrast', 'grayscale', 'saturate',
  'transition', 'duration', 'delay', 'ease', 'animate', 'scale',
  'transform', 'origin', 'translate', 'rotate', 'skew', 'backdrop',
  // varios
  'overflow', 'cursor', 'select', 'resize', 'object', 'aspect', 'align',
  'list', 'table-layout', 'pointer-events', 'visible', 'isolation', 'mix',
  'sr-only', 'appearance', 'outline-offset',
];

/* Nombres que la app usa y no son utilidades, aunque el patrón los alcance. */
const PERMITIDAS = new Set([
  // Estado de la pestaña: la alterna el código, no es una utilidad.
  'active',
  // Los usa el lector de código de barras y la cámara.
  'hidden', 'flash', 'player', 'md', 'mdl', 'spa', 'pacman',
]);

/*
 * El patrón: un prefijo de estado opcional, un prefijo de propiedad, y un valor.
 *
 * El grupo de estados lleva asterisco y no signo más a propósito: la mayoría de
 * las utilidades no tienen estado. Con signo más, "hover:bg-gray-50" se
 * detectaba y "bg-gray-50" se escapaba, que es justo al revés de lo que importa.
 */
const patron = new RegExp(
  `^(?:(?:${ESTADOS.join('|')}):)*` + // estados al principio, ninguno o varios
    `(?:${PREFIJOS.map(p => p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})` +
    `(?:[-/][A-Za-z0-9_.]+)?/?(?:-[0-9]+)?$`
);

/** Clases que el código agrega por su cuenta y no aparecen en el HTML. */
const DINAMICAS = new Set();

function archivos(dir) {
  let lista = [];
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'css') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) lista = lista.concat(archivos(p));
    else if (n.endsWith('.js')) lista.push(p);
  }
  return lista;
}

function esUtilidad(token) {
  if (!token) return false;
  if (PERMITIDAS.has(token)) return false;
  if (DINAMICAS.has(token)) return false;
  return patron.test(token);
}

/*
 * Las clases que hay dentro de un class="..." se sacan en dos partes, porque un
 * valor puede ser texto y código al mismo tiempo:
 *
 *   class="esquina-derecha insignia ${stock === 0 ? 'insignia-sin' : 'insignia-ok'}"
 *
 * El texto plano es todo lo que hay hasta el ${. La expresión es código, y
 * adentro sólo cuentan las cadenas entre comillas. Sin esa separación, un
 * parámetro como getStockClass(p) contaba la letra p como si fuera la clase "p",
 * que es una utilidad real de Tailwind, y el verificador daba un falso positivo
 * con la migración ya terminada.
 */
const RE_EXPRESION = /\$\{(?:[^{}]|\{[^{}]*\})*\}/g;

function limpiar(trozo) {
  return trozo
    .split(/[\s"',;]+/)
    .map(t => t.replace(/[^\w:.\-[\]%!]/g, ''))
    .filter(Boolean);
}

function clasesDelValor(valor) {
  const salida = [];
  let ultimo = 0;
  for (const m of valor.matchAll(RE_EXPRESION)) {
    salida.push(...limpiar(valor.slice(ultimo, m.index)));
    for (const q of m[0].matchAll(/'([^']*)'|"([^"]*)"/g)) {
      salida.push(...limpiar(q[1] !== undefined ? q[1] : q[2]));
    }
    ultimo = m.index + m[0].length;
  }
  salida.push(...limpiar(valor.slice(ultimo)));
  return salida;
}

const porArchivo = [];
const total = new Map();

function reportar(archivo, texto, valor, inicio) {
  const encontradas = new Map();
  for (const limpio of clasesDelValor(valor)) {
    if (!esUtilidad(limpio)) continue;
    const linea = texto.slice(0, inicio).split('\n').length;
    if (!encontradas.has(limpio)) encontradas.set(limpio, new Set());
    encontradas.get(limpio).add(linea);
    total.set(limpio, (total.get(limpio) || 0) + 1);
  }
  if (encontradas.size) {
    porArchivo.push({ archivo, encontradas, suma: [...encontradas.values()].reduce((a, s) => a + s.size, 0) });
  }
}

for (const archivo of archivos(RAIZ)) {
  const texto = readFileSync(archivo, 'utf8');
  const antes = porArchivo.length;

  /*
   * Se buscan los atributos class. Hay dos formas porque el valor puede traer
   * comillas simples adentro: un class="... ${algo ? 'a' : 'b'} ..." se corta en
   * la primera comilla simple si la expresión las prohíbe, y con eso se pierde
   * la mitad de las clases.
   */
  const re = /class=(?:"([^"\n]*)"|'([^'\n]*)')/g;
  for (const m of texto.matchAll(re)) {
    const valor = m[1] !== undefined ? m[1] : m[2];
    reportar(archivo, texto, valor, m.index);
  }

  /*
   * Y también las asignaciones de JavaScript: `x.className = '...'` y
   * `x.className = \`...\``. Estas NO son atributos class, así que el barrido de
   * arriba no las veía, y por ahí se colaron las clases de Tailwind de los
   * avisos flotantes: el verificador decía cero utilidades mientras la app
   * seguía sirviéndolas desde main.css. Un punto ciego que se lee "todo bien" es
   * peor que no tener el verificador.
   */
  const reAsignacion = /\.className\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`)/g;
  for (const m of texto.matchAll(reAsignacion)) {
    const valor = m[1] ?? m[2] ?? m[3];
    reportar(archivo, texto, valor, m.index);
  }
}

porArchivo.sort((a, b) => b.suma - a.suma);

const suma = porArchivo.reduce((a, x) => a + x.suma, 0);
const distintas = total.size;

if (!suma) {
  console.log('OK: no queda ninguna utilidad de Tailwind');
  process.exit(0);
}

console.log(`${suma} usos en ${distintas} clases distintas, en ${porArchivo.length} archivo(s)\n`);
for (const { archivo, encontradas, suma: s } of porArchivo) {
  console.log(`  ${archivo.padEnd(30)} ${s}`);
}

if (DETALLE) {
  console.log('\nPor clase:');
  const ordenadas = [...total.entries()].sort((a, b) => b[1] - a[1]);
  for (const [clase, n] of ordenadas) console.log(`  ${String(n).padStart(4)}  ${clase}`);
}

process.exit(1);
