/**
 * Prueba del diálogo de código repetido, extrayendo la función REAL de
 * src/components/CodigoDuplicado.js.
 *
 * No se copia el código: se lee el archivo, se recorta la definición de la
 * función y se evalúa contra una base falsa. Así, si alguien edita la función y
 * rompe algo, esta prueba lo detecta en vez de validar un texto viejo que
 * alguien pegó acá.
 *
 * Lo que se prueba es primerCodigoLibre(), que decide con qué código se guarda
 * un producto cuando el que escribió ya lo tiene otro. El resto del módulo es
 * pintado de HTML y necesita un navegador.
 *
 * Uso: node probar-codigos.mjs
 */
import { readFileSync } from 'node:fs';

const fuente = readFileSync(new URL('./src/components/CodigoDuplicado.js', import.meta.url), 'utf8');

// A diferencia de db.js, acá las funciones están al nivel del módulo y no como
// métodos de un objeto, así que el recorte busca "function nombre(".
function extraer(nombre) {
  const m = new RegExp(`^(?:export )?(?:async )?function ${nombre}\\(`, 'm').exec(fuente);
  if (!m) throw new Error(`No encontré ${nombre}() en CodigoDuplicado.js`);

  const inicio = m.index;
  const abre = fuente.indexOf('{', m.index + m[0].length);
  let profundidad = 0;
  for (let i = abre; i < fuente.length; i++) {
    const c = fuente[i];
    if (c === '{') profundidad++;
    else if (c === '}') {
      profundidad--;
      if (profundidad === 0) return fuente.slice(inicio, i + 1).replace(/^export /, '');
    }
  }
  throw new Error(`No pude cerrar la llave de ${nombre}()`);
}

const FUNCIONES = ['primerCodigoLibre'];

/**
 * Base falsa con el mismo comportamiento que hace el índice de Dexie.
 *
 * where('codigoBarras').startsWith(prefijo) recorre un IDBKeyRange acotado por
 * dos string, así que los productos sin código (codigoBarras null) quedan
 * fuera: no son string y no entran en el rango. Si la base falsa no imitara eso,
 * un String(null) se colaría en el conjunto de códigos usados y la función
 * elegiría un sufijo para esquivar un código inexistente.
 */
function armarBase({ productos = [] } = {}) {
  const db = {
    productos: {
      where(indice) {
        if (indice !== 'codigoBarras') throw new Error(`índice desconocido: ${indice}`);
        return {
          startsWith(prefijo) {
            return {
              async toArray() {
                return productos
                  .filter(p => typeof p.codigoBarras === 'string' && p.codigoBarras.startsWith(prefijo))
                  .map(p => ({ ...p }));
              }
            };
          }
        };
      }
    }
  };

  const cuerpo = FUNCIONES.map(extraer).join('\n\n');
  // eslint-disable-next-line no-new-func
  const factory = new Function('db', `${cuerpo}\nreturn { ${FUNCIONES.join(', ')} };`);
  return Object.assign(db, factory(db));
}

let pruebas = 0;
let fallos = 0;

async function prueba(descripcion, productos, base, esperado) {
  pruebas++;
  const { primerCodigoLibre } = armarBase({ productos });
  let obtenido;
  try {
    obtenido = await primerCodigoLibre(base);
  } catch (error) {
    fallos++;
    console.log(`  ERROR  ${descripcion}`);
    console.log(`         ${error.message}`);
    return;
  }
  if (obtenido === esperado) {
    console.log(`  ok     ${descripcion}`);
  } else {
    fallos++;
    console.log(`  FALLA  ${descripcion}`);
    console.log(`         esperaba ${JSON.stringify(esperado)}, obtuvo ${JSON.stringify(obtenido)}`);
  }
}

const conCodigo = (...codigos) => codigos.map((c, i) => ({ id: `p${i}`, codigoBarras: c }));

console.log('\nprimerCodigoLibre()');

// El caso normal: el código está libre y se guarda tal cual.
await prueba('código libre: devuelve el mismo código', [], '7790123456789', '7790123456789');
await prueba('código libre con otros produtos cargados',
  conCodigo('111', '222'), '7790123456789', '7790123456789');

// El primer conflicto: propone -2.
await prueba('código tomado: propone -2', conCodigo('7790'), '7790', '7790-2');
await prueba('código tomado dos veces: propone -3',
  conCodigo('7790', '7790-2'), '7790', '7790-3');
await prueba('tres tomados: propone -4',
  conCodigo('7790', '7790-2', '7790-3'), '7790', '7790-4');

// Huecos: no tiene que llenar el primer hueco, tiene que seguir la serie.
await prueba('hueco en la serie: propone el primero libre igual',
  conCodigo('7790', '7790-3', '7790-4'), '7790', '7790-2');
await prueba('hueco en el medio: saltea el -3 que falta',
  conCodigo('7790', '7790-2', '7790-4', '7790-5'), '7790', '7790-3');

// Productos sin código: no cuentan como conflictos.
await prueba('productos sin código no estorban',
  [{ id: 'a', codigoBarras: null }, { id: 'b', codigoBarras: undefined }, { id: 'c' }],
  '7790', '7790');
await prueba('sin código pero con el base tomado',
  [{ id: 'a', codigoBarras: null }, { id: 'b', codigoBarras: '7790' }],
  '7790', '7790-2');

// Un código que es prefijo del otro no es un conflicto, pero tampoco se pisa.
await prueba('código más largo que empieza igual: no cuenta como tomado',
  conCodigo('77901'), '7790', '7790');
await prueba('base tomado y otro más largo que lo empieza',
  conCodigo('7790', '77901'), '7790', '7790-2');

// El sufijo tiene que respectar el final del rango, no empezar de cero con
// cualquier número.
await prueba('muchos ya tomados: sigue la serie',
  conCodigo('7790', ...Array.from({ length: 20 }, (_, i) => `7790-${i + 2}`)),
  '7790', '7790-22');

// El base puede venir como número desde un lector de códigos, y el código
// guardado siempre es texto: el formulario y el escáner hacen toString() antes
// de escribir.
await prueba('base numérica contra código en texto: se convierte y colisiona',
  conCodigo('7790'), 7790, '7790-2');

// Un código guardado como número es OTRA clave que el mismo número en texto, y
// la app nunca lo escribe: el formulario y el escáner guardan texto. Se deja
// asentado para que nadie lea esto como un conflicto que la app no detecta.
await prueba('código guardado como número: es otra clave y no colisiona',
  conCodigo(7790), '7790', '7790');

// Agotamiento: con la serie entera ocupada no hay salida y hay que decirlo.
const todos = conCodigo('7790', ...Array.from({ length: 998 }, (_, i) => `7790-${i + 2}`));
await prueba('serie entera ocupada: devuelve null', todos, '7790', null);

console.log(`\n${pruebas - fallos}/${pruebas} aserciones ok`);
process.exit(fallos ? 1 : 0);
