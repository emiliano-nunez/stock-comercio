import { db, dbUtils, inicializarCategorias, TIPOS_VENTA, COLORES_CATEGORIAS, estadoStock, unidadStockTexto, pasoUnidadStock, getPrecioPrincipal, categoriasDe, tieneCategoria } from './db.js';
import { abrirFormularioProducto } from './components/ProductoForm.js';
import { abrirCopiaSeguridad } from './components/CopiaSeguridadModal.js';
import { abrirPedido } from './components/PedidoModal.js';
import { abrirScanner } from './components/ScannerModal.js';
import { abrirCodigoDuplicado } from './components/CodigoDuplicado.js';
import { abrirDetalleProducto } from './components/ProductoDetalle.js';
import { abrirAjustes } from './components/AjustesModal.js';
import { toast } from './utils/toast.js';
import { esc, escAttr, fmtPrecio } from './utils/html.js';
import { normalizarTexto, fechaEnDia, fechaYHora } from './utils/texto.js';
import { icono } from './utils/iconos.js';
import { aplicarCampos } from './utils/campos.js';

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

  // // Los tres grupos en que se ordena el catálogo, en el orden en que se
  // // muestran: lo que hay, lo que se está por acabar, y lo que ya se
  // acabó. // El color de cada uno es el mismo que usa el badge de la
  // tarjeta, para que // el grupo y su contenido se vean del mismo color.

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

    // Un solo filtro por vez: combinar dos deja grupos casi vacíos.
    this.filtro = null;

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

      // Los campos apagados se marcan en el body antes de pintar: el
      // formulario y la ficha se enteran por la clase, no por la base.
      await this.refrescarCampos();

      this.render();
      this.bindEvents();
      this.registrarServiceWorker();
      this.vigilarActualizacion();
      this.atenderAtajo();
      this.vigilarErroresGlobales();
      this.pedirEspacioPersistente();
      this.refrescarAlVolver();

      // Sin await y con su propio catch adentro: la encuesta es una pregunta
      // para el usuario y el arranque no espera la respuesta.
      this.encuestaInicial();

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

    await this.cargarProductos();
  }

  /**
   * Trae los productos de la vista actual y pinta la lista.
   *
   * Es el único punto que consulta: todo lo que cambia lo que se ve —pestaña,
   * grupo, búsqueda, orden— pasa por acá. Pide una página por vez para no
   * cargar el inventario entero con sus fotos en un teléfono gama baja.
   *
   * La secuencia desempata dos consultas que se pisen: gana la última.
   */
  async cargarProductos() {
    this._secuenciaConsulta = (this._secuenciaConsulta || 0) + 1;
    const secuencia = this._secuenciaConsulta;

    try {
      const { productos, total } = await dbUtils.consultarProductos({
        limite: this._limiteRender,
        busqueda: this.busqueda,
        categoriaId: this.valorFiltro('categoria'),
        estado: this.valorFiltro('estado'),
        proveedor: normalizarTexto(this.valorFiltro('proveedor') || ''),
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
  // // Clave de ordenación: empuja los productos sin categoría al final. //
  // NO es una etiqueta para mostrar en la UI. El catálogo agrupa por estado
  // de // stock, así que la categoría sólo se muestra en el chip de cada
  // tarjeta, y // las categorías sueltas usan su propio nombre. // // Con
  // varias categorías por producto manda la que alfabéticamente viene //
  // primera, y no la primera que eligió el usuario: si mandara esa, dos //
  // productos con las mismas dos categorías en distinto orden quedarían //
  // separados, y el resultado dependería del orden en que el usuario las
  // fue // marcando.

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
    const unidad = unidadStockTexto(producto, stock);
    // El "Poco" sale de estadoStock() y no de comparar acá otra vez, para que
    // el badge no pueda decir "Poco" mientras el grupo del catálogo dice
    // "Con stock".
    const estado = estadoStock(producto);
    if (estado === 'vacio') return 'Agotado';
    // Corto: el badge va sobre la foto y con "Poco (3 cajas)" se pasaba del
    // cuadro. El número con su unidad ya está en la línea de stock de abajo.
    if (estado === 'poco') return `Poco: ${stock}`;
    return `${stock} ${unidad}`;
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
            <button id="btn-ajustes" class="btn-texto" aria-label="Ajustes de campos">
              ${icono('ajuste')}<span class="texto-boton">Ajustes</span>
            </button>

            <!--
              La segunda fila del teléfono: el buscador y, a su derecha, los dos
              botones de alta —producto detallado y carga rápida—. En el
              escritorio esta misma fila gira a columna, así que los botones
              quedan abajo del buscador y antes de las pestañas.
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
                Los dos botones de alta van en la cabecera y no flotando sobre
                la grilla. Flotando tapaban productos, que es lo único que hay
                que mirar, y además quedaban lejos del buscador, que es donde ya
                está la mano. En el teléfono se ven como dos cuadrados a la
                derecha del buscador; en el escritorio toman todo el ancho de la
                barra.
              -->
              <button
                id="btn-agregar-fab"
                class="boton-agregar"
                aria-label="Producto detallado"
              >
                ${icono('mas')}<span class="texto-agregar">Producto detallado</span>
              </button>

              <button
                id="btn-carga-rapida"
                class="boton-agregar"
                aria-label="Carga rápida"
              >
                ${icono('rayo')}<span class="texto-agregar">Carga rápida</span>
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
    this.bindContenido();
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

  /** Cuántos hay en total en el grupo abierto, para el "cargar más". */
  totalEnVista() {
    return this._totalEnVista ?? this.productosDeLaVista().length;
  }

  valorFiltro(tipo) {
    return this.filtro?.tipo === tipo ? this.filtro.valor : null;
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

    // Con un grupo puesto, lo que está vacío es el grupo: "Catálogo vacío" haría
    // creer que borró todo.
    if (this.filtro && this._totalEnVista === 0) {
      const enCategoria = this.valorFiltro('categoria');
      return `
        <div class="apilado-4">
          ${this.renderFiltroVistaHTML()}
          <div class="vacio">
            <span class="vacio-icono-grande">📭</span>
            <h2 class="subtitulo con-margen-arriba-amplia">Todavía no hay productos</h2>
            <p class="detalle apagado con-margen-arriba">
              Cargá el primero y vas a ver la lista completa acá.
            </p>
            ${enCategoria ? `<button class="btn-principal con-margen-arriba" id="btn-agregar-en-categoria">${icono('mas')}<span>Agregar producto</span></button>` : ''}
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

    // Con un estado o un proveedor abierto el catálogo muestra un solo grupo, así
    // que la cabecera repetiría el aviso de filtro de arriba, con el mismo nombre
    // y el mismo número. Va la grilla sola.
    if (this.valorFiltro('estado') || this.valorFiltro('proveedor')) {
      return this.renderFiltroVistaHTML()
        + `<div class="cuadricula">${visibles.map(p => this.renderCatalogoItemHTML(p)).join('')}</div>`
        + this.renderCargarMasHTML(visibles);
    }

    // // Se agrupan sólo los productos que se van a pintar, no todos. Con
    // el tope // de render, meter el resto haría que un grupo quedara con
    // la cabecera en // "(12)" y cero tarjetas debajo, y el contador
    // miente.

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

  // El aviso de que se está mirando un solo grupo, con la salida. Sin él el
  // catálogo filtrado parece el catálogo entero. Dice cuántos de cuántos se ven:
  // el número solo no alcanza para saber si falta por el filtro o por la búsqueda.

  renderFiltroVistaHTML() {
    if (!this.filtro) return '';

    let nombre = this.filtro.valor;
    let color = 'var(--gris-400)';

    if (this.filtro.tipo === 'categoria') {
      const cat = this.categorias.find(c => c.id === this.filtro.valor);
      nombre = cat?.nombre || 'Categoría';
      color = this.getCategoriaColor(cat);
    } else if (this.filtro.tipo === 'estado') {
      const est = App.ESTADOS_STOCK.find(e => e.clave === this.filtro.valor);
      nombre = est?.etiqueta || 'Estado';
      color = est?.color;
    }

    return `
      <div class="recuadro recuadro-marca fila fila-separada con-margen-abajo-amplia">
        <span class="fila fila-amplia no-crece">
          <span class="fila fila-amplia no-crece">
            <span class="punto-chico" style="background-color: ${escAttr(color)}"></span>
            <span class="medio">${this.productosVisibles().length} de ${this._totalEnVista} en ${esc(nombre)}</span>
          </span>
        </span>
        <span class="detalle apagado no-crece">de ${this._contadores?.total ?? this._totalEnVista} productos</span>
        <button id="btn-ver-catalogo-completo" class="btn-secundario detalle">
          Ver todo
        </button>
      </div>
    `;
  }

  /**
   * Cambia de vista: pinta el marco y trae los productos que le corresponden.
   * `filtro` es null o { tipo, valor } — 'categoria', 'estado' o 'proveedor' —
   * y siempre va por acá, así una vista nueva no puede quedar sin cargar.
   */
  abrirVista(vista, filtro = null) {
    this.vistaActual = vista;
    this.filtro = filtro;
    this._limiteRender = App.LIMITE_RENDER;
    this.render();
    this.cargarProductos();
  }

  abrirCategoria(categoriaId) {
    this.abrirVista('catalogo', { tipo: 'categoria', valor: categoriaId });
    document.getElementById('contenido-principal')?.scrollIntoView({ block: 'start' });
  }

  abrirEstado(estado) {
    this.abrirVista('catalogo', { tipo: 'estado', valor: estado });
    document.getElementById('contenido-principal')?.scrollIntoView({ block: 'start' });
  }

  verCatalogoCompleto() {
    this.abrirVista('catalogo');
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
    // va como texto bajo el nombre, porque el espacio de la foto lo ocupa
    // la // categoría y el precio.

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
            <p class="micro apagado">Stock: ${p.stock || 0} ${esc(unidadStockTexto(p, p.stock || 0))}</p>
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
    // `porEstado` es un objeto plano con las tres claves de `ESTADOS_STOCK`, no un
    // Map: se lee por clave y no con `.get()`.
    const conteos = this._contadores?.porEstado
      || Object.fromEntries(App.ESTADOS_STOCK.map(e => [e.clave, 0]));

    return `
      <div class="tarjeta">
        <div class="apilado">
          <div class="bloque-cabecera">
            <h3 class="etiqueta-seccion">${icono('medida')}<span>Estado del stock</span></h3>
          </div>
          ${App.ESTADOS_STOCK.map(e => {
            const total = conteos[e.clave] || 0;
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
    this.abrirVista('catalogo', { tipo: 'proveedor', valor: proveedor.nombre });
    document.getElementById('contenido-principal')?.scrollIntoView({ block: 'start' });
  }

  renderProductoHTML(p) {
    const stockClass = this.getStockClass(p);
    const stock = p.stock || 0;
    const tipo = TIPOS_VENTA.find(t => t.value === p.tipoVenta) || TIPOS_VENTA[0];
    // La única unidad de esta tarjeta es la del costo, y el costo va siempre
    // en la unidad de la venta: costo y precio tienen que estar en la misma
    // unidad para que cierre la calculadora de margen. El stock ni se muestra
    // en unidad acá (el badge es sólo el número).
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
    const container = document.getElementById('contenido-principal');
    if (container) {
      // Mismo contenido que `<main>` en `render()`, banner incluido. Si no, el
      // aviso de actualización se cae en cada consulta.
      container.innerHTML = this.renderTarjetaActualizacionHTML() + this.renderVistaHTML();
    }
    this.bindContenido();
  }

  /*
   * El encabezado se recrea entero en cada `render()`, y sólo ahí. Atarlo
   * también desde `renderVista()` —que cambia sólo el interior de
   * `#contenido-principal`— le sumaba un listener a cada control en cada
   * consulta, y un clic en una pestaña terminaba navegando dos veces.
   */
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

        /*
         * Escribir desde Categorías salta a Inventario.
         *
         * La vista de categorías pinta categorías y no productos, así que el
         * resultado no tendría dónde aparecer: el buscador siempre busca
         * productos, y ése es el lugar donde se muestran. Se cambia de vista de
         * inmediato y no dentro de la espera, para que la primera tecla ya
         * tenga efecto.
         *
         * render() reconstruye el header entero, así que el input donde se
         * estaba escribiendo desaparece: sin devolverle el foco y poner el
         * cursor al final, la tecla siguiente se perdería en la nada.
         */
        if (valor && this.vistaActual === 'categorias') {
          this.busqueda = valor;
          this._limiteRender = App.LIMITE_RENDER;
          this.abrirVista('inventario');

          const campo = document.getElementById('buscador');
          if (campo) {
            campo.focus();
            campo.setSelectionRange(campo.value.length, campo.value.length);
          }
          return;
        }

        clearTimeout(this._temporizadorBusqueda);
        this._temporizadorBusqueda = setTimeout(() => {
          this.busqueda = valor;
          this._limiteRender = App.LIMITE_RENDER;
          this.cargarProductos();
        }, App.ESPERA_BUSQUEDA);
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
        this.cargarProductos();
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

    document.querySelectorAll('.pestana').forEach(btn => {
      btn.addEventListener('click', () => this.abrirVista(btn.dataset.vista));
    });

    document.getElementById('btn-escanear-header')?.addEventListener('click', () => this.escanearCodigo());
    document.getElementById('btn-copia')?.addEventListener('click', () => this.abrirCopiaSeguridad());
    document.getElementById('btn-pedido')?.addEventListener('click', () => this.abrirPedido());
    document.getElementById('btn-ajustes')?.addEventListener('click', () => this.mostrarAjustes());
    document.getElementById('btn-agregar-fab')?.addEventListener('click', () => this.nuevoProducto());
    document.getElementById('btn-carga-rapida')?.addEventListener('click', () => this.nuevoProducto(null, 'rapida'));
  }

  /*
   * Todo lo que está dentro de `#contenido-principal`: se recrea en cada
   * `render()` y en cada consulta, así que se ata en las dos. Los selectores de
   * fila salen del contenedor y no del documento, porque afuera vive el
   * formulario de producto, que también usa `.fila-tocable` para elegir
   * categoría.
   */
  bindContenido() {
    const contenedor = document.getElementById('contenido-principal');
    if (!contenedor) return;

    const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
    if (btnLimpiar) {
      btnLimpiar.addEventListener('click', () => {
        clearTimeout(this._temporizadorBusqueda);
        this.busqueda = '';
        const campo = document.getElementById('buscador');
        if (campo) campo.value = '';
        this._limiteRender = App.LIMITE_RENDER;
        this.cargarProductos();
      });
    }

    document.getElementById('btn-cargar-mas')?.addEventListener('click', () => {
      this._limiteRender += App.LIMITE_RENDER;
      this.cargarProductos();
    });

    document.getElementById('btn-actualizar-ahora')?.addEventListener('click', () => this.aplicarActualizacion());
    document.getElementById('btn-nueva-categoria')?.addEventListener('click', () => this.abrirModalCategoria());
    document.getElementById('btn-nueva-categoria-vacia')?.addEventListener('click', () => this.abrirModalCategoria());
    document.getElementById('btn-nuevo-proveedor')?.addEventListener('click', () => this.abrirModalProveedor());

    contenedor.querySelectorAll('.fila-tocable[data-proveedor]').forEach(btn => {
      const prov = this.proveedores.find(p => p.id === btn.dataset.proveedor);
      if (prov) btn.addEventListener('click', () => this.abrirProveedor(prov));
    });
    contenedor.querySelectorAll('.editar-proveedor').forEach(btn => {
      btn.addEventListener('click', () => this.abrirModalProveedor(btn.dataset.id));
    });
    contenedor.querySelectorAll('.eliminar-proveedor').forEach(btn => {
      btn.addEventListener('click', () => this.eliminarProveedor(btn.dataset.id));
    });

    contenedor.querySelectorAll('.editar-categoria').forEach(btn => {
      btn.addEventListener('click', () => this.abrirModalCategoria(btn.dataset.id));
    });
    contenedor.querySelectorAll('.eliminar-categoria').forEach(btn => {
      btn.addEventListener('click', () => this.eliminarCategoria(btn.dataset.id));
    });
    contenedor.querySelectorAll('.fila-tocable[data-id]').forEach(btn => {
      btn.addEventListener('click', () => this.abrirCategoria(btn.dataset.id));
    });
    contenedor.querySelectorAll('.fila-tocable[data-estado]').forEach(btn => {
      btn.addEventListener('click', () => this.abrirEstado(btn.dataset.estado));
    });
    document.getElementById('btn-ver-catalogo-completo')?.addEventListener('click', () => this.verCatalogoCompleto());
    document.getElementById('btn-agregar-en-categoria')?.addEventListener('click', () => this.nuevoProducto(this.valorFiltro('categoria')));

    /*
     * Estos dos van por delegación sobre `#contenido-principal`, que
     * `renderVista()` sólo cambia por dentro: el elemento sigue siendo el mismo,
     * así que se atan una sola vez y no se vuelven a sumar en cada consulta.
     */
    if (contenedor === this._contenidoConDelegacion) return;
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

    // Enter y Espacio hacen lo mismo que el clic, para quien navega con teclado.

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

    // El paso lo manda la unidad del stock si el producto tiene una propia
    // ("1 caja por toque"), y si no, la del tipo de venta como siempre.
    const step = pasoUnidadStock(producto.unidadStock, producto.tipoVenta);
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
        toast.warning(`⚠️ ${producto.nombre}: Stock bajo (${nuevoStock} ${unidadStockTexto(producto, nuevoStock)})`);
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
    this.abrirVista('inventario');
  }

  nuevoProducto(categoriaId = null, modo = 'detallado') {
    if (this._productoFormAbierto) return;
    this._productoFormAbierto = true;
    abrirFormularioProducto(
      () => { this.recargarYAvisar(() => { this._productoFormAbierto = false; }); },
      () => { this._productoFormAbierto = false; },
      // La categoría viaja como producto semilla para que el formulario la traiga

      categoriaId ? { categoriaIds: [categoriaId] } : null,
      (codigo) => this._alBuscarCodigo(codigo),
      (p) => this.eliminarProducto(p.id),
      modo
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

      else if (r.accion === 'crear' || r.accion === 'resuelto') {
        this.nuevoProductoConCodigo(codigo);
      }
    });
  }

  nuevoProductoConCodigo(codigo) {
    if (this._productoFormAbierto) return;
    this._productoFormAbierto = true;
    // Se pasa un producto "semilla" con el código escaneado para que el //
    // formulario lo pre-cargue. Antes se ignoraba el argumento y el usuario
    // // tenía que volver a escribir el código a mano.

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
      // Después de importar, la copia puede traer otros campos apagados:
      // refrescar los dos lados, los datos y el body.
      () => { this.recargarYAvisar(); this.refrescarCampos(); },
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

  /**
   * El panel de campos, desde el botón de la cabecera.
   *
   * El panel guarda y refresca él mismo al cerrar: no hay nada que propagar
   * desde acá, sólo pedir que se abra.
   */
  async mostrarAjustes() {
    try {
      await abrirAjustes({ modo: 'ajustes' });
    } catch (error) {
      console.error('[App] No se pudieron abrir los ajustes de campos:', error);
    }
  }

  /**
   * Marca en el body qué campos del formulario están apagados.
   *
   * Si todavía no hay registro, se pinta todo: es el primer arranque, y lo que
   * falta elegir es lo que después pregunta la encuesta.
   */
  async refrescarCampos() {
    try {
      const registro = await dbUtils.leerCamposFormulario();
      aplicarCampos(registro?.apagados || []);
    } catch (error) {
      console.error('[App] No se pudieron leer los campos del formulario:', error);
    }
  }

  /**
   * La encuesta del primer arranque.
   *
   * Sólo se abre si nunca se guardó una selección; después de eso, la única
   * puerta es el botón de ajustes. El método no se espera en `init()`: la app
   * tiene que servir aunque el usuario no responda.
   */
  async encuestaInicial() {
    try {
      const registro = await dbUtils.leerCamposFormulario();
      if (registro) return;
      await abrirAjustes({ modo: 'encuesta' });
    } catch (error) {
      console.error('[App] No se pudo abrir la encuesta de campos:', error);
    }
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
        <!-- La validación la manda la app (el botón avisa qué falta) -->
        <form id="form-categoria" class="dialogo-cuerpo apilado-4" novalidate>
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

    /*
     * El botón Crear se apaga sin nombre, pero sigue tappable: el toque avisa
     * qué falta en vez de pasar sin más (ni la burbuja del navegador, que no
     * dice el nombre del campo).
     */
    const botonGuardar = modal.querySelector('button[type="submit"]');
    const campoNombre = modal.querySelector('#cat-nombre');
    const faltaNombre = () => !campoNombre.value.trim();
    const actualizarBotonGuardar = () => {
      botonGuardar.classList.toggle('btn-apagado', faltaNombre());
      if (faltaNombre()) botonGuardar.setAttribute('aria-disabled', 'true');
      else botonGuardar.removeAttribute('aria-disabled');
    };
    actualizarBotonGuardar();
    campoNombre.addEventListener('input', actualizarBotonGuardar);
    botonGuardar.addEventListener('click', (e) => {
      if (faltaNombre()) {
        e.preventDefault();
        toast.warning('Te faltan campos: Nombre');
      }
    });

    modal.querySelector('#form-categoria').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = modal.querySelector('#cat-nombre').value.trim();
      const color = modal.querySelector('#cat-color').value;

      if (!nombre) return toast.warning('Te faltan campos: Nombre');

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

      if (this.valorFiltro('categoria') === categoriaId) this.filtro = null;
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
        <!-- La validación la manda la app (el botón avisa qué falta) -->
        <form id="form-proveedor" class="dialogo-cuerpo apilado-3" novalidate>
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

    // Mismo tratamiento que en la categoría: botón apagado sin nombre y
    // tappable, con aviso de qué falta.
    const botonGuardarProv = modal.querySelector('button[type="submit"]');
    const campoNombreProv = modal.querySelector('#prov-nombre');
    const faltaNombreProv = () => !campoNombreProv.value.trim();
    const actualizarBotonGuardarProv = () => {
      botonGuardarProv.classList.toggle('btn-apagado', faltaNombreProv());
      if (faltaNombreProv()) botonGuardarProv.setAttribute('aria-disabled', 'true');
      else botonGuardarProv.removeAttribute('aria-disabled');
    };
    actualizarBotonGuardarProv();
    campoNombreProv.addEventListener('input', actualizarBotonGuardarProv);
    botonGuardarProv.addEventListener('click', (e) => {
      if (faltaNombreProv()) {
        e.preventDefault();
        toast.warning('Te faltan campos: Nombre');
      }
    });

    modal.querySelector('#form-proveedor').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = modal.querySelector('#prov-nombre').value;

      if (!nombre.trim()) {
        toast.warning('Te faltan campos: Nombre');
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
      const proveedorFiltrado = this.valorFiltro('proveedor');
      if (proveedorFiltrado && normalizarTexto(proveedorFiltrado) === normalizarTexto(prov.nombre)) {
        this.filtro = null;
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
  /*
   * Nunca dos confirmaciones a la vez.
   *
   * `eliminarCategoria` consulta la base antes de preguntar, y mientras espera
   * el foco sigue en el botón de borrar: un Enter dispara otro clic y abría un
   * segundo diálogo encima del primero.
   */
  mostrarConfirmacion(mensaje, titulo = 'Confirmar', icono = '❓') {
    if (this._confirmacionAbierta) return Promise.resolve(false);
    this._confirmacionAbierta = true;
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
        this._confirmacionAbierta = false;
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
