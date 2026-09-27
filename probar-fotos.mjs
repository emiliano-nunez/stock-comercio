/**
 * Prueba de la lógica de fotos, extrayendo las funciones REALES de src/db.js.
 *
 * No se copia el código: se lee el archivo, se recorta la definición de cada
 * función y se evalúa contra una base falsa. Así, si alguien edita la función y
 * rompe algo, esta prueba lo detecta en vez de validar un texto viejo que
 * alguien pegó acá.
 *
 * Uso: node probar-fotos.mjs
 */
import { readFileSync } from 'node:fs';

const fuente = readFileSync(new URL('./src/db.js', import.meta.url), 'utf8');

// Recorta "  [async ]nombre(args) { ... }" contando llaves para seguir el
// alcance del cuerpo. Un regex solo no sirve: hay llaves dentro de template
// literals y de los comentarios.
function extraer(nombre) {
  const m = new RegExp(`\\n  (?:async )?${nombre}\\(`).exec(fuente);
  if (!m) throw new Error(`No encontré ${nombre}() en db.js`);

  const inicio = m.index + 1;
  const abre = fuente.indexOf('{', inicio);
  let profundidad = 0;
  for (let i = abre; i < fuente.length; i++) {
    const c = fuente[i];
    if (c === '{') profundidad++;
    else if (c === '}') {
      profundidad--;
      if (profundidad === 0) {
        // En el archivo esto es un método del objeto dbUtils ("  async f() {}"),
        // que no es una sentencia válida por sí sola. Hay que volverlo
        // declaración para poder evaluarlo suelto.
        const src = fuente.slice(inicio, i + 1).trim();
        return src.startsWith('async ')
          ? src.replace(/^async /, 'async function ')
          : src.replace(/^([A-Za-z_$])/, 'function $1');
      }
    }
  }
  throw new Error(`No pude cerrar la llave de ${nombre}()`);
}

const FUNCIONES = [
  '_repartoDeImagenes',
  '_medirConjunto',
  'medirImagenesSinUsar',
  'limpiarImagenesSinUsar',
  'medirFotosDelHistorial',
  'liberarFotosDelHistorial',
  'compararConSnapshot'
];

/**
 * Arma una base falsa con las funciones reales pegadas encima.
 *
 * Se pegan al MISMO objeto que hace de base a propósito. En db.js las funciones
 * son métodos de dbUtils, así que usan `db` del cierre para las tablas y `this`
 * para invocarse entre ellas (medir llama a this._repartoDeImagenes). Si acá
 * fueran dos cosas distintas, la prueba estaría midiendo un escenario que en la
 * app no existe.
 */
function armarBase({ productos = [], imagenes = [], historial = [] } = {}) {
  const borrados = [];
  // Copia mutable: bulkDelete tiene que sacar de verdad las filas, no sólo
  // anotarlas. Si no, "medir después de borrar" seguiría viendo lo borrado y la
  // prueba daría un falso OK sobre el estado real.
  const tabla = new Map(imagenes.map(i => [i.id, i]));
  const db = {
    _borrados: borrados,
    productos: { toArray: async () => productos.map(p => ({ ...p })) },
    historial: {
      toArray: async () => historial.map(h => ({ ...h })),
      get: async (id) => {
        const h = historial.find(x => x.id === id);
        return h ? { ...h } : undefined;
      }
    },
    imagenes: {
      toArray: async () => [...tabla.values()].map(i => ({ ...i })),
      bulkDelete: async (ids) => {
        borrados.push(...ids);
        for (const id of ids) tabla.delete(id);
      }
    }
  };

  const cuerpo = FUNCIONES.map(extraer).join('\n\n');
  // eslint-disable-next-line no-new-func
  const factory = new Function('db', `${cuerpo}\nreturn { ${FUNCIONES.join(', ')} };`);
  Object.assign(db, factory(db));
  return db;
}

let pruebas = 0;
let fallos = 0;

