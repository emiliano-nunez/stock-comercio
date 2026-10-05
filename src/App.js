import { db, dbUtils, inicializarCategorias, TIPOS_VENTA, COLORES_CATEGORIAS, estadoStock, getUnidadBase, getPrecioPrincipal, categoriasDe, tieneCategoria } from './db.js';
import { abrirFormularioProducto } from './components/ProductoForm.js';
import { abrirCopiaSeguridad } from './components/CopiaSeguridadModal.js';
import { abrirPedido } from './components/PedidoModal.js';
import { abrirScanner } from './components/ScannerModal.js';
import { abrirCodigoDuplicado } from './components/CodigoDuplicado.js';
import { abrirDetalleProducto } from './components/ProductoDetalle.js';
import { toast } from './utils/toast.js';
import { esc, escAttr, fmtPrecio } from './utils/html.js';
import { normalizarTexto, fechaEnDia, fechaYHora } from './utils/texto.js';
import { icono } from './utils/iconos.js';

// Clave interna para ordenar los productos sin categoría al final.
// Se usa '\uFFFF' (el último código Unicode) en vez de un texto legible: antes
// se usaba el string 'zzz_sin_categoria' también como etiqueta y se veía
// literalmente en el Catálogo. El escape evita depender de la codificación.
const SIN_CATEGORIA_ORDEN = '\uFFFF';

export class App {

  static LIMITE_RENDER = 60;

