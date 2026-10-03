
import { db, dbUtils, TIPOS_VENTA, getUnidadBase, getPrecioPrincipal } from './db.js';

const PREFIJO = 'test_';

const ok = (msg) => console.log(`✅ ${msg}`);
const fail = (msg, err) => console.error(`❌ ${msg}`, err ?? '');

async function testDatabase() {
  console.log('🧪 Iniciando tests de base de datos...');

  const categoriaId = `${PREFIJO}cat`;
  const productoId = `${PREFIJO}prod`;

  try {

    await db.open();
    ok('Base de datos abierta');

    await db.categorias.put({
      id: categoriaId,
      nombre: 'Categoría de prueba',
      color: '#16a34a'
    });
    const cats = await db.categorias.toArray();
    ok(`Categorías: ${cats.length} en total, la de prueba existe`);

    const testProducto = {
      id: productoId,
      nombre: 'Tomate Redondo Test',
      precio: 1200,
      precios: [{ unidad: 'kg', valor: 1200, label: 'Por Kilo (kg)', icon: '⚖️' }],
      unidadPrincipal: 'kg',
      tipoVenta: 'peso_kg',
      stock: 14.5,
      stockMinimo: 3,
      categoriaId,
      codigoBarras: '779123456789',
      imagenId: null,
      actualizadoEl: new Date().toISOString()
    };

    await db.productos.put(testProducto);
    ok('Producto insertado');

    const producto = await db.productos.get(productoId);
    if (!producto) throw new Error('el producto insertado no se pudo leer');
    ok(`Producto leído: ${producto.nombre}`);

    await dbUtils.ajustarStock(productoId, -0.5);
    const actualizado = await db.productos.get(productoId);
    if (actualizado.stock !== 14) {
      throw new Error(`stock esperado 14, obtenido ${actualizado.stock}`);
    }
    ok(`Stock ajustado a ${actualizado.stock}`);

    const snapshot = await dbUtils.crearPuntoRestauracion('Test automático');
    if (!snapshot.snapshotProductos.length) {
      throw new Error('el snapshot se creó vacío: restaurarlo borraría el inventario');
    }
    ok(`Punto de restauración creado con ${snapshot.snapshotProductos.length} producto(s)`);

    const historial = await dbUtils.getHistorial();
    ok(`Historial: ${historial.length} punto(s)`);

    const resultados = await dbUtils.buscarProductos('Tomate');
    ok(`Búsqueda "Tomate": ${resultados.length} resultado(s)`);

    const bajos = await dbUtils.getProductosStockBajo();
    if (bajos.some(p => p.id === productoId)) {
      throw new Error('apareció en stock bajo teniendo 14 y un mínimo de 3');
    }
    ok('Stock bajo: 0 coincidencias (correcto con stock 14 / mínimo 3)');

    await db.productos.update(productoId, { stock: 1 });
    const bajos2 = await dbUtils.getProductosStockBajo();
    if (!bajos2.some(p => p.id === productoId)) {
      throw new Error('con stock 1 y mínimo 3 no apareció en getProductosStockBajo()');
    }
    ok('getProductosStockBajo detecta el producto por debajo del mínimo');

    await testFotosConHistorial();
    await testEjemplosTipoVenta();

    console.log('🧪 Todos los tests pasaron');
    return true;
  } catch (error) {
    fail('Error en tests', error);
    return false;
  } finally {
    // Limpiar pase lo que pase, para no dejar basura en la BD del usuario.
    try {
      await db.productos.delete(productoId);
      await db.categorias.delete(categoriaId);
      ok('Datos de prueba limpiados');
    } catch (error) {
      fail('No se pudo limpiar del todo', error);
    }
  }
}

