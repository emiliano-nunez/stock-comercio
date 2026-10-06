import { beforeAll, expect, test } from 'vitest';
import 'fake-indexeddb/auto';
import { db, dbUtils, estadoStock } from '../src/db.js';
import { App } from '../src/App.js';
import { importarBackup } from '../src/utils/backup.js';

/*
 * La app, corriendo.
 *
 * Uso: npm test
 *
 * Por que existe: cuatro bugs seguidos llegaron a la pantalla del usuario y ninguno
 * se vio leyendo el código, compilando, ni con los seis verificadores. Eran:
 *
 *   - un `icono()` al que le faltaba el import: ReferenceError al pintar.
 *   - un `groupBy()` que no existe en Dexie 4: TypeError al contar.
 *   - un `this.productosFiltrados` que la clase ya no escribía: TypeError al
 *     arrancar.
 *   - un `this.productosVisibles` (arreglo) que tapaba al método `productosVisibles`
 *     de la clase: "no es una función" al pintar el inventario.
 *   - un `conteos.get()` sobre un objeto plano: la pestaña Categorías entera tiraba
 *     `conteos.get is not a function` y no se podía abrir nunca.
 *
 * Los cinco se ven sólo cuando el código corre. Acá corre, contra una base sembrada
 * en memoria y un DOM de verdad.
 *
 * El quinto tiene una cosa para aprender: la app no deja que el error salga. Lo
 * atrapa, lo escribe en la consola y pone un cartel de "Algo falló" en pantalla. O
 * sea que una prueba que sólo mira si algo se tiró lo pasa sin ver nada. Por eso
 * estas pruebas cuentan también los `console.error`: el cartel es el síntoma, y
 * aca se lee el síntoma.
 *
 * Lo que este archivo NO es: una suite completa. Es una prueba de que la app levanta
 * y de que las consultas de la base responden lo que la pantalla espera. Lo que
 * tiene de valor es que es la que hubiera atrapado los cuatro.
 *
 * Para eso hacen falta dos paquetes de desarrollo, que no van a la app: `jsdom`
 * para el DOM y `fake-indexeddb` para la base.
 */

/** Productos sembrados antes de arrancar. Los nombres llevan tilde a propósito. */
const PRODUCTOS = [
  { id: 'prod_1', nombre: 'Tomate Redondo', categoriaIds: ['cat_1'], proveedor: 'Norte', stock: 12, stockMinimo: 5, precio: 1500, tipoVenta: 'unidad' },
  { id: 'prod_2', nombre: 'Limón', categoriaIds: ['cat_1', 'cat_2'], proveedor: 'Norte', stock: 0, stockMinimo: 5, precio: 800, tipoVenta: 'unidad' },
  { id: 'prod_3', nombre: 'Aceite de Oliva', categoriaIds: ['cat_2'], proveedor: '', stock: 3, stockMinimo: 5, precio: 4200, tipoVenta: 'unidad' }
];

const CATEGORIAS = [
  { id: 'cat_1', nombre: 'Frescos', color: '#22c55e' },
  { id: 'cat_2', nombre: 'Despensa', color: '#f59e0b' }
];

beforeAll(async () => {
  await db.categorias.bulkPut(CATEGORIAS);
  dbUtils.fijarCategoriasParaContar(CATEGORIAS);
  for (const p of PRODUCTOS) {
    await dbUtils.guardarProducto(p, p.id);
  }
  document.body.innerHTML = '<div id="app"></div>';
});

test('la app arranca y dibuja el inventario', async () => {
  const errores = [];
  const antes = console.error;
  console.error = (...args) => errores.push(args.map(String).join(' '));

  let fallo = null;
  try {
    const app = new App();
    await app.init();
    app.render();
  } catch (error) {
    fallo = error;
  } finally {
    console.error = antes;
  }

  expect(fallo, 'arrancar sin tirar').toBeNull();
  expect(errores, 'sin errores en consola').toEqual([]);

  const html = document.getElementById('app').innerHTML;

  // Los tres productos están, con su nombre exacto.
  for (const p of PRODUCTOS) {
    expect(html, `el inventario muestra ${p.nombre}`).toContain(p.nombre);
  }

  // Y con los botones de la tarjeta, que es lo que no se ve leyendo el método.
  expect(html).toContain('data-action="edit"');
  expect(html).toContain('data-action="delete"');
});

/*
 * Las tres pestañas pintan enteras.
 *
 * La prueba de arriba arrancaba la app pero se quedaba en Inventario. Como la
 * tarjeta de "Estado del stock" sólo se pinta en Categorías, un error de ahí no
 * se veía: la app lo atrapaba, escribía en la consola y ponía el cartel de
 * "Algo falló", y la prueba pasaba igual mirando el HTML del inventario.
 *
 * Por eso esta prueba recorre las tres y cuenta los errores de consola. Si alguna
 * vez se rompe un panel que sólo aparece en otra pestaña, se entera.
 */
test('las tres pestañas pintan enteras y sin quejarse', async () => {
  const errores = [];
  const antes = console.error;
  console.error = (...args) => errores.push(args.map(String).join(' '));

  let fallo = null;
  try {
    const app = new App();
    await app.init();
    for (const vista of ['inventario', 'catalogo', 'categorias']) {
      app.vistaActual = vista;
      app.render();
    }
  } catch (error) {
    fallo = error;
  } finally {
    console.error = antes;
  }

  expect(fallo, 'pintar las tres pestañas sin tirar').toBeNull();
  expect(errores, 'sin errores en consola en ninguna pestaña').toEqual([]);

  const html = document.getElementById('app').innerHTML;
  expect(html, 'llegó a la última pestaña').toContain('Estado del stock');
});