function check(nombre, condicion, detalle = '') {
  pruebas++;
  if (condicion) {
    console.log(`  ok   ${nombre}`);
  } else {
    fallos++;
    console.log(`  FALLA ${nombre}${detalle ? '  -> ' + detalle : ''}`);
  }
}

// ---------------------------------------------------------------- medir/limpiar
console.log('\n_repartoDeImagenes + medirImagenesSinUsar + limpiarImagenesSinUsar');

// Caso 1: la foto sólo la mantiene viva un snapshot. Es el caso crítico del
// bloque C: si no se contara, la limpieza se llevaría por delante justo la foto
// que "Volver Atrás" necesita.
{
  const db = armarBase({
    productos: [{ id: 'p1', imagenId: 'img1' }],
    imagenes: [
      { id: 'img1', blob: { size: 100 } },
      { id: 'img2', blob: { size: 200 } },
      { id: 'img3', blob: { size: 300 }, thumb: { size: 10 } }
    ],
    historial: [{ id: 'h1', snapshotProductos: [{ id: 'p9', imagenId: 'img2' }] }]
  });
  const u = await db._repartoDeImagenes();
  check('la foto de un producto vivo no es ni suelta ni del historial',
    !u.delHistorial.some(i => i.id === 'img1') && !u.sueltas.some(i => i.id === 'img1'));
  check('la foto que sólo tiene un snapshot NO es suelta (si lo fuera, la limpieza la borraría)',
    !u.sueltas.some(i => i.id === 'img2') && u.delHistorial.some(i => i.id === 'img2'),
    JSON.stringify(u.sueltas.map(i => i.id)));

  const medido = await db.medirImagenesSinUsar();
  check('mide 1 foto suelta', medido.cantidad === 1, JSON.stringify(medido));
  check('suma blob + thumb', medido.bytes === 310, `bytes=${medido.bytes}`);
  check('megas = bytes / 1MB', Math.abs(medido.megas - 310 / 1048576) < 1e-9);

  const borradas = await db.limpiarImagenesSinUsar();
  check('limpia 1', borradas === 1);
  check('borra SÓLO la suelta', JSON.stringify(db._borrados) === '["img3"]', JSON.stringify(db._borrados));
}

// Caso 2: snapshot con snapshotProductos ausente (historial viejo o corrupto).
// Si reventara, el usuario no podría abrir el historial y por lo tanto no
// podría restaurar nada: el fallo de una medición tiene que ser inocuo.
{
  const db = armarBase({
    productos: [],
    imagenes: [{ id: 'img1', blob: { size: 1 } }],
    historial: [{ id: 'h1' }, { id: 'h2', snapshotProductos: null }]
  });
  let ok = true;
  try { await db.medirImagenesSinUsar(); } catch { ok = false; }
  check('no revienta con snapshots sin productos', ok);
}

// Caso 3: base vacía.
{
  const db = armarBase({});
  const medido = await db.medirImagenesSinUsar();
  check('base vacía mide 0', medido.cantidad === 0 && medido.bytes === 0);
  const borradas = await db.limpiarImagenesSinUsar();
  check('base vacía no borra nada', borradas === 0);
}

// Caso 4: no llama a bulkDelete cuando no hay nada que borrar. Dexie lanza
// TransactionInactiveError si se toca una tabla fuera de una transacción, y en
// algunos navegadores un bulkDelete vacío también es un error.
{
  const db = armarBase({ productos: [{ id: 'p1', imagenId: 'img1' }], imagenes: [{ id: 'img1' }] });
  await db.limpiarImagenesSinUsar();
  check('no llama a bulkDelete sin resultados', db._borrados.length === 0);
}

// ------------------------------------------------------------ compararConSnapshot
console.log('\ncompararConSnapshot');