/**
 * Fotos + historial: el bloque con más riesgo de la app.
 *
 * Comprueba la cadena completa del comportamiento actual:
 *   1. Guardar un producto con foto.
 *   2. Crear un punto de restauración.
 *   3. Cambiar la foto (la anterior NO se debe borrar, porque el snapshot la
 *      necesita).
 *   4. La app no borra fotos sola: abrir y cerrar la app no se lleva ninguna,
 *      ni la que referencia el producto ni la que referencia el snapshot.
 *   5. Deshacer el borrado de un producto debe devolverlo CON foto.
 *   6. Restaurar el snapshot debe devolver los productos con sus fotos.
 *   7. Restaurar con { conFotos: false } debe devolverlos sin imagen.
 *      "Volver Atrás" se pueda deshacer.
 *   9. Las fotos que sólo referencia el historial se miden, no se borran solas,
 *      y sí se borran cuando el usuario lo pide explícitamente.
 */
async function testFotosConHistorial() {
  const productoId = `${PREFIJO}prod_foto`;
  const imagenNueva = `${PREFIJO}img_nueva`;
  const imagenVieja = `${PREFIJO}img_vieja`;
  const contenido = 'contenido-de-prueba';

  const blob = new Blob([contenido], { type: 'image/webp' });

  // borrar los puntos de restauración del usuario al final. Este test puede

  const historialPrevio = new Set((await db.historial.toArray()).map(h => h.id));

  try {
    await db.imagenes.bulkPut([
      { id: imagenVieja, blob, fecha: new Date().toISOString() },
      { id: imagenNueva, blob, fecha: new Date().toISOString() }
    ]);

    await db.productos.put({
      id: productoId,
      nombre: 'Producto con foto (test)',
      precio: 1000,
      tipoVenta: 'unidad',
      stock: 5,
      stockMinimo: 1,
      imagenId: imagenVieja
    });

    const snap = await dbUtils.crearPuntoRestauracion('Test fotos');
    const enSnap = snap.snapshotProductos.find(p => p.id === productoId);
    if (enSnap?.imagenId !== imagenVieja) {
      throw new Error('el snapshot no guardó el imagenId del producto');
    }

    await db.productos.update(productoId, { imagenId: imagenNueva });
    const sigueLaVieja = await db.imagenes.get(imagenVieja);
    if (!sigueLaVieja) {
      throw new Error('al cambiar la foto se borró la anterior, que el snapshot todavía necesita');
    }
    ok('Cambiar la foto conserva la anterior (el snapshot la necesita)');

    // y el riesgo era real: si no contaba el historial, se llevaba por delante

    // es una medición, y la limpieza es una acción explícita del usuario.
    const sueltasAhora = await dbUtils.medirImagenesSinUsar();
    if (sueltasAhora.cantidad !== 0) {
      throw new Error(`hay ${sueltasAhora.cantidad} foto(s) suelta(s) que el test no creó`);
    }
    if (!await db.imagenes.get(imagenVieja)) throw new Error('desapareció la foto del snapshot');
    if (!await db.imagenes.get(imagenNueva)) throw new Error('desapareció la foto del producto');
    ok('Abrir la app no borra ninguna foto (ni la del producto ni la del snapshot)');

    const eliminado = await dbUtils.eliminarProducto(productoId, { conPuntoRestauracion: false });
    if (await db.imagenes.get(imagenNueva)) {
      throw new Error('eliminarProducto borró la foto; el deshacer la necesita');
    }
    await dbUtils.restaurarProductoEliminado(eliminado);
    const restaurado = await db.productos.get(productoId);
    if (restaurado?.imagenId !== imagenNueva) {
      throw new Error('el deshacer no devolvió el producto con su foto');
    }
    ok('Deshacer un borrado devuelve el producto CON su foto');

    await dbUtils.restaurarDesdeSnapshot(snap.id, { conFotos: true });
    const conFoto = await db.productos.get(productoId);
    if (conFoto?.imagenId !== imagenVieja) {
      throw new Error('restaurar con fotos no devolvió la foto que tenía el snapshot');
    }
    ok('Restaurar con fotos devuelve la imagen original del snapshot');

    await dbUtils.restaurarDesdeSnapshot(snap.id, { conFotos: false });
    const sinFoto = await db.productos.get(productoId);
    if (sinFoto?.imagenId != null) {
      throw new Error('restaurar sin fotos dejó el imagenId puesto');
    }
    if (!sinFoto) throw new Error('restaurar sin fotos no devolvió el producto');
    ok('Restaurar sin fotos devuelve el inventario con los productos sin imagen');

    const resumen = await dbUtils.resumenFotos(snap.snapshotProductos);
    if (resumen.conFoto !== 1 || resumen.disponibles !== 1) {
      throw new Error(`resumenFotos informed ${JSON.stringify(resumen)}, se esperaba 1 con foto y 1 disponible`);
    }
    ok('resumenFotos cuenta las fotos disponibles del snapshot');

    //

    // restauración que tiene el usuario, que es justo lo que este test existe
    // para no hacer: por eso los snapshots del test se limpian en el finally,
    const creadosPorElTest = (await db.historial.toArray())
      .map(h => h.id)
      .filter(id => !historialPrevio.has(id));
    if (creadosPorElTest.length < 3) {
      throw new Error(
        `esperaba al menos 3 snapshots del test (el manual + 2 "antes de restaurar"), `
        + `hubo ${creadosPorElTest.length}`
      );
    }
    ok('Restaurar deja un punto "Antes de restaurar" (el propio Volver Atrás se deshace)');

    const antesDeLiberar = await dbUtils.medirFotosDelHistorial();
    if (antesDeLiberar.cantidad < 2) {
      throw new Error(
        `esperaba 2 fotos del historial, medí ${antesDeLiberar.cantidad}. `
        + `Si el producto conservó la imagen, el restore con { conFotos: false } falló.`
      );
    }
    if (!await db.imagenes.get(imagenVieja)) {
      throw new Error('las fotos del historial desaparecieron solas: la app no debe borrarlas');
    }
    if (await dbUtils.medirImagenesSinUsar().then(r => r.cantidad)) {
      throw new Error('las fotos del historial se clasificaron como sueltas; los dos conjuntos deben ser disjuntos');
    }
    ok('Las fotos que sólo tiene el historial se miden y NO se borran solas');

    const liberadas = await dbUtils.liberarFotosDelHistorial();
    if (liberadas < 2) {
      throw new Error(`liberarFotosDelHistorial() borró ${liberadas}, esperaba al menos 2`);
    }
    if (await db.imagenes.get(imagenVieja)) {
      throw new Error('liberarFotosDelHistorial() no borró la foto pese a que nadie la referenciaba');
    }
    ok('Liberar las fotos del historial sí las borra, y sólo a pedido');
    ok(`Se liberaron ${liberadas} foto(s) de productos borrados`);
  } finally {
    await db.productos.delete(productoId);
    await db.imagenes.bulkDelete([imagenNueva, imagenVieja]);
    // Sólo los snapshots de este test. Los del usuario no se tocan.
    const creadosPorElTest = (await db.historial.toArray())
      .map(h => h.id)
      .filter(id => !historialPrevio.has(id));
    if (creadosPorElTest.length > 0) {
      await db.historial.bulkDelete(creadosPorElTest);
    }
  }
}

