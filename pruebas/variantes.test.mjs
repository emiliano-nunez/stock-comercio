import { expect, test } from 'vitest';
import 'fake-indexeddb/auto';
import { claveFamilia, nombreBaseDe, nombreDeVariante, datosDeVariante, economiaDe, economiaDistinta, db, dbUtils } from '../src/db.js';
import { exportarBackup, importarBackup } from '../src/utils/backup.js';

/*
 * Variantes: el nombre compuesto, los datos que se copian y los que no, la
 * clave de familia simétrica, y la ida y vuelta por la copia de seguridad.
 *
 * Corre con npm test, junto con las demás.
 */

const base = {
  id: 'prod_base',
  nombre: 'Taza Solar',
  precio: 2500,
  costo: 1500,
  stock: 7,
  stockMinimo: 2,
  categoriaIds: ['cat1'],
  imagenId: 'img_1',
  codigoBarras: '7790000000001',
  codigoProveedor: 'PR-1',
  historialPrecios: [{ fecha: '2026-01-01', precio: 2000, costo: 1000 }]
};

test('la clave de familia es el propio id en la base y la asignada en la variante', () => {
  expect(claveFamilia(base)).toBe('prod_base');
  expect(claveFamilia({ ...base, id: 'prod_v', familia: 'prod_base' })).toBe('prod_base');
  expect(claveFamilia({ id: 'prod_solo' })).toBe('prod_solo');
  expect(claveFamilia(null)).toBeNull();
});

test('el nombre de la variante es el de la base más la etiqueta limpia', () => {
  expect(nombreDeVariante(base, 'Negro', null)).toBe('Taza Solar — Negro');
  expect(nombreDeVariante(base, '  Negro  ', null)).toBe('Taza Solar — Negro');
});

test('si la base se borró, la variante no apila etiquetas', () => {
  const negra = { id: 'prod_n', nombre: 'Taza Solar — Negro', varianteEtiqueta: 'Negro' };

  expect(nombreBaseDe(negra)).toBe('Taza Solar');
  expect(nombreBaseDe(base)).toBe('Taza Solar');
  expect(nombreDeVariante(negra, 'Rojo', null)).toBe('Taza Solar — Rojo');
  // Con la base viva, manda el nombre de la base.
  expect(nombreDeVariante(negra, 'Rojo', base)).toBe('Taza Solar — Rojo');
});

test('los datos de la variante copian lo que hace al producto y limpian lo propio', () => {
  const negra = datosDeVariante(base, { etiqueta: 'Negro', color: '#1F2937', base: null });

  // Lo nuevo del vínculo.
  expect(negra.nombre).toBe('Taza Solar — Negro');
  expect(negra.familia).toBe('prod_base');
  expect(negra.varianteEtiqueta).toBe('Negro');
  expect(negra.varianteColor).toBe('#1F2937');

  // Lo que no se hereda.
  expect(negra.id).toBeUndefined();
  expect(negra.codigoBarras).toBeUndefined();
  expect(negra.imagenUrl).toBeUndefined();
  expect(negra.creadoEl).toBeUndefined();
  expect(negra.stock).toBe(0);
  expect(negra.codigoProveedor).toBeNull();
  expect(negra.historialPrecios).toEqual([]);

  // Lo que sí se copia.
  expect(negra.precio).toBe(2500);
  expect(negra.costo).toBe(1500);
  expect(negra.stockMinimo).toBe(2);
  expect(negra.categoriaIds).toEqual(['cat1']);
  expect(negra.imagenId).toBe('img_1');
});

test('una variante creada desde otra se suma a la misma familia', () => {
  const negra = datosDeVariante(base, { etiqueta: 'Negro', color: null, base: null });
  const roja = datosDeVariante({ ...negra, id: 'prod_n' }, { etiqueta: 'Rojo', color: null, base });

  expect(roja.familia).toBe('prod_base');
  expect(roja.nombre).toBe('Taza Solar — Rojo');
  expect(claveFamilia(roja)).toBe('prod_base');
});

test('la economía de un producto es el precio que se ve y el costo en números', () => {
  expect(economiaDe(base)).toEqual({ precio: 2500, costo: 1500 });

  // Con lista de precios, manda el de la unidad principal (y si no hay
  // exacto, el primero con valor).
  expect(economiaDe({ precio: 3000, precios: [{ unidad: 'unid', valor: 2800 }] }).precio).toBe(2800);

  // Vacío o ilegible cuenta como 0, nunca como NaN.
  expect(economiaDe({ precio: '', costo: null })).toEqual({ precio: 0, costo: 0 });
  expect(economiaDe(null)).toEqual({ precio: 0, costo: 0 });
});

test('la economía es distinta si cambia el precio o el costo de alguna hermana', () => {
  const misma = [{ ...base, id: 'prod_v', familia: 'prod_base' }];
  const precioAjeno = [{ ...base, id: 'prod_v', familia: 'prod_base', precio: 3000 }];
  const costoAjeno = [{ ...base, id: 'prod_v', familia: 'prod_base', costo: 900 }];

  // Sin hermanas no hay nada que avisar.
  expect(economiaDistinta({ precio: 2500, costo: 1500 }, [])).toBe(false);
  expect(economiaDistinta({ precio: 2500, costo: 1500 }, null)).toBe(false);

  expect(economiaDistinta({ precio: 2500, costo: 1500 }, misma)).toBe(false);
  expect(economiaDistinta({ precio: 2500, costo: 1500 }, precioAjeno)).toBe(true);
  expect(economiaDistinta({ precio: 2500, costo: 1500 }, costoAjeno)).toBe(true);

  // Un costo vacío en la hermana es un 0: contra un 0 propio no hay diferencia.
  expect(economiaDistinta({ precio: 2500, costo: 0 }, [{ ...base, id: 'prod_v', familia: 'prod_base', costo: '' }])).toBe(false);
});

test('la copia de seguridad lleva familia, etiqueta y color', async () => {
  await db.productos.clear();
  await dbUtils.guardarProducto({
    id: 'prod_var',
    nombre: 'Taza Solar — Negro',
    categoriaIds: [],
    stock: 0,
    precio: 2500,
    costo: 1500,
    familia: 'prod_base',
    varianteEtiqueta: 'Negro',
    varianteColor: '#1F2937'
  }, 'prod_var');

  const copia = await exportarBackup();
  await db.productos.clear();
  await importarBackup(copia);

  const traído = await db.productos.get('prod_var');
  expect(traído.familia).toBe('prod_base');
  expect(traído.varianteEtiqueta).toBe('Negro');
  // colorSeguro devuelve la paleta en minúsculas, que pintan igual.
  expect(traído.varianteColor).toBe('#1f2937');
});

test('un color de variante que no sea de la paleta no se importa', async () => {
  await db.productos.clear();
  await dbUtils.guardarProducto({
    id: 'prod_color_raro',
    nombre: 'Taza Solar — Verde',
    categoriaIds: [],
    stock: 0,
    precio: 2500,
    familia: 'prod_base',
    varianteEtiqueta: 'Verde',
    varianteColor: 'javascript:alert(1)'
  }, 'prod_color_raro');

  const copia = await exportarBackup();
  await db.productos.clear();
  await importarBackup(copia);

  const traído = await db.productos.get('prod_color_raro');
  expect(traído.varianteColor).toBeNull();
  expect(traído.varianteEtiqueta).toBe('Verde');
});
