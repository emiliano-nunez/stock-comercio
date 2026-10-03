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
import { icono } from './utils/iconos.js';

// Clave interna para ordenar los productos sin categoría al final.
// Se usa '\uFFFF' (el último código Unicode) en vez de un texto legible: antes
// se usaba el string 'zzz_sin_categoria' también como etiqueta y se veía
// literalmente en el Catálogo. El escape evita depender de la codificación.
const SIN_CATEGORIA_ORDEN = '\uFFFF';

export class App {

  static LIMITE_RENDER = 60;

  // El color de cada uno es el mismo que usa el badge de la tarjeta, para que

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

  /**
   * Los órdenes, con el ícono de cada uno.
   *
   * Estaban en un `<select>` con emoji. Un svg embebido dentro de un `<option>`
   * no lo dibuja ningún navegador, así que no había forma de poner un ícono de
   * verdad ahí; como el control se lee al revés —el ícono es lo que se ve y el
   * texto casi no se lee— se hizo una lista con el mismo patrón que el selector
   * de tipo de venta.
   */
  static ORDENES = [
    { campo: 'nombre', dir: 'asc', etiqueta: 'Nombre A-Z', icono: 'etiqueta' },
    { campo: 'nombre', dir: 'desc', etiqueta: 'Nombre Z-A', icono: 'etiqueta' },
    { campo: 'stock', dir: 'asc', etiqueta: 'Stock menor', icono: 'medida' },
    { campo: 'stock', dir: 'desc', etiqueta: 'Stock mayor', icono: 'medida' },
    { campo: 'precio', dir: 'asc', etiqueta: 'Precio menor', icono: 'dinero' },
    { campo: 'precio', dir: 'desc', etiqueta: 'Precio mayor', icono: 'dinero' },
    { campo: 'categoria', dir: 'asc', etiqueta: 'Categoría A-Z', icono: 'carpeta' },
    { campo: 'fecha', dir: 'desc', etiqueta: 'Recientes', icono: 'calendario' }
  ];

  constructor() {
    this.productos = [];
    this.productosFiltrados = [];
    this.categorias = [];
    this.busqueda = '';
    this.ordenarPor = 'nombre';
    this.ordenDireccion = 'asc';
    this.vistaActual = 'inventario';

    this.categoriaVista = null;

    // una se suelta la otra, porque "Bebidas sin stock" ya es un grupo entero y
    // meterle una categoría encima lo dejaría vacío casi siempre.
    this.estadoVista = null;

    this.proveedorVista = null;

    this.proveedores = [];
    this.ultimoEliminado = null;
    this.timeoutDeshacer = null;
    this.categoriaEditando = null;
    this._limiteRender = App.LIMITE_RENDER;
  }

  async init() {
    try {
      await inicializarCategorias();

      // La app no borra fotos sola: son dato del usuario. Acá sólo se MIDE lo que

      // tomaron y se canceló sin guardar: esas nunca fueron de ningún producto.
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
      this.vigilarActualizacion();
      this.atenderAtajo();

    } catch (error) {

      // se ve en la consola: el usuario cree que la app no abre.
      console.error('[App] Error en el arranque:', error);
      this.mostrarErrorArranque(error);
    }
  }

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
            <button id="btn-reintentar-carga" class="btn-principal btn-ancho">${icono('refrescar')} Reintentar</button>
            <button id="btn-descargar-emergencia" class="btn-secundario btn-ancho detalle">${icono('descargar')} Descargar copia de mis datos</button>
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
    // si no los blobs se acumulan en memoria en cada recarga de la vista.
    dbUtils.revocarImagenes(this.productos);
    this.productos = await dbUtils.getAllProductosConImagenes();
    this.categorias = await db.categorias.toArray();
    this.proveedores = await dbUtils.listarProveedores();
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

  //

  // primera, y no la primera que eligió el usuario: si mandara esa, dos
  // productos con las mismas dos categorías en distinto orden quedarían
  // separados, y el resultado dependería del orden en que el usuario las fue

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
            <h1 class="titulo fila fila-centro fila-amplia">${icono('caja')}<span>DepoApp</span></h1>
            <button id="btn-historial" class="btn-texto" aria-label="Historial y restaurar">
              ${icono('historial')}<span class="texto-boton">Historial</span>
            </button>
            <button id="btn-pedido" class="btn-texto" aria-label="Pedido de faltantes">
              ${icono('etiqueta')}<span class="texto-boton">Pedido</span>
            </button>

