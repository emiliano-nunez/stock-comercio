import { db, dbUtils, inicializarCategorias, TIPOS_VENTA, COLORES_CATEGORIAS, estadoStock, getUnidadBase, getPrecioPrincipal, categoriasDe, tieneCategoria } from './db.js';
import { abrirFormularioProducto } from './components/ProductoForm.js';
import { abrirHistorial } from './components/HistorialModal.js';
import { abrirPedido } from './components/PedidoModal.js';
import { abrirScanner } from './components/ScannerModal.js';
import { abrirCodigoDuplicado } from './components/CodigoDuplicado.js';
import { abrirDetalleProducto } from './components/ProductoDetalle.js';
import { toast } from './utils/toast.js';
import { esc, escAttr, fmtPrecio } from './utils/html.js';
import { normalizarTexto } from './utils/texto.js';

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
  /*
   * Los tres estados de stock, con el nombre de la clase y el color.
   *
   * El color está escrito dos veces a propósito: una vez como clase de CSS y una
   * vez como valor, porque va por atributo `style` en el punto de color del
   * catálogo. Si los dos tienen que salir del mismo lugar, cambiar el verde es
   * cambiar un número en tokens.css y otro acá, y se puede olvidar uno.
   */
  static ESTADOS_STOCK = [
    { clave: 'ok', etiqueta: 'Con stock', clase: 'insignia-ok', color: '#22c55e' },
    { clave: 'poco', etiqueta: 'Pocas unidades', clase: 'insignia-poco', color: '#f59e0b' },
    { clave: 'vacio', etiqueta: 'Sin stock', clase: 'insignia-sin', color: '#ef4444' }
  ];

  constructor() {
    this.productos = [];
    this.productosFiltrados = [];
    this.categorias = [];
    this.busqueda = '';
    this.ordenarPor = 'nombre';
    this.ordenDireccion = 'asc';
    this.vistaActual = 'inventario';
    // Categoría abierta en el catálogo. Es null cuando se ve el catálogo entero.
    this.categoriaVista = null;
    // Estado de stock abierto en el catálogo, o null. Es una forma más de mirar
    // el catálogo, igual que la categoría, y no se acumulan entre sí: al abrir
    // una se suelta la otra, porque "Bebidas sin stock" ya es un grupo entero y
    // meterle una categoría encima lo dejaría vacío casi siempre.
    this.estadoVista = null;
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
      this.atenderAtajo();
      
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
      ? `<pre class="bloque-datos">${esc(String(error?.stack || error))}</pre>`
      : '<p class="detalle apagado con-margen-arriba">Si el problema sigue, probá a recargar o a reinstalar la app.</p>';
    
    cont.innerHTML = `
      <div class="vacio-pantalla">
        <div class="centro-texto">
          <span class="vacio-icono">⚠️</span>
          <h1 class="titulo con-margen-arriba-amplia">No se pudo abrir la app</h1>
          <p class="con-medio con-margen-arriba">Tus datos siguen guardados en este dispositivo.</p>
          ${detalle}
          <div class="columna con-margen-arriba-amplia">
            <button id="btn-reintentar-carga" class="btn-principal btn-ancho">🔄 Reintentar</button>
            <button id="btn-descargar-emergencia" class="btn-secundario btn-ancho detalle">📤 Descargar copia de mis datos</button>
          </div>
          <p class="micro tenue con-margen-arriba-amplia">No borres los datos del navegador: puedes perder el inventario.</p>
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

    /*
     * La búsqueda normaliza las dos puntas: lo que escribió el usuario y lo que
     * tiene el producto. Con un toLowerCase() solo, "limon" no encontraba
     * "Limón" y el producto quedaba escondido sin aviso de por qué, que es la
     * peor forma de no encontrar algo: el usuario ve que hay más productos y no
     * los ve.
     *
     * Busca por nombre, código de barras, categoría y proveedor. Los dos
     * últimos no estaban y son lo que uno escribe cuando recuerda de dónde
     * compró algo en vez de cómo se llama.
     */
    const query = normalizarTexto(this.busqueda);
    if (query) {
      resultado = resultado.filter(p => {
        if (normalizarTexto(p.nombre).includes(query)) return true;
        if (p.codigoBarras && normalizarTexto(p.codigoBarras).includes(query)) return true;
        if (p.proveedor && normalizarTexto(p.proveedor).includes(query)) return true;
        return categoriasDe(p).some(id => {
          const cat = this.categorias.find(c => c.id === id);
          return cat && normalizarTexto(cat.nombre).includes(query);
        });
      });
    }

    resultado.sort((a, b) => {
      let valA, valB;

      switch (this.ordenarPor) {
        case 'nombre':
          // Ordenar por texto normalizado y no por el crudo: si no, "Limon"
          // queda antes que "Limón" por el acento y no por la letra, y el
          // orden cambia según cómo se escribió cada nombre.
          valA = normalizarTexto(a.nombre);
          valB = normalizarTexto(b.nombre);
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
          valA = normalizarTexto(this.getCategoriaOrden(a));
          valB = normalizarTexto(this.getCategoriaOrden(b));
          break;
        case 'fecha':
          valA = new Date(a.actualizadoEl || 0).getTime();
          valB = new Date(b.actualizadoEl || 0).getTime();
          break;
        default:
          valA = normalizarTexto(a.nombre);
          valB = normalizarTexto(b.nombre);
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
  //
  // Con varias categorías por producto manda la que alfabéticamente viene
  // primera, y no la primera que eligió el usuario: si mandara esa, dos
  // productos con las mismas dos categorías en distinto orden quedarían
  // separados, y el resultado dependería del orden en que el usuario las fue
  // marcando.
  getCategoriaOrden(producto) {
    const nombres = categoriasDe(producto)
      .map(id => this.categorias.find(c => c.id === id)?.nombre)
      .filter(Boolean);
    if (nombres.length === 0) return SIN_CATEGORIA_ORDEN;
    return nombres.sort((a, b) => a.localeCompare(b))[0];
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
      <div class="app">
        <header class="cabecera">
          <div class="cabecera-cuerpo">
            <div class="fila fila-separada">
              <h1 class="titulo">📦 Stock Comercio</h1>
              <div class="fila fila-corta">
                <button id="btn-historial" class="btn-texto" aria-label="Historial y restaurar">
                  <span aria-hidden="true">🔄</span><span class="texto-boton">Historial</span>
                </button>
                <button id="btn-pedido" class="btn-texto" aria-label="Pedido de faltantes">
                  <span aria-hidden="true">📋</span><span class="texto-boton">Pedido</span>
                </button>
              </div>
            </div>
            
            <div class="posicionado con-margen-arriba">
              <label for="buscador" class="solo-lector">Buscar productos</label>
              <input 
                type="search" 
                id="buscador" 
                class="campo buscador-campo" 
                placeholder="Buscar por nombre o código..."
                value="${escAttr(this.busqueda)}"
              >
              <span class="buscador-lupa">🔍</span>
              <button id="btn-escanear-header" class="buscador-boton" aria-label="Escanear código de barras">
                📷
              </button>
            </div>
            
            <div class="con-margen-arriba">
              <select id="ordenar-select" class="campo selector" aria-label="Ordenar por">
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
          
          <div class="pestanas">
            <button 
              id="tab-inventario" 
              class="pestana ${this.vistaActual === 'inventario' ? 'pestana-activa' : ''}"
              data-vista="inventario"
            >
              📦 Inventario
            </button>
            <button 
              id="tab-catalogo" 
              class="pestana ${this.vistaActual === 'catalogo' ? 'pestana-activa' : ''}"
              data-vista="catalogo"
            >
              📚 Catálogo
            </button>
            <button 
              id="tab-categorias" 
              class="pestana ${this.vistaActual === 'categorias' ? 'pestana-activa' : ''}"
              data-vista="categorias"
            >
              🏷️ Categorías
            </button>
          </div>
        </header>
        
        <main class="contenido" id="contenido-principal">
          ${this.renderVistaHTML()}
        </main>
        
        <button 
          id="btn-agregar-fab" 
          class="boton-flotante"
          aria-label="Agregar producto"
          style="width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center;"
        >
          <span class="grande" style="line-height: 1;">➕</span>
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
          <div class="vacio">
            <span class="vacio-icono">🔍</span>
            <p class="detalle medio con-margen-arriba">Sin resultados</p>
            <p class="detalle con-margen-arriba-chica">No se encontró "${esc(this.busqueda)}"</p>
            <button id="btn-limpiar-busqueda" class="btn-principal con-margen-arriba-amplia">Limpiar búsqueda</button>
          </div>
        `;
      }
      
      return `
        <div class="vacio">
          <span class="vacio-icono-grande">📦</span>
          <h2 class="subtitulo con-margen-arriba-amplia">Inventario vacío</h2>
          <p class="detalle apagado con-margen-arriba">Toca "Agregar producto" para empezar</p>
        </div>
        ${this.renderPieVersionHTML()}
      `;
    }
    
    const visibles = this.productosVisibles();
    // Grilla, con una columna en el teléfono y dos a partir de 768px de ancho de
    // PANTALLA, que es cuando la columna de la app ya llegó a su tope de 48rem.
    //
    // El corte va en md y no en sm a propósito. La tarjeta de inventario lleva
    // tres filas de controles (ajuste rápido, duplicar/editar/eliminar) y con la
    // miniatura al costado necesita unos 254px de contenido: a 640px de pantalla
    // dos columnas darían 305px de tarjeta, unos 190px de contenido, y el botón
    // de eliminar se caería de la fila. Con md, la columna ya mide 768px y cada
    // tarjeta 370px, que es lo que la tarjeta esperaba.
    return `
      <div class="rejilla-inventario">
        ${visibles.map(p => this.renderProductoHTML(p)).join('')}
      </div>
    ` + this.renderCargarMasHTML(visibles) + this.renderPieVersionHTML();
  }

  /**
   * El número de versión al pie del inventario.
   *
   * Va sólo en inventario y no en las otras dos pestañas a propósito: el
   * inventario es la que uno abre siempre, y es la que se revisa comparando la
   * app del host contra la publicada. Ponerlo en catálogo y categorías lo
   * repetiría tres veces sin agregar nada.
   *
   * El número viene de package.json, inyectado al compilar. Acá sólo se pinta,
   * para que no haya un número escrito a mano que se pueda desactualizar.
   */
  renderPieVersionHTML() {
    return `<p class="pie-version">${esc(__VERSION__)}</p>`;
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
  /*
   * Los productos que le tocan a la vista actual.
   *
   * Abrir una categoría es mirar el catálogo de esa categoría, no una búsqueda:
   * por eso el filtro vive acá y no en aplicarFiltroYOrden(), que alimenta las
   * tres vistas. Si viviera allí, cambiar de pestaña llevaría el filtro puesto y
   * el inventario mostraría un solo grupo de productos sin avisar.
   */
  productosDeLaVista() {
    if (this.vistaActual !== 'catalogo') return this.productosFiltrados;
    let base = this.productosFiltrados;
    if (this.categoriaVista) {
      base = base.filter(p => tieneCategoria(p, this.categoriaVista));
    }
    if (this.estadoVista) {
      base = base.filter(p => estadoStock(p) === this.estadoVista);
    }
    return base;
  }

  productosVisibles() {
    const base = this.productosDeLaVista();
    if (this.vistaActual !== 'catalogo') {
      return base.slice(0, this._limiteRender);
    }

    const porEstado = new Map(App.ESTADOS_STOCK.map(e => [e.clave, []]));
    for (const p of base) {
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
    const faltan = this.productosDeLaVista().length - visibles.length;
    if (faltan <= 0) return '';

    return `
      <div class="centro-texto">
        <p class="detalle apagado con-margen-abajo">Mostrando ${visibles.length} de ${this.productosDeLaVista().length}</p>
        <button id="btn-cargar-mas" class="btn-secundario">
          Cargar ${Math.min(faltan, App.LIMITE_RENDER)} más
        </button>
      </div>
    `;
  }
  
  renderCatalogoHTML() {
    // Con un grupo abierto y sin productos, el mensaje tiene que decir que lo
    // que está vacío es el grupo: si dijera "Catálogo vacío" el usuario pensaría
    // que perdió el inventario.
    if ((this.categoriaVista || this.estadoVista) && this.productosDeLaVista().length === 0) {
      const cat = this.categoriaVista ? this.categorias.find(c => c.id === this.categoriaVista) : null;
      const nombre = cat
        ? cat.nombre
        : (App.ESTADOS_STOCK.find(e => e.clave === this.estadoVista)?.etiqueta || 'Este grupo');
      // Con productos cargados el grupo es el que está vacío; sin ellos no hay
      // nada que vaciarse, y el ícono de bandeja vacía mentiría.
      const hayProductos = this.productosFiltrados.length > 0;
      return `
        <div class="apilado-4">
          ${this.renderFiltroVistaHTML()}
          <div class="vacio">
            <span class="vacio-icono-grande">${hayProductos ? '🗂️' : '📭'}</span>
            <h2 class="subtitulo con-margen-arriba-amplia">
              ${hayProductos ? `Nada en ${esc(nombre)}` : 'Todavía no hay productos'}
            </h2>
            <p class="detalle apagado con-margen-arriba">
              ${hayProductos
                ? 'Ningún producto cae en este grupo. Los otros sí tienen.'
                : 'Cargá el primero y vas a ver la lista completa acá.'}
            </p>
            ${cat ? '<button class="btn-principal con-margen-arriba" id="btn-agregar-en-categoria">➕ Agregar producto</button>' : ''}
          </div>
        </div>
      `;
    }

    if (this.productosFiltrados.length === 0) {
      return `
        <div class="vacio">
          <span class="vacio-icono-grande">📚</span>
          <h2 class="subtitulo con-margen-arriba-amplia">Catálogo vacío</h2>
          <p class="detalle apagado con-margen-arriba">No hay productos para mostrar</p>
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
    
    // Con un estado abierto el catálogo muestra un solo grupo, así que la
    // cabecera repetiría el aviso de filtro de arriba, con el mismo nombre y el
    // mismo número. Va la grilla sola.
    if (this.estadoVista) {
      return this.renderFiltroVistaHTML()
        + `<div class="cuadricula">${visibles.map(p => this.renderCatalogoItemHTML(p)).join('')}</div>`
        + this.renderCargarMasHTML(visibles);
    }

    // Se agrupan sólo los productos que se van a pintar, no todos. Con el tope
    // de render, meter el resto haría que un grupo quedara con la cabecera en
    // "(12)" y cero tarjetas debajo, y el contador miente.
    return this.renderFiltroVistaHTML() + App.ESTADOS_STOCK
      .filter(estado => porEstado.get(estado.clave).length > 0)
      .map(estado => {
        const productos = porEstado.get(estado.clave);
        return `
        <section class="con-margen-abajo-amplia">
          <h3 class="titulo-seccion">
            <span class="punto" style="background-color: ${estado.color}"></span>
            ${esc(estado.etiqueta)} (${productos.length})
          </h3>
          <div class="cuadricula con-margen-arriba">
            ${productos.map(p => this.renderCatalogoItemHTML(p)).join('')}
          </div>
        </section>
      `;
      }).join('') + this.renderCargarMasHTML(visibles);
  }

  // El aviso de que se está mirando un solo grupo, con la salida. Sin él el
  // catálogo filtrado parece el catálogo entero y el usuario no encuentra por
  // qué le faltan productos.
  //
  // Dice cuántos de cuántos se están viendo. El número solo no alcanza: con el
  // catálogo entero tampoco se sabría si lo que falta es el filtro o la búsqueda.
  renderFiltroVistaHTML() {
    if (!this.categoriaVista && !this.estadoVista) return '';
    
    const grupos = [];
    if (this.categoriaVista) {
      const cat = this.categorias.find(c => c.id === this.categoriaVista);
      grupos.push({ color: this.getCategoriaColor(cat), nombre: cat?.nombre || 'Categoría' });
    }
    if (this.estadoVista) {
      const est = App.ESTADOS_STOCK.find(e => e.clave === this.estadoVista);
      grupos.push({ color: est?.color, nombre: est?.etiqueta || 'Estado' });
    }
    
    const nombres = grupos.map(g => `
      <span class="fila fila-amplia no-crece">
        <span class="punto-chico" style="background-color: ${g.color}"></span>
        <span class="medio">${esc(g.nombre)}</span>
      </span>
    `).join('');
    
    const total = this.productosDeLaVista().length;
    return `
      <div class="recuadro recuadro-marca fila fila-separada con-margen-abajo-amplia">
        <span class="fila fila-amplia no-crece">${nombres}</span>
        <span class="detalle apagado no-crece">${total} de ${this.productosFiltrados.length}</span>
        <button id="btn-ver-catalogo-completo" class="btn-secundario detalle">
          Ver todo
        </button>
      </div>
    `;
  }

  // Abrir un grupo en el catálogo. Categoría o estado de stock: son dos formas
  // de mirar el mismo catálogo, y abrir una suelta la otra para que el usuario
  // nunca quede en un grupo doble que no pidió.
  abrirCategoria(categoriaId) {
    this.categoriaVista = categoriaId;
    this.estadoVista = null;
    this.vistaActual = 'catalogo';
    this._limiteRender = App.LIMITE_RENDER;
    this.render();
    // El catálogo arranca arriba, que es donde está el nombre del grupo.
    document.getElementById('contenido-principal')?.scrollIntoView({ block: 'start' });
  }
  
  abrirEstado(estado) {
    this.categoriaVista = null;
    this.estadoVista = estado;
    this.vistaActual = 'catalogo';
    this._limiteRender = App.LIMITE_RENDER;
    this.render();
    document.getElementById('contenido-principal')?.scrollIntoView({ block: 'start' });
  }

  verCatalogoCompleto() {
    this.categoriaVista = null;
    this.estadoVista = null;
    this._limiteRender = App.LIMITE_RENDER;
    this.render();
  }
  
  // La rama que aceptaba un string y sacaba un color por hash del nombre quedó
  // sin uso cuando el catálogo dejó de agrupar por categoría: el único que
  // llama es el formulario de categoría, que siempre pasa el objeto.
  getCategoriaColor(categoria) {
    return categoria?.color || COLORES_CATEGORIAS[0];
  }
  
  // Elige un color al azar entre los que NO estén en uso.
  // Si todos están en uso, elige uno al azar del total: 20 colores dan margen
  // de sobra, y si el usuario tiene más de 20 categorías ya sabrá elegir.
  colorAleatorioCategoria() {
    const usados = new Set(this.categorias.map(c => c.color).filter(Boolean));
    const libres = COLORES_CATEGORIAS.filter(c => !usados.has(c));
    const pool = libres.length > 0 ? libres : COLORES_CATEGORIAS;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  
  renderCatalogoItemHTML(p) {
    // Con varias categorías por producto, el marco de la foto no tiene lugar
    // para todas: muestra la primera y, si sobran, cuántas son. La lista
    // completa está en la hoja de detalle del producto y en el formulario.
    //
    // Se filtran las que ya no existen (una categoría borrada deja el id
    // colgando en productos viejos) para que un producto no muestre un punto
    // sin nombre.
    const categorias = categoriasDe(p)
      .map(id => this.categorias.find(c => c.id === id))
      .filter(Boolean);
    const cat = categorias[0];
    // Ver la nota de avisoFotoPerdida en renderProductoHTML: el 📦 de siempre
    // no distingue "nunca tuvo foto" de "se le perdió". En la grilla el aviso
    // va como texto bajo el nombre, porque el espacio de la foto lo ocupa la
    // categoría y el precio.
    const avisoFotoPerdida = p.fotoPerdida
      ? `<p class="aviso aviso-atencion fila-corta con-margen-abajo-chica">
           <span class="no-crece">⚠️</span>
           <span>Falta la foto</span>
         </p>`
      : '';
    const imagenHTML = p.imagenUrl 
      ? `<img src="${escAttr(p.imagenUrl)}" loading="lazy" decoding="async" class="foto-llena" alt="${escAttr(p.nombre)}">`
      : `<span class="vacio-icono-pequeno">${p.fotoPerdida ? '🖼️' : '📦'}</span>`;
    const tipo = TIPOS_VENTA.find(t => t.value === p.tipoVenta) || TIPOS_VENTA[0];
    const unidad = tipo.unidadBase || 'unid';
    
    return `
      <article class="tarjeta" data-id="${escAttr(p.id)}" data-action="detalle" role="button" tabindex="0"
        aria-label="Ver la hoja de ${escAttr(p.nombre)}">
        <div class="marco-foto marco-foto-centrado">
          ${imagenHTML}
          <div class="esquina-superior-derecha insignia insignia-pequena ${this.getStockClass(p)}">
            ${this.getStockLabel(p)}
          </div>
          ${cat ? `
            <div class="marca-foto">
              <span class="punto-mini" style="background-color: ${escAttr(cat.color || '#64748B')}"></span>
              <span class="micro con-medio cortado ancho-etiqueta">${esc(cat.nombre)}</span>
              ${categorias.length > 1 ? `<span class="micro tenue">+${categorias.length - 1}</span>` : ''}
            </div>
          ` : ''}
        </div>
        <h4 class="detalle fuerte cortado con-margen-abajo-chica">${esc(p.nombre)}</h4>
        ${p.codigoBarras ? `<p class="micro tenue mono cortado con-margen-abajo-chica">${esc(p.codigoBarras)}</p>` : ''}
        ${avisoFotoPerdida}
        ${p.precios && p.precios.length > 1 ? `
          <div class="fila envuelto fila-corta con-margen-abajo-chica">
            ${p.precios.map(pr => `
              <span class="categoria-chip">${esc(pr.icon || '📦')} $${fmtPrecio(pr.valor)}/${esc(pr.unidad)}</span>
            `).join('')}
          </div>
        ` : (p.precio ? `<p class="marca fuerte detalle">$${fmtPrecio(p.precio)}/${esc(unidad)}</p>` : '<p class="micro tenue">Sin precio</p>')}
        <p class="micro apagado">Stock: ${p.stock || 0} ${esc(unidad)}</p>
        ${p.costo ? `<p class="micro apagado">Costo: $${fmtPrecio(p.costo)}/${esc(unidad)}</p>` : ''}
        ${p.fechaCompra ? `<p class="micro tenue">📅 ${new Date(p.fechaCompra).toLocaleDateString('es-ES')}</p>` : ''}
      </article>
    `;
  }
  
  renderCategoriasHTML() {
    return `
      <div class="apilado-4">
        <div class="fila fila-separada">
          <h2 class="titulo">🏷️ Gestión de Categorías</h2>
          <button id="btn-nueva-categoria" class="btn-principal detalle">
            ➕ Nueva categoría
          </button>
        </div>
        
        <div class="tarjeta">
          <div class="apilado">
            ${this.categorias.map(cat => `
              <div class="recuadro recuadro-suave fila fila-separada">
                <button
                  class="fila-tocable"
                  data-id="${escAttr(cat.id)}"
                  aria-label="Ver los productos de ${escAttr(cat.nombre)} en el catálogo"
                >
                  <span class="punto" style="background-color: ${this.getCategoriaColor(cat)}"></span>
                  <span class="columna crece">
                    <span class="medio">${esc(cat.nombre)}</span>
                    <span class="micro apagado">
                      ${this.contarProductosCategoria(cat.id)} ${this.contarProductosCategoria(cat.id) === 1 ? 'producto' : 'productos'}
                      · Ver en el catálogo ›
                    </span>
                  </span>
                </button>
                <div class="fila no-crece">
                  <button class="btn-fantasma btn-icono texto-marca editar-categoria" data-id="${escAttr(cat.id)}" aria-label="Editar ${escAttr(cat.nombre)}">
                    ✏️
                  </button>
                  <button class="btn-fantasma btn-icono texto-peligro eliminar-categoria" data-id="${escAttr(cat.id)}" aria-label="Eliminar ${escAttr(cat.nombre)}">
                    🗑️
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        
        ${this.categorias.length === 0 ? `
          <div class="vacio">
            <span class="vacio-icono">📂</span>
            <p class="detalle medio con-margen-arriba">Sin categorías</p>
            <button id="btn-nueva-categoria-vacia" class="btn-principal con-margen-arriba">➕ Crear primera categoría</button>
          </div>
        ` : ''}
        
        ${this.renderEstadosStockHTML()}
      </div>
    `;
  }
  
  /**
   * Los tres grupos de estado de stock, junto a las categorías.
   *
   * Salen de los productos que ya están cargados y no se guardan en ningún lado:
   * el estado de un producto sale de comparar su stock con su mínimo, así que un
   * grupo guardado se desactualiza en el momento en que se toca el stock. Por
   * eso no hay botón de editar ni de borrar: no hay nada que editar, y si lo
   * hubiera el botón mentiría.
   *
   * Los tres se muestran siempre, incluso con cero productos. Un grupo que sólo
   * aparece cuando tiene algo es un grupo que el usuario no sabe que existe
   * hasta que ya lo necesita.
   */
  renderEstadosStockHTML() {
    const conteos = new Map(App.ESTADOS_STOCK.map(e => [e.clave, 0]));
    for (const p of this.productos) {
      const clave = estadoStock(p);
      conteos.set(clave, (conteos.get(clave) || 0) + 1);
    }
    
    return `
      <div class="tarjeta">
        <div class="apilado">
          <h3 class="etiqueta-seccion con-margen-abajo">📊 Estado del stock</h3>
          ${App.ESTADOS_STOCK.map(e => {
            const total = conteos.get(e.clave) || 0;
            return `
              <div class="recuadro recuadro-suave fila fila-separada">
                <button
                  class="fila-tocable"
                  data-estado="${escAttr(e.clave)}"
                  aria-label="Ver en el catálogo los ${total} productos con estado ${escAttr(e.etiqueta)}"
                >
                  <span class="punto" style="background-color: ${e.color}"></span>
                  <span class="columna crece">
                    <span class="medio">${esc(e.etiqueta)}</span>
                    <span class="micro apagado">
                      ${total} ${total === 1 ? 'producto' : 'productos'}
                      · Ver en el catálogo ›
                    </span>
                  </span>
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }
  
  contarProductosCategoria(categoriaId) {
    return this.productos.filter(p => tieneCategoria(p, categoriaId)).length;
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
      ? `<img src="${escAttr(p.imagenUrl)}" loading="lazy" decoding="async" class="foto-llena" alt="${escAttr(p.nombre)}">`
      : `<span class="vacio-icono-pequeno">${p.fotoPerdida ? '🖼️' : '📦'}</span>`;
    
    // Aviso de foto perdida. Sale SÓLO cuando el producto apunta a una foto que
    // no está en la base (p.fotoPerdida, que marca getAllProductosConImagenes).
    // Un producto que nunca tuvo foto no avisa: se vería con el 📦 de siempre y
    // el usuario no distinguiría una cosa de la otra.
    const avisoFotoPerdida = p.fotoPerdida
      ? `<p class="aviso aviso-atencion fila-corta">
           <span class="no-crece">⚠️</span>
           <span class="cortado">Falta la foto: no se encuentra en el dispositivo</span>
         </p>`
      : '';
    
    // Colores para badge de stock.
    // Las clases js-stock-* son los ganchos que usa actualizarTarjetaStock()
    // para refrescar la tarjeta en el sitio al cambiar el stock, sin
    // re-renderizar el catálogo entero.
    // El nombre de la clase, no el color. Los tres estados tienen su clase en
    // superficies.css y el color vive en tokens.css: acá no se escribe un color.
    const stockBadgeClass = stock === 0
      ? 'insignia-sin'
      : stock <= stockMinimo
        ? 'insignia-poco'
        : 'insignia-ok';
    const stockBadgeText = stock === 0 ? 'Agotado' : stock <= stockMinimo ? 'Poco' : 'OK';
    
    return `
      <article class="tarjeta tarjeta-alta" data-id="${escAttr(p.id)}" data-action="detalle"
        role="button" tabindex="0" aria-label="Ver la hoja de ${escAttr(p.nombre)}">
        <div class="fila fila-arriba fila-amplia crece relleno-3">
          <div class="miniatura">
            ${imagenHTML}
          </div>
          <div class="crece ancho-cero columna apilado">
            <div class="ancho-cero">
              <h3 class="fuerte cortado">${esc(p.nombre)}</h3>
              <div class="fila con-margen-arriba-chica envuelto">
                ${precio.valor ? `<span class="detalle medio texto-marca">$${fmtPrecio(precio.valor)}/${esc(precio.unidad)}</span>` : ''}
                ${p.costo ? `<span class="etiqueta-tenue">Costo: $${fmtPrecio(p.costo)}/${esc(unidad)}</span>` : ''}
                <span class="js-stock-badge insignia ${stockBadgeClass}">
                  ${stockBadgeText}: ${stock}
                </span>
                <span class="micro apagado">Mín: ${stockMinimo}</span>
                ${p.codigoBarras ? `<span class="micro tenue mono">${esc(p.codigoBarras)}</span>` : ''}
              </div>
              ${avisoFotoPerdida}
            </div>
            <!--
              Las acciones van en su propia fila y no arriba en la esquina: con
              iconos de 52px, varias en la fila del título se comen el ancho que
              queda al lado de la miniatura y el nombre queda ilegible.

              El ajuste de stock no está acá. Ocupaba dos filas y sólo hace falta
              mientras se está vendiendo o cargando un pedido; ahora vive en la
              hoja del producto, que es donde uno va a mirarlo para decidir.

              mt-auto las baja al pie de la tarjeta. En dos columnas las tarjetas
              no miden lo mismo (una con el aviso de foto perdida es más alta), y
              sin esto los botones de cada columna quedan a distinta altura y la
              grilla se ve despareja.
            -->
            <div class="fila fila-corta con-margen-arriba-auto separador-arriba relleno-superior-1">
              <button class="btn-fantasma btn-crece btn-chico" data-action="duplicate" data-id="${escAttr(p.id)}" aria-label="Duplicar ${escAttr(p.nombre)}">
                <span aria-hidden="true">📋</span><span>Duplicar</span>
              </button>
              <button class="btn-fantasma btn-crece btn-chico" data-action="edit" data-id="${escAttr(p.id)}" aria-label="Editar ${escAttr(p.nombre)}">
                <span aria-hidden="true">✏️</span><span>Editar</span>
              </button>
              <button class="btn-fantasma btn-crece btn-chico texto-peligro" data-action="delete" data-id="${escAttr(p.id)}" aria-label="Eliminar ${escAttr(p.nombre)}">
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
    
    document.querySelectorAll('.pestana').forEach(btn => {
      btn.addEventListener('click', () => {
        this.vistaActual = btn.dataset.vista;
        // El grupo abierto es una forma de mirar el catálogo. Al salirse del
        // catálogo se suelta, para que volver a Inventario muestre el inventario
        // entero y no el último grupo que se miró.
        this.categoriaVista = null;
        this.estadoVista = null;
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
    document.querySelectorAll('.fila-tocable[data-id]').forEach(btn => {
      btn.addEventListener('click', () => this.abrirCategoria(btn.dataset.id));
    });
    document.querySelectorAll('.fila-tocable[data-estado]').forEach(btn => {
      btn.addEventListener('click', () => this.abrirEstado(btn.dataset.estado));
    });
    document.getElementById('btn-ver-catalogo-completo')?.addEventListener('click', () => this.verCatalogoCompleto());
    document.getElementById('btn-agregar-en-categoria')?.addEventListener('click', () => this.nuevoProducto(this.categoriaVista));
    
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
        case 'detalle':
          this.abrirDetalle(id);
          break;
      }
    }, { passive: true });

    // Las tarjetas se pueden tocar y también enfocar. Sin esto, el atributo
    // role="button" sería una mentira para quien navega con el teclado: tendría
    // el foco puesto en la tarjeta y el Enter no abriría nada.
    document.getElementById('contenido-principal')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault();
      btn.click();
    });
  }
  
  /**
   * La hoja del producto: tocar la tarjeta la abre, sin pasar por Editar.
   *
   * El botón "detalle" no está en el HTML: lo busca `e.target.closest()` en
   * cualquier parte del contenedor, así que alcanza con que la tarjeta lo traiga
   * en un atributo y no hace falta envolverla en otro elemento que se coma el
   * clic de los botones de adentro.
   */
  abrirDetalle(id) {
    const producto = this.productos.find(p => p.id === id);
    if (!producto) return;
    abrirDetalleProducto({
      producto,
      categorias: this.categorias,
      onEditar: p => this.editarProducto(p.id),
      onAjustar: delta => this.ajustarStock(producto.id, delta)
    });
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
      return producto.stock;
    } catch (error) {
      toast.error('Error ajustando stock');
      return null;
    } finally {
      this._ajustandoStock[id] = false;
    }
  }
  
  /**
   * Reflejar en el DOM el nuevo stock de un producto, sin volver a pintar todo.
   *
   * Sólo se actualiza la insignia de estado. El número grande que había acá
   * murió con el ajuste de stock de la tarjeta: ahora los botones viven en la
   * hoja del producto y son los de esa hoja los que se refrescan.
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
    
    // Insignia de estado. Se reescribe entera con className, así que la clase
    // de estado va primero y el gancho de JavaScript va con ella: sin el
    // "js-stock-badge" el próximo ajuste no encontraría la insignia.
    const badge = card.querySelector('.js-stock-badge');
    if (badge) {
      const clases = stock === 0
        ? 'insignia-sin'
        : stock <= stockMinimo
          ? 'insignia-poco'
          : 'insignia-ok';
      badge.className = `js-stock-badge insignia ${clases}`;
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
  
  nuevoProducto(categoriaId = null) {
    if (this._productoFormAbierto) return;
    this._productoFormAbierto = true;
    abrirFormularioProducto(
      () => { this.cargarTodo(); this._productoFormAbierto = false; },
      () => { this._productoFormAbierto = false; },
      // La categoría viaja como producto semilla para que el formulario la traiga
      // elegida. Agregar desde una categoría vacía es agregar dentro de ella, y no
      // dejar el producto en "Sin categoría" al otro lado de la app.
      categoriaId ? { categoriaIds: [categoriaId] } : null,
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
    modal.className = 'velo';
    modal.innerHTML = `
      <div class="dialogo">
        <div class="dialogo-cabecera">
          <h2 class="titulo">${esEdicion ? '✏️ Editar' : '➕ Nueva'} Categoría</h2>
          <button id="cerrar-cat-modal" class="btn-fantasma btn-icono">✕</button>
        </div>
        <form id="form-categoria" class="dialogo-cuerpo apilado-4">
          <div>
            <label class="etiqueta">Nombre</label>
            <input type="text" id="cat-nombre" class="campo" value="${escAttr(cat?.nombre || '')}" required autocomplete="off" autofocus placeholder="Ej: Verduras">
          </div>
          <div>
            <label class="etiqueta">Color</label>
            <div class="fila envuelto">
              ${COLORES_CATEGORIAS.map(color => `
                <button type="button" class="color-btn muestra-color ${cat && this.getCategoriaColor(cat) === color ? 'muestra-color-elegida' : ''}" data-color="${color}" style="background-color: ${color}; border-color: ${color}40;" aria-label="Color ${color}">
                </button>
              `).join('')}
            </div>
            <input type="hidden" id="cat-color" value="${cat ? this.getCategoriaColor(cat) : this.colorAleatorioCategoria()}">
          </div>
          <div class="fila fila-amplia separador-arriba relleno-superior-2">
            <button type="button" id="btn-cat-cancelar" class="btn-secundario btn-crece">${esEdicion ? 'Cancelar' : 'Volver'}</button>
            <button type="submit" class="btn-principal btn-crece">${esEdicion ? '💾 Guardar' : '✅ Crear'}</button>
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
        // Se quita la marca de elegida a todas y se pone sólo a la que se tocó.
        // El gancho "color-btn" se conserva: sin él el siguiente clic no
        // encontraría los botones.
        modal.querySelectorAll('.color-btn').forEach(b => {
          b.className = 'color-btn muestra-color';
          b.style.borderColor = b.dataset.color + '40';
        });
        btn.className = 'color-btn muestra-color muestra-color-elegida';
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
    const productosAfectados = this.productos.filter(p => tieneCategoria(p, categoriaId));
    // Cuántos de esos siguen en alguna categoría después de quitar ésta.
    // El aviso decía "se quedarán sin categoría" para todos, y con productos en
    // varias categorías eso es falso: la mayoría se queda con las suyas.
    const conOtra = productosAfectados.filter(p => categoriasDe(p).length > 1).length;
    const mensaje = count === 0
      ? `¿Eliminar "${cat.nombre}"?`
      : `¿Eliminar "${cat.nombre}"? ${count} producto(s) dejan de estar en ella` +
        (conOtra > 0 ? `. ${conOtra} se quedan con las categorías que ya tenían.` : '.');

    const confirmado = await this.mostrarConfirmacion(mensaje, 'Eliminar categoría', '⚠️');
    if (!confirmado) return;

    try {
      await db.categorias.delete(categoriaId);
      // Se saca la categoría de la lista de cada producto en vez de dejarla en
      // null: el producto puede estar en varias, y vaciarle la lista entera
      // borraría de un plumazo las otras que sí existen.
      for (const p of productosAfectados) {
        await db.productos.update(p.id, {
          categoriaIds: categoriasDe(p).filter(id => id !== categoriaId)
        });
      }
      // Si se estaba mirando esa categoría en el catálogo, el filtro queda
      // apuntando a un id que ya no existe y la vista se vacía sin explicación.
      if (this.categoriaVista === categoriaId) this.categoriaVista = null;
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
      modal.className = 'velo';
      modal.innerHTML = `
        <div class="dialogo">
          <div class="dialogo-cabecera">
            <h2 class="titulo fila">
              <span>${esc(icono)}</span>
              ${esc(titulo)}
            </h2>
            <button class="btn-fantasma btn-icono" data-accion="cancelar" aria-label="Cerrar">✕</button>
          </div>
          <div class="relleno-4">
            <p class="subtitulo con-margen-abajo-amplia">${esc(mensaje)}</p>
            <div class="fila fila-amplia al-final">
              <button class="btn-secundario btn-crece" data-accion="cancelar">Cancelar</button>
              <button class="btn-peligro btn-crece" data-accion="aceptar">Eliminar</button>
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
  
  /**
   * Accesos directos de la PWA instalada: "#scan" y "#add".
   *
   * El manifest los declaraba, pero no había nada en la app que leyera el hash.
   * Tocarlos desde la pantalla de inicio abría la app y no pasaba nada. Sólo se
   * notaba una vez instalada la PWA, que es justo lo que pasa al publicarla.
   *
   * Se atiende en los dos momentos en que puede llegar:
   *   1. Al arrancar, si la app estaba cerrada y el acceso directo la abrió.
   *   2. Con 'hashchange', si la app ya estaba abierta. Tocar el ícono con la
   *      app corriendo cambia el hash de la misma pestaña.
   *
   * El hash se borra después de atenderlo. Sin eso, tocar dos veces seguidas el
   * mismo acceso directo no vuelve a disparar nada, porque la dirección no
   * cambia y 'hashchange' no se dispara. Es lo que hace que el atajo sea
   * repetible en vez de andar de a una.
   */
  atenderAtajo() {
    const ejecutar = () => {
      const atajo = (location.hash || '').replace(/^#/, '');
      if (!atajo) return;
      if (atajo !== 'scan' && atajo !== 'add') return;

      // Se borra antes de actuar, no después: si abrir el escáner o el
      // formulario fallara, el hash ya está limpio y el usuario no queda con una
      // dirección que al recargar le reabra un modal encima.
      history.replaceState(null, '', location.pathname + location.search);

      if (atajo === 'scan') this.escanearCodigo();
      else this.nuevoProducto();
    };

    window.addEventListener('hashchange', ejecutar);
    ejecutar();
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