test('el filtro y el orden devuelven la página pedida', async () => {
  const todos = await dbUtils.consultarProductos({ limite: 60 });
  expect(todos.total).toBe(3);
  expect(todos.productos.map(p => p.nombre)).toEqual([
    'Aceite de Oliva',
    'Limón',
    'Tomate Redondo'
  ]);

  const conTilde = await dbUtils.consultarProductos({ limite: 60, busqueda: 'limón' });
  expect(conTilde.total).toBe(1);

  // El acento escrito sin tilde tiene que encontrarlo igual, que es como se
  // escribe rápido en un teléfono.
  const sinTilde = await dbUtils.consultarProductos({ limite: 60, busqueda: 'limon' });
  expect(sinTilde.total).toBe(1);
  expect(sinTilde.productos[0].nombre).toBe('Limón');

  const porEstado = await dbUtils.consultarProductos({ limite: 60, estado: 'vacio' });
  expect(porEstado.total).toBe(1);

  const porCategoria = await dbUtils.consultarProductos({ limite: 60, categoriaId: 'cat_2' });
  expect(porCategoria.total).toBe(2);

  const conLimite = await dbUtils.consultarProductos({ limite: 2 });
  expect(conLimite.productos).toHaveLength(2);
  expect(conLimite.total, 'sigue sabiendo cuántos hay en total').toBe(3);

  /*
   * El recorte va después del orden. Con el recorte antes, el orden al revés
   * mostraría siempre los mismos dos productos de la cabeza, y el "Cargar más"
   * parecería no hacer nada.
   */
  const alReves = await dbUtils.consultarProductos({ limite: 2, ordenDireccion: 'desc' });
  expect(alReves.productos.map(p => p.nombre)).toEqual(['Tomate Redondo', 'Limón']);
  expect(alReves.total).toBe(3);

  const alRevesTodo = await dbUtils.consultarProductos({ limite: 60, ordenDireccion: 'desc' });
  expect(alRevesTodo.productos.map(p => p.nombre)).toEqual([
    'Tomate Redondo',
    'Limón',
    'Aceite de Oliva'
  ]);

  // Y cada orden posible devuelve el mismo número total, aunque traiga la lista
  // entera: si uno se olvidara de pasar por el recorte, se nota acá.
  for (const ordenarPor of ['nombre', 'precio', 'stock', 'categoria', 'fecha']) {
    const r = await dbUtils.consultarProductos({ limite: 2, ordenarPor });
    expect(r.productos, `el orden por ${ordenarPor} respeta el límite`).toHaveLength(2);
    expect(r.total, `el orden por ${ordenarPor} cuenta lo mismo`).toBe(3);
  }
});

test('los contadores de los paneles salen de la base', async () => {
  const porProveedor = await dbUtils.contarPorProveedor();
  expect(porProveedor.get('norte')).toBe(2);
  expect(porProveedor.size, 'sólo los proveedores con productos').toBe(1);

  const contadores = await dbUtils.contarProductos();
  expect(contadores.total).toBe(3);
  expect(contadores.porEstado.vacio).toBe(1);
  expect(contadores.porEstado.poco).toBe(1);
  expect(contadores.porEstado.ok).toBe(1);
  expect(contadores.porCategoria.get('cat_1')).toBe(2);
  expect(contadores.porCategoria.get('cat_2')).toBe(2);
});

test('los campos derivados se calculan al escribir', async () => {
  const guardado = await db.productos.get('prod_2');

  expect(guardado.estado, 'el estado sale de comparar stock con el mínimo').toBe('vacio');
  expect(guardado.nombreOrden).toBe('limon');
  expect(guardado.proveedorClave).toBe('norte');
  expect(guardado.busqueda).toContain('limon');
  expect(guardado.busqueda).toContain('norte');
  expect(guardado.busqueda).toContain('frescos');
});

test('ajustar stock en transacción devuelve lo que quedó en la base', async () => {
  const antes = await db.productos.get('prod_1');

  const resultado = await dbUtils.ajustarStock('prod_1', -4);
  expect(resultado.stock).toBe(antes.stock - 4);

  const guardado = await db.productos.get('prod_1');
  expect(guardado.stock, 'lo guardado es lo que volvió').toBe(resultado.stock);
  expect(guardado.estado, 'y el estado se recalculó').toBe(estadoStock(guardado));
});

test('importar una copia valida el archivo antes de tocar nada', async () => {
  const totalAntes = await db.productos.count();
  const categoriasAntes = await db.categorias.count();

  await expect(importarBackup('{"nada":1}')).rejects.toThrow();

  await expect(
    importarBackup(JSON.stringify({
      productos: [{ nombre: { html: '<img src=x onerror=alert(1)>' } }],
      categorias: []
    }))
  ).rejects.toThrow(/nombre/);

  expect(await db.productos.count(), 'no se borró nada').toBe(totalAntes);
  expect(await db.categorias.count(), 'ni las categorías').toBe(categoriasAntes);
});