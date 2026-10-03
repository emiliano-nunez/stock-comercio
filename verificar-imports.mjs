/*
 * Busca llamadas a una función propia sin el import que la trae.
 *
 * El caso que importa: un módulo llama a `icono(...)` sin haberlo importado. Eso
 * no es un error de sintaxis --el archivo sigue siendo JavaScript válido--, así
 * que compila, pasa los verificadores y recién falla en runtime, cuando el
 * ReferenceError aborta el flujo y deja al usuario con un botón que no hace nada.
 *
 * El error aparece como un toast con el nombre de la función, que es un texto de
 * programador y no le dice nada a quien usa la app.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROPIAS = ['icono', 'esc', 'escAttr', 'fmtPrecio', 'toast', 'normalizarTexto', 'fechaEnDia', 'fechaYHora'];

const raiz = 'src';
const archivos = [];

function recorrer(dir) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) recorrer(ruta);
    else if (ruta.endsWith('.js')) archivos.push(ruta);
  }
}
recorrer(raiz);

/* Una función que el archivo declara no hay que importarla: se cuenta como
   resuelta. */
const DEFINIDAS = /\bexport\s+(async\s+)?function\s+(\w+)|\bexport\s+const\s+(\w+)\s*=|\b(?:function|const|let)\s+(\w+)\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\()/;

let malos = 0;

for (const archivo of archivos) {
  const texto = readFileSync(archivo, 'utf8');

  const declaradas = new Set();
  for (const m of texto.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)) declaradas.add(m[1]);
  for (const m of texto.matchAll(/\b(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(|[^=]/g)) declaradas.add(m[1]);

  const importados = new Set();
  for (const m of texto.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const nombre of m[1].split(',')) {
      const limpio = nombre.trim().split(/\s+as\s+/).pop().trim();
      if (limpio) importados.add(limpio);
    }
  }

  for (const fn of PROPIAS) {
    if (declaradas.has(fn) || importados.has(fn)) continue;
    const patron = new RegExp(`(?<![\\w.$])${fn}\\s*\\(`);
    if (!patron.test(texto)) continue;
    const linea = texto.split('\n').findIndex((x) => patron.test(x)) + 1;
    console.log(`  ${archivo} L${linea}: usa ${fn}() y no la importa ni la declara`);
    malos++;
  }
}

if (malos) {
  console.log(`\nMAL: ${malos} llamada(s) sin import. Falla en runtime, no al compilar.`);
  process.exit(1);
}
console.log(`OK: ${archivos.length} archivo(s), toda llamada propia tiene su import.`);