            <!--
              La segunda fila del teléfono: el buscador y, a su derecha, el botón
              de agregar. En el escritorio esta misma fila gira a columna, así que
              el botón queda abajo del buscador y antes de las pestañas.
            -->
            <div class="fila-busca">
            <div class="posicionado con-margen-arriba">
              <label for="buscador" class="solo-lector">Buscar productos</label>
              <input
                type="search"
                id="buscador"
                class="campo buscador-campo"
                placeholder="Buscar producto..."
                value="${escAttr(this.busqueda)}"
              >
              <span class="buscador-lupa">${icono('buscar')}</span>
              <button id="btn-escanear-header" class="buscador-boton" aria-label="Escanear código de barras">
                ${icono('camara')}
              </button>
              <button
                id="btn-ordenar"
                class="buscador-boton buscador-boton-orden"
                aria-label="Ordenar por"
                aria-haspopup="listbox"
                aria-expanded="false"
              >
                ${icono('ordenar')}
              </button>

              <ul id="ordenar-options" class="desplegable desplegable-boton oculto" role="listbox">
                ${App.ORDENES.map(o => `
                  <li
                    class="fila-tocable ${this.ordenarPor === o.campo && this.ordenDireccion === o.dir ? 'opcion-elegida' : ''}"
                    role="option"
                    aria-selected="${this.ordenarPor === o.campo && this.ordenDireccion === o.dir}"
                    data-orden="${o.campo}_${o.dir}"
                  >
                    <span class="fila fila-amplia">
                      <span class="no-crece">${icono(o.icono)}</span>
                      <span>${esc(o.etiqueta)}</span>
                    </span>
                  </li>
                `).join('')}
              </ul>
            </div>

              <!--
                El botón de agregar va en el header y no flotando sobre la grilla.
                Flotando tapaba productos, que es lo único que hay que mirar, y
                además quedaba lejos del buscador, que es donde ya está la mano.
                En el teléfono se ve como un botón cuadrado a la derecha del
                buscador; en el escritorio toma todo el ancho de la barra.
              -->
              <button
                id="btn-agregar-fab"
                class="boton-agregar"
                aria-label="Agregar producto"
              >
                ${icono('mas')}<span class="texto-agregar">Crear Producto</span>
              </button>
            </div>

          <div class="pestanas">
            <button
              id="tab-inventario"
              class="pestana ${this.vistaActual === 'inventario' ? 'pestana-activa' : ''}"
              data-vista="inventario"
            >
              ${icono('caja')}<span>Inventario</span>
            </button>
            <button
              id="tab-catalogo"
              class="pestana ${this.vistaActual === 'catalogo' ? 'pestana-activa' : ''}"
              data-vista="catalogo"
            >
              ${icono('etiqueta')}<span>Catálogo</span>
            </button>
            <button
              id="tab-categorias"
              class="pestana ${this.vistaActual === 'categorias' ? 'pestana-activa' : ''}"
              data-vista="categorias"
            >
              ${icono('carpeta')}<span>Categorías</span>
            </button>
          </div>
        </div>
      </header>

