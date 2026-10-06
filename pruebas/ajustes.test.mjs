import { beforeAll, expect, test } from 'vitest';
import 'fake-indexeddb/auto';
import { db, dbUtils } from '../src/db.js';
import { exportarBackup, importarBackup } from '../src/utils/backup.js';

/*
 * Los ajustes de campos: que se guarden, que viajen en la copia de seguridad y
 * que una copia vieja no los borre.
 *
 * Corre con npm test, junto con las demás.
 */

beforeAll(async () => {
  // Las pruebas comparten la misma base en memoria y la del arranque corre
  // antes: su encuesta de primer arranque ya puede haber dejado registro. Sin
  // este arranque a cero, la primera aserción depende de qué archivo corrió
  // primero, que no es lo que se está probando.
  await db.ajustes.clear();

  // Importar exige al menos un producto con nombre: la copia que se exporta en
  // las pruebas necesita de dónde salir.
  await dbUtils.guardarProducto(
    { id: 'prod_base', nombre: 'Tomate Redondo', categoriaIds: [], stock: 3 },
    'prod_base'
  );
});

test('la selección de campos se guarda y se lee entera', async () => {
  expect(await dbUtils.leerCamposFormulario(), 'antes de elegir no hay registro').toBeNull();

  await dbUtils.guardarCamposFormulario(['notas', 'fecha']);
  expect((await dbUtils.leerCamposFormulario()).apagados).toEqual(['notas', 'fecha']);

  // Elegir todos los campos también deja registro: es lo que hace que la
  // encuesta del primer arranque no vuelva a preguntar.
  await dbUtils.guardarCamposFormulario([]);
  expect((await dbUtils.leerCamposFormulario()).apagados).toEqual([]);

  // Los repetidos no se guardan dobles: la lista es de claves, no de toques.
  await dbUtils.guardarCamposFormulario(['stock', 'stock']);
  expect((await dbUtils.leerCamposFormulario()).apagados).toEqual(['stock']);
});

test('la copia lleva los ajustes y la importación los devuelve', async () => {
  await dbUtils.guardarCamposFormulario(['stock', 'notas']);

  const copia = await exportarBackup();
  expect(JSON.parse(copia).ajustes).toEqual([
    { id: 'camposFormulario', apagados: ['stock', 'notas'] }
  ]);

  await db.ajustes.clear();
  await importarBackup(copia);

  expect((await dbUtils.leerCamposFormulario()).apagados).toEqual(['stock', 'notas']);
});

test('una copia vieja, sin ajustes, no borra la configuración del aparato', async () => {
  await dbUtils.guardarCamposFormulario(['proveedor']);

  const copiaVieja = JSON.stringify({
    version: 1,
    productos: [{ id: 'prod_viejo', nombre: 'Limón', categoriaIds: [], stock: 2 }],
    categorias: [],
    proveedores: [],
    imagenes: []
  });

  await importarBackup(copiaVieja);

  expect(
    (await dbUtils.leerCamposFormulario()).apagados,
    'sigue lo que había elegido en este aparato'
  ).toEqual(['proveedor']);
});
