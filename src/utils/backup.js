import { db, dbUtils, normalizarProveedor, COLORES_CATEGORIAS } from '../db.js';
import { normalizarTexto } from './texto.js';

/**
 * Poner un producto en la forma que la app usa hoy, sin perderle nada.
 *
 * Hace falta sólo al importar, y por los backups viejos:
 *
 *   - `categoriaId` (una sola categoría) se volvió `categoriaIds` (varias). Un
 *     backup anterior a eso trae el campo viejo, y `db.productos.update()` no lo
 *     borra: sólo pisa las claves que le pasan. Sin esta normalización, cada
 *     producto importado queda con las dos categorías guardadas, la vieja y la
 *     nueva, y se siguen arrastrando backup tras backup. `categoriasDe()` los
 *     lee bien mientras tanto, pero es mejor no dejar el campo muerto adentro.
 *
 *   - `proveedor` y `notas` no existían antes, así que llegan ausentes. Se
 *     rellenan con cadena vacía, que es como los guarda el formulario, y no
 *     con null: null obliga a repetir el `|| ''` en cada lugar que los lea. El
 *     proveedor además pasa por `normalizarProveedor()`, que es lo que hace el
 *     formulario: importar un backup con "  Lácteos  del sur " y volver a
 *     importarlo con "Lácteos del Sur" tiene que dar el mismo grupo en el
 *     pedido, no dos.
 *
 * Y además **descarta lo que no tiene forma**: un archivo de copia es lo único
 * que entra a la base sin pasar por el formulario, y hay lugares de la app que
 * escriben campos directo en el HTML sin escaparlos. Si una copia trae
 * `nombre: "<img src=x onerror=...>"`, guardarlo tal cual deja ejecutar eso en el
 * origen de la app, que es donde vive todo el inventario.
 *
 * Por eso cada campo pasa por `texto()` o por `numero()`, que no inventan nada:
 * un tipo raro se convierte a cadena vacía o a 0, no se propaga.
 */
function texto(valor, { largo = 4000 } = {}) {
  if (typeof valor === 'string') return valor.slice(0, largo);
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
}

function numero(valor, porDefecto = 0) {
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
}

