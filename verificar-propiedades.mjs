/*
 * Busca dos cosas sobre los campos de las clases.
 *
 *   1. Propiedades que se leen pero que la clase nunca escribe.
 *   2. Métodos con el mismo nombre que una propiedad, que el atributo de la
 *      instancia pisa y deja de existir.
 *
 * Uso: node verificar-propiedades.mjs
 *
 * Por que existe: la primera vez que se corrió, la app ya estaba en manos del
 * usuario y tiraba `TypeError: Cannot read properties of undefined` al arrancar.
 * `this.productosFiltrados` se leía en un método después de que el campo pasara a
 * llamarse `productosVisibles`. Compilaba y pasaban los otros cinco verificadores:
 * ninguno mira si un campo de la clase existe.
 *
 * El segundo caso salió de la prueba de arranque, y es el más traicionero porque
 * el campo no falta: existe, y es lo que tapa. Un método que se pisa no tira
 * "undefined", tira "no es una función", y sólo cuando se lo llama.
 *
 * La propiedad del constructor cuenta como escritura: es el lugar donde se
 * declaran. Sólo se miran clases, porque en una función suelta `this` puede ser
 * cualquier cosa.
 *
 * Lo que NO sabe y por eso hay que leer el aviso antes de tocarlo: que la
 * propiedad la ponga alguien por fuera, o que un método de otra clase la use.
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

/**
 * El texto del archivo sin los comentarios, para no contar lo que sólo se menciona.
 *
 * Los comentarios se cambian por espacios en vez de por nada, y los saltos de
 * línea se dejan: así el texto tiene los mismos índices y las mismas líneas que el
 * original, y los números que se reportan son los del archivo de verdad.
 *
 * Un /* precedido de letra, número o comilla no abre un comentario: es texto
 * de la app, como el accept="image/*" del input de galería. Contarlo como
 * apertura dejaba en blanco desde ese punto hasta el primer * / siguiente, o
 * sea media clase sin verificar, y cualquier comentario nuevo metido en el
 * medio movía ese borde y hacía saltar avisos falsos.
 */
function sinComentarios(texto) {
  return texto
    .replace(/(?<![\w$"'`])\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (linea, previo) => previo + ' '.repeat(linea.length - previo.length));
}

const hallazgos = [];
const pisados = [];
const tapados = new Set();

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
    const metodos = new Set();
    for (const m of cuerpo.matchAll(METODO)) metodos.add(m[1]);
    for (const m of cuerpo.matchAll(GETTER)) metodos.add(m[1]);

    /*
     * Un nombre que es método y además propiedad se pisan entre sí. El atributo de
     * la instancia gana sobre el de la clase, así que el método deja de existir
     * en cuanto se asigna la propiedad, y lo que se rompe es la llamada:
     * `this.algo()` pasa a ser "this.algo no es una función". Pasó con
     * `productosVisibles`: era el método que reparte el catálogo por estado, y el
     * constructor le puso un arreglo encima.
     */
    for (const m of cuerpo.matchAll(ESCRIBE)) {
      if (!metodos.has(m[1])) continue;
      if (tapados.has(m[1])) continue;
      tapados.add(m[1]);
      pisados.push({ archivo, linea: numeroDeLinea(inicio + m.index), clase: clases[c][1], nombre: m[1] });
    }

    for (const nombre of metodos) escritas.add(nombre);

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

if (hallazgos.length === 0 && pisados.length === 0) {
  console.log('OK: ningun metodo lee una propiedad que la clase no escribe, y ningun metodo esta tapado por una propiedad.');
  process.exit(0);
}

if (pisados.length > 0) {
  console.log('');
  for (const p of pisados) {
    console.log(`  TAPADO  ${p.archivo}:${p.linea}  this.${p.nombre}  (clase ${p.clase})`);
  }
  console.log('');
  console.log(`${pisados.length} metodo(s) con el mismo nombre que una propiedad.`);
  console.log('La propiedad pisa al metodo: donde se llame, tira "no es una funcion".');
}

if (hallazgos.length > 0) {
  console.log('');
  for (const h of hallazgos) {
    console.log(`  SIN ESCRIBIR  ${h.archivo}:${h.linea}  this.${h.nombre}  (clase ${h.clase})`);
  }
  console.log('');
  console.log(`${hallazgos.length} lectura(s) de propiedades que la clase nunca escribe.`);
  console.log('Cada una es un undefined en runtime, o una propiedad que otro pone.');
}

process.exit(1);
