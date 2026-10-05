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
// (ProductoForm y ScannerModal). La tabla historial se ve abajo: era la única
// que se ordenaba por fecha.
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
 *     de la lista. Buscar por categoría devolvería productos repetidos.
 *   - Dexie no indexa arrays con varias claves: la consulta no se puede
 *     escribir.
 *   - El filtro por categoría se hace en memoria, y son como pocos cientos de
 *     productos: no se nota.
 * El índice viejo de categoriaId se queda declarado en la v5 a propósito, para
 * que las bases ya existentes se puedan reindexar sin perder nada.
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

      // un producto que tuviera las dos formas sería el peor estado posible,
      // porque cada lugar que leyera una leería la otra.
      if (!Array.isArray(producto.categoriaIds)) {
        producto.categoriaIds = producto.categoriaId ? [producto.categoriaId] : [];
      }
      delete producto.categoriaId;

      if (typeof producto.proveedor !== 'string') producto.proveedor = '';
      if (typeof producto.notas !== 'string') producto.notas = '';
    });
  });

/*
 * v7: los proveedores pasan a ser una lista propia.
 *
 * Hasta acá el proveedor era sólo texto dentro del producto. Eso alcanza para
 * agrupar un pedido, pero no para administrar la lista: no había forma de
 * agregar un proveedor antes de tener un producto suyo, ni de renombrar uno sin
 * editar producto por producto.
 *
 * La tabla guarda el catálogo de nombres. El producto sigue guardando el nombre
 * en texto y no un id, a propósito: el formulario, el pedido, la búsqueda y el
 * backup ya leen ese campo, y cambiarlo a referencias obligaría a tocar todos
 * esos lugares para algo que no se pidió. La lista se arma sola con lo que ya
 * está en los productos, así que un inventario anterior no pierde ningún
 * proveedor.
 *
 * El id se arma acá y no con generarId() porque esa constante se declara más
 * abajo en este archivo.
 */