function idTexto(valor, prefijo) {
  const s = texto(valor, { largo: 120 });
  return s || `${prefijo}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Un color de los que la app reconoce, o nada.
 *
 * El color de una categoría va al HTML en un `style="background-color: ..."`, y
 * hay un punto de la app que lo escribe sin escapar. Si el color viniera de una
 * copia con cualquier texto, ese texto iría al atributo. La paleta está en db.js
 * y es una lista cerrada: lo que no está en ella no es un color de esta app y no
 * entra.
 */
function colorSeguro(valor) {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim().toLowerCase();
  return COLORES_CATEGORIAS.some(c => c.toLowerCase() === limpio) ? limpio : null;
}

/** Los precios: los mismos campos que el formulario escribe. */
function preciosSeguros(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, 24).map(p => ({
    unidad: texto(p?.unidad, { largo: 40 }),
    valor: numero(p?.valor),
    icon: texto(p?.icon, { largo: 8 }),
    esPrincipal: p?.esPrincipal === true
  })).filter(p => p.unidad);
}

function normalizarProducto(p) {
  const { categoriaId, categoriaIds, ...resto } = p || {};

  return {
    id: idTexto(resto.id, 'prod'),
    nombre: texto(resto.nombre, { largo: 300 }),
    categoriaIds: (Array.isArray(categoriaIds) ? categoriaIds : [])
      .slice(0, 24)
      .map(id => texto(id, { largo: 120 }))
      .filter(Boolean),
    proveedor: normalizarProveedor(resto.proveedor),
    notas: texto(resto.notas),
    codigoBarras: resto.codigoBarras ? texto(resto.codigoBarras, { largo: 64 }) : null,
    tipoVenta: texto(resto.tipoVenta, { largo: 60 }),
    unidadPrincipal: texto(resto.unidadPrincipal, { largo: 60 }),
    stock: Math.max(0, numero(resto.stock)),
    stockMinimo: Math.max(0, numero(resto.stockMinimo)),
    costo: Math.max(0, numero(resto.costo)),
    precio: Math.max(0, numero(resto.precio)),
    precios: preciosSeguros(resto.precios),
    imagenId: resto.imagenId ? texto(resto.imagenId, { largo: 120 }) : null,
    fechaCompra: texto(resto.fechaCompra, { largo: 40 }),
    fecha: texto(resto.fecha, { largo: 40 }),
    creadoEl: texto(resto.creadoEl, { largo: 40 }),
    actualizadoEl: texto(resto.actualizadoEl, { largo: 40 })
  };
}

function normalizarCategoria(c) {
  return {
    id: idTexto(c?.id, 'cat'),
    nombre: texto(c?.nombre, { largo: 120 }),
    color: colorSeguro(c?.color)
  };
}

function normalizarFilaProveedor(p) {
  return {
    id: idTexto(p?.id, 'prov'),
    nombre: normalizarProveedor(p?.nombre)
  };
}

export async function exportarBackup() {
  const [productos, categorias, proveedores, imagenes] = await Promise.all([
    db.productos.toArray(),
    db.categorias.toArray(),
    // La lista de proveedores también es del usuario. Si no viaja en el backup,
    // importarlo en otro aparato deja la lista vacía: los productos seguirían
    // teniendo su proveedor en el texto, pero no se verían en la pestaña.
    db.proveedores.toArray(),
    db.imagenes.toArray()
  ]);

  const imagenesBase64 = await Promise.all(
    imagenes.map(async (img) => ({
      id: img.id,
      blob: await blobToBase64(img.blob),
      // Guardar el MIME para que al importar no haya que adivinarlo
      tipo: img.blob?.type || 'image/webp',
      creadoEl: img.creadoEl
    }))
  );

  const backup = {
    version: 1,
    fecha: new Date().toISOString(),
    productos,
    categorias,
    proveedores,
    imagenes: imagenesBase64
  };

  return JSON.stringify(backup, null, 2);
}

/**
 * Importar una copia desde JSON. **Reemplaza** el contenido actual.
 *
 * Importar es la única forma de meter datos en la base sin pasar por el
 * formulario, así que es también la única puerta por la que puede entrar
 * cualquier cosa. Por eso el archivo se lee y se valida entero ANTES de tocar
 * una sola fila: si algo no tiene la forma que la app espera, se corta acá y la
 * base queda como estaba.
 *
 * No queda forma de volver atrás: no hay historial. Lo que protege al usuario
 * es que exporte una copia antes de importar, y el diálogo de importación se lo
 * dice con esas palabras.
 */
export async function importarBackup(jsonStr) {
  const backup = JSON.parse(jsonStr);

  if (!backup || typeof backup !== 'object') {
    throw new Error('El archivo no es una copia de DepoApp');
  }
  if (!Array.isArray(backup.productos) || !Array.isArray(backup.categorias)) {
    throw new Error('El archivo no trae la lista de productos o de categorías');
  }

  const imagenesBlobs = await Promise.all(
    (Array.isArray(backup.imagenes) ? backup.imagenes : []).slice(0, 5000).map(async (img) => ({
      id: idTexto(img?.id, 'img'),
      blob: base64ToBlob(img?.blob, img?.tipo),
      creadoEl: texto(img?.creadoEl, { largo: 40 })
    }))
  );

  // Todo se arma y se valida antes de la transacción. Si algo está mal, acá
  // falla y todavía no se borró nada.
  const productos = backup.productos.slice(0, 20000).map(normalizarProducto);
  const categorias = backup.categorias.slice(0, 2000).map(normalizarCategoria);
  const proveedores = (Array.isArray(backup.proveedores) ? backup.proveedores : [])
    .slice(0, 2000)
    .map(normalizarFilaProveedor)
    .filter(p => p.nombre);

  if (!productos.some(p => p.nombre)) {
    throw new Error('La copia no tiene ningún producto con nombre');
  }

  // La lista de proveedores se arma sola con los que traen los productos si el
  // archivo no la trae: una copia anterior a esa tabla no la tiene, y sin esto
  // importar dejaría la pestaña de proveedores vacía.
  if (!proveedores.length) {
    const vistos = new Map();
    for (const p of productos) {
      if (!p.proveedor) continue;
      const clave = normalizarTexto(p.proveedor);
      if (!vistos.has(clave)) vistos.set(clave, p.proveedor);
    }
    proveedores.push(
      ...[...vistos.values()].map(nombre => ({ id: dbUtils.generarId('prov'), nombre }))
    );
  }

  await db.transaction('rw', [db.productos, db.categorias, db.proveedores, db.imagenes], async () => {
    await db.imagenes.clear();
    await db.categorias.clear();
    await db.proveedores.clear();
    await db.productos.clear();

    if (imagenesBlobs.length) await db.imagenes.bulkPut(imagenesBlobs);
    if (categorias.length) await db.categorias.bulkPut(categorias);
    if (proveedores.length) await db.proveedores.bulkPut(proveedores);
    if (productos.length) await db.productos.bulkPut(productos);
  });

  return {
    productos: productos.length,
    categorias: categorias.length,
    proveedores: proveedores.length,
    imagenes: imagenesBlobs.length,
    reversible: false
  };
}

export function descargarBackup(jsonStr, nombre = `backup-stock-${new Date().toISOString().split('T')[0]}.json`) {
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function leerBackupArchivo(archivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(archivo);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, tipo = 'image/webp') {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  // Se respeta el MIME del backup; si no viene, se asume webp (la app
  return new Blob([bytes], { type: tipo || 'image/webp' });
}
