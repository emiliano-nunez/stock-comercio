import { expect, test } from 'vitest';
import { camposDerivados, db, estadoStock, getPrecioPrincipal } from '../src/db.js';

/*
 * Datos raros no pueden romper la app.
 *
 * Uso: npm test
 *
 * Por que existe: la migración a la versión 9 del esquema corre `camposDerivados()`
 * sobre TODOS los productos, dentro de la transacción con la que Dexie actualiza la
 * base. Si un solo producto tira, Dexie aborta la migración entera y la app no abre:
 * no es un producto que no aparece al buscar, es el inventario entero.
 *
 * Y los datos de esa migración son los del usuario, escritos por versiones
 * anteriores de la app que no los validaban. Nunca los vi. Este archivo hace las
 * dos cosas que se pueden hacer con eso: tolerar las formas raras donde se
 * calculan los campos, y comprobar que de verdad se toleran.
 */

/** Un producto con la forma que el usuario tendría, para las comparaciones. */
const NORMAL = { nombre: 'Aceite', precio: 100, stock: 5, stockMinimo: 2 };

test('un precio con un hueco no rompe el calculo de los campos', () => {
  /*
   * El caso que se dio: `[null]`. Pasa el `Array.isArray`, así que el filtro de
   * "es una lista" lo deja pasar, y `p.unidad` es leer sobre nada.
   */
  const producto = { nombre: 'Aceite', precios: [null] };

  expect(() => camposDerivados(producto, [])).not.toThrow();
  expect(getPrecioPrincipal(producto).valor).toBe(0);
});

test('un precio con un hueco entre dos buenos se saltea', () => {
  const producto = { nombre: 'Aceite', precios: [null, { unidad: 'kg', valor: 1500, label: 'kg' }] };

  expect(getPrecioPrincipal(producto).valor, 'agarra el que sí está').toBe(1500);
});

test('las formas raras de un producto no cortan el calculo', () => {
  const CATEGORIAS = [{ id: 'cat_1', nombre: 'Frescos' }];

  const RARAS = [
    ['nombre como número', { nombre: 42 }],
    ['nombre como objeto', { nombre: { a: 1 } }],
    ['nombre vacío', { nombre: '' }],
    ['nombre ausente', {}],
    ['nada de producto', undefined],
    ['stock como texto', { nombre: 'X', stock: 'diez' }],
    ['stock negativo', { nombre: 'X', stock: -3 }],
    ['categoría con un hueco', { nombre: 'X', categoriaIds: ['cat_1', null] }],
    ['categoría repetida', { nombre: 'X', categoriaIds: ['cat_1', 'cat_1'] }],
    ['precio como texto', { nombre: 'X', precio: '1500' }],
    ['precios como texto', { nombre: 'X', precios: 'mucho' }],
    ['precios vacíos', { nombre: 'X', precios: [] }],
    ['tipo de venta raro', { nombre: 'X', tipoVenta: 'inventado' }]
  ];

  for (const [nombre, producto] of RARAS) {
    expect(
      () => camposDerivados(producto, CATEGORIAS),
      `${nombre} no puede cortar el cálculo`
    ).not.toThrow();
  }
});

test('los campos derivados de un producto raro siguen siendo utilizables', () => {
  const raro = { nombre: '  TOMATE  ', precio: '1500', stock: 'diez', categoriaIds: ['cat_1', null] };
  const d = camposDerivados(raro, [{ id: 'cat_1', nombre: 'Frescos' }]);

  // Que un dato raro no tire no sirve si lo que sale es basura: estos son los
  // valores por los que la base filtra y ordena.
  expect(d.nombreOrden, 'el nombre se normaliza para ordenar').toBe('tomate');
  expect(d.precioOrden, 'el precio es un número, no un texto').toBe(1500);
  expect(d.proveedorClave).toBe('');
  expect(typeof d.busqueda).toBe('string');
  expect(d.busqueda).toContain('tomate');
  expect(['ok', 'poco', 'vacio'], 'el estado es siempre uno de los tres').toContain(d.estado);
});

test('un producto sin categoría no rompe el nombre de categoría', () => {
  const huerfano = { nombre: 'X', categoriaIds: ['cat_que_no_existe'] };
  expect(camposDerivados(huerfano, [{ id: 'cat_1', nombre: 'Frescos' }]).categoriaOrden).toBe('');
});

test('el estado sale de comparar stock con el mínimo', () => {
  expect(estadoStock({ stock: 0, stockMinimo: 5 })).toBe('vacio');
  expect(estadoStock({ stock: 3, stockMinimo: 5 })).toBe('poco');
  expect(estadoStock({ stock: 9, stockMinimo: 5 })).toBe('ok');
  // Sin datos, se trata como vacío: es lo que muestra la tarjeta, no hay nada
  // más honesto que inventar.
  expect(estadoStock({})).toBe('vacio');
});

test('el esquema es la versión que espera el código', async () => {
  /*
   * La migración se dispara sola al abrir. Si el número del código y el de Dexie no
   * coinciden, la migración no corre y los campos derivados quedan sin escribir:
   * el filtro por texto devuelve vacío y no dice por qué.
   */
  expect(db.verno).toBe(9);
});