// Es el caso que pidió el usuario: borró "Leche", el punto es de antes del
// borrado, así que al restaurar el producto vuelve.
{
  const db = armarBase({
    productos: [
      { id: 'p1', nombre: 'Arroz' },
      { id: 'p3', nombre: 'Azucar' }
    ],
    historial: [{
      id: 'h1',
      snapshotProductos: [
        { id: 'p1', nombre: 'Arroz' },
        { id: 'p2', nombre: 'Leche' }
      ]
    }]
  });
  const r = await db.compararConSnapshot('h1');
  check('detecta el producto que vuelve', r.vuelven.length === 1 && r.vuelven[0].nombre === 'Leche',
    JSON.stringify(r.vuelven));
  check('detecta el producto que desaparece', r.seVan.length === 1 && r.seVan[0].nombre === 'Azucar',
    JSON.stringify(r.seVan));
}

// Snapshot inexistente: no debe romper el diálogo.
{
  const db = armarBase({ productos: [{ id: 'p1' }], historial: [] });
  const r = await db.compararConSnapshot('no-existe');
  check('snapshot inexistente devuelve vacío', r.vuelven.length === 0 && r.seVan.length === 0);
}

// Snapshot con snapshotProductos ausente: idem.
{
  const db = armarBase({ productos: [{ id: 'p1' }], historial: [{ id: 'h1' }] });
  const r = await db.compararConSnapshot('h1');
  check('snapshot sin productos devuelve vacío', r.vuelven.length === 0 && r.seVan.length === 0);
}

// Id duplicado dentro del snapshot: la última gana. No debería pasar (los ids
// los genera la app), pero si un backup importado lo trae, sin esto el diff
// tiraría "vuelve" un producto que en realidad está en la base.
{
  const db = armarBase({
    productos: [{ id: 'p1', nombre: 'Arroz' }],
    historial: [{
      id: 'h1',
      snapshotProductos: [{ id: 'p1', nombre: 'Arroz viejo' }, { id: 'p1', nombre: 'Arroz' }]
    }]
  });
  const r = await db.compararConSnapshot('h1');
  check('id duplicado en el snapshot no genera falsos positivos', r.vuelven.length === 0,
    JSON.stringify(r.vuelven));
}

// Producto repetido en los productos actuales: seVan no puede duplicar el mismo
// id, o el diálogo contaría dos veces lo mismo.
{
  const db = armarBase({
    productos: [{ id: 'p1', nombre: 'Arroz' }, { id: 'p1', nombre: 'Arroz' }],
    historial: [{ id: 'h1', snapshotProductos: [{ id: 'p9', nombre: 'Leche' }] }]
  });
  const r = await db.compararConSnapshot('h1');
  check('producto repetido en la base no se va dos veces', r.seVan.length === 2, `seVan=${r.seVan.length}`);
  check('y sigue detectando al que falta', r.vuelven.length === 1);
}

// ------------------------------------------------- reparto de los 3 conjuntos
console.log('\n_repartoDeImagenes: delHistorial / sueltas (lo demás es de un producto vivo)');

