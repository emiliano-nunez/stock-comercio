/*
 * Busca interpolaciones sin escapar dentro de atributos de HTML.
 *
 * Uso: node verificar-escapado.mjs
 *
 * Por que existe: todo el HTML de la app se arma con template literals, asi que
 * una interpolacion pegada en un atributo sale cruda. Con texto escapado el
 * resultado es feo; con un color, un tipo de venta o una fecha que venga de una
 * copia de seguridad importada, lo que sale es capaz de romper el atributo y
 * meter codigo en el origen de la app, que es donde vive todo el inventario.
 *
 * La app escapa el texto del usuario en todos lados, pero eso no se puede
 * comprobar leyendo: hay mas de mil interpolaciones y solo un punado estan en un
 * atributo. Este verificador las mira todas y avisa de las que no pasan por esc o
 * escAttr.
 *
 * Lo que NO mira, y por que no es un problema:
 *
 *   - El contenido de un atributo sin interpolacion, que no tiene nada que
 *     pueda romperlo.
 *   - Los valores numericos y las constantes de la app, que no son texto libre.
 *
 * Un hallazgo no es necesariamente un bug: puede ser un numero que no necesita
 * escapado. Lo que busca es que ninguno se quede sin mirar.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EXTENSIONES = ['.js', '.mjs'];
const YO = 'verificar-escapado.mjs';

/** Atributos donde un valor sin escapar puede romper el HTML. */
const ATRIBUTOS = ['style', 'value', 'title', 'aria-label', 'placeholder', 'alt', 'id'];

const YA_ESCAPADO = /\b(esc|escAttr)\s*\(/;
const INTERPOLACION = /\$\{([^}]*)\}/g;

/** Expresiones que no son texto libre y por lo tanto no necesitan escapado. */
const SIN_RIESGO = [
  /\bicono\(/,
  /\bfmtPrecio\(/,
  /\bfecha(EnDia|YHora)\(/,
  /\bnormalizarTexto\(/,
  /\bgetUnidadBase\(/,
  /\bNumber\(/,
  /\bMath\./,
  /\bString\(/,
  /\bJSON\./,
  /\.(length|toFixed|toUpperCase|toLowerCase)\b/,
  /\b(estadoStock|categoriasDe|tieneCategoria|getPrecioPrincipal)\(/,
  /^\s*[\d\s'".,-]*$/,
  // Un ternario entre dos textos literales: no hay dato del usuario adentro.
  /^\s*[\w.]+\s*\?\s*(['"`])[^'"`]*\1\s*:\s*(['"`])[^'"`]*\2\s*$/,
  // Un selector, no un atributo: `CSS.escape` ya escapa. Volver a escaparlo lo
  // escaparía dos veces y el selector no encontraría el nodo.
  /^CSS\.escape\(/
];

function listar(dir, lista = []) {
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === '.git' || nombre === 'dist') continue;
    const ruta = join(dir, nombre);
    const info = statSync(ruta);
    if (info.isDirectory()) {
      listar(ruta, lista);
    } else if (EXTENSIONES.some(ext => nombre.endsWith(ext)) && nombre !== YO) {
      lista.push(ruta);
    }
  }
  return lista;
}

const atributosDe = (linea) => {
  const encontrados = [];
  for (const atributo of ATRIBUTOS) {
    const patron = new RegExp('\\b' + atributo + '="([^"]*)"', 'g');
    let m;
    while ((m = patron.exec(linea)) !== null) {
      encontrados.push({ atributo, valor: m[1] });
    }
  }
  return encontrados;
};

const hallazgos = [];

for (const archivo of listar('src')) {
  const lineas = readFileSync(archivo, 'utf8').split('\n');

  lineas.forEach((linea, i) => {
    for (const par of atributosDe(linea)) {
      if (par.valor.indexOf('${') === -1) continue;

      for (const m of par.valor.matchAll(INTERPOLACION)) {
        const expr = m[1].trim();
        if (!expr) continue;
        if (YA_ESCAPADO.test(expr)) continue;
        if (SIN_RIESGO.some(re => re.test(expr))) continue;

        hallazgos.push({ archivo, linea: i + 1, atributo: par.atributo, expr });
      }
    }
  });
}

if (hallazgos.length === 0) {
  console.log('OK: toda interpolacion en atributo pasa por esc o escAttr.');
  process.exit(0);
}

console.log('');
for (const h of hallazgos) {
  console.log(`  SIN ESCAPAR  ${h.archivo}:${h.linea}  ${h.atributo}=${h.expr}`);
}
console.log('');
console.log(`${hallazgos.length} interpolacion(es) sin escapar en atributos.`);
console.log('Cada una es una cosa que alguien tiene que mirar: si el valor no');
console.log('puede romper el atributo, se deja como esta; si puede, se escapa.');
process.exit(1);
