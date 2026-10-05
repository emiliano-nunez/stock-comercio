/*
 * Busca propiedades que se leen pero que nunca se escriben.
 *
 * Uso: node verificar-propiedades.mjs
 *
 * Por que existe: `this.productosFiltrados` se leía en un método después de que
 * el campo pasara a llamarse `productosVisibles`. Compilaba, pasaban los cinco
 * verificadores, y la app tiraba `TypeError: Cannot read properties of undefined`
 * en la primera pantalla. Los otros verificadores miran el archivo: este mira si
 * un campo de la clase existe.
 *
 * La propiedad del constructor cuenta como escritura: es el lugar donde se
 * declaran. Sólo se miran clases, porque en una función suelta `this` puede ser
 * cualquier cosa.
 *
 * Lo que NO sabe y por eso hay que leer el aviso antes de borrarlo: que la
 * propiedad la ponga alguien por fuera, o que un método de otra clase la use. Por
 * eso avisa y no falla: un hallazgo es una pregunta, no un error.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ARCHIVOS = ['.js', '.mjs'];
const YO = 'verificar-propiedades.mjs';

function listar(dir, lista = []) {
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === '.git' || nombre === 'dist') continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      listar(ruta, lista);
    } else if (ARCHIVOS.some(e => nombre.endsWith(e)) && nombre !== YO) {
      lista.push(ruta);
    }
  }
  return lista;
}

/** `this.prop = `, `this.prop ??= ` y demás: los lugares donde nace. */
const ESCRIBE = /\bthis\s*\.\s*([A-Za-z_$][\w$]*)\s*(?:=|\?\?=|\|\|=|&&=|\+=|-=|\*=|\/=)(?![\w$])/g;

/** `this.prop`, sin importar si del otro lado hay un igual o un método. */
const LEE = /\bthis\s*\.\s*([A-Za-z_$][\w$]*)/g;

/** `nombre(args) {` al nivel del cuerpo de la clase: un método, no una propiedad. */
const METODO = /^[ \t]{2}(?:static\s+)?(?:async\s+)?\*?([A-Za-z_$][\w$]*)\s*\(/gm;

/** `get nombre() {`: tampoco es una propiedad. */
const GETTER = /^[ \t]{2}(?:static\s+)?get\s+([A-Za-z_$][\w$]*)\s*\(/gm;

/** El texto del archivo sin los comentarios, para no contar lo que se menciona. */
function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const hallazgos = [];

for (const archivo of listar('src')) {
  const crudo = readFileSync(archivo, 'utf8');
  const codigo = sinComentarios(crudo);
  const numeroDeLinea = (indice) => crudo.slice(0, indice).split('\n').length;

  // Sólo las clases: un `export class X {` o `class X {`.
  const clases = [...codigo.matchAll(/(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g)];
  if (!clases.length) continue;

  for (let c = 0; c < clases.length; c++) {
    const inicio = clases[c].index + clases[c][0].length;
    const fin = c + 1 < clases.length ? clases[c + 1].index : codigo.length;
    const cuerpo = codigo.slice(inicio, fin);

    const escritas = new Set();
    for (const m of cuerpo.matchAll(ESCRIBE)) escritas.add(m[1]);

    /*
     * Los métodos de la clase no se escriben: se definen. Sin esto, `this.render()`
     * se leería como una propiedad que no existe y el verificador no serviría para
     * nada, porque casi todo lo que se llama con `this.` es un método.
     */
    for (const m of cuerpo.matchAll(METODO)) escritas.add(m[1]);
    for (const m of cuerpo.matchAll(GETTER)) escritas.add(m[1]);

    const leidas = new Map();
    for (const m of cuerpo.matchAll(LEE)) {
      const nombre = m[1];
      if (escritas.has(nombre)) continue;
      if (!leidas.has(nombre)) leidas.set(nombre, numeroDeLinea(inicio + m.index));
    }

    for (const [nombre, linea] of leidas) {
      hallazgos.push({ archivo, linea, clase: clases[c][1], nombre });
    }
  }
}

if (hallazgos.length === 0) {
  console.log('OK: ningun metodo lee una propiedad que la clase no escribe.');
  process.exit(0);
}

console.log('');
for (const h of hallazgos) {
  console.log(`  SIN ESCRIBIR  ${h.archivo}:${h.linea}  this.${h.nombre}  (clase ${h.clase})`);
}
console.log('');
console.log(`${hallazgos.length} lectura(s) de propiedades que la clase nunca escribe.`);
console.log('Cada una es un undefined en runtime, o una propiedad que otro pone.');
process.exit(1);
