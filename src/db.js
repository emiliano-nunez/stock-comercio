import Dexie from 'dexie';
import { normalizarTexto } from './utils/texto.js';

export const db = new Dexie('StockComercioDB');

// Historial de esquemas de la BD.
//
// El esquema vigente es el de la v6. Las versiones intermedias se declaran
// aunque ya no se usen: Dexie sólo necesita los índices declarados en cada
// versión para reindexar las BDs existentes, y saltarse números deja huecos que
// confunden al diagnosticar ("¿por qué mi BD dice 1 y el código dice 6?").
//
// Índices que se quitaron de uso y por qué, está en la nota de la v5 más abajo.
db.version(1).stores({
  productos: 'id, nombre, categoriaId, codigoBarras, tipoVenta',
  categorias: 'id, nombre',
  imagenes: 'id',
  historial: 'id, fecha'
});

db.version(2).stores({
  productos: 'id, nombre, categoriaId, codigoBarras, tipoVenta, costo, fechaCompra, unidadMedida',
  categorias: 'id, nombre',
  imagenes: 'id',
  historial: 'id, fecha'
});

db.version(3).stores({
  productos: 'id, nombre, categoriaId, codigoBarras, tipoVenta, costo, fechaCompra, unidadMedida, precios',
  categorias: 'id, nombre',
  imagenes: 'id',
  historial: 'id, fecha'
});

db.version(4).stores({
  productos: 'id, nombre, categoriaId, codigoBarras, tipoVenta, costo, fechaCompra, unidadMedida, precios',
  categorias: 'id, nombre, color',
  imagenes: 'id',
  historial: 'id, fecha'
});

// v5: se dejan de declarar tres índices que ninguna consulta usaba.
//
//   nombre        -> buscarProductos() filtra con includes(), que es búsqueda
//                    de subcadena y no puede aprovechar un índice. Y la
//                    búsqueda real de la app (App.aplicarFiltroYOrden) ni
//                    siquiera consulta la BD: filtra en memoria.
//   precios       -> indexar un campo array crea UNA ENTRADA DE ÍNDICE POR
//                    ELEMENTO: un producto con 4 precios genera 4 filas. Y no
//                    hay ninguna consulta where('precios').
//   unidadMedida  -> el campo quedó sin uso; lo reemplazó unidadPrincipal.
//
// Un índice que no se consulta no es gratis: se paga en cada escritura y ocupa
// espacio. En un móvil con 2GB de RAM, donde las escrituras van a disco, es lo
// más caro.
//
// Verificado que la tabla productos SÓLO se consulta por codigoBarras
// (ProductoForm y ScannerModal), y que historial sólo se ordena por fecha.
//
// Lo que NO se hizo aquí, a propósito: marcar codigoBarras como único ('&').
// Sería lo correcto, pero un índice único en IndexedDB también indexa el valor
// null, así que sólo un producto podría quedarse SIN código de barras (el
// formulario guarda null, no undefined). Con dos productos sin código, el
// guardado del segundo fallaría con ConstraintError. Arreglarlo exige migrar
// los null a undefined Y resolver los duplicados que ya haya, y una migración
// mal escrita deja la app sin abrir. Los duplicados se tratan en su lugar con
// dbUtils.buscarPorCodigoBarras(), que los devuelve todos en vez de elegir uno
// al azar.
db.version(5).stores({
  productos: 'id, categoriaId, codigoBarras, tipoVenta, costo, fechaCompra',
  categorias: 'id, nombre, color',
  imagenes: 'id',
  historial: 'id, fecha'
});

/*
 * v6: un producto puede estar en varias categorías, y se le agregan proveedor y
 * notas.
 *
 * Antes el campo era categoriaId y guardaba UN id. Un producto que es a la vez
 * "Lácteos" y "Frescos" tenía que elegir uno, y el otro grupo no lo encontraba.
 * Ahora es categoriaIds y es una lista.
 *
 * Por qué NO se indexa categoriaIds:
 *   - Un índice sobre un campo que es una lista crea UNA ENTRADA POR ELEMENTO
 *     (ver la nota de la v5 sobre precios). Con 3 categorías son 3 filas por
 *     producto.
 *   - Y, sobre todo, no hay ninguna consulta que lo use. Todo el filtrado pasa
 *     por App.aplicarFiltroYOrden() y por productosDeLaVista(), que filtran en
 *     memoria sobre el inventario ya cargado. El índice se pagaría en cada
 *     escritura y no se cobraría nunca.
 *
 * Se saca el índice de categoriaId porque ese campo ya no existe. Dexie
 * rebuilda los índices al cambiar de versión, así que dejarlo sería un índice
 * sobre una columna siempre vacía.
 *
 * La migración mueve el valor viejo a una lista de un solo elemento. Es
 * reversible: nada se borra de la foto ni del historial, y el campo nuevo
 * contiene exactamente lo que tenía el anterior.
 */
