/*
 * Verifica que los comentarios HTML dentro de las plantillas no lleven acentos
 * graves.
 *
 * Un acento grave dentro de un comentario que vive en una plantilla la cierra.
 * El archivo sigue siendo JavaScript válido --el verificador de sintaxis pasa--,
 * pero la mitad de la plantilla queda afuera y el resto se ejecuta como código, así
 * que el error aparece recién en runtime y como ReferenceError de algo que no
 * existe.
 *
 * No alcanza con buscar el acento en la línea del `<!--`: el cierre del comentario
 * puede estar dos o tres líneas más abajo, que es donde suele caerse.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

let malos = 0;

for (const archivo of archivos) {
  const lineas = readFileSync(archivo, 'utf8').split('\n');
  let dentroDeComentario = false;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const abre = linea.indexOf('<!--');
    const cierra = linea.indexOf('-->');

    if (dentroDeComentario) {
      // Ya estamos dentro del comentario: cualquier acento grave hasta el cierre
      // rompe la plantilla.
      if (linea.includes('`')) {
        console.log(`  ${archivo} L${i + 1}: acento grave dentro de un comentario de plantilla`);
        console.log(`      ${linea.trim()}`);
        malos++;
      }
      if (cierra >= 0) dentroDeComentario = false;
      continue;
    }

    if (abre >= 0) {
      // El comentario abre y cierra en la misma línea.
      if (cierra > abre) {
        const cuerpo = linea.slice(abre, cierra);
        if (cuerpo.includes('`')) {
          console.log(`  ${archivo} L${i + 1}: acento grave dentro de un comentario de plantilla`);
          console.log(`      ${linea.trim()}`);
          malos++;
        }
      } else if (cierra < 0) {
        dentroDeComentario = true;
      }
    }
  }
}

if (malos) {
  console.log(`\nMAL: ${malos} acento(s) grave(s) dentro de comentarios de plantilla.`);
  process.exit(1);
}
console.log(`OK: ${archivos.length} archivo(s) sin acentos graves en comentarios de plantilla.`);