import { db, dbUtils, categoriasDe, normalizarProveedor } from '../db.js';
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
 * Lo que NO se toca son los snapshots del historial: son una foto del pasado del
 * usuario, y reescribirlos para que calcen con el código de hoy sería mentir
 * sobre lo que había en ese momento.
 */
function normalizarProducto(p) {
  const { categoriaId, ...resto } = p;
  return {
    ...resto,
    categoriaIds: categoriasDe(p),
    proveedor: normalizarProveedor(resto.proveedor),
    notas: typeof resto.notas === 'string' ? resto.notas : ''
  };
}

export async function exportarBackup() {
  const [productos, categorias, proveedores, historial, imagenes] = await Promise.all([
    db.productos.toArray(),
    db.categorias.toArray(),
    // La lista de proveedores también es del usuario. Si no viaja en el backup,
    // importarlo en otro aparato deja la lista vacía: los productos seguirían
    // teniendo su proveedor en el texto, pero no se verían en la pestaña.
    db.proveedores.toArray(),
    db.historial.toArray(),
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
    historial,
    imagenes: imagenesBase64
  };

  return JSON.stringify(backup, null, 2);
}

/**
 * Importar backup desde JSON.
 *
 * IMPORTANTE: esta función REEMPLAZA por completo el contenido actual
 * (productos, categorías, imágenes e historial). Antes no quedaba forma de
 * volver atrás, porque la propia importación vacía la tabla historial. Ahora
 * se guarda un punto de restauración del estado previo y se reinserta al final,
 * de modo que "Volver Atrás" permite deshacer el import.
 */
export async function importarBackup(jsonStr) {
  const backup = JSON.parse(jsonStr);
  
  if (!backup.version || !backup.productos || !backup.categorias) {
    throw new Error('Formato de backup inválido');
  }

  const imagenesBlobs = await Promise.all(
    (backup.imagenes || []).map(async (img) => ({
      id: img.id,
      blob: base64ToBlob(img.blob, img.tipo),
      creadoEl: img.creadoEl
    }))
  );

  // Estado actual, para poder deshacer el import. Se crea fuera de la
  // transacción porque la transacción siguiente borra la tabla historial y se
  // llevaría por delante este punto. Si la base está vacía no hay nada que
  // preservar y crearPuntoRestauracion() devolvería un snapshot inútil.
  let puntoPrevio = null;
  if (await db.productos.count() > 0) {
    try {
      puntoPrevio = await dbUtils.crearPuntoRestauracion('Antes de importar backup');
    } catch (error) {
      console.error('No se pudo crear el punto previo a la importación:', error);
    }
  }

  // Limpiar + importar en UNA sola transacción: o entra todo el backup, o no
  // se toca nada.
  // bulkPut (no bulkAdd) para tolerar ids repetidos en el backup.
  await db.transaction('rw', [db.productos, db.categorias, db.proveedores, db.historial, db.imagenes], async () => {
    await db.imagenes.clear();
    await db.categorias.clear();
    await db.proveedores.clear();
    await db.productos.clear();
    await db.historial.clear();

    if (imagenesBlobs.length) {
      await db.imagenes.bulkPut(imagenesBlobs);
    }
    if (backup.categorias.length) {
      await db.categorias.bulkPut(backup.categorias);
    }
    if (backup.proveedores?.length) {
      await db.proveedores.bulkPut(backup.proveedores);
    }
    if (backup.productos.length) {
      // Normalizados al importar: un backup viejo trae `categoriaId` y no trae
      // `proveedor` ni `notas`. Ver normalizarProducto().
      await db.productos.bulkPut(backup.productos.map(normalizarProducto));
    }

    // Backup viejo: no trae la lista de proveedores, así que se arma con los
    // nombres que traen los productos. Sin esto, importar un backup anterior a
    // la tabla dejaría la pestaña de proveedores vacía aunque los productos
    // tuvieran su proveedor escrito.
    if (!backup.proveedores?.length) {
      const vistos = new Map();
      for (const p of backup.productos) {
        const nombre = (p.proveedor || '').trim();
        if (!nombre) continue;
        const clave = normalizarTexto(nombre);
        if (!vistos.has(clave)) vistos.set(clave, nombre);
      }
      if (vistos.size) {
        await db.proveedores.bulkPut(
          [...vistos.values()].map(nombre => ({ id: dbUtils.generarId('prov'), nombre }))
        );
      }
    }

    if (backup.historial?.length) {
      await db.historial.bulkPut(backup.historial);
    }

    if (puntoPrevio) {
      await db.historial.put(puntoPrevio);
    }
  });

  return {
    productos: backup.productos?.length || 0,
    categorias: backup.categorias?.length || 0,
    proveedores: backup.proveedores?.length || 0,
    historial: backup.historial?.length || 0,
    imagenes: imagenesBlobs.length,
    reversible: !!puntoPrevio
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
