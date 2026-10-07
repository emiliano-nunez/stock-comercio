import { expect, test } from 'vitest';
import 'fake-indexeddb/auto';
import { construirHistorialPrecios, db, dbUtils } from '../src/db.js';
import { exportarBackup, importarBackup } from '../src/utils/backup.js';

/*
 * El historial de precio y costo: que la referencia anterior quede guardada
 * cuando el precio o el costo cambian, y que la copia de seguridad lo lleve.
 *
 * Corre con npm test, junto con las demás.
 */

test('un cambio de precio guarda lo que valía antes', () => {
  const producto = { precio: 1000, costo: 600 };
  const nuevo = construirHistorialPrecios(producto, 1200, 600, '2026-10-07');

  expect(nuevo).toEqual([
    { fecha: '2026-10-07', precio: 1000, costo: 600 }
  ]);
});

test('sin cambios de precio ni costo no se agrega entrada', () => {
  const producto = { precio: 1000, costo: 600 };
  const nuevo = construirHistorialPrecios(producto, 1000, 600, '2026-10-07');

  expect(nuevo).toEqual([]);
});

test('fijar el primer precio no deja referencia', () => {
  const producto = { precio: 0, costo: 0 };
  const nuevo = construirHistorialPrecios(producto, 500, 0, '2026-10-07');

  expect(nuevo).toEqual([]);
});

test('un producto nuevo empieza sin historial', () => {
  expect(construirHistorialPrecios(null, 500, 300, '2026-10-07')).toEqual([]);
});

test('los cambios se acumulan y la última entrada es lo anterior', () => {
  const primero = construirHistorialPrecios({ precio: 1000, costo: 0 }, 1200, 0, '2026-09-01');
  const segundo = construirHistorialPrecios(
    { precio: 1200, costo: 0, historialPrecios: primero },
    900, 0, '2026-10-07'
  );

  expect(segundo).toEqual([
    { fecha: '2026-09-01', precio: 1000, costo: 0 },
    { fecha: '2026-10-07', precio: 1200, costo: 0 }
  ]);
  expect(segundo[segundo.length - 1].precio, 'lo anterior para el form').toBe(1200);
});

test('una entrada basura del historial se filtra al leer', () => {
  const producto = {
    precio: 900,
    costo: 0,
    historialPrecios: [null, 'raro', { fecha: '2026-01-01', precio: 800, costo: 0 }]
  };
  const nuevo = construirHistorialPrecios(producto, 950, 0, '2026-10-07');

  expect(nuevo).toEqual([
    { fecha: '2026-01-01', precio: 800, costo: 0 },
    { fecha: '2026-10-07', precio: 900, costo: 0 }
  ]);
});

test('la copia de seguridad lleva el historial y la importación lo devuelve', async () => {
  await db.productos.clear();
  await dbUtils.guardarProducto({
    id: 'prod_hist',
    nombre: 'Yerba',
    categoriaIds: [],
    stock: 4,
    precio: 1200,
    costo: 800,
    historialPrecios: [{ fecha: '2026-09-01', precio: 1000, costo: 700 }]
  }, 'prod_hist');

  const copia = await exportarBackup();
  await db.productos.clear();
  await importarBackup(copia);

  const traído = await db.productos.get('prod_hist');
  expect(traído.historialPrecios).toEqual([
    { fecha: '2026-09-01', precio: 1000, costo: 700 }
  ]);
});