db.version(6)
  .stores({
    productos: 'id, codigoBarras, tipoVenta, costo, fechaCompra',
    categorias: 'id, nombre, color',
    imagenes: 'id',
    historial: 'id, fecha'
  })
  .upgrade(async tx => {
    await tx.table('productos').toCollection().modify(producto => {
      // Se borra el campo viejo en la misma pasada, en vez de dejarlo puesto:
      // un producto que tuviera las dos formas sería el peor estado posible,
      // porque cada lugar que leyera una leería la otra.
      if (!Array.isArray(producto.categoriaIds)) {
        producto.categoriaIds = producto.categoriaId ? [producto.categoriaId] : [];
      }
      delete producto.categoriaId;

      // Los dos campos nuevos nacen vacíos, no en null: se comparan y se
      // concatenan como texto en la interfaz, y "" se puede pintar sin que cada
      // lugar se acuerde del caso.
      if (typeof producto.proveedor !== 'string') producto.proveedor = '';
      if (typeof producto.notas !== 'string') producto.notas = '';
    });
  });

/**
 * Las categorías de un producto, siempre como lista de ids.
 *
 * Un producto puede estar en varias. Se lee tolerando las dos formas porque hay
 * dos caminos por los que un producto viejo vuelve a aparecer con la forma
 * anterior: restaurar un punto de restauración tomado antes de esta versión, e
 * importar un backup viejo. Los snapshots del historial no se reescriben (son
 * el estado de otra fecha, y modificarlos sería mentir sobre ese estado), y un
 * backup pertenece al usuario tal como lo exportó.
 *
 * @param {{categoriaIds?: string[], categoriaId?: string}} producto
 * @returns {string[]} puede estar vacía: un producto sin categoría es válido.
 */
export function categoriasDe(producto) {
  if (Array.isArray(producto?.categoriaIds)) return producto.categoriaIds.filter(Boolean);
  if (producto?.categoriaId) return [producto.categoriaId];
  return [];
}

/** Un producto que está en la categoría dada, aunque tenga varias. */
export function tieneCategoria(producto, categoriaId) {
  if (!categoriaId) return false;
  return categoriasDe(producto).includes(categoriaId);
}

/**
 * Deja el nombre del proveedor como lo escribió el usuario, pero parejo.
 *
 * Recorta los bordes, corre los espacios repetidos y le pone mayúscula a la
 * primera letra. Nada de esto cambia lo que el usuario quiso decir: es lo mismo
 * nombre, escrito un poco más prolijo.
 *
 * Importa porque el pedido de faltantes se manda por proveedor. Si
 * "  distribuidora   del sur " y "Distribuidora del Sur" se guardaran
 * distintos, el pedido saldría partido en dos grupos que son el mismo cliente, y
 * el usuario tendría que mandarle dos listas al mismo lugar.
 *
 * Sólo se unifica lo que no cambia el nombre. Las palabras siguen en minúscula
 * porque "Distribuidora del Sur" y "Distribuidora Del Sur" se reconocen solos;
 * poner mayúscula en cada palabra produce "Distribuidora Del Sur", que es
 * escribir mal.
 */