      <main class="contenido" id="contenido-principal">
        ${this.renderTarjetaActualizacionHTML()}
        ${this.renderVistaHTML()}
      </main>
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
            <span class="vacio-icono">${icono('buscar')}</span>
            <p class="detalle medio con-margen-arriba">Sin resultados</p>
            <p class="detalle con-margen-arriba-chica">No se encontró "${esc(this.busqueda)}"</p>
            <button id="btn-limpiar-busqueda" class="btn-principal con-margen-arriba-amplia">Limpiar búsqueda</button>
          </div>
        `;
      }

      return `
        <div class="vacio">
          <span class="vacio-icono-grande">${icono('lapiz')}</span>
          <h2 class="subtitulo con-margen-arriba-amplia">Inventario vacío</h2>
          <p class="detalle apagado con-margen-arriba">Toca "Agregar producto" para empezar</p>
        </div>
        ${this.renderPieVersionHTML()}
      `;
    }

    const visibles = this.productosVisibles();

    //
    // El corte va en md y no en sm a propósito. La tarjeta de inventario lleva

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
   * Sin tope, cada búsqueda, cada cambio de orden y cada recarga de la vista
   * construye 200 tarjetas de cero, y el equipo objetivo tiene 2GB de RAM.
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

  /**
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
    if (this.proveedorVista) {

      // traer el nombre escrito con otra mayúscula y si se comparara literal el
      // grupo saldría vacío sin avisar por qué.
      const clave = normalizarTexto(this.proveedorVista);
      base = base.filter(p => normalizarTexto(p.proveedor || '') === clave);
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

    // mostraría 20 de 200 y haría aparecer "Cargar más" cinco veces seguidas

    const grupos = [...porEstado.values()].filter(g => g.length > 0);
    if (grupos.length === 0) return [];

    // pasa a los demás a propósito: si se pasara, cada "Cargar más" traería una
    // cantidad distinta de cada grupo y el orden de lectura se volvería a romper.
    //

    // app no pasa: _limiteRender siempre es múltiplo de 60 y hay 3 estados.
    const cupo = Math.max(1, Math.floor(this._limiteRender / grupos.length));

    const visibles = [];
    for (const grupo of grupos) {
      visibles.push(...grupo.slice(0, cupo));
    }
    return visibles;
  }

  renderCargarMasHTML(visibles) {

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

    // que está vacío es el grupo: si dijera "Catálogo vacío" el usuario pensaría

    if ((this.categoriaVista || this.estadoVista) && this.productosDeLaVista().length === 0) {
      const cat = this.categoriaVista ? this.categorias.find(c => c.id === this.categoriaVista) : null;
      const nombre = cat
        ? cat.nombre
        : (App.ESTADOS_STOCK.find(e => e.clave === this.estadoVista)?.etiqueta || 'Este grupo');

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
            ${cat ? `<button class="btn-principal con-margen-arriba" id="btn-agregar-en-categoria">${icono('mas')}<span>Agregar producto</span></button>` : ''}
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

    //

    const visibles = this.productosVisibles();
    const porEstado = new Map(App.ESTADOS_STOCK.map(e => [e.clave, []]));
    for (const p of visibles) {
      porEstado.get(estadoStock(p)).push(p);
    }

    if (this.estadoVista || this.proveedorVista) {
      return this.renderFiltroVistaHTML()
        + `<div class="cuadricula">${visibles.map(p => this.renderCatalogoItemHTML(p)).join('')}</div>`
        + this.renderCargarMasHTML(visibles);
    }

    // de render, meter el resto haría que un grupo quedara con la cabecera en

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

  // catálogo filtrado parece el catálogo entero y el usuario no encuentra por

  //

  renderFiltroVistaHTML() {
    if (!this.categoriaVista && !this.estadoVista && !this.proveedorVista) return '';

    const grupos = [];
    if (this.categoriaVista) {
      const cat = this.categorias.find(c => c.id === this.categoriaVista);
      grupos.push({ color: this.getCategoriaColor(cat), nombre: cat?.nombre || 'Categoría' });
    }
    if (this.estadoVista) {
      const est = App.ESTADOS_STOCK.find(e => e.clave === this.estadoVista);
      grupos.push({ color: est?.color, nombre: est?.etiqueta || 'Estado' });
    }
    if (this.proveedorVista) {
      grupos.push({ color: 'var(--gris-400)', nombre: this.proveedorVista });
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

  // de mirar el mismo catálogo, y abrir una suelta la otra para que el usuario
  // nunca quede en un grupo doble que no pidió.
  abrirCategoria(categoriaId) {
    this.categoriaVista = categoriaId;
    this.estadoVista = null;
    this.vistaActual = 'catalogo';
    this._limiteRender = App.LIMITE_RENDER;
    this.render();

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

  // llama es el formulario de categoría, que siempre pasa el objeto.
  getCategoriaColor(categoria) {
    return categoria?.color || COLORES_CATEGORIAS[0];
  }

  // de sobra, y si el usuario tiene más de 20 categorías ya sabrá elegir.
  colorAleatorioCategoria() {
    const usados = new Set(this.categorias.map(c => c.color).filter(Boolean));
    const libres = COLORES_CATEGORIAS.filter(c => !usados.has(c));
    const pool = libres.length > 0 ? libres : COLORES_CATEGORIAS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  renderCatalogoItemHTML(p) {

    //
    // colgando en productos viejos) para que un producto no muestre un punto

    const categorias = categoriasDe(p)
      .map(id => this.categorias.find(c => c.id === id))
      .filter(Boolean);
    const cat = categorias[0];
    // Ver la nota de avisoFotoPerdida en renderProductoHTML: el 📦 de siempre
    // no distingue "nunca tuvo foto" de "se le perdió". En la grilla el aviso
    // va como texto bajo el nombre, porque el espacio de la foto lo ocupa la

    const avisoFotoPerdida = p.fotoPerdida
      ? `<p class="aviso aviso-atencion fila-corta con-margen-abajo-chica">
           <span class="no-crece">${icono('alerta')}</span>
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
        <div class="tarjeta">
          <div class="apilado">
            <div class="bloque-cabecera">
              <h3 class="etiqueta-seccion">${icono('carpeta')}<span>Gestión de Categorías</span></h3>
              <button id="btn-nueva-categoria" class="btn-principal no-crece">
                ${icono('mas')}<span>Nueva categoría</span>
              </button>
            </div>
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
                    ${icono('editar')}
                  </button>
                  <button class="btn-fantasma btn-icono texto-peligro eliminar-categoria" data-id="${escAttr(cat.id)}" aria-label="Eliminar ${escAttr(cat.nombre)}">
                    ${icono('eliminar')}
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        ${this.categorias.length === 0 ? `
          <div class="vacio">
            <span class="vacio-icono">${icono('etiqueta')}</span>
            <p class="detalle medio con-margen-arriba">Sin categorías</p>
            <button id="btn-nueva-categoria-vacia" class="btn-principal con-margen-arriba">${icono('mas')} Crear primera categoría</button>
          </div>
        ` : ''}

