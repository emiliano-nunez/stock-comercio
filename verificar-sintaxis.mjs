/**
 * Verificación sintáctica y semántica básica.
 *
 * A diferencia de un chequeo por regex sobre el texto, esto usa el parser real
 * de Node: si un identificador no estuviera declarado ni importado y fuera
 * usado como llamada, el análisis léxico no lo detectaría, pero al menos
 * confirma que todos los archivos parsean y que no hay sintaxis rota.
 *
 * Usa --check de node sobre cada archivo sin ejecutar nada.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const raiz = process.argv[2] || 'src';
const archivos = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') || p.endsWith('.mjs')) archivos.push(p);
  }
})(raiz);

let fallos = 0;
for (const a of archivos) {
  try {
    execFileSync(process.execPath, ['--check', a], { stdio: 'pipe' });
    console.log(`  ok  ${a}`);
  } catch (e) {
    fallos++;
    console.log(`  MAL ${a}`);
    console.log(String(e.stderr).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

console.log(fallos === 0
  ? `\n${archivos.length} archivos parsean correctamente`
  : `\n${fallos} archivo(s) con error de sintaxis`);
process.exitCode = fallos === 0 ? 0 : 1;
