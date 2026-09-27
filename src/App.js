import { db, dbUtils, inicializarCategorias, TIPOS_VENTA, COLORES_CATEGORIAS, estadoStock, getUnidadBase, getPrecioPrincipal } from './db.js';
import { abrirFormularioProducto } from './components/ProductoForm.js';
import { abrirHistorial } from './components/HistorialModal.js';
import { abrirPedido } from './components/PedidoModal.js';
import { abrirScanner } from './components/ScannerModal.js';
import { abrirCodigoDuplicado } from './components/CodigoDuplicado.js';
import { toast } from './utils/toast.js';
import { esc, escAttr, fmtPrecio } from './utils/html.js';

// Clave interna para ordenar los productos sin categoría al final.
// Se usa '\uFFFF' (el último código Unicode) en vez de un texto legible: antes
// se usaba el string 'zzz_sin_categoria' también como etiqueta y se veía
// literalmente en el Catálogo. El escape evita depender de la codificación.
const SIN_CATEGORIA_ORDEN = '\uFFFF';

export class App {
  // Cuántos productos se pintan por tanda. Ver productosVisibles().
  static LIMITE_RENDER = 60;

  // Los tres grupos en que se ordena el catálogo, en el orden en que se
  // muestran: lo que hay, lo que se está por acabar, y lo que ya se acabó.
  // El color de cada uno es el mismo que usa el badge de la tarjeta, para que
  // el grupo y su contenido se vean del mismo color.
  static ESTADOS_STOCK = [
    { clave: 'ok', etiqueta: 'Con stock', clase: 'stock-ok', color: '#22c55e' },
    { clave: 'poco', etiqueta: 'Pocas unidades', clase: 'stock-low', color: '#f59e0b' },
    { clave: 'vacio', etiqueta: 'Sin stock', clase: 'stock-out', color: '#ef4444' }
  ];

  constructor() {
    this.productos = [];
    this.productosFiltrados = [];
    this.categorias = [];
    this.busqueda = '';
    this.ordenarPor = 'nombre';
    this.ordenDireccion = 'asc';
    this.vistaActual = 'inventario';
    this.ultimoEliminado = null;
    this.timeoutDeshacer = null;
    this.categoriaEditando = null;
    this._limiteRender = App.LIMITE_RENDER;
  }
  
  async init() {
    try {
      await inicializarCategorias();
      
      // ANTES acá se borraban las fotos que ningún producto referenciaba, en
      // cada arranque. Ya no: una foto es dato del usuario y la app no borra
      // fotos sola. El riesgo de que se perdieran era real y silencioso: si el
      // barrido no contaba el historial, se llevaba por delante justo las fotos
      // que "Volver Atrás" necesitaba, y el usuario recuperaba el inventario
      // sin imágenes y sin ningún aviso.
      //
      // Ahora sólo se MIDE, para poder avisarle cuánto ocupa lo que no se está
      // usando y que él decida (ver medirImagenesSinUsar y el aviso del
      // historial). El formulario igual borra las fotos que se tomaron y se
      // canceló sin guardar: esas nunca fueron de ningún producto.
      try {
        const sueltas = await dbUtils.medirImagenesSinUsar();
        if (sueltas.cantidad > 0) {
          console.info(
            `[App] ${sueltas.cantidad} foto(s) sin ningún producto asociado, ` +
            `${sueltas.megas.toFixed(1)}MB. No se borran: la app no borra ` +
            `fotos sola. Se pueden liberar desde el historial.`
          );
        }
      } catch (error) {
        // Medir no es crítico: si falla, la app sigue igual.
        console.error('[App] No se pudieron medir las fotos sin uso:', error);
      }
      
      await this.cargarTodo();
      
      // Crear punto de restauración diario si no existe uno hoy
      await this.crearPuntoRestauracionDiario();
      
      this.render();
      this.bindEvents();
      this.registrarServiceWorker();
      
    } catch (error) {
      // Sin esto, cualquier fallo de arranque deja la pantalla en blanco y sólo
      // se ve en la consola: el usuario cree que la app no abre.
      console.error('[App] Error en el arranque:', error);
      this.mostrarErrorArranque(error);
    }
  }
  
