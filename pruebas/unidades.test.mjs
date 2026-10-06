import { expect, test } from 'vitest';
import { UNIDADES_STOCK, getUnidadStock, unidadStockTexto, pasoUnidadStock } from '../src/db.js';

/*
 * La unidad del stock es independiente de la unidad de venta.
 *
 * Uso: npm test
 *
 * Por que existe: se puede guardar en cajas aunque la venta sea por kilo, y
 * cada pantalla (badge de la tarjeta, ficha, pedido, ajuste) tiene que decir
 * la misma palabra para la misma cantidad. Si alguna se acuerda de la unidad
 * de venta, el usuario ve "3 kg" en un lado y "3 cajas" en otro.
 */

test('sin unidad propia, el stock se cuenta en la unidad de la venta', () => {
  expect(getUnidadStock({ tipoVenta: 'peso_kg' })).toBe('kg');
  expect(getUnidadStock({ tipoVenta: 'unidad' })).toBe('unidad');
  expect(getUnidadStock({})).toBe('unidad');
  expect(getUnidadStock(null)).toBe('unidad');
});

test('la unidad propia manda sobre la de la venta', () => {
  expect(getUnidadStock({ tipoVenta: 'peso_kg', unidadStock: 'caja' })).toBe('caja');
  expect(getUnidadStock({ tipoVenta: 'peso_kg', unidadStock: '' })).toBe('kg');
  expect(getUnidadStock({ tipoVenta: 'unidad', unidadStock: 'docena' })).toBe('docena');
});

test('la palabra de la unidad se pluraliza con la cantidad', () => {
  expect(unidadStockTexto({ tipoVenta: 'peso_kg', unidadStock: 'caja' }, 3)).toBe('cajas');
  expect(unidadStockTexto({ tipoVenta: 'peso_kg', unidadStock: 'caja' }, 1)).toBe('caja');
  expect(unidadStockTexto({ tipoVenta: 'peso_kg' }, 5)).toBe('kg');
  expect(unidadStockTexto({ tipoVenta: 'peso_kg' }, 1)).toBe('kg');
  expect(unidadStockTexto({ tipoVenta: 'unidad' }, 2)).toBe('unidades');
});

test('el paso del stock: enteras de a una y lo de la venta como hasta ahora', () => {
  expect(pasoUnidadStock('', 'peso_kg')).toBe(0.5);
  expect(pasoUnidadStock('', 'unidad')).toBe(1);
  expect(pasoUnidadStock('', undefined)).toBe(1);
  expect(pasoUnidadStock('caja', 'peso_kg')).toBe(1);
  expect(pasoUnidadStock('kg', 'unidad')).toBe(0.5);
  expect(pasoUnidadStock('bolsa', 'peso_100g')).toBe(1);
});

test('la lista arranca con la opción automática y cubre enteras, kilo, litro y metro', () => {
  expect(UNIDADES_STOCK[0].value).toBe('');
  expect(UNIDADES_STOCK.map(u => u.value).join(',')).toBe(',unidad,caja,bolsa,pack,docena,kg,L,m');
});