/**
 * Ejemplos para probar a mano, uno por cada tipo de venta.
 *
 * NO se crean en la app: CATEGORIAS_DEFAULT está vacío a propósito, porque un
 * vacío y no el ejemplo de otro. Estos ejemplos viven acá, se crean, se revisan
 * en pantalla y se borran al terminar.
 *
 * Sirven para cubrir a mano lo que es difícil de alcanzar con datos inventados
 * a ojo: que el precio mostrado sea el de la unidad principal, que el paso del
 * ajuste rápido sea el del tipo, y que la unidad que aparece en el pedido y en
 * el stock sea la base.
 */
async function testEjemplosTipoVenta() {
  const ids = [];

  const ejemplos = [
    { nombre: 'Ej. Tomate (peso_kg)', tipoVenta: 'peso_kg', principal: '500g', stock: 4 },
    { nombre: 'Ej. Panela (peso_100g)', tipoVenta: 'peso_100g', principal: '100g', stock: 12 },
    { nombre: 'Ej. Aceite (peso_500g)', tipoVenta: 'peso_500g', principal: '500g', stock: 6 },
    { nombre: 'Ej. Gaseosa (unidad)', tipoVenta: 'unidad', principal: 'docena', stock: 24 },
    { nombre: 'Ej. Huevos (docena)', tipoVenta: 'docena', principal: 'docena', stock: 8 },
    { nombre: 'Ej. Cable (metro)', tipoVenta: 'metro', principal: 'm', stock: 30 },
    { nombre: 'Ej. Leche (litro)', tipoVenta: 'litro', principal: 'L', stock: 10 }
  ];

  try {
    for (const [i, ej] of ejemplos.entries()) {
      const tipo = TIPOS_VENTA.find(t => t.value === ej.tipoVenta);
      if (!tipo) throw new Error(`el ejemplo ${ej.nombre} usa un tipoVenta inexistente: ${ej.tipoVenta}`);

      const precios = tipo.subUnidades.map((s, j) => ({
        unidad: s.value,
        valor: 1000 + j,
        label: s.label,
        icon: s.icon
      }));

      const precioPrincipal = precios.find(p => p.unidad === ej.principal);
      if (!precioPrincipal) {
        throw new Error(`${ej.tipoVenta} no tiene la sub-unidad "${ej.principal}": el ejemplo está mal armado`);
      }

      const id = `${PREFIJO}ej_${i}`;
      ids.push(id);

      await db.productos.put({
        id,
        nombre: ej.nombre,
        precio: precioPrincipal.valor,
        precios,
        unidadPrincipal: ej.principal,
        tipoVenta: ej.tipoVenta,
        stock: ej.stock,
        stockMinimo: 2,
        categoriaId: null,
        codigoBarras: null,
        imagenId: null,
        actualizadoEl: new Date().toISOString()
      });
    }

    ok(`Ejemplos cargados: ${ids.length}, uno por cada tipo de venta`);

    for (const [i, ej] of ejemplos.entries()) {
      const leido = await db.productos.get(ids[i]);
      const esperado = 1000 + TIPOS_VENTA
        .find(t => t.value === ej.tipoVenta)
        .subUnidades.findIndex(s => s.value === ej.principal);

      const precio = getPrecioPrincipal(leido);
      if (precio.valor !== esperado) {
        throw new Error(`${ej.nombre}: getPrecioPrincipal devolvió ${precio.valor}, esperado ${esperado}`);
      }
      if (precio.unidad !== ej.principal) {
        throw new Error(`${ej.nombre}: devolvió la unidad ${precio.unidad}, esperado ${ej.principal}`);
      }
      if (getUnidadBase(leido.tipoVenta) !== TIPOS_VENTA.find(t => t.value === ej.tipoVenta).unidadBase) {
        throw new Error(`${ej.nombre}: la unidad base del stock no coincide con el tipo`);
      }
    }

    ok('Unidad principal y unidad base correctas en los 7 ejemplos');

    console.log('');
    console.log('   👀 Mirá ahora la app: cada ejemplo tiene que mostrar el precio de su');
    console.log('      unidad principal (el que empieza con ⭐) y el stock en su unidad base.');
    console.log('      Probá también el ajuste rápido: el paso tiene que ser el del tipo');
    console.log('      (0,5 en peso_kg, 0,1 en peso_100g, 1 en unidad/docena, 0,5 en metro/litro).');
    console.log('');
  } finally {
    await db.productos.bulkDelete(ids);
  }
}

export { testDatabase };