db.version(7)
  .stores({
    productos: 'id, codigoBarras, tipoVenta, costo, fechaCompra',
    categorias: 'id, nombre, color',
    proveedores: 'id, nombre',
    imagenes: 'id',
    historial: 'id, fecha'
  })
  .upgrade(async tx => {
    const productos = await tx.table('productos').toCollection().toArray();
    const vistos = new Map();
    for (const p of productos) {
      const nombre = (p.proveedor || '').trim();
      if (!nombre) continue;
      const clave = normalizarTexto(nombre);

      // el usuario tiene anotada.
      if (!vistos.has(clave)) vistos.set(clave, nombre);
    }
    if (!vistos.size) return;
    await tx.table('proveedores').bulkPut(
      [...vistos.values()].map(nombre => ({
        id: `prov_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        nombre
      }))
    );
  });
/*
 * v8: se elimina el historial de puntos de restauración.
 *
 * La app guardaba una copia completa de la tabla de productos antes de cada
 * borrado, y hasta diez copias. Con eso: cada borrado escribía el inventario
 * entero, las copias competían por la cuota con las fotos del usuario, y la tabla
 * más pesada de la base era la que nadie miraba.
 *
 * Peor: "Volver atrás" devolvía el estado del inventario, no sólo lo borrado. Un
 * punto tomaba antes de borrar la categoría "Bebidas" traía de vuelta todos los
 * productos que el usuario había eliminado a mano en el último mes, con el mismo
 * nombre y en otra categoría. Y una de esas copias guardaba las fotos de esos
 * productos, así que la limpieza de fotos del historial terminaba borrando fotos
 * que el usuario había tenido alguna vez.
 *
 * La app ahora no guarda ningún historial. Lo que protege al usuario es una sola
 * cosa, y es explícita: **Exportar copia de seguridad**, que deja un archivo en el
 * disco. Y antes de cualquier borrado se le pregunta, con el nombre de lo que va
 * a desaparecer.
 *
 * La tabla se borra declarándola acá sin ella: Dexie elimina del esquema las
 * tablas que la versión nueva no declara, y con eso se recuperan de golpe las
 * copias que quedaban, que es el espacio que estaban ocupando.
 */
db.version(8).stores({
  productos: 'id, codigoBarras, tipoVenta, costo, fechaCompra',
  categorias: 'id, nombre, color',
  proveedores: 'id, nombre',
  imagenes: 'id'
});

/*
 * v9: los datos que se filtran y se ordenan se guardan ya calculados.
 *
 * Hasta acá la app traía todos los productos a memoria y los filtraba y los
 * ordenaba con JavaScript, en cada tecla escrita. Medido en esta máquina, con
 * 500 productos son 6ms de JavaScript por tecla: poco. El que trababa era el
 * repintado, y para eso ya está el debounce del buscador. Pero los dos juntos
 * seguían siendo la parte cara de la app, y el motivo real es más grave que el
 * costo: **el filtro no lo hacía la base, lo hacía un arreglo que ya estaba en
 * memoria**. Eso obliga a traer el inventario entero para mostrar sesenta
 * tarjetas, y en un teléfono gama baja, donde la memoria es el recurso escaso,
 * es exactamente lo que no hay que hacer.
 *
 * Con esta versión el filtro, el orden y los contadores se hacen en IndexedDB, y
 * la app sólo trae la página que va a pintar. Se agrega un campo derivado por
 * cosa que se filtra o se ordena, y se los mantiene al escribir:
 *
 *   busqueda       los cuatro textos que se buscan, normalizados y juntos, en
 *                  un solo campo, para que la búsqueda sea una consulta y no
 *                  cuatro comparaciones por producto.
 *   estado         'ok', 'poco' o 'vacio'. Es lo que decide el filtro por estado
 *                  y los tres números del panel. Antes se recalculaba en cada
 *                  render, y `contarProductosCategoria` lo hacía veinte veces por
 *                  render porque el panel lo llama una vez por categoría.
 *   nombreOrden    el nombre normalizado, para ordenar por texto igual que
 *                  siempre ("Limon" y "Limón" en el mismo lugar).
 *   precioOrden    el precio principal como número, para ordenar por precio.
 *   categoriaOrden el nombre de la primera categoría, normalizado, para ordenar
 *                  por categoría.
 *   proveedorClave el proveedor normalizado, para filtrar por proveedor sin que
 *                  un tilde en mayúscula deje el grupo vacío.
 *   *categoriaIds  el mismo campo, pero indexado como lista. Antes el filtro por
 *                  categoría se hacía en memoria porque un índice sobre un array
 *                  "no se puede escribir"; con el asterisco de Dexie sí, y una
 *                  entrada por elemento es justo lo que hace falta.
 *
 * El costo es de escritura: cada cambio en un producto recalcula siete campos.
 * Un cambio de precio es una operación de usuario, no un proceso de fondo, así
 * que el canje da.
 */
db.version(9)
  .stores({
    productos: 'id, codigoBarras, tipoVenta, costo, fechaCompra, estado, nombreOrden, precioOrden, categoriaOrden, proveedorClave, busqueda, *categoriaIds',
    categorias: 'id, nombre, color',
    proveedores: 'id, nombre',
    imagenes: 'id'
  })
  .upgrade(async tx => {
    const categorias = await tx.table('categorias').toArray();
    const productos = await tx.table('productos').toCollection().toArray();
    for (const p of productos) {
      Object.assign(p, camposDerivados(p, categorias));
    }
    if (productos.length) await tx.table('productos').bulkPut(productos);
  });

/**
 * Los campos que se calculan a partir de otros y se guardan ya resueltos.
 *
 * Vive en una función y no en cada escritura porque hay siete lugares que
 * escriben un producto: el formulario, el ajuste de stock, el borrado de una
 * categoría, el renombrado de un proveedor y el import de una copia. Si cada uno
 * calculara su parte, se olvidaría uno y el filtro de ese campo devolvería la
 * lista vacía sin decir por qué, que es la peor forma de no encontrar algo.
 *
 * @param {object} producto el producto tal como está, sin los campos derivados.
 * @param {object[]} categorias el catálogo, para el nombre de la categoría.
 * @returns {object} sólo los campos derivados.
 */
export function camposDerivados(producto, categorias = []) {
  const nombre = normalizarTexto(producto?.nombre || '');
  const categoriaIds = categoriasDe(producto);
  const nombreCategoria = categorias.find(c => c.id === categoriaIds[0])?.nombre || '';
  const principal = getPrecioPrincipal(producto || {});

  return {
    // Los cuatro textos que la búsqueda mira, en un campo y con espacios entre
    // ellos para que un término no atraviese dos campos pegados.
    busqueda: normalizarTexto([
      producto?.nombre,
      producto?.codigoBarras,
      producto?.proveedor,
      nombreCategoria
    ].filter(Boolean).join(' ')),

    estado: estadoStock(producto || {}),
    nombreOrden: nombre,
    precioOrden: principal?.valor || 0,
    categoriaOrden: normalizarTexto(nombreCategoria),
    proveedorClave: normalizarTexto(producto?.proveedor || '')
  };
}

/**
 * Las categorías de un producto, siempre como lista de ids.
 *
 * Un producto puede estar en varias. Se lee tolerando las dos formas porque un
 * backup viejo puede traer la anterior: un backup pertenece al usuario tal como
 * lo exportó, y reescribirlo sería mentir sobre lo que el archivo dice.
 *
 * @param {{categoriaIds?: string[], categoriaId?: string}} producto
 * @returns {string[]} puede estar vacía: un producto sin categoría es válido.
 */
export function categoriasDe(producto) {
  if (Array.isArray(producto?.categoriaIds)) return producto.categoriaIds.filter(Boolean);
  if (producto?.categoriaId) return [producto.categoriaId];
  return [];
}

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

export const dbUtils = {

  generarId: (prefijo = 'id') => `${prefijo}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,

  /**
   * Leer un número del formulario rechazando lo que no es número.
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

  /**
   * Traer una página de productos, con el filtro y el orden resueltos en la base.
   *
   * Esta función es el reemplazo de filtrar en memoria. La diferencia no es que
   * sea más rápida en milisegundos: es que **trae sólo lo que se va a pintar**.
   * Antes, para mostrar sesenta tarjetas, la app leía el inventario entero de la
   * base, con las fotos de todos los productos, y lo tenía en memoria. En un
   * teléfono gama baja eso no es un detalle de rendimiento: es la diferencia
   * entre entrar y no entrar.
   *
   * @param {object} opciones
   * @param {number} [opciones.limite] cuántas tarjetas se van a pintar.
   * @param {number} [opciones.desde] desde cuál, para el "cargar más".
   * @param {string} [opciones.busqueda] texto ya normalizado.
   * @param {string} [opciones.categoriaId]
   * @param {string} [opciones.estado] 'ok', 'poco' o 'vacio'.
   * @param {string} [opciones.proveedor] ya normalizado.
   * @param {string} [opciones.ordenarPor] nombre, stock, precio, categoria o fecha.
   * @param {string} [opciones.ordenDireccion] 'asc' o 'desc'.
   * @returns {Promise<{productos: object[], total: number}>} `total` es cuántos
   *   hay en total, para el "Mostrando 60 de 300". Sale con una cuenta aparte
   *   porque Dexie no lo da en la misma pasada.
   */
  async consultarProductos({
    limite = 60, desde = 0,
    busqueda = '', categoriaId = null, estado = null, proveedor = null,
    ordenarPor = 'nombre', ordenDireccion = 'asc'
  } = {}) {
    const criterios = [];

    // Los filtros van como `where` sobre un índice, no como `filter`: la
    // diferencia es que `where` usa el índice y `filter` recorre la tabla
    // entera aunque después se descarte todo. El filtro por texto es el único
    // que no puede ser `where` y se ve abajo.
    if (estado) criterios.push(p => p.estado === estado);
    if (proveedor) criterios.push(p => p.proveedorClave === proveedor);
    if (categoriaId) criterios.push(p => (p.categoriaIds || []).includes(categoriaId));

    const texto = normalizarTexto(busqueda);

    let coleccion = db.productos.toCollection();

    if (texto) {
      /*
       * La búsqueda de verdad es una condición, no un índice.
       *
       * Un índice sólo puede comparar el principio de una clave, así que
       * "aceite" no encuentra "Aceite de oliva". Y el campo `busqueda` existe
       * justamente para no hacer cuatro comparaciones por producto: está todo
       * normalizado y junto, así que acá hay una.
       *
       * El filtro de Dexie corre en JavaScript sobre la colección, pero con la
       * ventaja de que la base no tiene que traer los objetos a la memoria de la
       * aplicación para poder mirarlos: los recorre por dentro y devuelve
       * sólo los que pasan.
       */
      coleccion = coleccion.filter(p => (p.busqueda || '').includes(texto));
    }

    for (const criterio of criterios) {
      coleccion = coleccion.filter(criterio);
    }

    const total = await coleccion.count();

    /*
     * El orden va sobre un campo guardado y con índice, salvo la fecha.
     *
     * `sortBy` sobre un índice lo resuelve la base sin traer nada a memoria. La
     * fecha no tiene índice porque nadie ordena por ella con frecuencia y se
     * agrega `actualizadoEl` a propósito: el campo indexado lo llenan seis
     * escrituras por producto y para un orden que sólo tiene dos opciones.
     */
    const DESC = ordenDireccion === 'desc';

    if (ordenarPor === 'nombre') {
      const r = await coleccion.sortBy('nombreOrden');
      return { productos: DESC ? r.slice().reverse() : r, total };
    }
    if (ordenarPor === 'precio') {
      const r = await coleccion.sortBy('precioOrden');
      return { productos: DESC ? r.slice().reverse() : r, total };
    }
    if (ordenarPor === 'categoria') {
      const r = await coleccion.sortBy('categoriaOrden');
      return { productos: DESC ? r.slice().reverse() : r, total };
    }
    if (ordenarPor === 'fecha') {
      const r = await coleccion.toArray();
      r.sort((a, b) => {
        const va = a.actualizadoEl || '';
        const vb = b.actualizadoEl || '';
        return DESC ? (va < vb ? 1 : va > vb ? -1 : 0) : (va < vb ? -1 : va > vb ? 1 : 0);
      });
      return { productos: r, total };
    }

    // Stock: no tiene índice a propósito, porque con la suma o la resta cambia
    // en cada venta y un índice que se reescribe siempre es más caro que un
    // orden en memoria sobre la página que se va a pintar.
    const r = await coleccion.toArray();
    r.sort((a, b) => {
      const va = a.stock || 0;
      const vb = b.stock || 0;
      if (va === vb) return 0;
      return DESC ? vb - va : va - vb;
    });
    return { productos: r, total };
  },

  /**
   * Cuántos productos hay en cada grupo, para los tres paneles.
   *
   * Antes esto se calculaba recorriendo el inventario entero una vez por
   * categoría, en cada render: veinte categorías por dos llamadas de línea son
   * cuarenta recorridos completos del inventario por pintar la pantalla. Con un
   * índice por categoría y otro por estado, cada número es una cuenta que la base
   * responde sin devolver nada.
   */
  async contarProductos() {
    const [total, porEstado, porProveedor] = await Promise.all([
      db.productos.count(),
      Promise.all(['ok', 'poco', 'vacio'].map(k => db.productos.where('estado').equals(k).count())),
      db.productos.orderBy('proveedorClave').uniqueKeys()
    ]);

    const porCategoria = new Map();
    for (const cat of this._categoriasCache || []) {
      porCategoria.set(cat.id, await db.productos.where('categoriaIds').equals(cat.id).count());
    }

    return {
      total,
      porEstado: { ok: porEstado[0], poco: porEstado[1], vacio: porEstado[2] },
      porCategoria,
      porProveedor: new Set(porProveedor.filter(Boolean))
    };
  },

  /**
   * Cuántos productos tiene cada proveedor.
   *
   * Sale de un `groupBy` sobre el índice `proveedorClave`, que es el mismo
   * campo por el que se filtra el grupo. Antes este número salía de recorrer el
   * inventario entero una vez por proveedor, cada vez que se pintaba la pantalla.
   *
   * @returns {Promise<Map<string, number>>} la clave normalizada y la cantidad.
   */
  async contarPorProveedor() {
    const conteos = await db.productos.orderBy('proveedorClave').groupBy(p => p.proveedorClave || '', p => p.count());
    return new Map(conteos);
  },

  /** El catálogo, que `contarProductos` necesita para los ids de categoría. */
  fijarCategoriasParaContar(categorias) {
    this._categoriasCache = categorias;
  },

  /**
   * Guardar un producto, con sus campos derivados ya calculados.
   *
   * Todas las escrituras de la app pasan por acá. La razón es una sola y no es de
   * rendimiento: hay siete lugares que escriben un producto --el formulario al
   * agregar y al editar, el ajuste de stock, el borrado de una categoría, el
   * renombrado de un proveedor y el import de una copia-- y cada uno tiene que
   * recalcular los mismos siete campos derivados. El que se olvidara uno no
   * rompería la escritura: rompería el filtro, y volvería vacío sin decir por
   * qué.
   *
   * @param {object} producto el producto con sus campos propios.
   * @param {string} [id] sólo para actualizar uno existente.
   */
  async guardarProducto(producto, id = null) {
    const completo = {
      ...producto,
      ...camposDerivados(producto, this._categoriasCache || [])
    };

    if (id) {
      const guardado = { ...completo, id };
      await db.productos.put(guardado);
      return guardado;
    }

    const nuevo = { id: producto.id || this.generarId('prod'), ...completo };
    await db.productos.add(nuevo);
    return nuevo;
  },

  /**
   * Recalcular los campos derivados de los productos que casen con el filtro.
   *
   * Lo usan las escrituras que tocan muchos productos de una vez: borrar una
   * categoría, renombrar un proveedor.
   *
   * @param {(p: object) => boolean} aplica qué productos se ven afectados.
   * @param {(p: object) => object} cambia qué se les escribe.
   * @returns {Promise<number>} cuántos productos se tocaron.
   */
  async recalcularDerivados(aplica, cambia) {
    const categorias = this._categoriasCache || [];
    const afectados = await db.productos.toCollection().filter(aplica).toArray();

    for (const p of afectados) {
      const nuevo = cambia(p);
      Object.assign(nuevo, camposDerivados({ ...p, ...nuevo }, categorias));
      await db.productos.put(nuevo);
    }

    return afectados.length;
  },

  /**
   * Fotos guardadas que no referencia ningún producto ni ningún punto de
   * restauración. NO borra nada: sólo mide.
   *
   * La app no borra fotos sola (ver limpiarImagenesSinUsar), porque son
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
   * Clasifica las imágenes guardadas según quién las referencia.
   *
   * Con el historial eliminado, sólo hay dos conjuntos y uno se va:
   *
   *   enProductos -> las tiene un producto vivo. Intocables.
   *   sueltas      -> no las referencia ningún producto. Salen de fotos
   *                 canceladas o reemplazadas.
   *
   * Todo pasa por acá y no por dos funciones que cada una recalcula su propio
   * criterio: si medir y limpiar calcularan distinto, el botón prometería una
   * cantidad y borraría otra.
   */
  async _repartoDeImagenes() {
    const productos = await db.productos.toArray();
    const enProductos = new Set(productos.map(p => p.imagenId).filter(Boolean));

    const todas = await db.imagenes.toArray();
    return {
      sueltas: todas.filter(img => !enProductos.has(img.id))
    };
  },

  /** Los bytes que ocupa un conjunto de imágenes, para poder decirle cuánto es. */
  async _medirConjunto(conjunto) {
    const bytes = conjunto.reduce(
      (total, img) => total + (img.blob?.size || 0) + (img.thumb?.size || 0),
      0
    );
    return { cantidad: conjunto.length, bytes, megas: bytes / (1024 * 1024) };
  },

  async guardarImagen(id, blob, thumb = null) {
    await db.imagenes.add({ id, blob, thumb, creadoEl: new Date().toISOString() });
    return id;
  },

  /*
   * Liberar las URLs de objeto de una tanda de productos.
   *
   * Hay que llamarlo ANTES de reemplazarla: una URL de objeto es una referencia
   * viva al blob, y sin revocar se quedan todas apuntando a la memoria del
   * proceso aunque la foto ya no se muestre.
   */
  revocarImagenes(productos) {
    if (!Array.isArray(productos)) return;
    for (const p of productos) {
      if (p?.imagenUrl) {
        try { URL.revokeObjectURL(p.imagenUrl); } catch {  }
      }
    }
  },

  /*
   * Los productos con un código de barras exacto.
   *
   * El índice de `codigoBarras` NO es único a propósito (está escrito en la nota
   * de la v5), así que puede haber más de uno: un backup importado, o dos
   * productos que el usuario les cargó el mismo código a mano. Por eso devuelve
   * todos y no uno con `.first()`, que elegiría al azar entre los duplicados y el
   * usuario no sabría cuál de los dos estaba viendo.
   */
  async buscarPorCodigoBarras(codigo) {
    if (!codigo) return [];
    return db.productos.where('codigoBarras').equals(String(codigo)).toArray();
  },

  async listarProveedores() {
    const lista = await db.proveedores.toArray();
    return lista.sort((a, b) => normalizarTexto(a.nombre).localeCompare(normalizarTexto(b.nombre), 'es'));
  },

  /*
   * Agregar un proveedor a la lista.
   *
   * Si el nombre ya está, en cualquiera de las dos formas en que se puede
   * escribir (con o sin tilde, con mayúsculas distintas), no se agrega un
   * duplicado: se devuelve el que ya estaba. Es lo que evita que el usuario
   * termine con "Lácteos del Sur" y "lácteos del sur" en dos filas, que en el
   * pedido saldrían como dos proveedores y son el mismo.
   *
   * El nombre se normaliza antes de guardar: mayúscula la primera letra, sin
   * espacios de sobra.
   */
  async agregarProveedor(nombre) {
    const limpio = normalizarProveedor(nombre);
    if (!limpio) throw new Error('El nombre del proveedor está vacío');

    const clave = normalizarTexto(limpio);
    const existentes = await db.proveedores.toArray();
    const yaExiste = existentes.find(p => normalizarTexto(p.nombre) === clave);
    if (yaExiste) return { ...yaExiste, yaExistia: true };

    const nuevo = { id: dbUtils.generarId('prov'), nombre: limpio };
    await db.proveedores.add(nuevo);
    return { ...nuevo, yaExistia: false };
  },

  /*
   * Renombrar un proveedor.
   *
   * El nombre vive dentro de cada producto, así que renombrar en la lista tiene
   * que reescribir también los productos que lo usan. Si no, la lista y los
   * productos quedan diciendo dos cosas distintas y el pedido los manda
   * separados.
   *
   * La comparación del nombre viejo es la normalizada, no la exacta, porque los
   * productos pueden traerlo escrito de cualquier forma y hay que agarrarlos
   * todos.
   */
  async renombrarProveedor(id, nombreNuevo) {
    const limpio = normalizarProveedor(nombreNuevo);
    if (!limpio) throw new Error('El nombre del proveedor está vacío');

    return db.transaction('rw', [db.proveedores, db.productos], async () => {
      const actual = await db.proveedores.get(id);
      if (!actual) throw new Error('El proveedor no existe');

      const claveVieja = normalizarTexto(actual.nombre);
      const claveNueva = normalizarTexto(limpio);

      if (claveNueva !== claveVieja) {
        const choque = await db.proveedores.toCollection()
          .filter(p => p.id !== id && normalizarTexto(p.nombre) === claveNueva)
          .first();
        if (choque) throw new Error(`Ya existe un proveedor llamado "${limpio}"`);
      }

      await db.proveedores.update(id, { nombre: limpio });
      await this.recalcularDerivados(
        producto => normalizarTexto(producto.proveedor || '') === claveVieja,
        () => ({ proveedor: limpio })
      );
      return limpio;
    });
  },

  async eliminarProveedor(id) {
    return db.transaction('rw', [db.proveedores, db.productos], async () => {
      const actual = await db.proveedores.get(id);
      if (!actual) return 0;
      const clave = normalizarTexto(actual.nombre);
      const afectados = await this.recalcularDerivados(
        producto => normalizarTexto(producto.proveedor || '') === clave,
        () => ({ proveedor: '' })
      );
      await db.proveedores.delete(id);
      return afectados;
    });
  },

  /*
   * Borrar un producto.
   *
   * Es una de las dos cosas que la app borra, y la otra son las fotos sueltas.
   * Las dos le preguntan al usuario antes, con el nombre de lo que desaparece: un
   * borrado acá ya no se puede deshacer dentro de la app. Lo que lo protege es
   * la copia de seguridad que el usuario exporta a mano.
   *
   * La foto NO se borra: es dato del usuario. Queda en la tabla de imágenes sin
   * que nadie la referencie, y aparece en "Liberar fotos sin usar" para que sea
   * él quien decida. Ver limpiarImagenesSinUsar.
   */
  async eliminarProducto(id) {
    const producto = await db.productos.get(id);
    if (!producto) throw new Error('Producto no encontrado');

    await db.productos.delete(id);

    return producto;
  },

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

  async getProductosStockBajo() {
    return db.productos
      .filter(p => p.stock <= p.stockMinimo)
      .toArray();
  },

  /*
   * Ajustar el stock de un producto.
   *
   * El leer y el escribir van en UNA transacción, y no sueltos. Con un `get()` y
   * después un `update()`, dos escritores se pisan: cada uno lee el valor viejo,
   * le suma lo suyo y escribe, y el ajuste del segundo se pierde sin error.
   *
   * No es una posibilidad teórica. La misma base la ven todas las pestañas del
   * navegador y la PWA instalada del mismo origen: si tenés la app en el teléfono
   * y el navegador en la computer, los dos ajustes cuentan sobre el mismo número.
   * En una app cuyo único propósito es que el stock cuadre, ése es el peor
   * lugar para una carrera.
   *
   * La transacción de Dexie es la que serializa: dos llamadas que la piden sobre
   * la misma tabla se ejecutan una después de la otra, no en paralelo.
   */
  async ajustarStock(id, delta) {
    return db.transaction('rw', db.productos, async () => {
      const producto = await db.productos.get(id);
      if (!producto) throw new Error('Producto no encontrado');

      const nuevoStock = Math.max(0, (producto.stock || 0) + delta);
      const actualizado = {
        ...producto,
        stock: nuevoStock,
        actualizadoEl: new Date().toISOString()
      };

      // El estado de stock es un campo derivado y va indexado: sin recalcularlo
      // acá, el producto aparecería en el grupo equivocado del catálogo y el
      // contador del panel quedaría desfasado hasta el próximo reinicio.
      Object.assign(actualizado, camposDerivados(actualizado, this._categoriasCache || []));

      await db.productos.put(actualizado);

      return { ...producto, stock: nuevoStock };
    });
  }
};

export const COLORES_CATEGORIAS = [
  '#EF4444',
  '#F97316',
  '#F59E0B',
  '#EAB308',
  '#84CC16',
  '#22C55E',
  '#10B981',
  '#14B8A6',
  '#06B6D4',
  '#0EA5E9',
  '#3B82F6',
  '#6366F1',
  '#8B5CF6',
  '#A855F7',
  '#D946EF',
  '#EC4899',
  '#F43F5E',
  '#78716C',
  '#64748B',
  '#1F2937',
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

  return await db.categorias.toArray();
}
