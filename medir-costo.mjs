/*
 * Mide el costo de la parte de JavaScript del filtrado actual.
 *
 * No importa nada y no toca la base del usuario: son arreglos en memoria. Es la
 * parte que domina, porque la búsqueda y el orden nohitsan la base: los hacen
 * sobre el arreglo entero, cada vez que se toca una tecla.
 *
 * Lo que NO mide, y por qué: la consulta contra un índice de IndexedDB. Medirla
 * necesitaría un motor de IndexedDB en Node, que el proyecto no tiene y no se
 * va a agregar sólo para medir. Esa parte se estima por lo que dice la
 * especificación, no por un número.
 */
const NORMALIZAR = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function armar(n) {
  const categorias = [];
  for (let i = 0; i < 20; i++) categorias.push({ id: `cat_${i}`, nombre: `Categoría ${i}` });

  const productos = [];
  for (let i = 0; i < n; i++) {
    productos.push({
      id: `prod_${i}`,
      nombre: `Producto de prueba número ${i} con un nombre bastante largo para ocupar dos líneas`,
      categoriaIds: [`cat_${i % 20}`],
      proveedor: `Proveedor ${i % 7}`,
      codigoBarras: `7798${String(1000000 + i)}`,
      stock: i % 40,
      precio: i * 5,
      actualizadoEl: '2026-10-01T00:00:00.000Z'
    });
  }
  return { productos, categorias };
}

/** Lo que hace `aplicarFiltroYOrden` en cada tecla escrita. */
function filtrarYOrdenar(productos, categorias, busqueda, campo = 'nombre') {
  const t0 = performance.now();

  let resultado = [...productos];

  const query = NORMALIZAR(busqueda);
  if (query) {
    resultado = resultado.filter(p => {
      if (NORMALIZAR(p.nombre).includes(query)) return true;
      if (p.codigoBarras && NORMALIZAR(p.codigoBarras).includes(query)) return true;
      if (p.proveedor && NORMALIZAR(p.proveedor).includes(query)) return true;
      return p.categoriaIds.some(id => {
        const cat = categorias.find(c => c.id === id);
        return cat && NORMALIZAR(cat.nombre).includes(query);
      });
    });
  }

  resultado.sort((a, b) => {
    const va = campo === 'nombre' ? NORMALIZAR(a.nombre) : campo === 'precio' ? a.precio : a.stock;
    const vb = campo === 'nombre' ? NORMALIZAR(b.nombre) : campo === 'precio' ? b.precio : b.stock;
    if (va < vb) return -1;
    if (va > vb) return 1;
    return 0;
  });

  return { ms: performance.now() - t0, total: resultado.length };
}

/** El panel de categorías: una vez por categoría, dos llamadas por línea. */
function contarCategorias(productos, categorias) {
  const t0 = performance.now();
  let total = 0;
  for (const cat of categorias) {
    for (const p of productos) {
      if (p.categoriaIds.includes(cat.id)) total++;
    }
  }
  return { ms: performance.now() - t0, total };
}

/** Cuántos nodos hace una tarjeta. El repintado es el otro costo grande. */
function nodosDeUnaTarjeta() {
  // article > fila > [stock-foto > miniatura > img + insignia, .tarjeta-info >
  // h3 + datos-producto > 4 spans] + acciones > 3 botones > svg > path
  return 1 + 1 + 3 + 2 + 1 + 4 + 4 + 3 * 3;
}

const tres = (t) => t.toFixed(1).padStart(7);

console.log('  productos   filtrar+ordenar (por tecla)   contar categorías   x20 búsquedas');
for (const n of [100, 300, 500, 1000, 2000]) {
  const { productos, categorias } = armar(n);

  // El caso caro: la búsqueda convierte cada nombre CON NORMALIZAR DENTRO del
  // filtro, así que el costo crece con el tamaño del texto escrito.
  let peor = 0;
  for (const q of ['p', 'pr', 'pro', 'prue', 'prueba', 'numero', '123']) {
    const r = filtrarYOrdenar(productos, categorias, q);
    peor = Math.max(peor, r.ms);
  }

  const c = contarCategorias(productos, categorias);

  console.log(
    '  ' + String(n).padStart(8) +
    '   ' + tres(peor) + 'ms' +
    '            ' + tres(c.ms) + 'ms' +
    '        ' + tres(peor * 20) + 'ms'
  );
}

console.log('');
console.log('  Nodos por tarjeta: ' + nodosDeUnaTarjeta());
console.log('  Con 60 tarjetas visibles, un repintado reconstruye unos ' + (nodosDeUnaTarjeta() * 60) + ' nodos.');