export function normalizarProveedor(nombre) {
  const texto = (nombre ?? '').toString().replace(/\s+/g, ' ').trim();
  if (!texto) return '';
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Clave para saber si dos nombres de proveedor son el mismo.
 *
 * Ésta no se guarda: sólo se usa para agrupar. Los productos que ya estaban
 * cargados pueden traer el mismo proveedor escrito con otra mayúscula, y
 * agrupar por el texto exacto los separaría. La tilde y la eñe también cuentan
 * como iguales, porque "lacteos" y "lácteos" son el mismo proveedor escrito
 * apurado, no dos.
 *
 * El nombre que se muestra es el primero que aparece, no el que gana la
 * comparación: el primero es el que el usuario tiene anotado.
 */
export function claveProveedor(nombre) {
  return normalizarTexto(nombre);
}

// Nota sobre hooks:
// Se eliminó el hook 'deleting' que tenía dos defectos:
//   1) Accedía a trans.imagenes / trans.historial, pero la transacción que abre
//      db.productos.delete() sólo abarca la tabla productos. Esas propiedades
//      son undefined -> TypeError al borrar cualquier producto con foto.
//   2) Guardaba un punto de restauración con snapshotProductos: [] (vacío).
//      Como restaurarDesdeSnapshot() hace clear() + bulkAdd(), restaurar
//      cualquiera de esos snapshots BORRABA todo el inventario.
// El borrado con punto de restauración real está en dbUtils.eliminarProducto(),
// que sí abre una transacción con las tres tablas implicadas.

// Hook para crear punto de restauración automático en actualizaciones masivas
// NOTA: el hook 'updating' anterior se eliminó. Usaba setTimeout, que se
// ejecuta ya cerrado el commit, así que el snapshot guardaba el estado
// POST-cambio y no servía para deshacer nada; además se disparaba en cada
// +/- de stock copiando el inventario entero. El punto de recuperación previo
// a un cambio de precio se crea ahora en ProductoForm.guardar(), que conoce el
// estado anterior y se ejecuta una sola vez por guardado.

// Utilidades de base de datos
export const dbUtils = {
  // Generar ID único
  generarId: (prefijo = 'id') => `${prefijo}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,

  /**
   * Leer un número del formulario rechazando lo que no es número.
   *
   * El código usaba parseFloat(valor) || 0 en todos lados. Eso protege contra
   * NaN, pero a costa de convertir en 0 cualquier error de tipeo: "abc", "1,5"
   * o un campo vacío se guardaban como 0. Para el stock eso es lo peor que
   * puede pasar, porque el producto pasa a "Agotado" y entra solo en el pedido
   * al proveedor. Un 0 silencioso es más peligroso que un error visible.
   *
   * @param {FormDataEntryValue|string|null} valor
   * @param {string} etiqueta nombre del campo, para el mensaje de error.
   * @param {{ min?: number, max?: number, requerido?: boolean }} [opciones]
   * @returns {{ valor: number }|{ error: string }}
   */
  leerNumero(valor, etiqueta, { min = null, max = null, requerido = false } = {}) {
    const crudo = (valor ?? '').toString().trim();
    
    if (crudo === '') {
      if (requerido) return { error: `Falta el valor de "${etiqueta}"` };
      return { valor: 0 };
    }
    
    // Se acepta coma como separador decimal porque en muchos teclados
    // numéricos la coma es lo que se escribe, y rechazarla obligaría al
    // usuario a cambiar de teclado. El punto también se acepta.
    const normalizado = crudo.replace(',', '.');
    const n = Number(normalizado);
    
    if (!Number.isFinite(n)) {
      return { error: `"${crudo}" no es un número válido en "${etiqueta}"` };
    }
    if (min !== null && n < min) {
      return { error: `"${etiqueta}" no puede ser menor que ${min}` };
    }
    if (max !== null && n > max) {
      return { error: `"${etiqueta}" no puede ser mayor que ${max}` };
    }
    
    return { valor: n };
  },

  // Obtener todos los productos con imágenes
  async getAllProductosConImagenes() {
    const productos = await db.productos.toArray();
    const imagenesMap = new Map();
    
    // Obtener todas las imágenes necesarias
    const imagenesIds = [...new Set(productos.map(p => p.imagenId).filter(Boolean))];
    if (imagenesIds.length > 0) {
      const imagenes = await db.imagenes.where('id').anyOf(imagenesIds).toArray();
      imagenes.forEach(img => imagenesMap.set(img.id, img));
    }
    
    return productos.map(p => {
      if (p.imagenId && imagenesMap.has(p.imagenId)) {
        const img = imagenesMap.get(p.imagenId);
        // La miniatura si existe; la imagen completa si el producto se guardó
        // antes de que las miniaturas existieran. Esta función trae TODOS los
        // blobs a memoria de una vez, así que usar la miniatura en vez de la
        // completa es la diferencia entre pintar 300 fotos de 200px o de 800px.
        const fuente = img.thumb || img.blob;
        if (fuente) return { ...p, imagenUrl: URL.createObjectURL(fuente) };
      }
      
      // El producto APUNTA a una foto pero la foto no está en la base. O sea:
      // alguien la borró por fuera de la app (limpieza del navegador, borrado
      // manual del almacenamiento, restauración de un backup parcial, cierre
      // abrupto a mitad de una escritura).
      //
      // Se marca en el objeto en memoria y no se persiste: depende del estado
      // actual de la base, así que guardarlo en el producto sería mentir en
      // cuanto la foto volviera a aparecer. La UI lo usa para avisarle al
      // usuario en vez de mostrarle el 📦 de siempre, que no distingue "nunca
      // tuvo foto" de "se le perdió".
      if (p.imagenId) return { ...p, fotoPerdida: true };
      
      return p;
    });
  },

  /**
   * Fotos guardadas que no referencia ningún producto ni ningún punto de
   * restauración. NO borra nada: sólo mide.
   *
   * La app ya no borra fotos sola (ver limpiarImagenesSinUsar), porque son
   * dato del usuario. Esta función existe para poder decirle cuánta hay y
   * cuánto ocupan, y que decida él.
   */
  async medirImagenesSinUsar() {
    const { sueltas } = await this._repartoDeImagenes();
    return this._medirConjunto(sueltas);
  },

  /**
   * Borrar las fotos que no usa ningún producto ni ningún punto de
   * restauración. Sólo se llama desde una acción explícita del usuario, nunca
   * al arrancar.
   *
   * Lo que se borra por esta vía son fotos que quedaron sueltas: se tomó una
   * foto y se canceló el formulario a medias, se cerró la PWA en el medio, o se
   * reemplazó una foto muchas veces. Nunca son fotos que el usuario haya
   * guardado en un producto.
   */
  async limpiarImagenesSinUsar() {
    const { sueltas } = await this._repartoDeImagenes();
    if (sueltas.length > 0) {
      await db.imagenes.bulkDelete(sueltas.map(img => img.id));
    }
    return sueltas.length;
  },

  /**
   * Clasifica las imágenes guardadas en tres conjuntos, según quién las
   * referencia:
   *
   *   enProductos -> las tiene un producto vivo. Intocables.
   *   delHistorial -> sólo las tiene algún punto de restauración. Son las fotos
   *                 de productos que el usuario ya borró. Ocupan espacio y no
   *                 las muestra nadie, pero son lo único que permite que
   *                 "Volver Atrás" devuelva el producto CON su foto.
   *   sueltas      -> no las referencia nadie. Salen de fotos canceladas o
   *                 reemplazadas.
   *
   * Los dos últimos son disjuntos, así que las dos limpiezas del historial no se
   * pisan. Todo pasa por acá y no por dos funciones que cada una recalcula su
   * propio criterio: si medir y limpiar calcularan distinto, el botón prometería
   * una cantidad y borraría otra.
   *
   * Antes existía un _idsDeImagenesEnUso() que devolvía la unión de productos
   * e historial. Se fue al hacer este reparto y no quedó usada en ningún lado;
   * se elimina en vez de dejarla, porque un nombre que dice "en uso" junto a un
   * "de productos" que significa otra cosa es la forma más segura de que el
   * próximo que lo lea termine borrando las fotos del historial.
   */
  async _repartoDeImagenes() {
    const productos = await db.productos.toArray();
    const enProductos = new Set(productos.map(p => p.imagenId).filter(Boolean));

    const snapshots = await db.historial.toArray();
    const enHistorial = new Set();
    for (const snapshot of snapshots) {
      for (const p of snapshot.snapshotProductos || []) {
        if (p.imagenId) enHistorial.add(p.imagenId);
      }
    }

    const todas = await db.imagenes.toArray();
    return {
      delHistorial: todas.filter(img => enHistorial.has(img.id) && !enProductos.has(img.id)),
      sueltas: todas.filter(img => !enProductos.has(img.id) && !enHistorial.has(img.id))
    };
  },

  // Medir lo que ocupa el conjunto 'delHistorial'. No borra nada: el mismo
  // criterio que usa la limpieza, para que el número del botón sea el número
  // que se va a borrar.
  async _medirConjunto(conjunto) {
    const bytes = conjunto.reduce(
      (total, img) => total + (img.blob?.size || 0) + (img.thumb?.size || 0),
      0
    );
    return { cantidad: conjunto.length, bytes, megas: bytes / (1024 * 1024) };
  },

  /**
   * Cuánta foto hay guardada que sólo existe para el historial: la de productos
   * que el usuario ya eliminó. No la muestra nadie en el catálogo, pero pesa.
   *
   * Crece sin que el usuario lo decida, y es justo la consecuencia de que la
   * app ya no borre fotos sola (son dato del usuario). Por eso se mide y se le
   * ofrece liberarla, en vez de hacerlo por sorpresa.
   */
  async medirFotosDelHistorial() {
    const { delHistorial } = await this._repartoDeImagenes();
    return this._medirConjunto(delHistorial);
  },

  /**
   * Borrar las fotos que sólo el historial referencia. Es la única acción de la
   * app que elimina fotos que en algún momento fueron de un producto del
   * usuario, y por eso el botón que la dispara insiste dos veces.
   *
   * Lo que NO se toca: las fotos de los productos que están en el inventario
   * ahora. Y lo que se pierde: la capacidad de que "Volver Atrás" devuelva los
   * productos borrados con su imagen. Los productos siguen volviendo; lo que no
   * vuelve es la foto.
   */
  async liberarFotosDelHistorial() {
    const { delHistorial } = await this._repartoDeImagenes();
    if (delHistorial.length > 0) {
      await db.imagenes.bulkDelete(delHistorial.map(img => img.id));
    }
    return delHistorial.length;
  },

  /**
   * Qué cambiaría al restaurar un punto: qué productos volverían y cuáles
   * desaparecerían.
   *
   * Sin esto, el diálogo dice "se sustituirá el inventario por el estado del
   * 12/03" y el usuario tiene que decidir a ciegas. Lo que más le cuesta
   * imaginar es justo lo que pasa con los productos que él mismo borró: el
   * punto de restauración se creó ANTES del borrado, así que restaurar trae de
   * vuelta lo que él eliminó, y eso no se dice en ninguna parte.
   *
   * @returns {Promise<{ vuelven: object[], seVan: object[] }>} `vuelven` están en
   *   el snapshot pero no en la base (o sea, fueron borrados después);
   *   `seVan` están en la base pero no en el snapshot (fueron agregados
   *   después).
   */
  async compararConSnapshot(snapshotId) {
    const snapshot = await db.historial.get(snapshotId);
    if (!snapshot) return { vuelven: [], seVan: [] };
    
    // Un snapshot sin lista de productos no es un estado: es un registro roto.
    // Con `(|| [])` se seguiría adelante y, como el snapshot vacío no contiene
    // a nadie, TODOS los productos del usuario saldrían en `seVan`. El diálogo
    // los pintaría como "12 productos que van a desaparecer" y sería mentira:
    // la restauración ni siquiera se puede aplicar (ver la comprobación de
    // vacío en restaurarDesdeSnapshot).
    if (!Array.isArray(snapshot.snapshotProductos)) return { vuelven: [], seVan: [] };
    
    const enSnapshot = new Map(snapshot.snapshotProductos.map(p => [p.id, p]));
    const actuales = await db.productos.toArray();
    const enBase = new Set(actuales.map(p => p.id));
    
    return {
      vuelven: snapshot.snapshotProductos.filter(p => !enBase.has(p.id)),
      seVan: actuales.filter(p => !enSnapshot.has(p.id))
    };
  },

  // Guardar una imagen con su miniatura de catálogo.
  //
  // Se centraliza para que la galería y la cámara hagan lo mismo: si una de las
  // dos se olvidara de la miniatura, esa foto seguiría ocupando 800px de RAM
  // para pintarse en 64px y no habría forma de notarlo.
  //
  // El campo se llama creadoEl y no fecha porque es el que backup.js ya
  // exporta e importa: renombrarlo acá ponía `creadoEl: undefined` en cada
  // backup y rompía el viaje de ida y vuelta sin que se notara.
  async guardarImagen(id, blob, thumb = null) {
    await db.imagenes.add({ id, blob, thumb, creadoEl: new Date().toISOString() });
    return id;
  },
  
  // Liberar los ObjectURL de una lista de productos.
  // Hay que llamarlo ANTES de reemplazarla: createObjectURL() no se puede
  // liberar solo, así que cada recarga de la vista dejaba los blobs anteriores
  // retenidos en memoria.
  revocarImagenes(productos) {
    if (!Array.isArray(productos)) return;
    for (const p of productos) {
      if (p?.imagenUrl) {
        try { URL.revokeObjectURL(p.imagenUrl); } catch { /* ya liberado */ }
      }
    }
  },
  
  // Cuántos productos de un snapshot conservan su foto.
  //
  // Casi todos la conservan (las imágenes ya no se borran), pero los productos
  // eliminados o de los que se cambió la foto ANTES de ese cambio pueden
  // tener el blob perdido. El diálogo de restauración usa esto para no
  // prometer fotos que no van a volver.
  async resumenFotos(snapshotProductos = []) {
    const conFoto = snapshotProductos.filter(p => p.imagenId);
    const ids = [...new Set(conFoto.map(p => p.imagenId))];
    let disponibles = 0;
    if (ids.length > 0) {
      const claves = await db.imagenes.where('id').anyOf(ids).keys().toArray();
      disponibles = claves.length;
    }
    return { total: snapshotProductos.length, conFoto: conFoto.length, disponibles };
  },
  
  // Todos los productos con un código de barras, no sólo el primero.
  //
  // El índice de codigoBarras NO es único (ver la nota de la v5), así que en
  // principio puede haber más de uno: un backup importado, o dos productos
  // cargados en equipos distintos. Antes el escáner y el formulario usaban
  // .first(), que elige uno al azar de entre los duplicados, así que el usuario
  // podía ver un producto y creer que era el suyo.
  //
  // Con esta función el que llama puede avisarle de que hay más de uno.
  async buscarPorCodigoBarras(codigo) {
    if (!codigo) return [];
    return db.productos.where('codigoBarras').equals(String(codigo)).toArray();
  },

  // Crear punto de restauración (snapshot)
  async crearPuntoRestauracion(motivo = 'Manual') {
    const productos = await db.productos.toArray();
    const snapshot = {
      // Sufijo aleatorio: dos snapshots en el mismo ms colapsarían en el mismo id
      id: `restauracion_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      fecha: new Date().toISOString(),
      motivo,
      snapshotProductos: productos.map(p => ({ ...p }))
    };
    
    await db.historial.add(snapshot);
    
    // Mantener solo las últimas 10 versiones.
    // Antes sólo borraba una por llamada, así que el historial podía crecer
    // bastante por encima del límite.
    const LIMITE = 10;
    const count = await db.historial.count();
    if (count > LIMITE) {
      const excedentes = await db.historial.orderBy('fecha').limit(count - LIMITE).toArray();
      await db.historial.bulkDelete(excedentes.map(h => h.id));
    }
    
    return snapshot;
  },
  
  // Restaurar desde punto de restauración
  //
  // { conFotos } resuelve lo que el usuario elige en el diálogo de confirmación:
  //   true  (por defecto) devuelve cada producto con su foto.
  //   false devuelve el inventario pero sin imágenes (imagenId a null).
  //
  // Por qué los snapshots no guardan los blobs: metadatos no ocupan nada,
  // mientras que los blobs multiplicados por los 10 snapshots llegarían
  // fácilmente a cientos de MB (300 productos × 100KB × 10 = 300MB), inviable
  // en un equipo con 2GB de RAM. En vez de eso, las imágenes NO se borran: ni al
  // eliminar un producto, ni al cambiarle la foto, ni al vaciar el historial. Son
  // dato del usuario, y mientras el blob siga ahí el imagenId de cada snapshot
  // sigue resolviendo y la foto reaparece sola al restaurar.
  async restaurarDesdeSnapshot(snapshotId, { conFotos = true } = {}) {
    const snapshot = await db.historial.get(snapshotId);
    if (!snapshot) throw new Error('Punto de restauración no encontrado');
    
    // Red de seguridad: un snapshot sin productos nunca es un "estado" válido.
    // Sin esta comprobación, restaurar uno de esos puntos vacíos que dejó el
    // antiguo hook 'deleting' borraba el inventario entero.
    if (!Array.isArray(snapshot.snapshotProductos) || snapshot.snapshotProductos.length === 0) {
      throw new Error('Este punto de restauración está vacío y no se puede aplicar');
    }

    const productos = conFotos
      ? snapshot.snapshotProductos
      : snapshot.snapshotProductos.map(({ imagenId, ...p }) => ({ ...p, imagenId: null }));
    
    // Punto de seguridad: guardar el estado ACTUAL antes de sobrescribirlo.
    //
    // Sin esto, restaurar un punto viejo era una operación de un solo sentido
    // salvo por suerte. El inventario actual sólo sobrevive si por casualidad
    // alguno de los 10 puntos guardados lo contiene, y la última milleta no la
    // genera nada: si el usuario agregó productos y no cambió ningún precio ni
    // borró nada, no hubo ningún motivo que disparara un snapshot, y al
    // restaurar desaparecían esos productos sin dejar rastro en ninguna parte.
    //
    // Va ANTES de la transacción a propósito. Si guardar el respaldo falla, que
    // se cancele la restauración entera: cancelar es mejor que pisar el
    // inventario sin red. El error sube al llamador, que avisa y no toca nada.
    await this.crearPuntoRestauracion('Antes de restaurar');
    
    // Usar transacción para atomicidad
    await db.transaction('rw', db.productos, async () => {
      await db.productos.clear();
      await db.productos.bulkPut(productos);
    });
    
    return snapshot;
  },
  
  // Eliminar un producto creando antes un punto de restauración útil.
  // Todo en una sola transacción (productos + historial) para que el snapshot
  // incluya el producto que se va a borrar y así "deshacer" funcione.
  //
  // IMPORTANTE: la foto NO se borra. Antes sí, y eso rompía dos cosas:
  //   1. El "deshacer" reinsertaba la fila del producto pero el blob ya no
  //      estaba, así que el producto volvía sin imagen.
  //   2. El punto de restauración del historial guardaba el imagenId del
  //      producto eliminado, pero sin el blob. Restaurar ese punto devolvía el
  //      inventario con los productos sin foto.
  // Dejando el blob en su sitio, el deshacer es un simple reinsertado y el
  // "Volver Atrás" del historial recupera también las imágenes. La foto se
  // queda en la base aunque el producto no vuelva nunca: es dato del usuario y
  // la app no borra fotos sola (ver limpiarImagenesSinUsar).
  async eliminarProducto(id, { conPuntoRestauracion = true } = {}) {
    const producto = await db.productos.get(id);
    if (!producto) throw new Error('Producto no encontrado');
    
    await db.transaction('rw', [db.productos, db.historial], async () => {
      if (conPuntoRestauracion) {
        // El producto AÚN está en la tabla, así que el snapshot lo contiene:
        // restaurar este punto devuelve el producto con su stock.
        const productos = await db.productos.toArray();
        await db.historial.add({
          id: `restauracion_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          fecha: new Date().toISOString(),
          motivo: 'eliminacion',
          snapshotProductos: productos.map(p => ({ ...p }))
        });
        
        // Mantener solo los últimos 10 puntos
        const count = await db.historial.count();
        if (count > 10) {
          const masAntiguos = await db.historial.orderBy('fecha').limit(count - 10).toArray();
          await db.historial.bulkDelete(masAntiguos.map(h => h.id));
        }
      }
      
      await db.productos.delete(id);
    });
    
    return producto;
  },
  
  // Deshacer un borrado: reinserta el producto tal como estaba.
  //
  // Antes tenía que reponer también el blob de la foto, porque eliminarProducto
  // lo borraba. Ahora que la foto se queda en la base, alcanza con reinsertar
  // la fila: el imagenId vuelve a resolver y el producto regresa con su
  // imagen. Si el id ya estuviera ocupado (el usuario lo volvió a crear
  // mientras tanto), se descarta en vez de pisar el producto nuevo.
  async restaurarProductoEliminado(producto) {
    if (!producto?.id) throw new Error('Nada que restaurar');
    
    await db.transaction('rw', db.productos, async () => {
      const existente = await db.productos.get(producto.id);
      if (existente) {
        throw new Error('Ya existe un producto con ese código, no se restauró');
      }
      
      // La copia de la app viene de getAllProductosConImagenes() y trae un
      // imagenUrl (un ObjectURL temporal). No debe persistirse: es un valor
      // válido sólo durante esta sesión y ocupa espacio en cada fila.
      const { imagenUrl, ...datos } = producto;
      
      await db.productos.add(datos);
    });
    
    return producto;
  },
  
  // Obtener historial de restauraciones
  async getHistorial() {
    return db.historial.orderBy('fecha').reverse().toArray();
  },
  
  // Buscar productos por texto o código de barras
  async buscarProductos(query) {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];
    
    return db.productos
      .filter(p => 
        p.nombre.toLowerCase().includes(lowerQuery) ||
        (p.codigoBarras && p.codigoBarras.includes(lowerQuery))
      )
      .toArray();
  },
  
  // Obtener productos con stock bajo (para pedidos)
  async getProductosStockBajo() {
    return db.productos
      .filter(p => p.stock <= p.stockMinimo)
      .toArray();
  },
  
  // Incrementar/Decrementar stock atómicamente
  async ajustarStock(id, delta) {
    const producto = await db.productos.get(id);
    if (!producto) throw new Error('Producto no encontrado');
    
    const nuevoStock = Math.max(0, (producto.stock || 0) + delta);
    await db.productos.update(id, { 
      stock: nuevoStock,
      actualizadoEl: new Date().toISOString()
    });
    
    return { ...producto, stock: nuevoStock };
  }
};

// 20 colores para categorías (formato hex)
export const COLORES_CATEGORIAS = [
  '#EF4444', // Rojo
  '#F97316', // Naranja
  '#F59E0B', // Ámbar
  '#EAB308', // Amarillo
  '#84CC16', // Lima
  '#22C55E', // Verde
  '#10B981', // Esmeralda
  '#14B8A6', // Turquesa
  '#06B6D4', // Cian
  '#0EA5E9', // Sky
  '#3B82F6', // Azul
  '#6366F1', // Índigo
  '#8B5CF6', // Violeta
  '#A855F7', // Púrpura
  '#D946EF', // Fucsia
  '#EC4899', // Rosa
  '#F43F5E', // Rosa-600
  '#78716C', // Stone
  '#64748B', // Slate
  '#1F2937', // Gris oscuro
];

// Categorías por defecto - VACÍO (el usuario crea las suyas)
export const CATEGORIAS_DEFAULT = [];

export const TIPOS_VENTA = [
  { 
    value: 'unidad', 
    label: 'Por Unidad', 
    icon: '📦', 
    step: 1, 
    unidadBase: 'unidad',
    subUnidades: [
      { value: 'unidad', label: 'Por Unidad', icon: '📦' },
      { value: 'docena', label: 'Por Docena', icon: '📦' },
      { value: 'caja', label: 'Por Caja', icon: '📦' },
      { value: 'pack', label: 'Por Pack', icon: '📦' }
    ]
  },
  { 
    value: 'peso_kg', 
    label: 'Por Kilo (kg)', 
    icon: '⚖️', 
    step: 0.5, 
    unidadBase: 'kg',
    subUnidades: [
      { value: 'kg', label: 'Por Kilo (kg)', icon: '⚖️' },
      { value: '500g', label: 'Por 500g', icon: '⚖️' },
      { value: '250g', label: 'Por 250g', icon: '⚖️' },
      { value: '100g', label: 'Por 100g', icon: '⚖️' }
    ]
  },
  { 
    value: 'peso_100g', 
    label: 'Por 100g', 
    icon: '⚖️', 
    step: 0.1, 
    unidadBase: '100g',
    subUnidades: [
      { value: '100g', label: 'Por 100g', icon: '⚖️' },
      { value: 'g', label: 'Por Gramo', icon: '⚖️' }
    ]
  },
  { 
    value: 'peso_500g', 
    label: 'Por 500g', 
    icon: '⚖️', 
    step: 0.5, 
    unidadBase: '500g',
    subUnidades: [
      { value: '500g', label: 'Por 500g', icon: '⚖️' },
      { value: 'kg', label: 'Por Kilo (kg)', icon: '⚖️' },
      { value: '100g', label: 'Por 100g', icon: '⚖️' }
    ]
  },
  { 
    value: 'docena', 
    label: 'Por Docena', 
    icon: '📦', 
    step: 1, 
    unidadBase: 'docena',
    subUnidades: [
      { value: 'docena', label: 'Por Docena', icon: '📦' },
      { value: 'unidad', label: 'Por Unidad', icon: '📦' }
    ]
  },
  { 
    value: 'metro', 
    label: 'Por Metro', 
    icon: '📏', 
    step: 0.5, 
    unidadBase: 'm',
    subUnidades: [
      { value: 'm', label: 'Por Metro', icon: '📏' },
      { value: 'cm', label: 'Por Centímetro', icon: '📏' },
      { value: 'rollo', label: 'Por Rollo', icon: '📦' }
    ]
  },
  { 
    value: 'litro', 
    label: 'Por Litro', 
    icon: '🥛', 
    step: 0.5, 
    unidadBase: 'L',
    subUnidades: [
      { value: 'L', label: 'Por Litro', icon: '🥛' },
      { value: 'ml', label: 'Por Mililitro', icon: '🥛' },
      { value: '500ml', label: 'Por 500ml', icon: '🥛' },
      { value: '250ml', label: 'Por 250ml', icon: '🥛' }
    ]
  },
];

// Unidad de medida que se muestra para un tipo de venta dado.
// Fuente única de verdad: antes cada componente resolvía esto por su cuenta y
// PedidoModal comparaba contra 'peso', un valor que no existe en TIPOS_VENTA
// (los reales son peso_kg, peso_100g, peso_500g), así que la unidad salía
// siempre como 'unid'.
export function getUnidadBase(tipoVenta) {
  const tipo = TIPOS_VENTA.find(t => t.value === tipoVenta) || TIPOS_VENTA[0];
  return tipo.unidadBase || 'unid';
}

/**
 * Estado de stock de un producto: 'ok', 'poco' o 'vacio'.
 *
 * Vive acá y no en un componente porque lo necesitan tres lugares que tienen
 * que coincidir: el badge de la tarjeta, los grupos del catálogo y el badge del
 * diálogo de código repetido. Cuando estaba repartido en tres ifs, un producto
 * caía en "pocas unidades" en un lado y en "con stock" en otro, y el catálogo
 * contradecía a su propia grilla.
 *
 * @param {{stock?: number, stockMinimo?: number}} producto
 * @returns {'ok'|'poco'|'vacio'}
 */
export function estadoStock(producto) {
  const stock = producto.stock || 0;
  if (stock === 0) return 'vacio';
  if (stock <= (producto.stockMinimo || 0)) return 'poco';
  return 'ok';
}

/**
 * Unidad principal elegida por el usuario para un producto.
 *
 * Devuelve el descriptor de la sub-unidad elegida ({ value, label, icon }), o
 * el de la unidad base si el producto no tiene elección o la que tiene no
 * existe en su tipo de venta.
 *
 * OJO con el alcance: esto define la unidad del PRECIO, no la del stock.
 * El stock (stock y stockMinimo) está siempre expresado en la unidad base del
 * tipo de venta y no se convierte, porque entre sub-unidades no hay factores
 * de conversión definidos: no se sabe cuántas unidades tiene una caja, ni
 * cuántos gramos tiene un rollo. Convertir exigiría inventarse una tabla que
 * sería falsa para la mayoría de los productos.
 */
export function getUnidadPrincipal(producto) {
  const tipo = TIPOS_VENTA.find(t => t.value === producto?.tipoVenta) || TIPOS_VENTA[0];
  const subs = tipo.subUnidades || [];
  const base = subs[0] || { value: tipo.unidadBase, label: tipo.label, icon: tipo.icon };
  const elegida = subs.find(s => s.value === producto?.unidadPrincipal);
  return elegida || base;
}

/**
 * Precio del producto en su unidad principal, con la unidad correspondiente.
 *
 * Se devuelve la unidad JUNTO al precio a propósito: si el producto no tiene
 * precio para la unidad principal (datos viejos, o una sub-unidad que quedó sin
 * precio), se cae al primer precio que exista y se devuelve la unidad de ese,
 * para no mostrar "$1.200/500g" con el precio del kilo al lado.
 *
 * @returns {{ valor: number, unidad: string, label: string, esPrincipal: boolean }}
 *   esPrincipal indica si el precio corresponde a la unidad elegida o si es un
 *   fallback a otra unidad.
 */
export function getPrecioPrincipal(producto) {
  const principal = getUnidadPrincipal(producto);
  const precios = Array.isArray(producto?.precios) ? producto.precios : [];
  
  const exacto = precios.find(p => p.unidad === principal.value);
  if (exacto) {
    return { valor: exacto.valor, unidad: principal.value, label: principal.label, esPrincipal: true };
  }
  
  // Sin precio para la unidad principal: se usa el primero disponible, con SU
  // unidad. Es el caso de los productos guardados antes de que la unidad
  // principal hiciese algo, y de los que tienen el precio principal en blanco.
  const primero = precios.find(p => p.valor > 0);
  if (primero) {
    return { valor: primero.valor, unidad: primero.unidad, label: primero.label || primero.unidad, esPrincipal: false };
  }
  
  // Sin precios: se cae al campo precio de siempre, en la unidad base.
  return {
    valor: Number(producto?.precio) || 0,
    unidad: principal.value,
    label: principal.label,
    esPrincipal: true
  };
}

// Inicializar categorías - NO crear por defecto, el usuario crea las suyas
export async function inicializarCategorias() {
  // No crear categorías por defecto - el usuario define las suyas
  // Solo retorna las que existan
  return await db.categorias.toArray();
}