        ${this.renderEstadosStockHTML()}
        ${this.renderProveedoresHTML()}
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
          <div class="bloque-cabecera">
            <h3 class="etiqueta-seccion">${icono('medida')}<span>Estado del stock</span></h3>
          </div>
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

  /**
   * Los proveedores, en su propia tarjeta, abajo de las categorías.
   *
   * Es una lista propia y no algo derivado de los productos porque se puede
   * ya está en el inventario, el primero que se creara no se vería en ningún
   * lado hasta que le cargaras un producto.
   *
   * A diferencia de los grupos de estado de stock, acá sí hay botón de editar y
   * de borrar: son nombres que el usuario escribió y puede querer corregirlos.
   */
  renderProveedoresHTML() {
    const conteos = new Map();
    for (const p of this.productos) {
      const clave = normalizarTexto(p.proveedor || '');
      if (!clave) continue;
      conteos.set(clave, (conteos.get(clave) || 0) + 1);
    }

    return `
      <div class="tarjeta">
        <div class="apilado">
          <div class="bloque-cabecera">
            <h3 class="etiqueta-seccion">${icono('proveedor')}<span>Proveedores</span></h3>
            <button id="btn-nuevo-proveedor" class="btn-principal no-crece">
              ${icono('mas')}<span>Nuevo proveedor</span>
            </button>
          </div>

          ${this.proveedores.length === 0 ? `
            <p class="detalle apagado">
              Todavía no hay proveedores. Agregá uno y después asignáselo a los
              productos que le comprás.
            </p>
          ` : this.proveedores.map(prov => {
            const total = conteos.get(normalizarTexto(prov.nombre)) || 0;
            return `
              <div class="recuadro recuadro-suave fila fila-separada">
                <button
                  class="fila-tocable"
                  data-proveedor="${escAttr(prov.id)}"
                  aria-label="Ver en el inventario los ${total} productos de ${escAttr(prov.nombre)}"
                >
                  <span class="columna crece">
                    <span class="medio">${esc(prov.nombre)}</span>
                    <span class="micro apagado">
                      ${total === 0
                        ? 'Sin productos todavía'
                        : `${total} ${total === 1 ? 'producto' : 'productos'} · Ver en el inventario ›`}
                    </span>
                  </span>
                </button>
                <div class="fila no-crece">
                  <button class="btn-fantasma btn-icono texto-marca editar-proveedor"
                    data-id="${escAttr(prov.id)}" aria-label="Renombrar ${escAttr(prov.nombre)}">${icono('editar')}</button>
                  <button class="btn-fantasma btn-icono texto-peligro eliminar-proveedor"
                    data-id="${escAttr(prov.id)}" aria-label="Sacar ${escAttr(prov.nombre)} de la lista">${icono('eliminar')}</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  abrirProveedor(proveedor) {
    this.categoriaVista = null;
    this.estadoVista = null;
    this.proveedorVista = proveedor.nombre;
    this.vistaActual = 'catalogo';
    this._limiteRender = App.LIMITE_RENDER;
    this.render();
    document.getElementById('contenido-principal')?.scrollIntoView({ block: 'start' });
  }

  renderProductoHTML(p) {
    const stockClass = this.getStockClass(p);
    const stock = p.stock || 0;
    const tipo = TIPOS_VENTA.find(t => t.value === p.tipoVenta) || TIPOS_VENTA[0];
    const step = tipo.step;
    // Unidad del STOCK: siempre la base del tipo de venta. No se convierte a la
    // unidad principal porque entre sub-unidades no hay factores de conversión
    // definidos (no se sabe cuántas unidades tiene una caja), y un stock

    const unidad = tipo.unidadBase || 'unid';

    const precio = getPrecioPrincipal(p);
    const stockMinimo = p.stockMinimo || 0;
    const imagenHTML = p.imagenUrl
      ? `<img src="${escAttr(p.imagenUrl)}" loading="lazy" decoding="async" class="foto-llena" alt="${escAttr(p.nombre)}">`
      : `<span class="vacio-icono-pequeno">${p.fotoPerdida ? '🖼️' : '📦'}</span>`;

    // Un producto que nunca tuvo foto no avisa: se vería con el 📦 de siempre y
    // el usuario no distinguiría una cosa de la otra.
    const avisoFotoPerdida = p.fotoPerdida
      ? `<p class="aviso aviso-atencion fila-corta">
           <span class="no-crece">${icono('alerta')}</span>
           <span class="cortado">Falta la foto: no se encuentra en el dispositivo</span>
         </p>`
      : '';

    const stockBadgeClass = stock === 0
      ? 'insignia-sin'
      : stock <= stockMinimo
        ? 'insignia-poco'
        : 'insignia-ok';
    const stockBadgeText = stock === 0 ? 'Agotado' : stock <= stockMinimo ? 'Poco' : 'OK';

    return `
      <article class="tarjeta tarjeta-alta" data-id="${escAttr(p.id)}" data-action="detalle"
        role="button" tabindex="0" aria-label="Ver la hoja de ${escAttr(p.nombre)}">
        <div class="fila fila-arriba fila-amplia crece">
          <div class="miniatura">
            ${imagenHTML}
          </div>
          <div class="crece ancho-cero columna apilado">
            <div class="ancho-cero">
              <h3 class="fuerte cortado">${esc(p.nombre)}</h3>
              <div class="datos-producto">
                ${precio.valor ? `<span class="detalle medio texto-marca">$${fmtPrecio(precio.valor)}/${esc(precio.unidad)}</span>` : '<span class="etiqueta-tenue">Sin precio</span>'}
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
              <button class="btn-fantasma btn-crece btn-icono-solo" data-action="duplicate" data-id="${escAttr(p.id)}" aria-label="Duplicar ${escAttr(p.nombre)}">
                ${icono('duplicar')}
              </button>
              <button class="btn-fantasma btn-crece btn-icono-solo" data-action="edit" data-id="${escAttr(p.id)}" aria-label="Editar ${escAttr(p.nombre)}">
                ${icono('editar')}
              </button>
              <button class="btn-fantasma btn-crece btn-icono-solo texto-peligro" data-action="delete" data-id="${escAttr(p.id)}" aria-label="Eliminar ${escAttr(p.nombre)}">
                ${icono('eliminar')}
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

    const btnOrdenar = document.getElementById('btn-ordenar');
    const listaOrden = document.getElementById('ordenar-options');
    if (btnOrdenar && listaOrden) {
      const cerrarOrden = () => {
        listaOrden.classList.add('oculto');
        btnOrdenar.setAttribute('aria-expanded', 'false');
      };
      btnOrdenar.addEventListener('click', (e) => {
        e.stopPropagation();
        const abierto = btnOrdenar.getAttribute('aria-expanded') === 'true';
        listaOrden.classList.toggle('oculto', abierto);
        btnOrdenar.setAttribute('aria-expanded', String(!abierto));
      });
      listaOrden.addEventListener('click', (e) => {
        const elegida = e.target.closest('[data-orden]');
        if (!elegida) return;
        const [campo, dir] = elegida.dataset.orden.split('_');
        this.ordenarPor = campo;
        this.ordenDireccion = dir;
        cerrarOrden();
        this.aplicarFiltroYOrden();
      });
      document.addEventListener('click', (e) => {
        if (!listaOrden.contains(e.target) && e.target !== btnOrdenar) cerrarOrden();
      });
    }

    document.getElementById('btn-cargar-mas')?.addEventListener('click', () => {
      this._limiteRender += App.LIMITE_RENDER;
      this.renderVista();
    });

    document.querySelectorAll('.pestana').forEach(btn => {
      btn.addEventListener('click', () => {
        this.vistaActual = btn.dataset.vista;

        // catálogo se suelta, para que volver a Inventario muestre el inventario

        this.categoriaVista = null;
        this.estadoVista = null;
        this.proveedorVista = null;
        this._limiteRender = App.LIMITE_RENDER;
        this.render();
      });
    });

    document.getElementById('btn-escanear-header')?.addEventListener('click', () => this.escanearCodigo());
    document.getElementById('btn-historial')?.addEventListener('click', () => this.abrirHistorial());
    document.getElementById('btn-pedido')?.addEventListener('click', () => this.abrirPedido());
    document.getElementById('btn-agregar-fab')?.addEventListener('click', () => this.nuevoProducto());
    document.getElementById('btn-actualizar-ahora')?.addEventListener('click', () => this.aplicarActualizacion());
    document.getElementById('btn-nueva-categoria')?.addEventListener('click', () => this.abrirModalCategoria());
    document.getElementById('btn-nueva-categoria-vacia')?.addEventListener('click', () => this.abrirModalCategoria());
    document.getElementById('btn-nuevo-proveedor')?.addEventListener('click', () => this.abrirModalProveedor());

    document.querySelectorAll('.fila-tocable[data-proveedor]').forEach(btn => {
      const prov = this.proveedores.find(p => p.id === btn.dataset.proveedor);
      if (prov) btn.addEventListener('click', () => this.abrirProveedor(prov));
    });
    document.querySelectorAll('.editar-proveedor').forEach(btn => {
      btn.addEventListener('click', () => this.abrirModalProveedor(btn.dataset.id));
    });
    document.querySelectorAll('.eliminar-proveedor').forEach(btn => {
      btn.addEventListener('click', () => this.eliminarProveedor(btn.dataset.id));
    });

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

    /*
    * Los dos listeners de abajo van por delegación sobre `#contenido-principal`,
    * y por eso se atan UNA sola vez.
    *
    * El resto de bindEvents() ata listeners a elementos que están DENTRO del
    * contenedor y que se recrean en cada render, así que hay que volver a
    * atarlos. Este elemento no: `render()` lo recrea (hace `app.innerHTML = ...`)
    * pero `renderVista()` sólo le cambia el contenido interior, así que el
    * elemento sigue siendo el mismo.
    *
    * Con `_eventsBound` reiniciado en cada render, cada llamada a `renderVista()`
    * —que es lo que hace "Cargar más"— sumaba un listener nuevo sobre el mismo
    * elemento. Un clic en "Eliminar" disparaba el borrado N veces y con él N
    * avisos de "eliminado". Por eso el flag se guarda acá y no en `_eventsBound`:
    * si el elemento es el mismo, los listeners ya están.
    */
    const contenedor = document.getElementById('contenido-principal');
    if (!contenedor || contenedor === this._contenidoConDelegacion) return;
    this._contenidoConDelegacion = contenedor;

    contenedor.addEventListener('click', (e) => {
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

    // role="button" sería una mentira para quien navega con el teclado: tendría

    contenedor.addEventListener('keydown', (e) => {
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

  /**
   * Se escaneó desde el formulario un código que ya existe y el usuario tocó
   * "Ver en el inventario".
   *
   * Busca, no edita. Escaneando mientras se está armando un producto, lo más
   * probable es que el usuario quiera ver si ya lo tiene, no modificarlo: abrir
   * el formulario lo dejaría editando un producto que no pidió tocar y con datos
   * que no son suyos en pantalla.
   *
   * La búsqueda queda puesta con el código, así aparecen todos los que lo
   * comparten. Si el índice no es único, mostrar sólo uno haría creer que es el
   * único.
   */
  _alBuscarCodigo(codigo) {
    this.busqueda = codigo;
    this.vistaActual = 'inventario';
    this.categoriaVista = null;
    this.estadoVista = null;
    this.proveedorVista = null;
    this._limiteRender = App.LIMITE_RENDER;
    this.aplicarFiltroYOrden();
    this.render();
    const campo = document.getElementById('buscador');
    if (campo) campo.value = codigo;
  }

  nuevoProducto(categoriaId = null) {
    if (this._productoFormAbierto) return;
    this._productoFormAbierto = true;
    abrirFormularioProducto(
      () => { this.cargarTodo(); this._productoFormAbierto = false; },
      () => { this._productoFormAbierto = false; },
      // La categoría viaja como producto semilla para que el formulario la traiga

      categoriaId ? { categoriaIds: [categoriaId] } : null,
      (codigo) => this._alBuscarCodigo(codigo),
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
      (codigo) => this._alBuscarCodigo(codigo),
      (p) => this.eliminarProducto(p.id)
    );
  }

  // foto, y el usuario cambia lo que la distingue.
  //
  // No se escribe NADA en la base hasta que el usuario guarda. Podría ser más

  //

  //
  // Lo que NO se copia, a propósito:

  //     escáner y el formulario avisan. Se deja en blanco para que el usuario

  //   - imagenUrl: es un ObjectURL que pertenece al catálogo. Pasarlo haría que

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
      (codigo) => this._alBuscarCodigo(codigo),
      (p) => this.eliminarProducto(p.id)
    );
  }

  async eliminarProducto(id) {
    const producto = this.productos.find(p => p.id === id);
    if (!producto) return;

    try {

      // producto en la misma transacción (si se usara db.productos.delete() no
      // habría punto de restauración y no se podría volver atrás).
      //
      // La foto NO se borra: queda en db.imagenes para que el deshacer y el

      // imagen. La app no borra fotos sola; si el usuario quiere liberar el

      //
      // Se guarda el producto devuelto (con su imagenId) para que el deshacer

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

    // el mensaje de error, así que no hace falta catch aquí.
    //

    // abre directo. Con dos o más, elegir por el usuario cuál es el correcto

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

      else if (r.accion === 'crear' || r.accion === 'resuelto') {
        this.nuevoProductoConCodigo(codigo);
      }
    });
  }

  nuevoProductoConCodigo(codigo) {
    if (this._productoFormAbierto) return;
    this._productoFormAbierto = true;
    // Se pasa un producto "semilla" con el código escaneado para que el

    abrirFormularioProducto(
      () => { this.cargarTodo(); this._productoFormAbierto = false; },
      () => { this._productoFormAbierto = false; },
      { codigoBarras: codigo },
      (codigo) => this._alBuscarCodigo(codigo),
      (p) => this.eliminarProducto(p.id)
    );
  }

  abrirHistorial() {
    if (this._historialAbierto) return;
    this._historialAbierto = true;

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
            <button type="submit" class="btn-principal btn-crece">${esEdicion ? `${icono('verificar')}<span>Guardar</span>` : `${icono('verificar')}<span>Crear</span>`}</button>
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

    const conOtra = productosAfectados.filter(p => categoriasDe(p).length > 1).length;
    const mensaje = count === 0
      ? `¿Eliminar "${cat.nombre}"?`
      : `¿Eliminar "${cat.nombre}"? ${count} producto(s) dejan de estar en ella` +
        (conOtra > 0 ? `. ${conOtra} se quedan con las categorías que ya tenían.` : '.');

    const confirmado = await this.mostrarConfirmacion(mensaje, 'Eliminar categoría', '⚠️');
    if (!confirmado) return;

    try {
      await db.categorias.delete(categoriaId);

      for (const p of productosAfectados) {
        await db.productos.update(p.id, {
          categoriaIds: categoriasDe(p).filter(id => id !== categoriaId)
        });
      }

      if (this.categoriaVista === categoriaId) this.categoriaVista = null;
      toast.success('Categoría eliminada');
      await this.cargarTodo();
    } catch (error) {
      toast.error('Error eliminando categoría');
    }
  }

  /**
   * Alta o renombre de un proveedor.
   *
   * El nombre se normaliza al guardar, no al escribir: el usuario escribe como
   * escribe y la app lo prolija. Lo que evita los duplicados es comparar con el
   * nombre ya guardado en forma normalizada, tanto al agregar como al renombrar.
   */
  async abrirModalProveedor(proveedorId = null) {
    if (this._proveedorModalAbierto) return;
    this._proveedorModalAbierto = true;

    const prov = proveedorId ? this.proveedores.find(p => p.id === proveedorId) : null;
    const esEdicion = !!prov;

    const modal = document.createElement('div');
    modal.className = 'velo';
    modal.innerHTML = `
      <div class="dialogo">
        <div class="dialogo-cabecera">
          <h2 class="titulo">${esEdicion ? `${icono('editar')} Renombrar` : `${icono('mas')} Nuevo`} Proveedor</h2>
          <button id="cerrar-prov-modal" class="btn-fantasma btn-icono" aria-label="Cerrar">✕</button>
        </div>
        <form id="form-proveedor" class="dialogo-cuerpo apilado-3">
          <div>
            <label for="prov-nombre" class="etiqueta">Nombre</label>
            <input
              type="text"
              id="prov-nombre"
              class="campo"
              placeholder="Ej: Distribuidora del Sur"
              value="${escAttr(prov?.nombre || '')}"
              required
              autocomplete="off"
              autofocus
            >
            <p class="micro apagado con-margen-arriba-chica">
              ${esEdicion
                ? 'Si lo cambiás, se actualiza en todos los productos que lo tienen.'
                : 'Se prolija solo. Si ya existe uno con ese nombre, no se agrega otro.'}
            </p>
          </div>
          <div class="fila fila-amplia separador-arriba relleno-superior-2">
            <button type="button" id="btn-prov-cancelar" class="btn-secundario btn-crece">${esEdicion ? 'Cancelar' : 'Volver'}</button>
            <button type="submit" class="btn-principal btn-crece">${esEdicion ? `${icono('verificar')}<span>Guardar</span>` : `${icono('verificar')}<span>Agregar</span>`}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    const cerrar = () => {
      this._proveedorModalAbierto = false;
      modal.remove();
    };

    modal.querySelector('#cerrar-prov-modal').addEventListener('click', cerrar);
    modal.querySelector('#btn-prov-cancelar').addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

    modal.querySelector('#form-proveedor').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = modal.querySelector('#prov-nombre').value;

      if (!nombre.trim()) {
        toast.error('El nombre es obligatorio');
        return;
      }

      try {
        if (esEdicion) {
          await dbUtils.renombrarProveedor(prov.id, nombre);
          toast.success(`Ahora se llama "${nombre.trim()}"`);
        } else {
          const r = await dbUtils.agregarProveedor(nombre);
          toast.success(r.yaExistia
            ? `"${r.nombre}" ya estaba en la lista`
            : `Proveedor "${r.nombre}" agregado`);
        }
        cerrar();
        await this.cargarTodo();
      } catch (error) {
        toast.error(error.message || 'No se pudo guardar el proveedor');
      }
    });
  }

  async eliminarProveedor(proveedorId) {
    const prov = this.proveedores.find(p => p.id === proveedorId);
    if (!prov) return;

    const total = this.productos.filter(
      p => normalizarTexto(p.proveedor || '') === normalizarTexto(prov.nombre)
    ).length;

    const mensaje = total === 0
      ? `¿Sacar "${prov.nombre}" de la lista?`
      : `¿Sacar "${prov.nombre}" de la lista? ${total} producto(s) quedan sin proveedor.`;

    const confirmado = await this.mostrarConfirmacion(mensaje, 'Sacar proveedor', '⚠️');
    if (!confirmado) return;

    try {
      await dbUtils.eliminarProveedor(proveedorId);
      if (this.proveedorVista && normalizarTexto(this.proveedorVista) === normalizarTexto(prov.nombre)) {
        this.proveedorVista = null;
      }
      toast.success(`"${prov.nombre}" salió de la lista`);
      await this.cargarTodo();
    } catch (error) {
      toast.error('No se pudo sacar el proveedor');
    }
  }

  /**
   * Diálogo de confirmación con el estilo de la app. Resuelve true si el
   * usuario confirma, false si cancela por cualquier vía.
   *
   * Todo pasa por un único `cerrar()`, que quita el modal, desconecta el listener
   * de Escape y resuelve. Ninguna otra salida puede existirl: si el ✕ o Cancelar
   * resolveieran por su cuenta, la promesa quedaría esperando, y si el listener
   * de Escape se quitara sólo en su propia rama, cada diálogo dejaría uno vivo en
   * document.
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
        if (e.target === modal) return cerrar(false);
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

      // reabriría el modal, y si el formulario fallara el usuario quedaría con

      history.replaceState(null, '', location.pathname + location.search);

      if (atajo === 'scan') this.escanearCodigo();
      else this.nuevoProducto();
    };

    window.addEventListener('hashchange', ejecutar);
    ejecutar();
  }

  //

  //      no se registraba nunca y la app perdía el modo offline.

  registrarServiceWorker() {
    if (import.meta.env.DEV) {
      console.debug('[SW] Registro gestionado por vite-plugin-pwa (registerSW.js)');
    }
  }

/**
   * Avisa que ya se descargó una versión nueva y que un toque la trae.
   *
   * La app NO queda atrapada en una versión vieja: con `registerType:
   * 'autoUpdate'` el service worker nuevo entra solo. Lo que pasa es otro: la
   * página que está abierta sigue corriendo el código viejo, porque ese código
   * ya se cargó y cambiarlo necesita recargar.
   *
   * `controllerchange` es el aviso de eso, y está disponible desde siempre.
   *
   * El modo `prompt` dejaba esto más lindo pero ataba a la app en un bucle: la
   * tarjeta vive dentro del bundle, así que el usuario con la versión vieja, que
   * es a quien hay que avisarle, no tiene el código que avisa. Nunca la veía, y
   * La versión al pie del inventario es la que dice en qué está cada uno.
   */
  vigilarActualizacion() {
    if (!('serviceWorker' in navigator)) return;

    if (import.meta.env.DEV) return;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      this.hayActualizacion = true;
      this.render();
    });
  }

  aplicarActualizacion() {
    const boton = document.getElementById('btn-actualizar-ahora');
    if (boton) {
      boton.disabled = true;
      boton.textContent = 'Actualizando...';
    }
    location.reload();
  }

  /**
   * La tarjeta de actualización, arriba de todo.
   *
   * Arriba y no escondida porque es lo único que cambia solo en la pantalla sin
   * que el usuario haga nada. Abajo de un desplegable o dentro de un modal se
   * pierde, y perderse es volver a la versión vieja.
   */
  renderTarjetaActualizacionHTML() {
    if (!this.hayActualizacion) return '';
    return `
      <div class="recuadro recuadro-marca apilado">
        <div class="etiqueta-seccion">⬇️ Se descargó una versión nueva</div>
        <p class="detalle">
          Tocá el botón y seguís trabajando con la misma información. Tus
          productos no se pierden: están guardados en este aparato.
        </p>
        <button
          type="button"
          id="btn-actualizar-ahora"
          class="btn-principal btn-ancho con-margen-arriba"
        >Ver la versión nueva</button>
      </div>
    `;
  }
}

const app = new App();
app.init();

export { app };
