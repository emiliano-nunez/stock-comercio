// Busca caracteres fuera del rango esperado en el código fuente.
//
// Tres cosas se escapan:
//   1. CJK, hiragana, katakana y hangul. Nunca quisimos escribir así.
//   2. Cirílico y griego. Se cuelan al escribir comentarios en español y son
//      todavía más difíciles de ver a simple vista que los chinos.
//   3. Las dos secuencias UTF-8 que delatan mojibake.
//
// Los emoji NO se marcan: la app los usa a propósito, y todos viven por encima
// de U+FFFF, que es justo donde termina el rango que se revisa.
//
//   node verificar-caracteres.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Se revisa el código y también la raíz del repo, donde están los archivos de
// configuración y los textos. Los comentarios viven igual en los dos lados.
const RAIZES = ['src', '.'];
const EXTENSIONES = ['.js', '.mjs', '.css', '.html', '.md', '.json', '.yml', '.toml'];

// Se saltea a sí mismo: los rangos están escrito como escapes, no como
// caracteres, pero mejor no depender de eso.
const YO = 'verificar-caracteres.mjs';

const MOJIBAKE = [
  { nombre: 'Ã seguido de ƒ/©/¨ (0xC3 0x83/0xC2/0xC2 0xA8)', bytes: [0xc3, 0x83] },
  { nombre: 'replacement char U+FFFD (0xEF 0xBF 0xBD)', bytes: [0xef, 0xbf, 0xbd] },
];

const RANGOS = [
  {
    nombre: 'CJK',
    re: /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g,
  },
  {
    nombre: 'CIRILICO',
    re: /[\u0400-\u04ff\u0500-\u052f]/g,
  },
  {
    nombre: 'GRIEGO',
    re: /[\u0370-\u03ff\u1f00-\u1fff]/g,
  },
];

function archivos(dir, profundidad = 0) {
  if (profundidad > 3) return [];
  let lista = [];
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.git' || n === 'dist' || n === YO) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) lista = lista.concat(archivos(p, profundidad + 1));
    else if (EXTENSIONES.some(e => n.endsWith(e))) lista.push(p);
  }
  return lista;
}

let malos = 0;
const vistos = new Set();

for (const raiz of RAIZES) {
  for (const archivo of archivos(raiz)) {
    if (vistos.has(archivo)) continue;
    vistos.add(archivo);

    const buf = readFileSync(archivo);
    const texto = buf.toString('utf8');
    const lineas = texto.split('\n');

    for (const rango of RANGOS) {
      const encontradas = [...texto.matchAll(rango.re)];
      if (!encontradas.length) continue;

      // Una línea se informa una sola vez. Una palabra de seis letras en
      // cirílico son seis coincidencias de la misma línea, y reportar las seis
      // esconde el resto de los problemas en el ruido.
      const porLinea = new Map();
      for (const m of encontradas) {
        const linea = texto.slice(0, m.index).split('\n').length;
        if (!porLinea.has(linea)) porLinea.set(linea, m[0]);
      }

      malos++;
      console.log(`${rango.nombre}  ${archivo}`);
      for (const [linea, caracter] of porLinea) {
        const textoLinea = (lineas[linea - 1] || '').trim().slice(0, 90);
        const donde = `U+${caracter.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
        console.log(`        linea ${linea} [${donde}]: ${JSON.stringify(textoLinea)}`);
      }
    }

    for (const m of MOJIBAKE) {
      for (let i = 0; i + m.bytes.length <= buf.length; i++) {
        if (m.bytes.every((b, k) => buf[i + k] === b)) {
          malos++;
          const linea = buf.slice(0, i).toString('utf8').split('\n').length;
          console.log(`MOJIBAKE  ${archivo}:${linea}  ${m.nombre}`);
          break;
        }
      }
    }
  }
}

console.log(
  malos
    ? `\n${malos} archivo(s) con caracteres sospechosos`
    : `OK: ${vistos.size} archivo(s) sin CJK, cirilico, griego ni mojibake`
);
process.exit(malos ? 1 : 0);