  // Pantalla de error de arranque con opciones de recuperación
  mostrarErrorArranque(error) {
    const cont = document.getElementById('app');
    if (!cont) return;
    
    const detalle = import.meta.env.DEV
      ? `<pre class="mt-4 p-3 bg-gray-100 rounded-lg text-xs text-left overflow-auto max-h-48 whitespace-pre-wrap">${esc(String(error?.stack || error))}</pre>`
      : '<p class="text-gray-500 mt-2 text-sm">Si el problema sigue, probá a recargar o a reinstalar la app.</p>';
    
    cont.innerHTML = `
      <div class="min-h-screen flex items-center justify-center p-6">
        <div class="max-w-md text-center">
          <span class="text-5xl">⚠️</span>
          <h1 class="text-touch-lg font-bold text-gray-900 mt-4">No se pudo abrir la app</h1>
          <p class="text-gray-600 mt-2">Tus datos siguen guardados en este dispositivo.</p>
          ${detalle}
          <div class="flex flex-col gap-2 mt-6">
            <button id="btn-reintentar-carga" class="btn-primary w-full">🔄 Reintentar</button>
            <button id="btn-descargar-emergencia" class="btn-secondary w-full text-sm">📤 Descargar copia de mis datos</button>
          </div>
          <p class="text-xs text-gray-400 mt-4">No borres los datos del navegador: puedes perder el inventario.</p>
        </div>
      </div>
    `;
    
    document.getElementById('btn-reintentar-carga')?.addEventListener('click', () => {
      window.location.reload();
    });
    
    // Aunque la app no arranque, el usuario debe poder sacar sus datos.
    document.getElementById('btn-descargar-emergencia')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-descargar-emergencia');
      btn.disabled = true;
      btn.textContent = '⏳ Generando...';
      try {
        const { exportarBackup, descargarBackup } = await import('./utils/backup.js');
        descargarBackup(await exportarBackup(), `backup-stock-rescate-${new Date().toISOString().slice(0, 10)}.json`);
        btn.textContent = '✅ Copia descargada';
      } catch (e) {
        console.error(e);
        btn.textContent = '❌ No se pudo exportar';
        btn.disabled = false;
      }
    });
  }
  
  async crearPuntoRestauracionDiario() {
    const historial = await dbUtils.getHistorial();
    const hoy = new Date().toISOString().split('T')[0];
    const hayHoy = historial.some(h => h.fecha.startsWith(hoy));
    if (!hayHoy && this.productos.length > 0) {
      await dbUtils.crearPuntoRestauracion('cierre');
    }
  }
  
  async cargarTodo() {
    // Liberar los ObjectURL de la carga anterior antes de crear los nuevos,
    // si no los blobs se acumulan en memoria en cada recarga de la vista.
    dbUtils.revocarImagenes(this.productos);
    this.productos = await dbUtils.getAllProductosConImagenes();
    this.categorias = await db.categorias.toArray();
    this.aplicarFiltroYOrden();
  }
  
  aplicarFiltroYOrden() {
    let resultado = [...this.productos];
    
    const query = this.busqueda.toLowerCase().trim();
    if (query) {
      resultado = resultado.filter(p => 
        p.nombre.toLowerCase().includes(query) ||
        (p.codigoBarras && p.codigoBarras.toLowerCase().includes(query))
      );
    }
    
    resultado.sort((a, b) => {
      let valA, valB;
      
      switch (this.ordenarPor) {
        case 'nombre':
          valA = a.nombre.toLowerCase();
          valB = b.nombre.toLowerCase();
          break;
        case 'stock':
          valA = a.stock || 0;
          valB = b.stock || 0;
          break;
        case 'precio':
          valA = a.precio || 0;
          valB = b.precio || 0;
          break;
        case 'categoria':
          valA = this.getCategoriaOrden(a.categoriaId).toLowerCase();
          valB = this.getCategoriaOrden(b.categoriaId).toLowerCase();
          break;
        case 'fecha':
          valA = new Date(a.actualizadoEl || 0).getTime();
          valB = new Date(b.actualizadoEl || 0).getTime();
          break;
        default:
          valA = a.nombre.toLowerCase();
          valB = b.nombre.toLowerCase();
      }
      
      if (valA < valB) return this.ordenDireccion === 'asc' ? -1 : 1;
      if (valA > valB) return this.ordenDireccion === 'asc' ? 1 : -1;
      return 0;
    });
    
    this.productosFiltrados = resultado;
    this.renderVista();
  }
  
  // Clave de ordenación: empuja los productos sin categoría al final.
  // NO es una etiqueta para mostrar en la UI. El catálogo agrupa por estado de
  // stock, así que la categoría sólo se muestra en el chip de cada tarjeta, y
  // las categorías sueltas usan su propio nombre.
  getCategoriaOrden(categoriaId) {
    if (!categoriaId) return SIN_CATEGORIA_ORDEN;
    return this.categorias.find(c => c.id === categoriaId)?.nombre || SIN_CATEGORIA_ORDEN;
  }
  
  getStockClass(producto) {
    return App.ESTADOS_STOCK.find(e => e.clave === estadoStock(producto)).clase;
  }
  
  getStockLabel(producto) {
    const stock = producto.stock || 0;
    const unidad = getUnidadBase(producto.tipoVenta);
    // El "Poco" sale de estadoStock() y no de comparar acá otra vez, para que el
    // badge no pueda decir "Poco" mientras el grupo del catálogo dice "Con stock".
    const estado = estadoStock(producto);
    if (estado === 'vacio') return 'Agotado';
    if (estado === 'poco') return `Poco (${stock} ${unidad})`;
    return `${stock} ${unidad}`;
  }
  
  getUnidadBase(tipoVenta) {
    return getUnidadBase(tipoVenta);
  }
  
  render() {
    this._eventsBound = false;
    
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="min-h-screen flex flex-col safe-area-inset bg-gray-50 overflow-x-hidden">
        <header class="bg-white border-b border-gray-100 sticky top-0 z-40 overflow-x-hidden">
          <div class="px-3 py-2.5">
            <div class="flex items-center justify-between gap-2">
              <h1 class="text-touch-lg font-bold text-gray-900">📦 Stock Comercio</h1>
              <div class="flex items-center gap-1">
                <button id="btn-historial" class="btn-ghost p-2" aria-label="Historial y restaurar">
                  🔄
                </button>
                <button id="btn-pedido" class="btn-ghost p-2" aria-label="Pedido de faltantes">
                  📋
                </button>
              </div>
            </div>
            
            <div class="relative mt-2">
              <label for="buscador" class="sr-only">Buscar productos</label>
              <input 
                type="search" 
                id="buscador" 
                class="input-touch pl-10 pr-10 text-touch" 
                placeholder="Buscar por nombre o código..."
                value="${escAttr(this.busqueda)}"
              >
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">🔍</span>
              <button id="btn-escanear-header" class="absolute right-2 top-1/2 -translate-y-1/2 btn-ghost p-2" aria-label="Escanear código de barras">
                🔍
              </button>
            </div>
            
            <div class="mt-2">
              <select id="ordenar-select" class="input-touch text-touch w-full">
                <option value="nombre_asc" ${this.ordenarPor === 'nombre' && this.ordenDireccion === 'asc' ? 'selected' : ''}>🔤 Nombre A-Z</option>
                <option value="nombre_desc" ${this.ordenarPor === 'nombre' && this.ordenDireccion === 'desc' ? 'selected' : ''}>🔤 Nombre Z-A</option>
                <option value="stock_asc" ${this.ordenarPor === 'stock' && this.ordenDireccion === 'asc' ? 'selected' : ''}>📦 Stock menor</option>
                <option value="stock_desc" ${this.ordenarPor === 'stock' && this.ordenDireccion === 'desc' ? 'selected' : ''}>📦 Stock mayor</option>
                <option value="precio_asc" ${this.ordenarPor === 'precio' && this.ordenDireccion === 'asc' ? 'selected' : ''}>💰 Precio menor</option>
                <option value="precio_desc" ${this.ordenarPor === 'precio' && this.ordenDireccion === 'desc' ? 'selected' : ''}>💰 Precio mayor</option>
                <option value="categoria_asc" ${this.ordenarPor === 'categoria' && this.ordenDireccion === 'asc' ? 'selected' : ''}>📂 Categoría A-Z</option>
                <option value="fecha_desc" ${this.ordenarPor === 'fecha' && this.ordenDireccion === 'desc' ? 'selected' : ''}>📅 Recientes</option>
              </select>
            </div>
          </div>
          
          <div class="flex border-t border-gray-100 -mx-3 overflow-x-hidden">
            <button 
              id="tab-inventario" 
              class="tab-btn ${this.vistaActual === 'inventario' ? 'active' : ''} flex-1 py-2 text-sm font-medium text-center"
              data-vista="inventario"
            >
              📦 Inventario
            </button>
            <button 
              id="tab-catalogo" 
              class="tab-btn ${this.vistaActual === 'catalogo' ? 'active' : ''} flex-1 py-2 text-sm font-medium text-center"
              data-vista="catalogo"
            >
              📚 Catálogo
            </button>
            <button 
              id="tab-categorias" 
              class="tab-btn ${this.vistaActual === 'categorias' ? 'active' : ''} flex-1 py-2 text-sm font-medium text-center"
              data-vista="categorias"
            >
              🏷️ Categorías
            </button>
          </div>
        </header>
        
        <main class="flex-1 overflow-y-auto px-3 pb-24 overflow-x-hidden" id="contenido-principal">
          ${this.renderVistaHTML()}
        </main>
        
        <button 
          id="btn-agregar-fab" 
          class="fixed bottom-6 right-4 z-50 btn-primary shadow-xl shadow-primary-600/40 flex items-center justify-center text-touch safe-bottom"
          aria-label="Agregar producto"
          style="width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center;"
        >
          <span class="text-2xl" style="line-height: 1;">➕</span>
        </button>
      </div>
    `;
    this.bindEvents();
  }
  
  renderVistaHTML() {
    switch (this.vistaActual) {
      case 'catalogo':
        return this.renderCatalogoHTML();
      case 'categorias':
        return this.renderCategoriasHTML();
      default:
        return this.renderInventarioHTML();
    }
  }
  
  renderInventarioHTML() {
    if (this.productosFiltrados.length === 0) {
      if (this.busqueda) {
        return `
          <div class="text-center py-12 text-gray-500">
            <span class="text-5xl">🔍</span>
            <p class="text-touch font-medium mt-2">Sin resultados</p>
            <p class="text-sm mt-1">No se encontró "${esc(this.busqueda)}"</p>
            <button id="btn-limpiar-busqueda" class="btn-primary mt-4 w-auto">Limpiar búsqueda</button>
          </div>
        `;
      }
      
      return `
        <div class="text-center py-12 text-gray-500">
          <span class="text-6xl">📦</span>
          <h2 class="text-touch-lg font-semibold text-gray-700 mt-4">Inventario vacío</h2>
          <p class="text-sm text-gray-500 mt-2">Toca "Agregar producto" para empezar</p>
        </div>
      `;
    }
    
    const visibles = this.productosVisibles();
    return visibles.map(p => this.renderProductoHTML(p)).join('')
      + this.renderCargarMasHTML(visibles);
  }

  /**
   * Productos que se pintan, según hasta dónde llegó el usuario con "Cargar
   * más".
   *
   * Antes se mapeaban TODOS los productos a HTML de una vez. Con 200 productos
   * son 200 tarjetas construidas de cero en cada búsqueda, cada cambio de
   * orden y cada recarga de la vista, y el equipo objetivo tiene 2GB de RAM.
   *
   * Ojo: esto NO es paginación. Los productos siguen todos cargados en memoria
   * y la búsqueda los sigue incluyendo a todos; sólo se limita hasta dónde se
   * pinta. Por eso el botón informa cuántos faltan.
   *
   * En el catálogo el tope se reparte entre los tres grupos de stock en vez de
   * recortar la lista por el principio. Repartido al revés, con 200 productos
   * ordenados por nombre los primeros 60 son los que empiezan con A y B: el
   * grupo "Sin stock" podía quedar con la cabecera en "(12)" y cero tarjetas
   * debajo, que es peor que no mostrarlo, porque el contador miente.
   */
  productosVisibles() {
    if (this.vistaActual !== 'catalogo') {
      return this.productosFiltrados.slice(0, this._limiteRender);
    }

    const porEstado = new Map(App.ESTADOS_STOCK.map(e => [e.clave, []]));
    for (const p of this.productosFiltrados) {
      porEstado.get(estadoStock(p)).push(p);
    }

    // El tope se reparte entre los grupos que tienen algo, no entre los tres
    // estados. Dividir entre tres estados con el catálogo entero en stock
    // mostraría 20 de 200 y haría aparecer "Cargar más" cinco veces seguidas
    // para nada.
    const grupos = [...porEstado.values()].filter(g => g.length > 0);
    if (grupos.length === 0) return [];

    // Cada grupo se lleva la misma parte. El sobrante de un grupo chico no se
    // pasa a los demás a propósito: si se pasara, cada "Cargar más" traería una
    // cantidad distinta de cada grupo y el orden de lectura se volvería a romper.
    //
    // El mínimo de 1 hace que un grupo con un solo producto no se vuelva
    // invisible, aunque el tope fuera más chico que la cantidad de grupos. En la
    // app no pasa: _limiteRender siempre es múltiplo de 60 y hay 3 estados.
    const cupo = Math.max(1, Math.floor(this._limiteRender / grupos.length));

    const visibles = [];
    for (const grupo of grupos) {
      visibles.push(...grupo.slice(0, cupo));
    }
    return visibles;
  }

  renderCargarMasHTML(visibles) {
    // Se cuenta sobre lo que realmente se pintó y no sobre _limiteRender: en el
    // catálogo el reparto por grupos deja huecos sin usar cuando un grupo es
    // chico, y con _limiteRender el botón anunciaba más productos de los que
    // aparecían.
    const faltan = this.productosFiltrados.length - visibles.length;
    if (faltan <= 0) return '';

    return `
      <div class="text-center py-4">
        <p class="text-sm text-gray-500 mb-2">Mostrando ${visibles.length} de ${this.productosFiltrados.length}</p>
        <button id="btn-cargar-mas" class="btn-secondary w-auto min-h-touch">
          Cargar ${Math.min(faltan, App.LIMITE_RENDER)} más
        </button>
      </div>
    `;
  }
  
  renderCatalogoHTML() {
    if (this.productosFiltrados.length === 0) {
      return `
        <div class="text-center py-12 text-gray-500">
          <span class="text-6xl">📚</span>
          <h2 class="text-touch-lg font-semibold text-gray-700 mt-4">Catálogo vacío</h2>
          <p class="text-sm text-gray-500 mt-2">No hay productos para mostrar</p>
        </div>
      `;
    }

    // El catálogo agrupa por estado de stock, no por categoría: primero lo que
    // hay, después lo que se está por acabar y al final lo que ya se acabó. Es
    // el orden en que un local necesita leer el catálogo, que es "qué puedo
    // ofrecer hoy y qué tengo que reponer".
    //
    // La categoría no se pierde: cada tarjeta lleva su chip con el color y el
    // nombre, y el orden elegido con el desplegable sigue funcionando dentro de
    // cada grupo (incluida la opción "Categoría A-Z").
    const visibles = this.productosVisibles();
    const porEstado = new Map(App.ESTADOS_STOCK.map(e => [e.clave, []]));
    for (const p of visibles) {
      porEstado.get(estadoStock(p)).push(p);
    }

    // Se agrupan sólo los productos que se van a pintar, no todos. Con el tope
    // de render, meter el resto haría que un grupo quedara con la cabecera en
    // "(12)" y cero tarjetas debajo, y el contador miente.
    return App.ESTADOS_STOCK
      .filter(estado => porEstado.get(estado.clave).length > 0)
      .map(estado => {
        const productos = porEstado.get(estado.clave);
        return `
        <section class="mb-6">
          <h3 class="text-touch font-bold text-gray-900 flex items-center gap-2 px-3 pb-1 border-b border-gray-200">
            <span class="w-6 h-6 rounded-full flex-shrink-0" style="background-color: ${estado.color}"></span>
            ${esc(estado.etiqueta)} (${productos.length})
          </h3>
          <div class="grid grid-cols-2 gap-3 mt-3 px-3">
            ${productos.map(p => this.renderCatalogoItemHTML(p)).join('')}
          </div>
        </section>
      `;
      }).join('') + this.renderCargarMasHTML(visibles);
  }
  
  // La rama que aceptaba un string y sacaba un color por hash del nombre quedó
  // sin uso cuando el catálogo dejó de agrupar por categoría: el único que
  // llama es el formulario de categoría, que siempre pasa el objeto.
  getCategoriaColor(categoria) {
    return categoria?.color || COLORES_CATEGORIAS[0];
  }
  
  renderCatalogoItemHTML(p) {
    const cat = p.categoriaId ? this.categorias.find(c => c.id === p.categoriaId) : null;
    // Ver la nota de avisoFotoPerdida en renderProductoHTML: el 📦 de siempre
    // no distingue "nunca tuvo foto" de "se le perdió". En la grilla el aviso
    // va como texto bajo el nombre, porque el espacio de la foto lo ocupa la
    // categoría y el precio.
    const avisoFotoPerdida = p.fotoPerdida
      ? `<p class="text-[11px] leading-tight text-warning-700 flex items-center gap-1 mb-1">
           <span class="flex-shrink-0">⚠️</span>
           <span>Falta la foto</span>
         </p>`
      : '';
    const imagenHTML = p.imagenUrl 
      ? `<img src="${escAttr(p.imagenUrl)}" loading="lazy" decoding="async" class="w-full h-full object-cover" alt="${escAttr(p.nombre)}">`
      : `<span class="text-3xl">${p.fotoPerdida ? '🖼️' : '📦'}</span>`;
    const tipo = TIPOS_VENTA.find(t => t.value === p.tipoVenta) || TIPOS_VENTA[0];
    const unidad = tipo.unidadBase || 'unid';
    
    return `
      <article class="card-touch group">
        <div class="aspect-square max-w-xs mx-auto sm:max-w-none rounded-xl bg-gray-100 overflow-hidden relative mb-2">
          ${imagenHTML}
          <div class="absolute top-1 right-1 ${this.getStockClass(p)} stock-badge text-xs px-1.5 py-0.5">
            ${this.getStockLabel(p)}
          </div>
          ${p.categoriaId ? `
            <div class="absolute bottom-1 left-1 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-full px-2 py-0.5">
              <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${escAttr(cat?.color || '#64748B')}"></span>
              <span class="text-xs text-gray-600 truncate max-w-[80px]">${esc(cat?.nombre || '')}</span>
            </div>
          ` : ''}
        </div>
        <h4 class="font-semibold text-gray-900 truncate text-sm mb-1">${esc(p.nombre)}</h4>
        ${avisoFotoPerdida}
        ${p.precios && p.precios.length > 1 ? `
          <div class="flex flex-wrap gap-1 mb-1">
            ${p.precios.map(pr => `
              <span class="text-xs bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded">${esc(pr.icon || '📦')} $${fmtPrecio(pr.valor)}/${esc(pr.unidad)}</span>
            `).join('')}
          </div>
        ` : (p.precio ? `<p class="text-primary-700 font-bold text-sm">$${fmtPrecio(p.precio)}/${esc(unidad)}</p>` : '<p class="text-gray-400 text-xs">Sin precio</p>')}
        <p class="text-xs text-gray-500">Stock: ${p.stock || 0} ${esc(unidad)}</p>
        ${p.costo ? `<p class="text-xs text-gray-500">Costo: $${fmtPrecio(p.costo)}/${esc(unidad)}</p>` : ''}
        ${p.fechaCompra ? `<p class="text-xs text-gray-400">📅 ${new Date(p.fechaCompra).toLocaleDateString('es-ES')}</p>` : ''}
      </article>
    `;
  }
  
  renderCategoriasHTML() {
    return `
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-touch-lg font-bold text-gray-900">🏷️ Gestión de Categorías</h2>
          <button id="btn-nueva-categoria" class="btn-primary text-sm">
            ➕ Nueva categoría
          </button>
        </div>
        
        <div class="card-touch">
          <div class="space-y-2">
            ${this.categorias.map(cat => `
              <div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div class="flex items-center gap-3">
                  <span class="w-6 h-6 rounded-full flex-shrink-0" style="background-color: ${this.getCategoriaColor(cat)}"></span>
                  <div>
                    <p class="font-medium text-gray-900">${esc(cat.nombre)}</p>
                    <p class="text-xs text-gray-500">${this.contarProductosCategoria(cat.id)} productos</p>
                  </div>
                </div>
                <div class="flex gap-2">
                  <button class="btn-ghost p-2 text-primary-600 editar-categoria" data-id="${escAttr(cat.id)}" aria-label="Editar ${escAttr(cat.nombre)}">
                    ✏️
                  </button>
                  <button class="btn-ghost p-2 text-danger-500 eliminar-categoria" data-id="${escAttr(cat.id)}" aria-label="Eliminar ${escAttr(cat.nombre)}">
                    🗑️
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        
        ${this.categorias.length === 0 ? `
          <div class="text-center py-8 text-gray-500">
            <span class="text-5xl">📂</span>
            <p class="text-touch font-medium mt-2">Sin categorías</p>
            <button id="btn-nueva-categoria-vacia" class="btn-primary mt-4">➕ Crear primera categoría</button>
          </div>
        ` : ''}
      </div>
    `;
  }
  
  contarProductosCategoria(categoriaId) {
    return this.productos.filter(p => p.categoriaId === categoriaId).length;
  }
  
  renderProductoHTML(p) {
    const stockClass = this.getStockClass(p);
    const stock = p.stock || 0;
    const tipo = TIPOS_VENTA.find(t => t.value === p.tipoVenta) || TIPOS_VENTA[0];
    const step = tipo.step;
    // Unidad del STOCK: siempre la base del tipo de venta. No se convierte a la
    // unidad principal porque entre sub-unidades no hay factores de conversión
    // definidos (no se sabe cuántas unidades tiene una caja), y un stock
    // guardado en kg reinterpretado como 500g daría números que no existen.
    const unidad = tipo.unidadBase || 'unid';
    // Unidad del PRECIO: la que eligió el usuario. Antes se mostraba siempre la
    // base, así que un producto con principal "500g" aparecía con el precio del
    // kilo al lado de la etiqueta equivocada.
    const precio = getPrecioPrincipal(p);
    const stockMinimo = p.stockMinimo || 0;
    const imagenHTML = p.imagenUrl 
      ? `<img src="${escAttr(p.imagenUrl)}" loading="lazy" decoding="async" class="w-full h-full object-cover" alt="${escAttr(p.nombre)}">`
      : `<span class="text-3xl">${p.fotoPerdida ? '🖼️' : '📦'}</span>`;
    
    // Aviso de foto perdida. Sale SÓLO cuando el producto apunta a una foto que
    // no está en la base (p.fotoPerdida, que marca getAllProductosConImagenes).
    // Un producto que nunca tuvo foto no avisa: se vería con el 📦 de siempre y
    // el usuario no distinguiría una cosa de la otra.
    const avisoFotoPerdida = p.fotoPerdida
      ? `<p class="text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded-lg px-2 py-1 flex items-center gap-1">
           <span class="flex-shrink-0">⚠️</span>
           <span class="truncate">Falta la foto: no se encuentra en el dispositivo</span>
         </p>`
      : '';
    
    // Colores para badge de stock.
    // Las clases js-stock-* son los ganchos que usa actualizarTarjetaStock()
    // para refrescar la tarjeta en el sitio al cambiar el stock, sin
    // re-renderizar el catálogo entero.
    const stockBadgeClass = stock === 0 
      ? 'bg-red-100 text-red-800' 
      : stock <= stockMinimo 
        ? 'bg-yellow-100 text-yellow-800' 
        : 'bg-green-100 text-green-800';
    const stockBadgeText = stock === 0 ? 'Agotado' : stock <= stockMinimo ? 'Poco' : 'OK';
    
    return `
      <article class="card-touch bg-white rounded-2xl shadow-sm border border-gray-100 mb-3 overflow-hidden" data-id="${escAttr(p.id)}">
        <div class="flex items-center gap-3 p-3">
          <div class="relative flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 bg-gray-100 rounded-xl flex items-center justify-center overflow-hidden">
            ${imagenHTML}
          </div>
          <div class="flex-1 min-w-0 flex flex-col gap-2">
            <div class="min-w-0">
              <h3 class="font-bold text-gray-900 truncate text-base leading-tight">${esc(p.nombre)}</h3>
              <div class="flex items-center gap-2 mt-1 flex-wrap">
                ${precio.valor ? `<span class="text-sm font-semibold text-primary-700">$${fmtPrecio(precio.valor)}/${esc(precio.unidad)}</span>` : ''}
                ${p.costo ? `<span class="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded">Costo: $${fmtPrecio(p.costo)}/${esc(unidad)}</span>` : ''}
                <span class="js-stock-badge inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${stockBadgeClass}">
                  ${stockBadgeText}: ${stock}
                </span>
                <span class="text-xs text-gray-500">Mín: ${stockMinimo}</span>
                ${p.codigoBarras ? `<span class="text-xs text-gray-400 font-mono">${esc(p.codigoBarras)}</span>` : ''}
              </div>
              ${avisoFotoPerdida}
            </div>
            <div class="flex items-center justify-between pt-1 border-t border-gray-50">
              <span class="text-xs font-medium text-gray-400">Ajuste rápido:</span>
              <div class="flex items-center gap-2">
                <button class="min-h-touch min-w-touch flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xl rounded-xl active:scale-95 select-none" data-action="decrement" data-id="${escAttr(p.id)}" aria-label="Quitar ${escAttr(step)} ${escAttr(unidad)}">
                  −
                </button>
                <span class="js-stock-numero w-12 text-center font-mono font-bold text-lg text-gray-900">${stock}</span>
                <button class="min-h-touch min-w-touch flex items-center justify-center bg-primary-600 hover:bg-primary-700 text-white font-bold text-xl rounded-xl active:scale-95 select-none" data-action="increment" data-id="${escAttr(p.id)}" aria-label="Agregar ${escAttr(step)} ${escAttr(unidad)}">
                  +
                </button>
              </div>
            </div>
            <!--
              Las tres acciones van en su propia fila y no arriba en la esquina.
              Con iconos de 52px, tres en la fila del título se comían 164px de los
              ~244 que quedan al lado de la miniatura y el nombre quedaba
              ilegible. Además al repartir por igual (flex-1) cada botón mide
              ~81px en vez de 52: se tocan mejor y, con su texto, no hay que
              adivinar qué hace el ícono.
            -->
            <div class="flex items-center gap-1.5 pt-1 border-t border-gray-50">
              <button class="btn-ghost flex-1 inline-flex items-center justify-center gap-1 text-xs px-2 min-w-touch" data-action="duplicate" data-id="${escAttr(p.id)}" aria-label="Duplicar ${escAttr(p.nombre)}">
                <span aria-hidden="true">📋</span><span>Duplicar</span>
              </button>
              <button class="btn-ghost flex-1 inline-flex items-center justify-center gap-1 text-xs px-2 min-w-touch" data-action="edit" data-id="${escAttr(p.id)}" aria-label="Editar ${escAttr(p.nombre)}">
                <span aria-hidden="true">✏️</span><span>Editar</span>
              </button>
              <button class="btn-ghost flex-1 inline-flex items-center justify-center gap-1 text-xs px-2 min-w-touch text-red-500 hover:text-red-700" data-action="delete" data-id="${escAttr(p.id)}" aria-label="Eliminar ${escAttr(p.nombre)}">
                <span aria-hidden="true">🗑️</span><span>Eliminar</span>
              </button>
            </div>
          </div>
        </div>
      </article>
    `;
  }
  
  renderVista() {
    this._eventsBound = false;
    const container = document.getElementById('contenido-principal');
    if (container) {
      container.innerHTML = this.renderVistaHTML();
    }
    this.bindEvents();
  }
  
  bindEvents() {
    if (this._eventsBound) return;
    this._eventsBound = true;
    
    const buscador = document.getElementById('buscador');
    if (buscador) {
      buscador.addEventListener('input', (e) => {
        this.busqueda = e.target.value;
        // Búsqueda nueva = punto de partida nuevo: si no, el usuario que ya
        // había cargado 300 productos vería los 60 primeros de la otra
        // búsqueda sin haberlo pedido.
        this._limiteRender = App.LIMITE_RENDER;
        this.aplicarFiltroYOrden();
      });
    }
    
    const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
    if (btnLimpiar) {
      btnLimpiar.addEventListener('click', () => {
        this.busqueda = '';
        buscador.value = '';
        this._limiteRender = App.LIMITE_RENDER;
        this.aplicarFiltroYOrden();
      });
    }
    
    const ordenarSelect = document.getElementById('ordenar-select');
    if (ordenarSelect) {
      ordenarSelect.addEventListener('change', (e) => {
        const [campo, dir] = e.target.value.split('_');
        this.ordenarPor = campo;
        this.ordenDireccion = dir;
        this.aplicarFiltroYOrden();
      });
    }
    
    document.getElementById('btn-cargar-mas')?.addEventListener('click', () => {
      this._limiteRender += App.LIMITE_RENDER;
      this.renderVista();
    });
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.vistaActual = btn.dataset.vista;
        this._limiteRender = App.LIMITE_RENDER;
        this.render();
      });
    });
    
    document.getElementById('btn-escanear-header')?.addEventListener('click', () => this.escanearCodigo());
    document.getElementById('btn-historial')?.addEventListener('click', () => this.abrirHistorial());
    document.getElementById('btn-pedido')?.addEventListener('click', () => this.abrirPedido());
    document.getElementById('btn-agregar-fab')?.addEventListener('click', () => this.nuevoProducto());
    document.getElementById('btn-nueva-categoria')?.addEventListener('click', () => this.abrirModalCategoria());
    document.getElementById('btn-nueva-categoria-vacia')?.addEventListener('click', () => this.abrirModalCategoria());
    
    document.querySelectorAll('.editar-categoria').forEach(btn => {
      btn.addEventListener('click', () => this.abrirModalCategoria(btn.dataset.id));
    });
    document.querySelectorAll('.eliminar-categoria').forEach(btn => {
      btn.addEventListener('click', () => this.eliminarCategoria(btn.dataset.id));
    });
    
    document.getElementById('contenido-principal')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      
      switch (action) {
        case 'increment':
          this.ajustarStock(id, 1);
          break;
        case 'decrement':
          this.ajustarStock(id, -1);
          break;
        case 'edit':
          this.editarProducto(id);
          break;
        case 'duplicate':
          this.duplicarProducto(id);
          break;
        case 'delete':
          this.eliminarProducto(id);
          break;
      }
    }, { passive: true });
  }
  
  async ajustarStock(id, delta) {
    // Guard contra clicks rápidos encadenados
    if (this._ajustandoStock?.[id]) return;
    this._ajustandoStock = this._ajustandoStock || {};
    this._ajustandoStock[id] = true;
    
    const producto = this.productos.find(p => p.id === id);
    if (!producto) { this._ajustandoStock[id] = false; return; }
    
    const tipo = TIPOS_VENTA.find(t => t.value === producto.tipoVenta) || TIPOS_VENTA[0];
    const step = tipo.step;
    const cambioReal = delta * step;
    
    try {
      await dbUtils.ajustarStock(id, cambioReal);
      
      producto.stock = Math.max(0, (producto.stock || 0) + cambioReal);
      producto.actualizadoEl = new Date().toISOString();
      
      // Se actualiza SÓLO la tarjeta tocada en vez de renderizar el catálogo
      // entero. Antes cada +1/-1 destruía y recreaba todos los nodos: con 200
      // productos son 200 tarjetas × su contenido, en cada toque, y el scroll
      // saltaba de posición porque el contenido se reconstruía.
      this.actualizarTarjetaStock(producto);
      
      if (producto.stock > 0 && producto.stock <= (producto.stockMinimo || 0)) {
        toast.warning(`⚠️ ${producto.nombre}: Stock bajo (${producto.stock} ${this.getUnidadBase(producto.tipoVenta)})`);
      } else if (producto.stock === 0) {
        toast.error(`❌ ${producto.nombre}: Agotado`);
      }
    } catch (error) {
      toast.error('Error ajustando stock');
    } finally {
      this._ajustandoStock[id] = false;
    }
  }
  
  /**
   * Reflejar en el DOM el nuevo stock de un producto, sin volver a pintar todo.
   *
   * Se actualizan tres cosas de la tarjeta: el número central, el badge de
   * estado (Agotado / Poco / OK) y el "Mín: N" no cambia pero se refresca junto
   * con el badge para que no quede desfasado si algún día se toca.
   *
   * Si la tarjeta no está en el DOM (está más allá del límite de render, o la
   * vista cambió entre el click y el await) no se hace nada: el próximo
   * renderVista() la pinta con el valor ya correcto, porque `producto` es la
   * misma referencia que se acaba de mutar.
   */
  actualizarTarjetaStock(producto) {
    const card = document.querySelector(`article[data-id="${CSS.escape(producto.id)}"]`);
    if (!card) return;
    
    const stock = producto.stock || 0;
    const stockMinimo = producto.stockMinimo || 0;
    
    // Número central del ajuste rápido
    const numero = card.querySelector('.js-stock-numero');
    if (numero) numero.textContent = stock;
    
    // Badge de estado
    const badge = card.querySelector('.js-stock-badge');
    if (badge) {
      const clases = stock === 0
        ? 'bg-red-100 text-red-800'
        : stock <= stockMinimo
          ? 'bg-yellow-100 text-yellow-800'
          : 'bg-green-100 text-green-800';
      badge.className = `js-stock-badge inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${clases}`;
      badge.textContent = `${stock === 0 ? 'Agotado' : stock <= stockMinimo ? 'Poco' : 'OK'}: ${stock}`;
    }
  }
  
  // Se escaneó desde el formulario un código que ya existe y el usuario tocó
  // "Ver producto". Se cierra el formulario actual y se abre el existente.
  // editarProducto() tiene su propia guarda contra formularios apilados, así
  // que basta con delegar.
  _alVerProductoExistente(productoExistente) {
    this.editarProducto(productoExistente.id);
  }
  
  nuevoProducto() {
    if (this._productoFormAbierto) return;
    this._productoFormAbierto = true;
    abrirFormularioProducto(
      () => { this.cargarTodo(); this._productoFormAbierto = false; },
      () => { this._productoFormAbierto = false; },
      null,
      (p) => this._alVerProductoExistente(p),
      (p) => this.eliminarProducto(p.id)
    );
  }
  
  editarProducto(id) {
    if (this._productoFormAbierto) return;
    const producto = this.productos.find(p => p.id === id);
    if (!producto) return;
    this._productoFormAbierto = true;
    abrirFormularioProducto(
      () => { this.cargarTodo(); this._productoFormAbierto = false; },
      () => { this._productoFormAbierto = false; },
      producto,
      (p) => this._alVerProductoExistente(p),
      (p) => this.eliminarProducto(p.id)
    );
  }
  
  // Abrir el formulario con una copia del producto, listo para guardar como
  // nuevo. Sirve para las variantes: mismo nombre base, mismo precio, misma
  // foto, y el usuario cambia lo que la distingue.
  //
  // No se escribe NADA en la base hasta que el usuario guarda. Podría ser más
  // simple meter el duplicado directo y después abrirlo para editar, pero
  // entonces cancelar el formulario deja un producto basura en el inventario, y
  // un producto basura con foto es lo más caro de limpiar después. Con el
  // formulario de por medio, si cancela no pasó nada.
  //
  // Lo que se copia: todos los datos del producto (precios, stock, categoría,
  // tipo de venta, unidad principal, costos, IVA, fecha, foto).
  //
  // Lo que NO se copia, a propósito:
  //   - id: sin esto el formulario cree que está editando y en vez de crear uno
  //     nuevo pisaría el original.
  //   - codigoBarras: es la identidad del producto, no un dato. Copiarlo
  //     devolvería dos artículos con el mismo código, que es justo lo que el
  //     escáner y el formulario avisan. Se deja en blanco para que el usuario
  //     escriba el de la variante, y si la variante no tiene, lo deja vacío.
  //   - imagenUrl: es un ObjectURL que pertenece al catálogo. Pasarlo haría que
  //     el formulario revocara en cerrar() la imagen de la tarjeta del
  //     original. El formulario carga la suya sola desde imagenId.
  //   - fotoPerdida: se deriva al leer de la base, no tiene sentido guardarlo.
  //   - creadoEl / actualizadoEl: los pone el formulario al guardar.
  duplicarProducto(id) {
    if (this._productoFormAbierto) return;
    const original = this.productos.find(p => p.id === id);
    if (!original) return;
    
    const {
      id: _id,
      codigoBarras: _codigoBarras,
      imagenUrl: _imagenUrl,
      fotoPerdida: _fotoPerdida,
      creadoEl: _creadoEl,
      actualizadoEl: _actualizadoEl,
      ...datos
    } = original;
    
    this._productoFormAbierto = true;
    abrirFormularioProducto(
      () => { this.cargarTodo(); this._productoFormAbierto = false; },
      () => { this._productoFormAbierto = false; },
      datos,
      (p) => this._alVerProductoExistente(p),
      (p) => this.eliminarProducto(p.id)
    );
  }
  
  async eliminarProducto(id) {
    const producto = this.productos.find(p => p.id === id);
    if (!producto) return;
    
    try {
      // dbUtils.eliminarProducto crea el punto de restauración y borra el
      // producto en la misma transacción (si se usara db.productos.delete() no
      // habría punto de restauración y no se podría volver atrás).
      //
      // La foto NO se borra: queda en db.imagenes para que el deshacer y el
      // "Volver Atrás" del historial puedan devolver el producto con su
      // imagen. La app no borra fotos sola; si el usuario quiere liberar el
      // espacio, lo hace desde el historial (🗄️ liberarFotosDelHistorial).
      //
      // Se guarda el producto devuelto (con su imagenId) para que el deshacer
      // lo reinserte tal cual estaba.
      const eliminado = await dbUtils.eliminarProducto(id);
      this.ultimoEliminado = eliminado;
      
      await this.cargarTodo();
      
      this.mostrarDeshacer(`🗑️ ${producto.nombre} eliminado`, async () => {
        try {
          await dbUtils.restaurarProductoEliminado(this.ultimoEliminado);
          this.ultimoEliminado = null;
          await this.cargarTodo();
          toast.success('Producto restaurado');
        } catch (error) {
          console.error(error);
          toast.error(`No se pudo deshacer: ${error.message}. Usá el historial para recuperarlo.`);
        }
      });
    } catch (error) {
      console.error(error);
      toast.error('Error eliminando producto');
    }
  }
  
  mostrarDeshacer(mensaje, onUndo) {
    if (this.timeoutDeshacer) clearTimeout(this.timeoutDeshacer);
    toast.undo(mensaje, onUndo, 5000);
    this.timeoutDeshacer = setTimeout(() => this.ultimoEliminado = null, 5000);
  }
  
  async escanearCodigo() {
    // abrirScanner ya no propaga el fallo de inicio: deja el modal abierto con
    // el mensaje de error, así que no hace falta catch aquí.
    //
    // El índice de codigoBarras no es único, así que un código puede
    // pertenecer a más de un producto. Con uno solo no hay nada que decidir y se
    // abre directo. Con dos o más, elegir por el usuario cuál es el correcto
    // sería adivinar: antes se abría el primero con un aviso, y el usuario
    // podía estar editando el producto equivocado sin enterarse.
    await abrirScanner(async (codigo, coincidencias) => {
      if (coincidencias.length === 0) {
        toast.success(`Código escaneado: ${codigo}`);
        setTimeout(() => this.nuevoProductoConCodigo(codigo), 300);
        return;
      }

      if (coincidencias.length === 1) {
        this.editarProducto(coincidencias[0].id);
        return;
      }

      const r = await abrirCodigoDuplicado({
        codigo,
        productos: coincidencias,
        origen: 'escaner',
        onAbrir: p => this.editarProducto(p.id),
        onBorrar: p => this.eliminarProducto(p.id)
      });

      if (r.accion === 'abrir') this.editarProducto(r.producto.id);
      // 'crear' y 'resuelto' (el usuario borró todos los conflictos) terminan
      // igual: el código ya no pertenece a nadie y toca dar de alta el producto.
      else if (r.accion === 'crear' || r.accion === 'resuelto') {
        this.nuevoProductoConCodigo(codigo);
      }
    });
  }
  
  nuevoProductoConCodigo(codigo) {
    if (this._productoFormAbierto) return;
    this._productoFormAbierto = true;
    // Se pasa un producto "semilla" con el código escaneado para que el
    // formulario lo pre-cargue. Antes se ignoraba el argumento y el usuario
    // tenía que volver a escribir el código a mano.
    abrirFormularioProducto(
      () => { this.cargarTodo(); this._productoFormAbierto = false; },
      () => { this._productoFormAbierto = false; },
      { codigoBarras: codigo },
      (p) => this._alVerProductoExistente(p),
      (p) => this.eliminarProducto(p.id)
    );
  }
  
  abrirHistorial() {
    if (this._historialAbierto) return;
    this._historialAbierto = true;
    // El 2º callback (onClose) es el que SIEMPRE se ejecuta, al cerrar con ✕,
    // con Escape o con el import. Sin él el flag se quedaba en true para
    // siempre y el botón 🔄 dejaba de abrir el historial.
    abrirHistorial(
      () => { this.cargarTodo(); },
      () => { this._historialAbierto = false; }
    );
  }
  
  abrirPedido() {
    if (this._pedidoAbierto) return;
    this._pedidoAbierto = true;
    abrirPedido(() => {
      this._pedidoAbierto = false;
    });
  }
  
  async abrirModalCategoria(categoriaId = null) {
    if (this._categoriaModalAbierto) return;
    this._categoriaModalAbierto = true;
    
    const cat = categoriaId ? this.categorias.find(c => c.id === categoriaId) : null;
    const esEdicion = !!cat;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content max-w-md">
        <div class="flex items-center justify-between p-4 border-b border-gray-100 bg-primary-50 rounded-t-2xl">
          <h2 class="text-touch-lg font-bold text-gray-900">${esEdicion ? '✏️ Editar' : '➕ Nueva'} Categoría</h2>
          <button id="cerrar-cat-modal" class="btn-ghost p-2">✕</button>
        </div>
        <form id="form-categoria" class="p-4 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Nombre</label>
            <input type="text" id="cat-nombre" class="input-touch text-touch-lg" value="${escAttr(cat?.nombre || '')}" required autocomplete="off" autofocus placeholder="Ej: Verduras">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Color</label>
            <div class="flex flex-wrap gap-2">
              ${COLORES_CATEGORIAS.map(color => `
                <button type="button" class="color-btn w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all ${cat && this.getCategoriaColor(cat) === color ? 'ring-2 ring-primary-500 scale-110' : 'hover:scale-105'}" data-color="${color}" style="background-color: ${color}; border-color: ${color}40;">
                </button>
              `).join('')}
            </div>
            <input type="hidden" id="cat-color" value="${cat ? this.getCategoriaColor(cat) : COLORES_CATEGORIAS[0]}">
          </div>
          <div class="flex gap-3 pt-2 border-t border-gray-100">
            <button type="button" id="btn-cat-cancelar" class="btn-secondary flex-1">${esEdicion ? 'Cancelar' : 'Volver'}</button>
            <button type="submit" class="btn-primary flex-1">${esEdicion ? '💾 Guardar' : '✅ Crear'}</button>
          </div>
        </form>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const cerrar = () => {
      this._categoriaModalAbierto = false;
      modal.remove();
    };
    
    modal.querySelector('#cerrar-cat-modal').addEventListener('click', cerrar);
    modal.querySelector('#btn-cat-cancelar').addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });
    
    modal.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.color-btn').forEach(b => {
          b.className = 'color-btn w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all';
          b.style.borderColor = b.dataset.color + '40';
        });
        btn.className = 'color-btn w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all ring-2 ring-primary-500 scale-110';
        btn.style.borderColor = btn.dataset.color;
        modal.querySelector('#cat-color').value = btn.dataset.color;
      });
    });
    
    modal.querySelector('#form-categoria').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = modal.querySelector('#cat-nombre').value.trim();
      const color = modal.querySelector('#cat-color').value;
      
      if (!nombre) return toast.error('El nombre es obligatorio');
      
      try {
        if (esEdicion) {
          await db.categorias.update(cat.id, { nombre, color });
        } else {
          const id = `cat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await db.categorias.add({ id, nombre, color });
        }
        toast.success(esEdicion ? 'Categoría actualizada' : 'Categoría creada');
        cerrar();
        await this.cargarTodo();
      } catch (error) {
        toast.error('Error guardando categoría');
      }
    });
  }
  
  async eliminarCategoria(categoriaId) {
    const cat = this.categorias.find(c => c.id === categoriaId);
    if (!cat) return;
    
    const count = this.contarProductosCategoria(categoriaId);
    const mensaje = count > 0 
      ? `¿Eliminar "${cat.nombre}"? Tiene ${count} producto(s). Se quedarán sin categoría.`
      : `¿Eliminar "${cat.nombre}"?`;
    
    const confirmado = await this.mostrarConfirmacion(mensaje, 'Eliminar categoría', '⚠️');
    if (!confirmado) return;
    
    try {
      await db.categorias.delete(categoriaId);
      const productosAfectados = this.productos.filter(p => p.categoriaId === categoriaId);
      for (const p of productosAfectados) {
        await db.productos.update(p.id, { categoriaId: null });
      }
      toast.success('Categoría eliminada');
      await this.cargarTodo();
    } catch (error) {
      toast.error('Error eliminando categoría');
    }
  }
  
  /**
   * Diálogo de confirmación con el estilo de la app. Resuelve true si el
   * usuario confirma, false si cancela por cualquier vía.
   *
   * Todo pasa por un único `cerrar()`, que quita el modal, desconecta el
   * listener de Escape y resuelve. Antes había tres salidas independientes y dos
   * bugs:
   *   1. El ✕ y el botón Cancelar usaban un onclick inline que sólo quitaba el
   *      overlay del DOM: la promesa nunca se resolvía y el `await` de quien la
   *      esperaba se quedaba colgado para siempre.
   *   2. El listener de 'keydown' sólo se quitaba dentro de la rama de Escape,
   *      así que confirmar o cancelar dejaba un listener vivo en document por
   *      cada diálogo abierto (crece sin límite).
   */
  mostrarConfirmacion(mensaje, titulo = 'Confirmar', icono = '❓') {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content max-w-md">
          <div class="flex items-center justify-between p-4 border-b border-gray-100 bg-primary-50 rounded-t-2xl">
            <h2 class="text-touch-lg font-bold text-gray-900 flex items-center gap-2">
              <span>${esc(icono)}</span>
              ${esc(titulo)}
            </h2>
            <button class="btn-ghost p-2" data-accion="cancelar" aria-label="Cerrar">✕</button>
          </div>
          <div class="p-4">
            <p class="text-touch text-gray-700 mb-6">${esc(mensaje)}</p>
            <div class="flex gap-3 justify-end">
              <button class="btn-secondary flex-1" data-accion="cancelar">Cancelar</button>
              <button class="btn-danger flex-1" data-accion="aceptar">Eliminar</button>
            </div>
          </div>
        </div>
      `;
      
      let cerrado = false;
      
      const cerrar = (valor) => {
        if (cerrado) return;
        cerrado = true;
        modal.remove();
        document.removeEventListener('keydown', onEscape);
        resolve(valor);
      };
      
      const onEscape = (e) => {
        if (e.key === 'Escape') cerrar(false);
      };
      
      modal.addEventListener('click', (e) => {
        if (e.target === modal) return cerrar(false);  // clic en el fondo
        const accion = e.target.closest('[data-accion]')?.dataset.accion;
        if (accion === 'aceptar') cerrar(true);
        else if (accion === 'cancelar') cerrar(false);
      });
      
      document.addEventListener('keydown', onEscape);
      document.body.appendChild(modal);
    });
  }
  
  // El service worker NO se registra aquí.
  //
  // vite-plugin-pwa (injectRegister: 'auto', el valor por defecto) ya inyecta
  // un <script src="/registerSW.js"> en index.html que hace exactamente esto al
  // evento 'load'. Registrarlo además desde aquí era un duplicado con dos
  // fallos:
  //   1. init() es async (espera a IndexedDB), así que el listener de 'load'
  //      podía registrarse DESPUÉS de que 'load' ya hubiera disparado -> el SW
  //      no se registraba nunca y la app perdía el modo offline.
  //   2. En dev, /sw.js no existe (sólo se genera en build) y el registro
  //      fallaba con un error de MIME type.
  registrarServiceWorker() {
    if (import.meta.env.DEV) {
      console.debug('[SW] Registro gestionado por vite-plugin-pwa (registerSW.js)');
    }
  }
}

const app = new App();
app.init();

export { app };