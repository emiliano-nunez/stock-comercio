// Busca caracteres fuera del rango esperado en el código fuente: CJK ( slips del
// modelo), y las dos secuencias UTF-8 que delatan mojibake.
//   node verificar-caracteres.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = 'src';
const MOJIBAKE = [
  { nombre: 'Ã seguido de ƒ/©/¨ (0xC3 0x83/0xC2/0xC2 0xA8)', bytes: [0xc3, 0x83] },
  { nombre: 'replacement char U+FFFD (0xEF 0xBF 0xBD)', bytes: [0xef, 0xbf, 0xbd] }
];

function archivos(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : p.endsWith('.js') ? [p] : [];
  });
}

let malos = 0;
for (const archivo of archivos(RAIZ)) {
  const buf = readFileSync(archivo);
  const texto = buf.toString('utf8');

  // CJK, hiragana, katakana, hangul, y los rangos de puntuación CJK.
  const cjk = [...texto.matchAll(/[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g)];
  if (cjk.length) {
    malos++;
    console.log(`CJK   ${archivo}`);
    for (const m of cjk) {
      const linea = texto.slice(0, m.index).split('\n').length;
      console.log(`        línea ${linea}: ${JSON.stringify(texto.split('\n')[linea - 1].trim().slice(0, 90))}`);
    }
  }

  for (const m of MOJIBAKE) {
    for (let i = 0; i + m.bytes.length <= buf.length; i++) {
      if (m.bytes.every((b, k) => buf[i + k] === b)) {
        malos++;
        const linea = buf.slice(0, i).toString('utf8').split('\n').length;
        console.log(`MOJI  ${archivo}:${linea}  ${m.nombre}`);
        break;
      }
    }
  }
}

console.log(malos ? `\n${malos} archivo(s) con caracteres sospechosos` : 'OK: sin CJK ni mojibake');
process.exit(malos ? 1 : 0);