  /*
   * Cuánto se espera antes de filtrar, en milisegundos.
   *
   * Es lo que separa "se busca mientras se escribe" de "se traba mientras se
   * escribe". Con 250ms la lista se repinta una vez por palabra, que es lo que
   * el ojo espera de una búsqueda, en vez de una vez por tecla.
   */
  static ESPERA_BUSQUEDA = 250;

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
    this._totalEnVista = 0;
    this._urlsDeImagen = new Map();
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
            `fotos sola. Se pueden liberar desde la copia de seguridad.`
          );
        }
      } catch (error) {
        // Medir no es crítico: si falla, la app sigue igual.
        console.error('[App] No se pudieron medir las fotos sin uso:', error);
      }

      await this.cargarTodo();

      this.render();
      this.bindEvents();
      this.registrarServiceWorker();
      this.vigilarActualizacion();
      this.atenderAtajo();
      this.vigilarErroresGlobales();
      this.pedirEspacioPersistente();
      this.refrescarAlVolver();

    } catch (error) {

      // se ve en la consola: el usuario cree que la app no abre.
      console.error('[App] Error en el arranque:', error);
      this.mostrarErrorArranque(error);
    }
  }

  /*
   * Errores que se escapan de cualquier handler.
   *
   * Sin esto, un error dentro de un listener no deja pantalla en blanco: deja el
   * DOM viejo con el estado nuevo, en silencio, y el error sale como una promesa
   * rechazada que nadie mira. Con esto el error queda anotado y se le dice al
   * usuario, que es lo único que puede hacer con él.
   *
   * Se anotan en una lista de la propia página: es lo único que sobrevive a una
   * recarga, y un error que nadie puede volver a leer no sirve de nada.
   */
  vigilarErroresGlobales() {
    if (this._vigilandoErrores) return;
    this._vigilandoErrores = true;

    const anotar = (que, error) => {
      console.error(`[App] ${que}:`, error);
      try {
        const lista = JSON.parse(localStorage.getItem('depoapp-errores') || '[]');
        lista.unshift({ que, mensaje: String(error?.message || error), fecha: new Date().toISOString() });
        localStorage.setItem('depoapp-errores', JSON.stringify(lista.slice(0, 20)));
      } catch {
        // Si ni el localStorage anda, no hay dónde anotarlo. No se avisa: el
        // error ya está en la consola, que es lo que puede leer el que progresa.
      }
      toast.error('Algo falló. Si la pantalla no responde, recargá la app.');
    };

    window.addEventListener('error', (e) => {
      if (e.error) anotar('Error', e.error);
    });

    window.addEventListener('unhandledrejection', (e) => {
      // Lo de la cuota se avisa mejor y más tarde, en su propio lugar.
      if (e.reason?.name === 'QuotaExceededError') return;
      anotar('Promesa rechazada', e.reason);
    });
  }

  /**
   * Pedir que el navegador no nos barra la base cuando falta espacio.
   *
   * `persist()` es lo que separa "esta base vive acá" de "esta base vive hasta
   * que el navegador decida". Chrome la concede casi siempre; Firefox y Safari la
   * conceden con interacción del usuario, así que el resultado se mira pero no
   * se espera: si no la concede, la app sigue igual y sólo depende más del
   * respaldo.
   */
  pedirEspacioPersistente() {
    if (!navigator.storage?.persist) return;
    navigator.storage.persisted?.()
      .then((ya) => { if (!ya) return navigator.storage.persist(); })      .then(() => navigator.storage.persisted())
      .then((concedido) => {
        if (!concedido) {
          console.info(
            '[App] El navegador no garantiza el almacenamiento. Conviene exportar la copia seguido.'
          );
        }
      })
      .catch(() => { /* no es crítico */ });
  }

  /**
   * Recargar los datos cuando la app vuelve al frente.
   *
   * La misma base la ven todas las pestañas del navegador y la PWA instalada del
   * mismo origen. Si ajustás stock en la computer y seguís en el teléfono, esta
   * pantalla mostraba el número viejo sin decir nada. Al volver, se relee.
   *
   * Se relee la lista y se repinta sólo el contenido, sin tocar la cabecera: así
   * no se pierde lo que el usuario tenía escrito en el buscador ni la posición
   * del scroll.
   */
  refrescarAlVolver() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(this._temporizadorRefresco);
      this._temporizadorRefresco = setTimeout(async () => {
        try {
          await this.cargarTodo();
          this.aplicarFiltroYOrden();
        } catch (error) {
          console.error('[App] No se pudo refrescar al volver:', error);
        }
      }, App.ESPERA_BUSQUEDA);
    });
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

  /**
   * Recargar los datos y avisar si no se pudo.
   *
   * Se llama desde callbacks de diálogos que no esperan nada: si la base falla,
   * sin esto el error se pierde y la pantalla queda mostrando datos viejos sin
   * que nadie lo note.
   *
   * El caso que de verdad importa es la cuota. En un teléfono con muchas fotos el
   * navegador puede quedarse sin espacio, y la escritura falla con un error que
   * no dice nada. El mensaje dice las dos cosas que el usuario puede hacer:
   * exportar la copia y liberar fotos sueltas.
   */
  async recargarYAvisar(alTerminar) {
    try {
      await this.cargarTodo();
      if (alTerminar) alTerminar();
    } catch (error) {
      if (error?.name === 'QuotaExceededError') {
        console.error('[App] No hay espacio para escribir:', error);
        this.mostrarAvisoCuota();
      } else {
        console.error('[App] No se pudo recargar:', error);
        toast.error('No se pudo guardar. Probá de nuevo.');
      }
      if (alTerminar) alTerminar();
    }
  }

  mostrarAvisoCuota() {
    const yaAvisado = this._avisoCuota;
    this._avisoCuota = true;

    if (yaAvisado) {
      toast.error('El dispositivo se quedó sin espacio.');
      return;
    }

    const velo = document.createElement('div');
    velo.className = 'velo';
    velo.innerHTML = `
      <div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="cuota-titulo">
        <div class="dialogo-cabecera dialogo-cabecera-aviso">
          <h2 class="titulo fila" id="cuota-titulo">
            <span>${icono('alerta')}</span> No hay espacio para guardar
          </h2>
        </div>
        <div class="dialogo-cuerpo apilado-3">
          <p class="detalle">
            El último cambio <strong class="fuerte">no se guardó</strong>. El
            teléfono se quedó sin espacio y nada de lo que se estaba haciendo quedó
            escrito.
          </p>
          <div class="nota-info detalle">
            <p class="fuerte con-margen-abajo-chica">Qué podés hacer</p>
            <ul class="lista">
              <li>Exportar la copia de seguridad.</li>
              <li>Liberar las fotos que no están en ningún producto.</li>
              <li>Sacar fotos de los productos que ya no vendas.</li>
            </ul>
          </div>
          <p class="detalle apagado">
            La app nunca borra una foto sola: eso lo decidís vos.
          </p>
        </div>
        <div class="dialogo-pie">
          <button class="btn-secundario btn-crece" data-accion="quitar">Entendido</button>
          <button class="btn-principal btn-crece" data-accion="copia">${icono('descargar')} Ir a la copia</button>
        </div>
      </div>
    `;

    velo.addEventListener('click', (e) => {
      if (e.target === velo || e.target.closest('[data-accion="quitar"]')) {
        velo.remove();
        return;
      }
      const irACopia = e.target.closest('[data-accion="copia"]');
      if (irACopia) {
        velo.remove();
        this.abrirCopiaSeguridad();
      }
    });

    document.body.appendChild(velo);
  }

  /**
   * Cargar lo que la app necesita, menos el inventario.
   *
   * Antes esta función traía **todos** los productos con sus fotos. Ahora trae lo
   * chico: el catálogo de categorías, la lista de proveedores y los contadores de
   * los tres paneles. Los productos los trae la consulta de la vista, de a pages.
   *
   * La diferencia es la que hace que la app abra en un teléfono gama baja: para
   * pintar sesenta tarjetas ya no hace falta tener quinientos productos con sus
   * quinientas fotos en la memoria.
   */
  async cargarTodo() {
    this.categorias = await db.categorias.toArray();
    this.proveedores = await dbUtils.listarProveedores();

    // Los contadores de los tres paneles salen de cuentas sobre índices, y
    // `contarProductos` necesita el catálogo para los ids de categoría.
    dbUtils.fijarCategoriasParaContar(this.categorias);
    this._contadores = await dbUtils.contarProductos();
    this._contadoresPorProveedor = await dbUtils.contarPorProveedor();

    await this.aplicarFiltroYOrden();
  }

  /**
   * Pintar la vista con lo que devuelve la base.
   *
   * Antes esta función era el filtro: tomaba el inventario entero que estaba en
   * memoria, lo ordenaba y dejaba las tarjetas en `productosFiltrados`. Ahora
   * sólo le pide una página a `consultarProductos()` y pinta eso.
   *
   * La diferencia que importa no es de milisegundos, es de memoria: para mostrar
   * sesenta tarjetas la base devuelve sesenta productos, no el inventario entero
   * con las fotos de todos. En un teléfono gama baja, que es para el que está
   * hecha la app, esa es la diferencia entre abrirla y no abrirla.
   *
   * El respaldo contra el desbordamiento es el número de secuencia: si el
   * usuario escribe rápido, dos consultas pueden terminar en orden distinto al
   * que se Teclearon, y gana la última que se pidió.
   */
  async aplicarFiltroYOrden() {
    this._secuenciaConsulta = (this._secuenciaConsulta || 0) + 1;
    const secuencia = this._secuenciaConsulta;

    try {
      const { productos, total } = await dbUtils.consultarProductos({
        limite: this._limiteRender,
        busqueda: this.busqueda,
        categoriaId: this.categoriaVista,
        estado: this.estadoVista,
        proveedor: normalizarTexto(this.proveedorVista || ''),
        ordenarPor: this.ordenarPor,
        ordenDireccion: this.ordenDireccion
      });

      // Una consulta más lenta que la que la reemplazó: si el usuario sigue
      // escribiendo mientras espera, el resultado ya no le sirve.
      if (secuencia !== this._secuenciaConsulta) return;

      this._totalEnVista = total;
      this.productos = await this.conFotosDe(productos);
      this.renderVista();
    } catch (error) {
      console.error('[App] No se pudo consultar la lista:', error);
      toast.error('No se pudo leer la lista de productos');
    }
  }

  /**
   * Ponerle la URL de la foto a los productos de la página, sin repetir trabajo.
   *
   * Las fotos se piden sólo de las que el producto todavía no tiene resuelta, y
   * las URLs que ya se crearon se guardan por id de imagen: si el producto no
   * cambió de foto, la URL sigue siendo la misma y no hay que volver a leer el
   * blob ni crear otra.
   *
   * Antes cada recarga de la vista revocaba todas las URLs y creaba otras
   * tantas, para las mismas fotos: quinientas URLs nuevas por recarga con quinientos
   * productos. Eso es trabajo que no se ve en pantalla, y es de lo que más se queja un
   * teléfono chico.
   *
   * @param {object[]} productos la página que se va a pintar.
   * @returns {Promise<object[]>} los mismos productos, con `imagenUrl` o con
   *   `fotoPerdida`.
   */
  async conFotosDe(productos) {
    const faltan = [...new Set(
      productos.map(p => p.imagenId).filter(Boolean)
    )].filter(idImagen => !this._urlsDeImagen.has(idImagen));

    if (faltan.length) {
      const imagenes = await db.imagenes.where('id').anyOf(faltan).toArray();
      for (const img of imagenes) {
        const fuente = img.thumb || img.blob;
        if (fuente) this._urlsDeImagen.set(img.id, URL.createObjectURL(fuente));
      }
    }

    return productos.map(p => {
      if (!p.imagenId) return p;

      const url = this._urlsDeImagen.get(p.imagenId);
      if (url) return { ...p, imagenUrl: url };

      // El producto apunta a una foto que ya no está en el dispositivo.
      return { ...p, fotoPerdida: true };
    });
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
            <button id="btn-copia" class="btn-texto" aria-label="Copia de seguridad">
              ${icono('descargar')}<span class="texto-boton">Copia</span>
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
    if (this._totalEnVista === 0) {
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
    const fecha = fechaYHora(__FECHA_BUILD__);
    return `<p class="pie-version">${esc(__VERSION__)}${fecha ? ` · ${esc(fecha)}` : ''}</p>`;
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
   * Los productos visibles: son los que ya trajo la consulta.
   *
   * `productosDeLaVista()` ya no filtra nada. Antes armaba el grupo de la
   * categoría, del estado o del proveedor sobre el arreglo entero, y por eso se llamaba cuatro o cinco veces por render para tener lo mismo. Ahora
   * ese filtro lo hace `consultarProductos()` en la base, una sola vez, y lo que
   * llega ya viene filtrado.
   *
   * Lo que queda acá es el reparto del catálogo por estado de stock, que es una
   * cosa de lectura y no de filtro: el catálogo muestra los tres grupos juntos.
   */
  productosDeLaVista() {
    return this.productos || [];
  }

  productosVisibles() {
    const base = this.productosDeLaVista();
    if (this.vistaActual !== 'catalogo') return base;

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

  /** Cuántos hay en total en el grupo abierto, para el "cargar más". */
  totalEnVista() {
    return this._totalEnVista ?? this.productosDeLaVista().length;
  }

  renderCargarMasHTML(visibles) {

    const faltan = this.totalEnVista() - visibles.length;
    if (faltan <= 0) return '';

    return `
      <div class="centro-texto">
        <p class="detalle apagado con-margen-abajo">Mostrando ${visibles.length} de ${this.totalEnVista()}</p>
        <button id="btn-cargar-mas" class="btn-secundario">
          Cargar ${Math.min(faltan, App.LIMITE_RENDER)} más
        </button>
      </div>
    `;
  }

  renderCatalogoHTML() {

    // que está vacío es el grupo: si dijera "Catálogo vacío" el usuario pensaría

    if ((this.categoriaVista || this.estadoVista) && this._totalEnVista === 0) {
      const cat = this.categoriaVista ? this.categorias.find(c => c.id === this.categoriaVista) : null;
      const nombre = cat
        ? cat.nombre
        : (App.ESTADOS_STOCK.find(e => e.clave === this.estadoVista)?.etiqueta || 'Este grupo');

      const hayProductos = this._totalEnVista > 0;
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

    if (this._totalEnVista === 0) {
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
            <span class="punto" style="background-color: ${escAttr(estado.color)}"></span>
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
        <span class="punto-chico" style="background-color: ${escAttr(g.color)}"></span>
        <span class="medio">${esc(g.nombre)}</span>
      </span>
    `).join('');

    const total = this.totalEnVista();
    return `
      <div class="recuadro recuadro-marca fila fila-separada con-margen-abajo-amplia">
        <span class="fila fila-amplia no-crece">${nombres}</span>
        <span class="detalle apagado no-crece">${total} de ${this._totalEnVista}</span>
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

  /*
   * El color de una categoría, y siempre uno de la paleta.
   *
   * El color va al HTML en `style="background-color: ..."` en cinco lugares, y un
   * color que no sea un color rompe el atributo. Por eso esta función es la
   * única puerta: si el valor no está en la paleta, devuelve el primero y no lo
   * deja pasar. Un `||` no alcanza, porque el caso que rompe es un color que sí
   * existe pero no es un color: "rojo" o `red; } body {`.
   */
  getCategoriaColor(categoria) {
    const color = categoria?.color;
    if (typeof color !== 'string') return COLORES_CATEGORIAS[0];
    const limpio = color.trim().toLowerCase();
    return COLORES_CATEGORIAS.find(c => c.toLowerCase() === limpio) || COLORES_CATEGORIAS[0];
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
      ? `<p class="nota-atencion fila-corta con-margen-abajo-chica">
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
        <div class="fila fila-arriba fila-amplia crece">
          <div class="marco-foto catalogo-foto">
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
          <div class="crece ancho-cero columna apilado">
            <h4 class="detalle fuerte cortado">${esc(p.nombre)}</h4>
            ${p.codigoBarras ? `<p class="micro tenue mono cortado">${esc(p.codigoBarras)}</p>` : ''}
            ${avisoFotoPerdida}
            ${p.precios && p.precios.length > 1 ? `
              <div class="fila envuelto fila-corta">
                ${p.precios.map(pr => `
                  <span class="categoria-chip">${esc(pr.icon || '📦')} $${fmtPrecio(pr.valor)}/${esc(pr.unidad)}</span>
                `).join('')}
              </div>
            ` : (p.precio ? `<p class="marca fuerte detalle">$${fmtPrecio(p.precio)}/${esc(unidad)}</p>` : '<p class="micro tenue">Sin precio</p>')}
            <p class="micro apagado">Stock: ${p.stock || 0} ${esc(unidad)}</p>
            ${p.costo ? `<p class="micro apagado">Costo: $${fmtPrecio(p.costo)}/${esc(unidad)}</p>` : ''}
            ${p.fechaCompra ? `<p class="micro tenue">📅 ${new Date(p.fechaCompra).toLocaleDateString('es-ES')}</p>` : ''}
          </div>
        </div>
      </article>
    `;
  }

  renderCategoriasHTML() {
    return `
      <div class="apilado-4 bloques-columna">
        <div class="tarjeta">
          <div class="apilado">
            <div class="bloque-cabecera">
              <h3 class="etiqueta-seccion">${icono('carpeta')}<span>Gestión de Categorías</span></h3>
              <button id="btn-nueva-categoria" class="btn-principal no-crece btn-bloque" aria-label="Nueva categoría">
                ${icono('mas')}<span class="texto-bloque">Nueva categoría</span>
              </button>
            </div>
            ${this.categorias.map(cat => `
              <div class="recuadro recuadro-suave fila fila-separada">
                <button
                  class="fila-tocable"
                  data-id="${escAttr(cat.id)}"
                  aria-label="Ver los productos de ${escAttr(cat.nombre)} en el catálogo"
                >
                  <span class="punto" style="background-color: ${escAttr(this.getCategoriaColor(cat))}"></span>
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
    const conteos = this._contadores?.porEstado
      || Object.fromEntries(App.ESTADOS_STOCK.map(e => [e.clave, 0]));

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
                  aria-label="Ver en el catálogo los ${escAttr(total)} productos con estado ${escAttr(e.etiqueta)}"
                >
                  <span class="punto" style="background-color: ${escAttr(e.color)}"></span>
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

  /**
   * Cuántos productos hay en una categoría.
   *
   * Antes recorría el inventario entero, y como el panel de categorías lo llama
   * dos veces por línea, eso eran cuarenta recorridos completos por cada pantalla
   * que se pintaba. Ahora es un número que la base ya tenía contado.
   */
  contarProductosCategoria(categoriaId) {
    return this._contadores?.porCategoria?.get(categoriaId) ?? 0;
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
    const conteos = this._contadoresPorProveedor || new Map();

    return `
      <div class="tarjeta">
        <div class="apilado">
          <div class="bloque-cabecera">
            <h3 class="etiqueta-seccion">${icono('proveedor')}<span>Proveedores</span></h3>
            <button id="btn-nuevo-proveedor" class="btn-principal no-crece btn-bloque" aria-label="Nuevo proveedor">
              ${icono('mas')}<span class="texto-bloque">Nuevo proveedor</span>
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
                  aria-label="Ver en el inventario los ${escAttr(total)} productos de ${escAttr(prov.nombre)}"
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
      ? `<p class="nota-atencion fila-corta">
           <span class="no-crece">${icono('alerta')}</span>
           <span class="nota-texto">Falta la foto: no se encuentra en el dispositivo</span>
         </p>`
      : '';

    const stockBadgeClass = stock === 0
      ? 'insignia-sin'
      : stock <= stockMinimo
        ? 'insignia-poco'
        : 'insignia-ok';

    return `
      <article class="tarjeta tarjeta-alta" data-id="${escAttr(p.id)}" data-action="detalle"
        role="button" tabindex="0" aria-label="Ver la hoja de ${escAttr(p.nombre)}">
        <div class="stock-foto">
          <div class="miniatura">
            ${imagenHTML}
            <span class="js-stock-badge insignia insignia-pequena insignia-stock esquina-superior-derecha ${stockBadgeClass}">${stock}</span>
          </div>
          ${p.fecha ? `<span class="micro stock-fecha">${esc(fechaEnDia(p.fecha))}</span>` : ''}
        </div>
        <div class="tarjeta-info">
          <h3 class="fuerte cortado">${esc(p.nombre)}</h3>
          <div class="datos-producto">
            ${precio.valor ? `<span class="detalle medio texto-marca">$${fmtPrecio(precio.valor)}/${esc(precio.unidad)}</span>` : '<span class="etiqueta-tenue">Sin precio</span>'}
            ${p.costo ? `<span class="etiqueta-tenue">Costo: $${fmtPrecio(p.costo)}/${esc(unidad)}</span>` : ''}
            <span class="micro apagado">Mín: ${stockMinimo}</span>
            ${p.codigoBarras ? `<span class="micro tenue mono">${esc(p.codigoBarras)}</span>` : ''}
          </div>
          ${avisoFotoPerdida}
        </div>
        <!--
          Las acciones son la tercera pieza de la tarjeta, al lado de la foto y de
          la información, y no una fila aparte abajo: en el teléfono, en un solo
          renglón, se ven la foto, los datos y los dos botones a la vez. En la PC
          esta misma fila pasa abajo y ocupa el ancho entero, como antes.

          El ajuste de stock no está acá. Ocupaba dos filas y sólo hace falta
          mientras se está vendiendo o cargando un pedido; ahora vive en la
          hoja del producto, que es donde uno va a mirarlo para decidir.

          Ojo con los acentos graves en este comentario: vive dentro de la
          plantilla, así que uno acá la cierra y el archivo sigue siendo
          JavaScript válido --el verificador de sintaxis no lo nota-- pero en
          runtime se ejecuta como código.
        -->
        <div class="acciones-tarjeta">
          <!--
            Este botón no se ve en el teléfono: en la hoja del producto está el
            mismo, y acá sólo sobra. La regla que lo esconde se llama
            .duplicar-tarjeta y está en controles.css.
          -->
          <button class="btn-fantasma btn-crece btn-icono-solo duplicar-tarjeta" data-action="duplicate" data-id="${escAttr(p.id)}" aria-label="Duplicar ${escAttr(p.nombre)}">
            ${icono('duplicar')}
          </button>
          <button class="btn-fantasma btn-crece btn-icono-solo" data-action="edit" data-id="${escAttr(p.id)}" aria-label="Editar ${escAttr(p.nombre)}">
            ${icono('editar')}
          </button>
          <button class="btn-fantasma btn-crece btn-icono-solo texto-peligro" data-action="delete" data-id="${escAttr(p.id)}" aria-label="Eliminar ${escAttr(p.nombre)}">
            ${icono('eliminar')}
          </button>
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
      /*
       * La búsqueda no filtra en cada tecla.
       *
       * Antes cada `input` ordenaba el inventario entero y repintaba sesenta
       * tarjetas, así que escribir una palabra de veinte letras hacía veinte
       * ordenamientos y veinte reconstrucciones de la lista. En un teléfono
       * gama baja eso se siente: la pantalla se congela mientras se escribe.
       *
       * Con 250ms de espera la lista se repinta una vez, cuando el usuario deja
       * de escribir. Sigue siendo lo bastante rápido para que se vea en vivo, y
       * el `change` del botón "limpiar" y el del desplegable de orden no pasan
       * por acá, así que no llegan tarde.
       */
      buscador.addEventListener('input', (e) => {
        const valor = e.target.value;
        clearTimeout(this._temporizadorBusqueda);
        this._temporizadorBusqueda = setTimeout(() => {
          this.busqueda = valor;
          this._limiteRender = App.LIMITE_RENDER;
          this.aplicarFiltroYOrden();
        }, App.ESPERA_BUSQUEDA);
      });
    }

    const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
    if (btnLimpiar) {
      btnLimpiar.addEventListener('click', () => {
        clearTimeout(this._temporizadorBusqueda);
        this.busqueda = '';
        if (buscador) buscador.value = '';
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

      /*
       * Este listener va en `document`, que nunca se recrea, así que atarlo en
       * cada render lo acumulaba: como el buscador repinta la vista en cada tecla,
       * escribir una palabra de veinte letras dejaba veinte listeners vivos en
       * `document`, cada uno con referencias a nodos ya desconectados del DOM.
       * Cada clic en cualquier parte disparaba los veinte.
       *
       * Se ata una sola vez, con la misma guarda que usa la delegación del
       * contenido. La lista y el botón se resuelven en el momento del clic, no
       * en el de atar: así el listener sigue sirviendo aunque el header se haya
       * repintado.
       */
      if (!this._ordenCerrarAlClicFuera) {
        this._ordenCerrarAlClicFuera = (e) => {
          const lista = document.getElementById('ordenar-options');
          const boton = document.getElementById('btn-ordenar');
          if (!lista || !boton) return;
          if (!lista.contains(e.target) && e.target !== boton) {
            lista.classList.add('oculto');
            boton.setAttribute('aria-expanded', 'false');
          }
        };
        document.addEventListener('click', this._ordenCerrarAlClicFuera);
      }
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
    document.getElementById('btn-copia')?.addEventListener('click', () => this.abrirCopiaSeguridad());
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
  /**
   * Un producto por id, buscando en la base si no está en la página.
   *
   * `this.productos` es lo que se está pintando, no el inventario. Antes estas
   * acciones lo buscaban sólo ahí, así que un producto que quedaba fuera de la
   * pantalla --porque el usuario filtró, cambió de pestaña o cargó más-- las
   * dejaba sin hacer nada, en silencio y sin error.
   *
   * @param {string} id
   * @returns {Promise<object|null>} el producto con su foto resuelta, o null.
   */
  async productoPorId(id) {
    const enLaPagina = this.productos.find(p => p.id === id);
    if (enLaPagina) return enLaPagina;

    try {
      const guardado = await db.productos.get(id);
      if (!guardado) return null;

      const [conFoto] = await this.conFotosDe([guardado]);
      return conFoto || guardado;
    } catch (error) {
      // No propaga: la llaman cinco acciones que se disparan desde un clic, y si
      // una falla no puede ser una promesa rechazada sin manejar sino una acción
      // que no hace nada sin decir por qué.
      console.error('[App] No se pudo leer el producto:', error);
      toast.error('No se pudo abrir el producto');
      return null;
    }
  }

  async abrirDetalle(id) {
    const producto = await this.productoPorId(id);
    if (!producto) return;
    abrirDetalleProducto({
      producto,
      categorias: this.categorias,
      onEditar: p => this.editarProducto(p.id),
      onAjustar: delta => this.ajustarStock(producto.id, delta),
      onDuplicar: p => this.duplicarProducto(p.id)
    });
  }

  async ajustarStock(id, delta) {

    if (this._ajustandoStock?.[id]) return;
    this._ajustandoStock = this._ajustandoStock || {};
    this._ajustandoStock[id] = true;

    const producto = await this.productoPorId(id);
    if (!producto) { this._ajustandoStock[id] = false; return; }

    const tipo = TIPOS_VENTA.find(t => t.value === producto.tipoVenta) || TIPOS_VENTA[0];
    const step = tipo.step;
    const cambioReal = delta * step;

    try {
      // El valor que vuelve es el que quedó en la base después de la transacción,
      // no el calculado acá. Con dos pestañas abiertas, calcularlo del lado de
      // esta podría mostrar un número que la base nunca tuvo.
      const guardado = await dbUtils.ajustarStock(id, cambioReal);
      if (!guardado) return null;

      const nuevoStock = guardado.stock;
      producto.stock = nuevoStock;
      producto.actualizadoEl = guardado.actualizadoEl;

      // saltaba de posición porque el contenido se reconstruía.
      this.actualizarTarjetaStock(producto);

      if (nuevoStock > 0 && nuevoStock <= (producto.stockMinimo || 0)) {
        toast.warning(`⚠️ ${producto.nombre}: Stock bajo (${nuevoStock} ${this.getUnidadBase(producto.tipoVenta)})`);
      } else if (nuevoStock === 0) {
        toast.error(`❌ ${producto.nombre}: Agotado`);
      }
      return nuevoStock;
    } catch (error) {
      console.error('[App] Error ajustando stock:', error);
      toast.error('No se pudo ajustar el stock');
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
      badge.className = `js-stock-badge insignia insignia-pequena insignia-stock esquina-superior-derecha ${clases}`;
      badge.textContent = `${stock}`;
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
      () => { this.recargarYAvisar(() => { this._productoFormAbierto = false; }); },
      () => { this._productoFormAbierto = false; },
      // La categoría viaja como producto semilla para que el formulario la traiga

      categoriaId ? { categoriaIds: [categoriaId] } : null,
      (codigo) => this._alBuscarCodigo(codigo),
      (p) => this.eliminarProducto(p.id)
    );
  }

  async editarProducto(id) {
    if (this._productoFormAbierto) return;
    const producto = await this.productoPorId(id);
    if (!producto) return;
    this._productoFormAbierto = true;
    abrirFormularioProducto(
      () => { this.recargarYAvisar(() => { this._productoFormAbierto = false; }); },
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

  async duplicarProducto(id) {
    if (this._productoFormAbierto) return;
    const original = await this.productoPorId(id);
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
      () => { this.recargarYAvisar(() => { this._productoFormAbierto = false; }); },
      () => { this._productoFormAbierto = false; },
      datos,
      (codigo) => this._alBuscarCodigo(codigo),
      (p) => this.eliminarProducto(p.id)
    );
  }

  /*
   * Borrar un producto.
   *
   * Antes de borrar se le pregunta al usuario, con el nombre del producto y la
   * foto de por medio. No hay historial ni "deshacer": si se borró, se borró, y lo
   * único que queda es la copia de seguridad que el usuario exportó a mano.
   *
   * La foto NO se borra: queda en la tabla de imágenes sin que nadie la
   * referencie, y aparece en la copia de seguridad para que sea el usuario el que
   * decida liberarla. La app nunca borra fotos sola.
   */
  async eliminarProducto(id, { confirmado = false } = {}) {
    const producto = await this.productoPorId(id);
    if (!producto) return;

    if (!confirmado) {
      const ok = await this.confirmarBorrado({
        titulo: `¿Eliminar "${producto.nombre}"?`,
        mensaje: 'Se borra el producto y queda sin foto. No se puede deshacer. Si todavía no exportaste una copia de seguridad, conviene hacerlo ahora.',
        confirmar: 'Eliminar'
      });
      if (!ok) return;
    }

    try {
      await dbUtils.eliminarProducto(id);

      await this.cargarTodo();

      toast.success(`Producto eliminado: ${producto.nombre}`);
    } catch (error) {
      console.error(error);
      toast.error('Error eliminando producto');
    }
  }

  /**
   * Preguntar antes de algo que no se puede deshacer.
   *
   * Un solo lugar para todos los borrados, para que ninguno se escape de la
   * pregunta: cada uno pasa por acá y el botón dice qué cosa borra.
   *
   * @returns {Promise<boolean>} true si el usuario confirmó.
   */
  confirmarBorrado({ titulo, mensaje, confirmar = 'Eliminar', peligro = true }) {
    return new Promise(resolve => {
      const velo = document.createElement('div');
      velo.className = 'velo';
      velo.innerHTML = `
        <div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="conf-titulo">
          <div class="dialogo-cabecera ${peligro ? 'dialogo-cabecera-peligro' : ''}">
            <h2 class="titulo" id="conf-titulo">${esc(titulo)}</h2>
          </div>
          <div class="dialogo-cuerpo">
            <p class="detalle">${esc(mensaje)}</p>
          </div>
          <div class="dialogo-pie">
            <button class="btn-secundario" data-accion="no">Cancelar</button>
            <button class="${peligro ? 'btn-peligro' : 'btn-principal'}" data-accion="si">${esc(confirmar)}</button>
          </div>
        </div>
      `;

      const cerrar = (respuesta) => {
        velo.remove();
        document.removeEventListener('keydown', alTeclear);
        resolve(respuesta);
      };

      const alTeclear = (e) => {
        if (e.key === 'Escape') cerrar(false);
      };

      velo.addEventListener('click', (e) => {
        if (e.target === velo) return cerrar(false);
        const btn = e.target.closest('[data-accion]');
        if (btn) cerrar(btn.dataset.accion === 'si');
      });

      document.addEventListener('keydown', alTeclear);
      document.body.appendChild(velo);
      velo.querySelector('[data-accion="si"]')?.focus();
    });
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
      () => { this.recargarYAvisar(() => { this._productoFormAbierto = false; }); },
      () => { this._productoFormAbierto = false; },
      { codigoBarras: codigo },
      (codigo) => this._alBuscarCodigo(codigo),
      (p) => this.eliminarProducto(p.id)
    );
  }

  abrirCopiaSeguridad() {
    if (this._copiaAbierta) return;
    this._copiaAbierta = true;

    abrirCopiaSeguridad(
      () => { this.recargarYAvisar(); },
      () => { this._copiaAbierta = false; }
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
            <input type="text" id="cat-nombre" class="campo" value="${escAttr(cat?.nombre || '')}" required autocomplete="off" placeholder="Ej: Verduras">
          </div>
          <div>
            <label class="etiqueta">Color</label>
            <div class="fila envuelto">
              ${COLORES_CATEGORIAS.map(color => `
                <button type="button" class="color-btn muestra-color ${cat && this.getCategoriaColor(cat) === color ? 'muestra-color-elegida' : ''}" data-color="${escAttr(color)}" style="background-color: ${escAttr(color)}; border-color: ${escAttr(color)}40;" aria-label="Color ${escAttr(color)}">
                </button>
              `).join('')}
            </div>
            <input type="hidden" id="cat-color" value="${escAttr(cat ? this.getCategoriaColor(cat) : this.colorAleatorioCategoria())}">
          </div>
          <div class="fila fila-amplia separador-arriba relleno-superior-2">
            <button type="button" id="btn-cat-cancelar" class="btn-secundario btn-crece">${esEdicion ? 'Cancelar' : 'Volver'}</button>
            <button type="submit" class="btn-principal btn-crece">${esEdicion ? `${icono('verificar')}<span>Guardar</span>` : `${icono('verificar')}<span>Crear</span>`}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    modal.querySelector('#cat-nombre').focus();

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
        /*
         * Renombrar una categoría cambia el nombre por el que se ordenan y se
         * buscan los productos que están en ella, así que sus campos derivados
         * también cambian. Sin esto, el producto queda ordenándose por el nombre
         * viejo de su categoría, que es una cosa que el usuario nunca ve y por lo
         * tanto nunca puede corregir.
         */
        if (esEdicion) {
          await db.transaction('rw', [db.categorias, db.productos], async () => {
            await db.categorias.update(cat.id, { nombre, color });
            await dbUtils.recalcularDerivados(
              producto => categoriasDe(producto).includes(cat.id),
              () => ({})
            );
          });
        } else {
          const id = `cat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await db.categorias.add({ id, nombre, color });
        }
        toast.success(esEdicion ? 'Categoría actualizada' : 'Categoría creada');
        cerrar();
        await this.recargarYAvisar();
      } catch (error) {
        toast.error('Error guardando categoría');
      }
    });
  }

  async eliminarCategoria(categoriaId) {
    const cat = this.categorias.find(c => c.id === categoriaId);
    if (!cat) return;

    /*
     * Los productos de la categoría se buscan en la base y no en lo que hay
     * cargado: `this.productos` es la página que se está pintando, no el
     * inventario. Con la lista de la pantalla, borrar una categoría dejaba
     * apuntando a un id que ya no existe a todos los productos que no estaban en
     * la página abierta.
     */
    const productosAfectados = await db.productos.where('categoriaIds').equals(categoriaId).toArray();
    const count = productosAfectados.length;

    const conOtra = productosAfectados.filter(p => categoriasDe(p).length > 1).length;
    const mensaje = count === 0
      ? `¿Eliminar "${cat.nombre}"?`
      : `¿Eliminar "${cat.nombre}"? ${count} producto(s) dejan de estar en ella` +
        (conOtra > 0 ? `. ${conOtra} se quedan con las categorías que ya tenían.` : '.');

    const confirmado = await this.mostrarConfirmacion(mensaje, 'Eliminar categoría', '⚠️');
    if (!confirmado) return;

    try {
      /*
       * Las dos cosas en UNA transacción.
       *
       * Con un `delete` y después un `update` por producto, si el update número
       * siete de veinte falla, la categoría ya estaba borrada y los productos
       * quedaban apuntando a un id que ya no existe: productos que aparecen en
       * todas partes y en ninguna categoría. Con la transacción, o entra todo o
       * no entra nada.
       */
      await db.transaction('rw', [db.categorias, db.productos], async () => {
        await db.categorias.delete(categoriaId);

        for (const p of productosAfectados) {
          const sinLaCategoria = {
            ...p,
            categoriaIds: categoriasDe(p).filter(id => id !== categoriaId)
          };
          Object.assign(sinLaCategoria, dbUtils.camposDerivados(sinLaCategoria, this.categorias));
          await db.productos.put(sinLaCategoria);
        }
      });

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
    modal.querySelector('#prov-nombre').focus();

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

    /*
     * El conteo sale de la base y no de la página: el aviso dice cuántos
     * productos quedan sin proveedor, y si contara sólo los sesenta que están
     * en pantalla diría un número que no es el que hay.
     */
    const total = await dbUtils.contarPorProveedor()
      .then(conteos => conteos.get(normalizarTexto(prov.nombre)) || 0);

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