// Base de referencia para las tres clasificaciones.
//   img1 -> producto vivo            => enUso
//   img2 -> sólo un snapshot         => delHistorial
//   img3 -> snapshot Y producto      => enUso (un producto manda sobre el historial)
//   img4 -> nadie la referencia      => sueltas
//   img5 -> el producto la quitó la foto y el snapshot es viejo => delHistorial
{
  const db = armarBase({
    productos: [
      { id: 'p1', imagenId: 'img1' },
      { id: 'p2', imagenId: 'img3' },
      { id: 'p3', imagenId: null }
    ],
    imagenes: [
      { id: 'img1', blob: { size: 10 } },
      { id: 'img2', blob: { size: 20 } },
      { id: 'img3', blob: { size: 30 } },
      { id: 'img4', blob: { size: 40 } },
      { id: 'img5', blob: { size: 50 } }
    ],
    historial: [
      { id: 'h1', snapshotProductos: [{ id: 'p9', imagenId: 'img2' }] },
      { id: 'h2', snapshotProductos: [{ id: 'p2', imagenId: 'img3' }, { id: 'p8', imagenId: 'img5' }] }
    ]
  });

  const r = await db._repartoDeImagenes();
  const ids = (c) => c.map(i => i.id).sort();

  check('delHistorial = sólo-snapshot + foto que se le quitó al producto',
    JSON.stringify(ids(r.delHistorial)) === '["img2","img5"]', JSON.stringify(ids(r.delHistorial)));
  check('sueltas = la que no referencia nadie',
    JSON.stringify(ids(r.sueltas)) === '["img4"]', JSON.stringify(ids(r.sueltas)));
  check('la foto de un producto vivo no aparece en ninguno de los dos',
    !ids(r.delHistorial).includes('img1') && !ids(r.sueltas).includes('img1'));
  check('la que está en producto y en snapshot cuenta como de producto, no del historial',
    !ids(r.delHistorial).includes('img3'), JSON.stringify(ids(r.delHistorial)));

  // La intersección es lo que hace que las dos limpiezas no se pisen. Si un
  // id estuviera en los dos, un botón prometería borrar lo que el otro protegió.
  const interseccion = r.delHistorial.filter(i => r.sueltas.some(s => s.id === i.id));
  check('delHistorial y sueltas no se superponen', interseccion.length === 0,
    JSON.stringify(interseccion.map(i => i.id)));

  // Medir y limpiar tienen que ver EXACTAMENTE el mismo conjunto.
  const mSueltas = await db.medirImagenesSinUsar();
  check('medir sueltas ve 1', mSueltas.cantidad === 1 && mSueltas.bytes === 40, JSON.stringify(mSueltas));

  const mHist = await db.medirFotosDelHistorial();
  check('medir historial ve 2', mHist.cantidad === 2 && mHist.bytes === 70, JSON.stringify(mHist));

  const liberadas = await db.liberarFotosDelHistorial();
  check('liberar historial borra 2', liberadas === 2);
  check('y son las del historial, no las sueltas ni las de productos',
    JSON.stringify([...db._borrados].sort()) === '["img2","img5"]', JSON.stringify(db._borrados));
  check('NO toca la foto de un producto vivo', !db._borrados.includes('img1'));
  check('NO toca la foto que share producto y snapshot', !db._borrados.includes('img3'));
}

// Con lo borrado, la foto de un producto que vuelve a tocar el historial tiene
// que dejar de contar como delHistorial. Si no, el botón queda mostrando un
// número que ya no corresponde y el usuario lo pulsa dos veces.
{
  const db = armarBase({
    productos: [],
    imagenes: [{ id: 'img2', blob: { size: 20 } }],
    historial: [{ id: 'h1', snapshotProductos: [{ id: 'p9', imagenId: 'img2' }] }]
  });
  await db.liberarFotosDelHistorial();
  const despues = await db.medirFotosDelHistorial();
  check('tras liberar, mide 0 (el botón no queda ofreciendo un número viejo)',
    despues.cantidad === 0, JSON.stringify(despues));
  const otra = await db.liberarFotosDelHistorial();
  check('liberar dos veces no borra nada extra', otra === 0);
  check('ni llama a bulkDelete de nuevo', db._borrados.length === 1, JSON.stringify(db._borrados));
}

// Snapshot sin snapshotProductos: la clasificación tiene que ignorarlo en vez
// de tratar todos sus ids como ausentes.
{
  const db = armarBase({
    productos: [{ id: 'p1', imagenId: 'img1' }],
    imagenes: [{ id: 'img1', blob: { size: 10 } }],
    historial: [{ id: 'h1' }]
  });
  let ok = true;
  try { await db.medirFotosDelHistorial(); } catch { ok = false; }
  check('no revienta con snapshots sin productos', ok);
}

console.log(`\n${pruebas - fallos}/${pruebas} aserciones ok`);
if (fallos > 0) {
  console.error(`${fallos} FALLA(S)`);
  process.exit(1);
}
