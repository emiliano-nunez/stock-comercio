import { db, dbUtils, TIPOS_VENTA, UNIDADES_STOCK, pasoUnidadStock, categoriasDe, normalizarProveedor } from '../db.js';
import { imagenUtils } from '../utils/imagen.js';
import { abrirCamara } from './CamaraModal.js';
import { abrirScanner } from './ScannerModal.js';
import { abrirCodigoDuplicado } from './CodigoDuplicado.js';
import { toast } from '../utils/toast.js';
import { esc, escAttr } from '../utils/html.js';
import { normalizarTexto } from '../utils/texto.js';
import { icono } from '../utils/iconos.js';

export class ProductoForm {
  constructor(onSave, onClose, producto = null, onBuscarCodigo = null, onBorrarProducto = null, modo = 'detallado') {
    this.onSave = onSave;
    this.onClose = onClose;
    this.producto = producto;

    this.onBuscarCodigo = onBuscarCodigo;
    // Se invoca cuando el usuario borra un producto en conflicto desde el
    // // diálogo de código repetido. Pasa por la app y no por dbUtils
    // directo para // que el borrado deje punto de restauración, ofrezca
    // deshacer y recargue la // vista: si el formulario borrara por su
    // cuenta, la app se quedaría con la // lista vieja y el producto
    // volvería a aparecer al cancelar el formulario.

    this.onBorrarProducto = onBorrarProducto;

    // 'rapida' muestra sólo foto, nombre y precio final; 'detallado' es la
    // ficha completa. Son los mismos campos: el modo sólo decide cuáles se ven.
    this.modo = modo;

    this.isEditing = !!producto?.id;
    this.imagenId = producto?.imagenId || null;

    // formulario es un cuadrado de ~320px, así que con la miniatura se vería

    this.imagenUrl = producto?.imagenUrl || null;

    this._imagenUrlPropia = false;
    this.modal = null;
    this.tipoVenta = producto?.tipoVenta || 'unidad';

    // Se calcula aquí para que crearModal() y bindEvents() compartan el valor.
    this.camaraDisponible = window.isSecureContext
      || location.hostname === 'localhost'
      || location.hostname === '127.0.0.1';

    this._outsideClick = new AbortController();
    // Ids de imágenes creadas durante esta sesión del formulario. Si el usuario
    // cancela en vez de guardar, quedan huérfanas en db.imagenes para
    // siempre // (no hay ningún producto que las referencie), así que se
    // borran en cerrar().

    this._imagenesNuevas = new Set();
    this._guardado = false;
  }

  async abrir() {

    // // Cada apertura es una sesión nueva del formulario. Sin este reset,
    // el // _guardado del primer guardado exitoso quedaba en true para
    // siempre y // limpiarImagenesSinGuardar() salía con su early return en
    // TODAS las // cancelaciones siguientes: las fotos capturadas y luego
    // descartadas se // acumulaban como blobs huérfanos. El constructor
    // sólo corre una vez, // porque App.js mantiene una sola instancia del
    // formulario.

    // porque App.js mantiene una sola instancia del formulario.
    this._imagenesNuevas.clear();
    this._guardado = false;

    await this.cargarImagenCompleta();

    await this.cargarCategorias();
    await this.cargarProveedores();
    this.modal = this.crearModal();
    document.body.appendChild(this.modal);

    await new Promise(r => requestAnimationFrame(r));
    this.modal.querySelector('#nombre').focus();

    this.handleKeydown = (e) => {
      if (e.key === 'Escape') this.cerrar();
    };
    document.addEventListener('keydown', this.handleKeydown);
  }

  /**
   * De carga rápida a la ficha completa, con lo escrito hasta acá.
   *
   * No se reabre el formulario: son los mismos campos con las secciones
   * apagadas, así el nombre, la foto y el precio quedan donde estaban y sólo
   * hay que levantar la clase que los escondía.
   */
  pasarADetallado() {
    this.modo = 'detallado';
    const form = this.modal.querySelector('#form-producto');
    form.classList.remove('rapido');
    form.scrollTop = 0;
    const precios = form.querySelector('#precios-container');
    const botonPrecio = form.querySelector('#btn-agregar-precio');
    if (precios && botonPrecio) form.insertBefore(precios, botonPrecio);
    const encabezado = this.modal.querySelector('.dialogo-cabecera h2');
    if (encabezado) encabezado.innerHTML = `${icono('mas')}<span>Nuevo Producto</span>`;
  }

  /**
   * De la ficha completa a una carga rápida en blanco.
   *
   * Se cierra y se abre otra vez, y lo escrito en la ficha se descarta entero:
   * es lo que evita arrastrar datos parciales a un alta que sólo pide tres
   * cosas.
   */
  async pasarARapida() {
    await this.cerrar();
    await abrirFormularioProducto(
      this.onSave,
      this.onClose,
      null,
      this.onBuscarCodigo,
      this.onBorrarProducto,
      'rapida'
    );
  }

  async cargarCategorias() {
    this.categorias = await db.categorias.toArray();
    // No categorías por defecto - solo las que el usuario creó
  }

  /**
   * Los proveedores que ya usa el inventario, para el buscador del campo.
   *
   * Se leen de la base y no de la app porque el formulario ya carga solo las
   * categorías: no hace falta pasar nada por parámetro para que sepa qué hay.
   *
   * Se agrupan por clave normalizada, así que "Lácteos del Sur" y "lácteos del
   * sur" salen como una sola sugerencia, y se muestra la forma con mayúscula
   * que alguien escribió. Un proveedor que nadie usa no aparece: la lista no
   * crece con lo que el usuario pruebe.
   */
  async cargarProveedores() {
    const productos = await db.productos.toArray();
    const vistos = new Map();
    for (const p of productos) {
      const nombre = (p.proveedor || '').trim();
      if (!nombre) continue;
      const clave = normalizarTexto(nombre);
      if (!vistos.has(clave)) vistos.set(clave, nombre);
    }
    this.proveedores = [...vistos.values()].sort((a, b) =>
      normalizarTexto(a).localeCompare(normalizarTexto(b), 'es')
    );
  }

  /**
   * El buscador de proveedores: escribir y que salga lo que ya se usó.
   *
   * El campo sigue siendo un input de texto común, no un select. Escribir un
   * proveedor nuevo tiene que ser igual de fácil que elegir uno viejo: si el
   * campo obligara a elegir de la lista, no se podría dar de alta al primero.
   *
   * Por eso la lista aparece con lo que hay escrito, no desde el principio.
   * Con el campo vacío no se muestra nada: son veinte nombres y ninguno es el
   * que el usuario quiere todavía. Recién con dos letras hay algo que filtrar.
   *
   * El filtro no se parece en mayúsculas ni en tildes, igual que la búsqueda
   * principal. Si el usuario busca "sur" tiene que salir "Distribuidora del Sur".
   */
  bindProveedor(modal) {
    const campo = modal.querySelector('#proveedor');
    const lista = modal.querySelector('#proveedor-lista');
    if (!campo || !lista) return;

    const cerrarLista = () => {
      lista.classList.add('oculto');
      lista.hidden = true;
      lista.innerHTML = '';
      campo.setAttribute('aria-expanded', 'false');
    };

    const elegir = (nombre) => {
      campo.value = nombre;
      cerrarLista();
      campo.focus();
    };

    const MINIMO = 2;
    const MAXIMO = 6;

    const filtrar = () => {
      const escrito = normalizarTexto(campo.value);

      if (escrito.length < MINIMO || !this.proveedores?.length) {
        cerrarLista();
        return;
      }

      const encontrados = this.proveedores
        .filter(nombre => normalizarTexto(nombre).includes(escrito))
        .slice(0, MAXIMO);

      if (!encontrados.length) {
        // Sin resultados no se muestra un desplegable vacío: el usuario está

        cerrarLista();
        return;
      }

      const exacto = encontrados.findIndex(n => normalizarTexto(n) === escrito);
      if (exacto > 0) {
        const [primero] = encontrados.splice(exacto, 1);
        encontrados.unshift(primero);
      }

      lista.innerHTML = encontrados.map(nombre => `
        <li>
          <button type="button" class="desplegable-item" role="option"
            aria-selected="false">${esc(nombre)}</button>
        </li>
      `).join('');
      lista.classList.remove('oculto');
      lista.hidden = false;
      campo.setAttribute('aria-expanded', 'true');

      lista.querySelectorAll('.desplegable-item').forEach(btn => {
        btn.addEventListener('click', () => elegir(btn.textContent.trim()));
      });
    };

    campo.addEventListener('input', filtrar);
    campo.addEventListener('focus', () => { if (campo.value.trim().length >= MINIMO) filtrar(); });

    // formulario entero y el usuario perdía lo que había escrito del proveedor.
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lista.hidden) {
        e.stopPropagation();
        cerrarLista();
      }
    });

    // // El clic por fuera cierra la lista. Se escucha en el documento y no
    // en el // campo porque el toque puede caer en cualquier lado, y con un
    // retardo // porque si no el clic que elige una opción llega después
    // del blur y no // cuenta.

    document.addEventListener('click', (e) => {
      if (lista.hidden) return;
      if (e.target.closest('#proveedor-lista') || e.target === campo) return;
      cerrarLista();
    });
  }

  /**
   * Cargar la imagen COMPLETA del producto para el preview del formulario.
   *
   * El catálogo trabaja con miniaturas de 200px (ver imagenUtils.crearThumb) y
   * el preview es un cuadrado de ~320px: usar la miniatura ahí se vería borroso,
   * sobre todo en la pantalla de edición, que es donde el usuario compara la
   * foto con el producto que tiene enfrente.
   *
   * Se deja constancia de que la URL es del formulario (_imagenUrlPropia) para
   * poder revocarla al cerrar sin tocar las del catálogo.
   */
  async cargarImagenCompleta() {
    if (!this.producto?.imagenId) return;

    try {
      const img = await db.imagenes.get(this.producto.imagenId);

      if (!img?.blob) return;

      this.imagenUrl = imagenUtils.crearObjectURL(img.blob);
      this._imagenUrlPropia = true;
    } catch (error) {

      console.error('No se pudo cargar la imagen completa del producto:', error);
    }
  }

  crearModal() {
    const modal = document.createElement('div');
    modal.className = 'velo';

    const camaraDisponible = this.camaraDisponible;
    const esRapida = this.modo === 'rapida';

    // Categorías del producto: un producto puede estar en varias. Se resuelven una
    // vez, con nombre y color, porque el botón del selector tiene que pintar las
    // que estén elegidas y las opciones ya traen los suyos en data-.
    //
    // El botón muestra las primeras tres y, si sobran, cuántas: un producto en
    // ocho categorías convertiría el campo en ocho filas y taparía el resto del
    // formulario. La lista completa queda a un toque, y en la hoja de detalle.
    const categoriasElegidas = categoriasDe(this.producto)
      .map(id => this.categorias.find(c => c.id === id))
      .filter(Boolean);
    const MAXIMO_EN_EL_BOTON = 3;

    const tipoActual = TIPOS_VENTA.find(t => t.value === this.tipoVenta) || TIPOS_VENTA[0];
    const unidadStockElegida = this.producto?.unidadStock || '';
    const step = pasoUnidadStock(unidadStockElegida, this.tipoVenta);
    const unidadBase = tipoActual.unidadBase || 'unid';
    // El ícono del rótulo de stock sigue a la unidad: cajas si cuenta en
    // cajas, la balanza si cuenta en kilos.
    const iconoStock = UNIDADES_STOCK.find(u => u.value === unidadStockElegida)?.icon || tipoActual.icon;
    const stockInicial = this.producto?.stock || 0;

    const stockMinInicial = this.producto?.stockMinimo
      ?? (this.tipoVenta.startsWith('peso') ? 1 : 5);
    const costoInicial = this.producto?.costo || '';

    // El bloque de precios va en distinto lugar según el modo: en carga rápida,
    // debajo del nombre, en la columna de los campos; en la ficha completa,
    // después de la calculadora. Es el mismo nodo en los dos casos, así que
    // pasar a la ficha lo devuelve a su lugar sin rehacer el formulario ni
    // perder lo que se escribió.
    const bloquePrecios = `
          <!-- Precios por unidad (base + sub-unidades) -->
          <div id="precios-container">
            <div class="etiqueta solo-detallado">${icono('dinero')} Precios por unidad</div>
            <div class="apilado" id="precios-lista">
              ${this.renderPreciosHTML(unidadBase, tipoActual, tipoActual.subUnidades)}
            </div>
          </div>`;

    modal.innerHTML = `
      <div class="dialogo dialogo-ancho dialogo-columna">
        <!-- Header -->
        <div class="dialogo-cabecera dialogo-cabecera-fija">
          <h2 class="titulo titulo-icono">${icono(esRapida ? 'rayo' : this.isEditing ? 'editar' : 'mas')}<span>${esRapida ? 'Carga rápida' : this.isEditing ? 'Editar Producto' : 'Nuevo Producto'}</span></h2>
          <button id="cerrar-form" class="btn-fantasma btn-icono" aria-label="Cerrar">✕</button>
        </div>

        <!-- Form scrollable -->
        <!-- La validación la manda la app: el botón guardar avisa qué falta y
             con novalidate el navegador no se adelanta con su burbuja. -->
        <form id="form-producto" class="dialogo-cuerpo apilado-3 crece${esRapida ? ' rapido' : ''}" novalidate>
          ${!this.isEditing ? `
          <button type="button" id="link-carga-rapida" class="btn-fantasma btn-ancho">${icono('rayo')}<span>Carga rápida</span></button>
          ` : ''}
          <div class="etiqueta-seccion con-margen-arriba-amplia solo-detallado">${icono('caja')} Producto</div>

          <!-- Foto del producto -->
          <div class="form-cabecera">
            <div class="form-foto campo-foto">
              <div class="etiqueta">${icono('camara')} Foto</div>
              <div class="posicionado">
                <div id="preview-container" class="marco-foto marco-foto-vacio" role="button" tabindex="0" aria-label="Sacar o cambiar la foto">
                  ${this.imagenUrl ? `
                    <img src="${this.imagenUrl}" class="foto-llena" alt="Foto del producto">
                    <button type="button" id="quitar-foto" class="boton-cerrar-foto" aria-label="Quitar foto">✕</button>
                  ` : `
                    <div class="vacio">
                      <span class="vacio-icono">${icono('galeria')}</span>
                    </div>
                  `}
                </div>
                <div class="apilado-chico con-margen-arriba">
                  <button
                    type="button"
                    id="btn-camara"
                    class="btn-secundario btn-crece ancho-entero"
                    ${!camaraDisponible ? 'disabled' : ''}
                    aria-label="${camaraDisponible ? 'Abrir cámara' : 'Cámara requiere HTTPS (no disponible en red local)'}"
                  >
                    ${icono('camara')}<span>Cámara</span>
                  </button>
                  <button type="button" id="btn-galeria" class="btn-secundario btn-crece ancho-entero">
                    ${icono('galeria')}<span>Galería</span>
                  </button>
                </div>
                <!--
              Sin capture: con ese atributo el teléfono abre la cámara en vez del
              selector de archivos, así que el botón decía "Galería" y sacaba la
              foto. Con accept="image/*" a secas el selector deja elegir una foto
              ya sacada, y en la mayoría de los teléfonos también ofrece la cámara.
            -->
            <input type="file" id="input-galeria" accept="image/*" class="oculto">
              </div>
              ${!camaraDisponible ? `
                <p class="micro apagado con-margen-arriba-chica">${icono('alerta')} La cámara requiere HTTPS. Usá la galería.</p>
              ` : ''}
            </div>

            <div class="columna apilado-3 crece">
              <div>
                <label for="nombre" class="etiqueta">${icono('lapiz')} Nombre del producto *</label>
                <input
                  type="text"
                  id="nombre"
                  name="nombre"
                  class="campo"
                  placeholder="Ej: Tomate Redondo"
                  value="${escAttr(this.producto?.nombre || '')}"
                  required
                  autocomplete="off"
                >
              </div>

              <div class="solo-detallado campo-codigo-barras">
                <label for="codigoBarras" class="etiqueta">${icono('etiqueta')} Código de barras</label>
                <div class="fila">
                  <input
                    type="text"
                    id="codigoBarras"
                    name="codigoBarras"
                    class="campo crece"
                    placeholder="Escanea o escribe"
                    value="${escAttr(this.producto?.codigoBarras || '')}"
                    autocomplete="off"
                  >
                  <button
                    type="button"
                    id="btn-escanear"
                    class="btn-secundario no-crece ${!camaraDisponible ? 'btn-apagado' : ''}"
                    ${!camaraDisponible ? 'disabled' : ''}
                    aria-label="${camaraDisponible ? 'Escanear código de barras' : 'Escáner requiere HTTPS (no disponible en red local)'}"
                  >
                    ${icono('escanear')}
                  </button>
                </div>
                ${!camaraDisponible ? `
                  <p class="micro apagado con-margen-arriba-chica">${icono('alerta')} El escáner requiere HTTPS. Escribí el código a mano.</p>
                ` : ''}
              </div>

              <div class="solo-detallado campo-codigo-proveedor">
                <label for="codigoProveedor" class="etiqueta">${icono('etiqueta')} Código del proveedor</label>
                <input
                  type="text"
                  id="codigoProveedor"
                  name="codigoProveedor"
                  class="campo"
                  placeholder="Ej: PRV-0142"
                  value="${escAttr(this.producto?.codigoProveedor || '')}"
                  autocomplete="off"
                >
              </div>

              ${esRapida ? bloquePrecios : ''}
            </div>
          </div>

          <div class="etiqueta-seccion con-margen-arriba-amplia solo-detallado">${icono('dinero')} Precio</div>

          <!-- Tipo de venta -->
          <div class="solo-detallado campo-tipo-venta">
            <div class="etiqueta">⚖️ Tipo de venta</div>
            <div class="posicionado" id="tipo-venta-selector">
              <button
                type="button"
                id="tipo-venta-toggle"
                class="campo-boton"
                aria-haspopup="listbox"
                aria-expanded="false"
              >
                <span id="tipo-venta-texto" class="fila">
                  ${TIPOS_VENTA.find(t => t.value === this.tipoVenta)?.icon || '📦'}
                  ${TIPOS_VENTA.find(t => t.value === this.tipoVenta)?.label || 'Por Unidad'}
                </span>
                <svg class="flecha tenue con-margen-izquierda" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
              <ul
                id="tipo-venta-options"
                class="desplegable oculto"
                role="listbox"
              >
                ${TIPOS_VENTA.map(tipo => `
                  <li
                    class="opcion ${this.tipoVenta === tipo.value ? 'opcion-elegida' : ''}"
                    role="option"
                    data-value="${escAttr(tipo.value)}"
                    aria-selected="${this.tipoVenta === tipo.value}"
                  >
                    <span class="mediano">${tipo.icon}</span>
                    <span class="medio">${tipo.label}</span>
                    <span class="micro apagado empuja-derecha">${tipo.unidadBase}</span>
                  </li>
                `).join('')}
              </ul>
              <input type="hidden" id="tipoVenta" name="tipoVenta" value="${escAttr(this.tipoVenta || "")}">
            </div>
          </div>

          <!-- Calculadora de Precio -->
          <div id="calculadora-precio" class="recuadro recuadro-marca solo-detallado campo-calculadora">
            <div class="etiqueta-seccion">${icono('calculadora')} Calculadora de Precio</div>

            <div class="con-margen-abajo">
              <label for="costo" class="etiqueta">${icono('dinero')} Costo (${unidadBase})</label>
              <div class="posicionado">
                <span class="buscador-lupa">$</span>
                <input
                  type="number"
                  id="costo"
                  name="costo"
                  class="campo campo-con-icono"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value="${escAttr(costoInicial)}"
                  inputmode="decimal"
                >
              </div>
            </div>

            <div class="cuadricula-apilada con-margen-abajo">
              <div>
                <label for="ivaPorcentaje" class="etiqueta">${icono('porcentaje')} IVA %</label>
                <div class="posicionado">
                  <input
                    type="number"
                    id="ivaPorcentaje"
                    name="ivaPorcentaje"
                    class="campo centro-texto"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="21"
                    value="${escAttr(this.producto?.ivaPorcentaje ?? 0)}"
                    inputmode="decimal"
                  >
                  <span class="sufijo-campo">%</span>
                </div>
              </div>

              <div>
                <label for="margenPorcentaje" class="etiqueta">${icono('porcentaje')} Margen %</label>
                <div class="posicionado">
                  <input
                    type="number"
                    id="margenPorcentaje"
                    name="margenPorcentaje"
                    class="campo centro-texto"
                    step="0.01"
                    min="0"
                    placeholder="30"
                    value="${escAttr(this.producto?.margenPorcentaje ?? 50)}"
                    inputmode="decimal"
                  >
                  <span class="sufijo-campo">%</span>
                </div>
              </div>
            </div>

            <div class="recuadro">
              <div class="fila fila-separada detalle">
                <span class="con-medio">Precio calculado:</span>
                <span id="precioCalculado" class="marca mediano">$0.00</span>
              </div>
              <div class="fila fila-separada micro apagado con-margen-arriba-chica">
                <span>Costo: <span id="costoBase">$0.00</span></span>
                <span>+IVA: <span id="ivaCalculado">$0.00</span></span>
                <span>+Margen: <span id="margenCalculado">$0.00</span></span>
              </div>
            </div>

            <p class="micro apagado con-margen-arriba-chica centro-texto">Edita el precio final abajo para redondear · Los % se guardan</p>
          </div>

          ${esRapida ? '' : bloquePrecios}

          <!--
            El botón va FUERA del bloque de arriba a propósito. Adentro comparte
            la grilla de dos columnas con el resto del formulario, así que
            "ancho del modal" ahí es media pantalla y el botón quedaba en una
            sola columna, con la mitad del ancho al lado sin usar.
          -->
          <button
            type="button"
            id="btn-agregar-precio"
            class="btn-secundario btn-ancho detalle con-margen-arriba solo-detallado"
          >
            ${icono('mas')}<span>Agregar otro precio</span>
          </button>

          <div class="etiqueta-seccion con-margen-arriba-amplia solo-detallado seccion-inventario">${icono('medida')} Inventario</div>

          <!-- Stock y Stock Mínimo -->
          <div class="cuadricula-apilada solo-detallado">
            <div class="campo-stock">
              <label for="stock" class="etiqueta">
                ${icono('medida')} Stock actual ${iconoStock}
              </label>
              <div class="fila fila-corta">
                <button type="button" class="btn-secundario btn-cuadro" data-stock-action="decrement" aria-label="Disminuir stock">−</button>
                <input
                  type="number"
                  id="stock"
                  name="stock"
                  class="campo centro-texto crece ancho-cero"
                  step="${step}"
                  min="0"
                  value="${escAttr(stockInicial)}"
                  inputmode="decimal"
                >
                <button type="button" class="btn-secundario btn-cuadro" data-stock-action="increment" aria-label="Aumentar stock">+</button>
              </div>
            </div>

            <div class="campo-stock-minimo">
              <label for="stockMinimo" class="etiqueta">
                ${icono('alerta')} Stock mínimo
              </label>
              <div class="fila fila-corta">
                <button type="button" class="btn-secundario btn-cuadro" data-stockmin-action="decrement" aria-label="Disminuir stock mínimo">−</button>
                <input
                  type="number"
                  id="stockMinimo"
                  name="stockMinimo"
                  class="campo centro-texto crece ancho-cero"
                  step="${step}"
                  min="0"
                  value="${escAttr(stockMinInicial)}"
                  inputmode="decimal"
                >
                <button type="button" class="btn-secundario btn-cuadro" data-stockmin-action="increment" aria-label="Aumentar stock mínimo">+</button>
              </div>
            </div>
          </div>

          <!-- Unidad en que se cuenta el stock: la de la venta o una propia -->
          <div class="solo-detallado campo-stock">
            <label for="unidad-stock" class="etiqueta">${icono('medida')} Mide el stock en</label>
            <select id="unidad-stock" name="unidadStock" class="campo">
              ${UNIDADES_STOCK.map(op => `
                <option value="${escAttr(op.value)}" ${unidadStockElegida === op.value ? 'selected' : ''}>${esc(op.label)}</option>
              `).join('')}
            </select>
          </div>

          <!-- Fecha -->
          <div class="solo-detallado campo-fecha">
            <label for="fecha" class="etiqueta">${icono('calendario')} Fecha</label>
            <input
              type="date"
              id="fecha"
              name="fecha"
              class="campo"
              value="${escAttr(this.producto?.fecha || new Date().toISOString().split('T')[0])}"
            >
          </div>

          <div class="etiqueta-seccion con-margen-arriba-amplia solo-detallado seccion-ubicacion">${icono('carpeta')} Ubicación</div>

<!-- Proveedor y categorías, en dos columnas.
               Son las dos etiquetas que dicen a qué grupo pertenece el producto y se
               llenan de la misma manera, así que van juntas: el proveedor a la izquierda
               y las categorías a su derecha. Antes iban apiladas y había que bajar para
               llegar del uno al otro. -->
          <div class="form-par solo-detallado">
            <div class="campo-proveedor">
              <label for="proveedor" class="etiqueta">${icono('proveedor')} Proveedor</label>
            <div class="posicionado">
              <input
                type="text"
                id="proveedor"
                name="proveedor"
                class="campo"
                placeholder="Empezá a escribir y elegí de la lista"
                value="${escAttr(this.producto?.proveedor || '')}"
                autocomplete="off"
                role="combobox"
                aria-expanded="false"
                aria-autocomplete="list"
                aria-controls="proveedor-lista"
              >
              <ul id="proveedor-lista" class="desplegable oculto" role="listbox" aria-label="Proveedores que ya usás" hidden></ul>
            </div>
          </div>
<!-- Categorías -->
          <div class="campo-categorias">
            <div class="etiqueta">📂 Categorías</div>
            <div class="posicionado" id="categoria-selector">
              <button
                type="button"
                id="categoria-toggle"
                class="campo-boton"
                aria-haspopup="listbox"
                aria-expanded="false"
              >
                <span id="categoria-texto" class="fila envuelto">
                  ${
                    categoriasElegidas.length === 0
                      ? '<span class="medio tenue">Sin categoría</span>'
                      : categoriasElegidas.slice(0, MAXIMO_EN_EL_BOTON).map(cat => `
                        <span class="ficha-categoria">
                          <span class="punto-chico" style="background-color: ${escAttr(cat.color || '#64748B')}"></span>
                          <span class="medio">${esc(cat.nombre)}</span>
                        </span>
                      `).join('') +
                        (categoriasElegidas.length > MAXIMO_EN_EL_BOTON
                          ? `<span class="ficha-categoria"><span class="medio">+${categoriasElegidas.length - MAXIMO_EN_EL_BOTON}</span></span>`
                          : '')
                  }
                </span>
                <svg class="flecha tenue con-margen-izquierda" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
              <div
                id="categoria-options"
                class="desplegable desplegable-largo oculto"
                role="listbox"
                aria-multiselectable="true"
              >
                ${this.categorias.length === 0 ? `
                  <p class="micro tenue con-relleno">Primero creá una categoría</p>
                ` : ''}
                ${this.categorias.map(cat => `
                  <li
                    class="fila-tocable fila-lista ${categoriasElegidas.some(c => c.id === cat.id) ? 'opcion-elegida' : ''}"
                    role="option"
                    data-id="${escAttr(cat.id)}"
                    data-nombre="${escAttr(cat.nombre)}"
                    data-color="${escAttr(cat.color || '#64748B')}"
                    aria-selected="${categoriasElegidas.some(c => c.id === cat.id)}"
                  >
                    <span class="punto-chico" style="background-color: ${escAttr(cat.color || '#64748B')}"></span>
                    <span class="medio crece">${esc(cat.nombre)}</span>
                    <span class="casilla-lista ${categoriasElegidas.some(c => c.id === cat.id) ? 'casilla-lista-marcada' : ''}" aria-hidden="true">${icono('verificar')}</span>
                  </li>
                `).join('')}
                ${this.categorias.length > 0 ? `
                  <button type="button" id="categoria-listo" class="btn-secundario ancho-entero con-margen-arriba-chica">
                    Listo
                  </button>
                ` : ''}
              </div>
              <input type="hidden" id="categoriaIds" name="categoriaIds" value="${escAttr(categoriasDe(this.producto).join(','))}">
            </div>
          </div>
          </div>

          <!--
            Proveedor y notas van al final del formulario, no antes de los
            precios. Las notas son texto libre del usuario, un papel aparte:
            metidas en medio de los campos se perdían en el medio del
            formulario, y no era el último dato que completaba.
          -->
          <div class="pos-it solo-detallado campo-notas">
            <label for="notas" class="etiqueta-seccion">📝 Notas de este producto</label>
            <textarea
              id="notas"
              name="notas"
              class="area-texto"
              rows="3"
              placeholder="Ej: este distribuidor me trae los productos ordenados"
            >${esc(this.producto?.notas || '')}</textarea>
          </div>

          <button type="button" id="link-completar-ficha" class="btn-fantasma btn-ancho">${icono('lapiz')}<span>Completar en producto detallado</span></button>

          <!-- Espacio para que no se tape el botón sticky -->
          <div class="alto-foto"></div>
        </form>

        <!-- Botones sticky al fondo -->
        <div class="dialogo-pie dialogo-pie-fija">
          <button type="button" id="btn-cancelar" class="btn-secundario btn-crece">
            ${this.isEditing ? 'Cancelar' : 'Volver'}
          </button>
          <button type="submit" form="form-producto" class="btn-principal btn-crece">
            ${this.isEditing ? `${icono('verificar')}<span>Guardar cambios</span>` : `${icono('verificar')}<span>Agregar producto</span>`}
          </button>
        </div>
      </div>
    `;

    this.bindEvents(modal);
    return modal;
  }

  bindEvents(modal) {
    const form = modal.querySelector('#form-producto');

    this.bindProveedor(modal);

    modal.querySelector('#cerrar-form').addEventListener('click', () => this.cerrar());
    modal.querySelector('#btn-cancelar').addEventListener('click', () => this.cerrar());
    modal.querySelector('#link-carga-rapida')?.addEventListener('click', () => this.pasarARapida());
    modal.querySelector('#link-completar-ficha')?.addEventListener('click', () => this.pasarADetallado());

    // Cerrar al tocar fuera del contenido (pero no en inputs/botones)
    //
    // Con que e.target sea el velo ya alcanza: un toque dentro del diálogo
    // burbujea hasta acá, pero con e.target apuntando al elemento tocado, nunca
    // al velo. Antes había además un manejador que buscaba ".modal-content"
    // para frenar la propagación; con el nombre viejo de esa clase no
    // encontraba nada y nunca se conectó.
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.cerrar();
    });

    // en el input oculto #tipoVenta. Se elimina este bloque porque además

    modal.querySelectorAll('[data-stock-action]').forEach(btn => {
      btn.addEventListener('click', () => this.ajustarStock(btn.dataset.stockAction));
    });

    modal.querySelectorAll('[data-stockmin-action]').forEach(btn => {
      btn.addEventListener('click', () => this.ajustarStockMin(btn.dataset.stockminAction));
    });

    // Cambiar la unidad del stock mueve el paso de los +/- y el ícono del
    // rótulo; no el número guardado, que queda como estaba.
    modal.querySelector('#unidad-stock')?.addEventListener('change', () => this.actualizarPasoStock(modal));

    modal.querySelector('#btn-camara').addEventListener('click', () => this.abrirCamara());

    /*
     * Tocar el cuadro de la foto hace lo mismo que el botón Cámara, con o sin
     * foto: sirve tanto para sacarla como para rehacerla. Sin cámara (red local
     * sin HTTPS) el toque abre la galería, que siempre está disponible.
     */
    const preview = modal.querySelector('#preview-container');
    const toqueFoto = () => {
      if (this.camaraDisponible) this.abrirCamara();
      else modal.querySelector('#input-galeria')?.click();
    };
    preview?.addEventListener('click', toqueFoto);
    preview?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toqueFoto();
      }
    });

    modal.querySelector('#btn-galeria').addEventListener('click', () => {
      modal.querySelector('#input-galeria').click();
    });

    modal.querySelector('#input-galeria').addEventListener('change', (e) => {
      this.seleccionarDeGaleria(e.target.files[0]);
      e.target.value = '';
    });

    const btnQuitar = modal.querySelector('#quitar-foto');
    if (btnQuitar) {
      // stopPropagation: el cuadro entero es tachable y abre la cámara; sin
      // frenar acá, quitar la foto abriría la cámara en el mismo toque.
      btnQuitar.addEventListener('click', (e) => {
        e.stopPropagation();
        this.quitarFoto();
      });
    }

    const btnEscanear = modal.querySelector('#btn-escanear');
    if (btnEscanear) {
      btnEscanear.addEventListener('click', () => {
        if (!this.camaraDisponible) {
          toast.error('El escáner requiere HTTPS. En red local escribe el código manual o despliega en Vercel/Netlify.');
        } else {
          this.abrirScanner();
        }
      });
    }

    this.inicializarCalculadoraPrecio(modal);

    this.configurarEventosPrecios(modal);

    /*
     * El botón guardar se ve apagado mientras falte un campo obligatorio, pero
     * sigue tappable: el toque contesta con "Te faltan campos: ..." en vez de
     * un botón mudo o la burbuja del navegador.
     */
    this.actualizarBotonGuardar(modal);
    form.addEventListener('input', () => this.actualizarBotonGuardar(modal));
    form.addEventListener('change', () => this.actualizarBotonGuardar(modal));
    modal.querySelector('button[type="submit"][form="form-producto"]').addEventListener('click', (e) => {
      const faltan = this.camposFaltantes(modal);
      if (faltan.length) {
        e.preventDefault();
        toast.warning(`Te faltan campos: ${faltan.join(', ')}`);
      }
    });

    form.addEventListener('submit', (e) => this.guardar(e));

    const categoriaToggle = modal.querySelector('#categoria-toggle');
    const categoriaOptions = modal.querySelector('#categoria-options');
    const categoriaInput = modal.querySelector('#categoriaIds');
    const categoriaTexto = modal.querySelector('#categoria-texto');
    const categoriaListo = modal.querySelector('#categoria-listo');
    const abrirCategorias = () => {
      categoriaOptions.classList.remove('oculto');
      categoriaToggle.setAttribute('aria-expanded', 'true');
    };
    const cerrarCategorias = () => {
      categoriaOptions.classList.add('oculto');
      categoriaToggle.setAttribute('aria-expanded', 'false');
    };

    if (categoriaToggle && categoriaOptions) {
      categoriaToggle.addEventListener('click', () => {
        if (categoriaOptions.classList.contains('oculto')) abrirCategorias();
        else cerrarCategorias();
      });

      // // Cerrar al hacer click fuera. // Se registra con AbortController
      // para poder desconectarlo en cerrar(): // si no, cada apertura del
      // formulario deja un listener en document que // retiene el modal
      // entero ya desconectado del DOM.

      document.addEventListener('click', (e) => {
        if (!categoriaToggle.contains(e.target) && !categoriaOptions.contains(e.target)) {
          cerrarCategorias();
        }
      }, { signal: this._outsideClick.signal });

      categoriaListo?.addEventListener('click', cerrarCategorias);
      // Marcar y desmarcar, sin cerrar.
      //
      // La lista se queda abierta a propósito: si se cerrara al elegir, marcar
      // la segunda categoría exigiría volver a abrirla, y elegir tres sería
      // abrir, marcar, abrir, marcar, abrir, marcar. El botón "Listo" y el
      // click fuera son las dos salidas.

      categoriaOptions.querySelectorAll('[role="option"]').forEach(option => {
        option.addEventListener('click', () => {
          const marcado = option.getAttribute('aria-selected') === 'true';
          option.setAttribute('aria-selected', String(!marcado));
          option.classList.toggle('opcion-elegida', !marcado);
          const casilla = option.querySelector('.casilla-lista');
          if (casilla) casilla.classList.toggle('casilla-lista-marcada', !marcado);

          const marcadas = [...categoriaOptions.querySelectorAll('[role="option"][aria-selected="true"]')];
          const ids = marcadas.map(opt => opt.dataset.id).filter(Boolean);

          // de a poco, sin que el usuario hiciera nada para que eso pasara.
          const colgados = categoriaInput.value
            .split(',')
            .map(id => id.trim())
            .filter(id => id && !categoriaOptions.querySelector(`[role="option"][data-id="${CSS.escape(id)}"]`));
          categoriaInput.value = [...ids, ...colgados].join(',');

          // // El botón se repinta con las fichas de las elegidas. Se
          // reemplaza el // contenido entero en vez de tocar el texto del
          // contenedor, porque // el textContent borraría los puntos de
          // color de adentro.

          const MAXIMO = 3;
          categoriaTexto.innerHTML = marcadas.length === 0
            ? '<span class="medio tenue">Sin categoría</span>'
            : marcadas.slice(0, MAXIMO).map(opt => {
                const nombre = opt.dataset.nombre || '';
                const color = opt.dataset.color || '#64748B';
                return `<span class="ficha-categoria"><span class="punto-chico" style="background-color: ${escAttr(color)}"></span><span class="medio">${esc(nombre)}</span></span>`;
              }).join('') +
              (marcadas.length > MAXIMO
                ? `<span class="ficha-categoria"><span class="medio">+${marcadas.length - MAXIMO}</span></span>`
                : '');
        });
      });
    }

    const tipoToggle = modal.querySelector('#tipo-venta-toggle');
    const tipoOptions = modal.querySelector('#tipo-venta-options');
    const tipoInput = modal.querySelector('#tipoVenta');
    const tipoTexto = modal.querySelector('#tipo-venta-texto');

    if (tipoToggle && tipoOptions) {
      tipoToggle.addEventListener('click', () => {
        const isOpen = !tipoOptions.classList.contains('oculto');
        tipoOptions.classList.toggle('oculto');
        tipoToggle.setAttribute('aria-expanded', !isOpen);
      });

      document.addEventListener('click', (e) => {
        if (!tipoToggle.contains(e.target) && !tipoOptions.contains(e.target)) {
          tipoOptions.classList.add('oculto');
          tipoToggle.setAttribute('aria-expanded', 'false');
        }
      }, { signal: this._outsideClick.signal });

      tipoOptions.querySelectorAll('[role="option"]').forEach(option => {
        option.addEventListener('click', () => {
          const value = option.dataset.value;
          const tipo = TIPOS_VENTA.find(t => t.value === value);
          if (!tipo) return;

          this.tipoVenta = value;
          tipoInput.value = value;
          tipoTexto.innerHTML = `${tipo.icon} ${tipo.label}`;

          tipoOptions.querySelectorAll('[role="option"]').forEach(opt => {
            opt.classList.remove('opcion-elegida');
            opt.setAttribute('aria-selected', 'false');
          });
          option.classList.add('opcion-elegida');
          option.setAttribute('aria-selected', 'true');

          tipoOptions.classList.add('oculto');
          tipoToggle.setAttribute('aria-expanded', 'false');

          this.actualizarPorTipoVenta(modal, tipo);
        });
      });
    }
  }

  configurarEventosPrecios(modal) {
    const container = modal.querySelector('#precios-lista');
    if (!container) return;

    if (!this._preciosEventosBound) {
      this._preciosEventosBound = true;

      modal.querySelector('#btn-agregar-precio')?.addEventListener('click', () => {
        const tipoActual = TIPOS_VENTA.find(t => t.value === this.tipoVenta) || TIPOS_VENTA[0];
        const subUnidades = tipoActual?.subUnidades || [];
        const existentes = Array.from(container.querySelectorAll('.precio-item')).map(el => el.dataset.unidad);

        // La unidad principal tiene su propio campo ("Precio final"), que no es
        // un .precio-item: sin sumarla acá el selector la vuelve a ofrecer y
        // quedan dos campos con el mismo nombre, de los cuales sólo se guarda
        // el primero.
        const principal = modal.querySelector('#unidad-principal')?.value;
        if (principal) existentes.push(principal);

        const disponibles = subUnidades.filter(s => !existentes.includes(s.value));

        if (disponibles.length === 0) {
          toast.info('Ya tienes precios para todas las unidades disponibles');
          return;
        }

        if (disponibles.length === 1) {
          this.agregarPrecioItem(container, disponibles[0]);
        } else {

          this.mostrarSelectorUnidad(disponibles, (unidad) => {
            this.agregarPrecioItem(container, unidad);
          });
        }
      });

      container.addEventListener('click', (e) => {
        const btnEliminar = e.target.closest('.eliminar-precio');
        if (btnEliminar) {
          btnEliminar.closest('.precio-item')?.remove();
        }
      });
    }

    const unidadPrincipalSelect = modal.querySelector('#unidad-principal');
    if (unidadPrincipalSelect && !unidadPrincipalSelect.dataset.listener) {
      unidadPrincipalSelect.dataset.listener = '1';
      unidadPrincipalSelect.addEventListener('change', () => {
        const nuevaPrincipal = unidadPrincipalSelect.value;
        const tipoActual = TIPOS_VENTA.find(t => t.value === this.tipoVenta) || TIPOS_VENTA[0];

        const preciosActuales = {};
        container.querySelectorAll('.precio-item input[name^="precio_"]').forEach(input => {
          const unidad = input.name.replace('precio_', '');
          preciosActuales[unidad] = parseFloat(input.value) || 0;
        });

        // // Actualizar en el producto temporal. // label e icon se
        // reconstruyen desde los descriptores del tipo de venta //
        // (subUnidades) y no desde las entradas de precios, porque al pasar
        // por // el form esas entradas los pierden y guardar() compara esta
        // lista con // la suya.

        const descripcion = new Map((tipoActual.subUnidades || []).map(s => [s.value, s]));
        this.producto = this.producto || {};
        this.producto.unidadPrincipal = nuevaPrincipal;
        this.producto.precios = Object.entries(preciosActuales).map(([unidad, valor]) => {
          const d = descripcion.get(unidad) || {};
          return { unidad, valor, label: d.label || unidad, icon: d.icon || '' };
        });

        container.innerHTML = this.renderPreciosHTML(tipoActual.unidadBase, tipoActual, tipoActual.subUnidades);
        this.configurarEventosPrecios(modal);
        this.inicializarCalculadoraPrecio(modal);
      });
    }
  }

  agregarPrecioItem(container, subUnidad) {
    const html = `
      <div class="precio-item fila anim-subir" data-unidad="${subUnidad.value}">
        <span class="mediano">${subUnidad.icon}</span>
        <span class="detalle medio crece">${subUnidad.label}</span>
        <div class="posicionado crece">
          <span class="buscador-lupa">$</span>
          <input
            type="number"
            name="precio_${subUnidad.value}"
            class="campo campo-con-icono"
            step="0.01"
            min="0"
            placeholder="0.00"
            value=""
            inputmode="decimal"
          >
        </div>
        <button
          type="button"
          class="btn-fantasma btn-cuadro texto-peligro eliminar-precio"
          data-unidad="${subUnidad.value}"
          aria-label="Eliminar precio ${escAttr(subUnidad.label)}"
        >
          ✕
        </button>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  }

  mostrarSelectorUnidad(opciones, onSelect) {
    const modal = document.createElement('div');
    modal.className = 'velo';
    modal.innerHTML = `
      <div class="dialogo">
        <div class="dialogo-cabecera">
          <h2 class="titulo titulo-icono">${icono('mas')}<span>Agregar precio para</span></h2>
          <button class="btn-fantasma btn-icono" id="cerrar-selector-unidad" aria-label="Cerrar">✕</button>
        </div>
        <div class="dialogo-cuerpo apilado">
          ${opciones.map(opt => `
            <button
              type="button"
              class="opcion fila fila-amplia"
              data-value="${escAttr(opt.value)}"
            >
              <span class="grande">${opt.icon}</span>
              <span class="medio">${opt.label}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#cerrar-selector-unidad').addEventListener('click', () => modal.remove());
    modal.querySelectorAll('[data-value]').forEach(btn => {
      btn.addEventListener('click', () => {
        const opt = opciones.find(o => o.value === btn.dataset.value);
        modal.remove();
        onSelect(opt);
      });
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  /**
   * Recalcula el paso de los botones de stock y el ícono del rótulo a partir
   * de la unidad elegida en el select. Comparten lógica con el cambio de tipo
   * de venta porque los dos deciden lo mismo: de a cuánto salta el stock.
   */
  actualizarPasoStock(modal) {
    const tipoActual = TIPOS_VENTA.find(t => t.value === this.tipoVenta) || TIPOS_VENTA[0];
    const unidad = modal.querySelector('#unidad-stock')?.value || '';
    const paso = pasoUnidadStock(unidad, this.tipoVenta);

    const stockInput = modal.querySelector('#stock');
    const stockMinInput = modal.querySelector('#stockMinimo');
    if (stockInput) stockInput.step = paso;
    if (stockMinInput) stockMinInput.step = paso;

    const stockLabel = modal.querySelector('label[for="stock"]');
    if (stockLabel) {
      const simbolo = UNIDADES_STOCK.find(u => u.value === unidad)?.icon || tipoActual.icon;
      stockLabel.innerHTML = `${icono('medida')} Stock actual ${simbolo}`;
    }
  }

  actualizarPorTipoVenta(modal, tipoActual) {
    const unidadBase = tipoActual.unidadBase || 'unid';
    const subUnidades = tipoActual.subUnidades || [];

    this.actualizarPasoStock(modal);

    const costoLabel = modal.querySelector('label[for="costo"]');
    if (costoLabel) {
      costoLabel.innerHTML = `${icono('dinero')} Costo (${unidadBase})`;
    }

    const preciosContainer = modal.querySelector('#precios-lista');
    if (preciosContainer) {
      preciosContainer.innerHTML = this.renderPreciosHTML(unidadBase, tipoActual, subUnidades);
    }

    requestAnimationFrame(() => {
      this.inicializarCalculadoraPrecio(modal);
      this.configurarEventosPrecios(modal);
    });
  }

  getCategoriaIcono(nombre) {
    const iconos = {
      'Verduras': '🥬', 'Frutas': '🍎', 'Limpieza': '🧽',
      'Almacén': '🏪', 'Bebidas': '🥤', 'Otros': '📦'
    };
    return iconos[nombre] || '📦';
  }

  inicializarCalculadoraPrecio(modal) {
    const costoInput = modal.querySelector('#costo');

    /*
 * El campo de precio se busca cada vez que hace falta y no se guarda en una
 * variable. `#precios-lista` se vuelve a pintar cuando cambia el tipo de venta,
 * así que el campo atrapado en el cierre quedaba viejo: los listeners de costo,
 * IVA y margen están atados una sola vez y seguían escribiendo en un campo que ya
 * no estaba en la página.
 *
 * El selector es el primer `precio_` de la lista, sin `.precio-item`: esa clase
 * sólo la llevan los precios de sub-unidades, y el campo "Precio final" —al que
 * calcula esta herramienta— está fuera de ella. Con un producto sin sub-unidades
 * no había ningún `.precio-item`, el selector no matcheaba nada y la guardaba de
 * abajo cortaba la inicialización entera.
 */
    const campoPrecio = () => modal.querySelector('#precios-lista input[name^="precio_"]');

    const ivaInput = modal.querySelector('#ivaPorcentaje');
    const margenInput = modal.querySelector('#margenPorcentaje');
    const precioCalculadoEl = modal.querySelector('#precioCalculado');
    const costoBaseEl = modal.querySelector('#costoBase');
    const ivaCalculadoEl = modal.querySelector('#ivaCalculado');
    const margenCalculadoEl = modal.querySelector('#margenCalculado');

    if (!costoInput || !campoPrecio() || !ivaInput || !margenInput
        || !precioCalculadoEl || !costoBaseEl || !ivaCalculadoEl || !margenCalculadoEl) {
      console.warn('[Calculadora] Faltan elementos, no se inicializa');
      return;
    }

    /*
     * Las otras unidades del producto se escalan junto a la principal. Si no,
     * cambiar el IVA deja el producto a medio actualizar: una docena con el
     * precio viejo al lado de una unidad con el nuevo. Se multiplica por el
     * mismo factor que acaba de mover al principal, y sólo cuando el principal
     * sigue a la calculadora, porque un precio escrito a mano no arrastra a los
     * demás.
     */
    const escalarSubPrecios = (precioAnterior, precioCalc) => {
      if (!(precioAnterior > 0) || !(precioCalc > 0) || precioAnterior === precioCalc) return;

      const factor = precioCalc / precioAnterior;
      modal.querySelectorAll('#precios-lista .precio-item input').forEach(input => {
        const valor = parseFloat(input.value) || 0;
        if (valor > 0) input.value = (Math.round(valor * factor * 100) / 100).toFixed(2);
      });
    };

    const calcular = () => {
      const costo = parseFloat(costoInput.value) || 0;
      const ivaPct = parseFloat(ivaInput.value) || 0;
      const margenPct = parseFloat(margenInput.value) || 0;

      const ivaMonto = costo * (ivaPct / 100);
      const costoConIva = costo + ivaMonto;
      const margenMonto = costoConIva * (margenPct / 100);
      const precioCalc = costoConIva + margenMonto;

      costoBaseEl.textContent = `$${costo.toLocaleString('es-ES', {minimumFractionDigits: 2})}`;
      ivaCalculadoEl.textContent = `$${ivaMonto.toLocaleString('es-ES', {minimumFractionDigits: 2})}`;
      margenCalculadoEl.textContent = `$${margenMonto.toLocaleString('es-ES', {minimumFractionDigits: 2})}`;
      precioCalculadoEl.textContent = `$${precioCalc.toLocaleString('es-ES', {minimumFractionDigits: 2})}`;

      /*
       * Si el precio final está vacío o igual al calculado anterior, se
       * actualiza. Cuando el cálculo da cero no se escribe nada: el campo se
       * deja vacío para que se vea el 0,00 de ejemplo y al escribir se
       * reemplace, que es lo mismo que pasa con los precios de docena y caja.
       * Escribir un 0,00 de verdad obligaba al usuario a borrarlo a mano.
       */
      const precioInput = campoPrecio();
      if (!precioInput) return;

      const precioActual = parseFloat(precioInput.value) || 0;
      const sigueAlCalculo = precioActual === 0
        || Math.abs(precioActual - this.ultimoPrecioCalculado) < 0.01;

      if (sigueAlCalculo) {
        precioInput.value = precioCalc > 0 ? precioCalc.toFixed(2) : '';
        escalarSubPrecios(precioActual, precioCalc);
      }
      this.ultimoPrecioCalculado = precioCalc;
    };

    this.ultimoPrecioCalculado = 0;
    calcular();

    if (!this._calculadoraEventosBound) {
      this._calculadoraEventosBound = true;
      [costoInput, ivaInput, margenInput].forEach(input => {
        input.addEventListener('input', calcular);
        input.addEventListener('change', calcular);
      });
    }

  }

  ajustarStock(accion) {
    const input = this.modal.querySelector('#stock');
    const step = parseFloat(input.step) || 1;
    let valor = parseFloat(input.value) || 0;

    if (accion === 'increment') {
      valor += step;
    } else {
      valor = Math.max(0, valor - step);
    }

    // Redondear para evitar problemas de punto flotante
    valor = Math.round(valor * 1000) / 1000;
    input.value = valor;
  }

  ajustarStockMin(accion) {
    const input = this.modal.querySelector('#stockMinimo');
    const step = parseFloat(input.step) || 1;
    let valor = parseFloat(input.value) || 0;

    if (accion === 'increment') {
      valor += step;
    } else {
      valor = Math.max(0, valor - step);
    }

    valor = Math.round(valor * 1000) / 1000;
    input.value = valor;
  }

  async abrirCamara() {
    try {
      await abrirCamara(({ imagenId, imagenUrl, blob }) => {
        this.imagenId = imagenId;
        this.imagenUrl = imagenUrl;
        this._imagenUrlPropia = true;
        this._imagenesNuevas.add(imagenId);
        this.actualizarPreview(imagenUrl);
        toast.success('Foto capturada y guardada');
      });
    } catch (error) {
      toast.error(error.message);
    }
  }

  async seleccionarDeGaleria(archivo) {
    if (!archivo) return;

    const validacion = imagenUtils.validarArchivo(archivo);
    if (!validacion.valido) {
      toast.error(validacion.error);
      return;
    }

    try {

      const btnGaleria = this.modal.querySelector('#btn-galeria');
      const textoOriginal = btnGaleria.innerHTML;
      btnGaleria.disabled = true;
      btnGaleria.innerHTML = '⏳ Procesando...';

      const blob = await imagenUtils.fileAWebPBlob(archivo);
      const imagenId = dbUtils.generarId('img');

      const thumb = await imagenUtils.crearThumb(blob);
      await dbUtils.guardarImagen(imagenId, blob, thumb);

      this.imagenId = imagenId;
      this.imagenUrl = imagenUtils.crearObjectURL(blob);
      this._imagenUrlPropia = true;
      this._imagenesNuevas.add(imagenId);
      this.actualizarPreview(this.imagenUrl);
      toast.success('Foto guardada');

      btnGaleria.disabled = false;
      btnGaleria.innerHTML = textoOriginal;
    } catch (error) {
      console.error('Error procesando imagen:', error);
      toast.error('Error procesando la imagen: ' + error.message);

      const btnGaleria = this.modal.querySelector('#btn-galeria');
      if (btnGaleria) {
        btnGaleria.disabled = false;
        btnGaleria.innerHTML = `${icono('galeria')}<span>Galería</span>`;
      }
    }
  }

  async quitarFoto() {
    if (!this.imagenId) return;

    this.imagenId = null;

    if (this.imagenUrl && this._imagenUrlPropia) {
      imagenUtils.revocarObjectURL(this.imagenUrl);
    }
    this.imagenUrl = null;
    this._imagenUrlPropia = false;

    this.actualizarPreview(null);
    toast.info('Foto quitada');

    // El blob NO se borra acá: si se borrara y el usuario cerrara el formulario,
    // el producto se quedaría apuntando a una imagen que ya no existe. Liberarla
    // es una acción explícita desde el historial.
  }

  actualizarPreview(url) {
    const container = this.modal.querySelector('#preview-container');
    if (url) {
      container.innerHTML = `
        <img src="${url}" class="foto-llena" alt="Foto del producto">
        <button type="button" id="quitar-foto" class="boton-cerrar-foto" aria-label="Quitar foto">✕</button>
      `;
      // stopPropagation: sin eso el toque en la ✕ sube al contenedor y además
      // abre la cámara, que es justo lo que el usuario no pidió.
      container.querySelector('#quitar-foto').addEventListener('click', (e) => {
        e.stopPropagation();
        this.quitarFoto();
      });
    } else {
      container.innerHTML = `
        <div class="vacio">
          <span class="vacio-icono">${icono('galeria')}</span>
          <p class="detalle con-margen-arriba-chica">Sin foto</p>
        </div>
      `;
    }
  }

  async abrirScanner() {
    try {

      // // `coincidencias` es una LISTA de productos, no un producto. Antes
      // se // comprobaba `if (productoExistente)` sobre la lista, y un
      // array vacío es // verdadero en JavaScript: por eso escanear un
      // código nuevo decía siempre // que ya existía.

      await abrirScanner(async (codigo, coincidencias) => {
        // El escáner se abre encima del formulario: si el usuario cerró el
        // // formulario mientras escaneaba, this.modal ya es null y buscar
        // el input // reventaría con TypeError dentro de un callback.

        const input = this.modal?.querySelector('#codigoBarras');
        if (input) input.value = codigo;

        if (!coincidencias.length) {
          toast.success('Código escaneado');
          return;
        }

        // No se abre el producto a editar. Escaneando lo que el usuario está

        const cuantos = coincidencias.length;
        toast.warning(
          cuantos === 1
            ? `Este código ya existe: ${coincidencias[0].nombre}`
            : `Este código existe en ${cuantos} productos`,
          {
            action: 'Ver en el inventario',
            onAction: async () => {

              // // await en cerrar(): el padre cambia de vista y su onClose
              // // diferido de 200 ms tiene que ejecutarse antes, si no
              // dejaría el // formulario nuevo ya montado sobre el viejo.

              await this.cerrar();
              this.onBuscarCodigo?.(codigo);
            }
          }
        );
      });
    } catch (error) {
      toast.error('Error al escanear: ' + error.message);
    }
  }

  /**
   * Los campos obligatorios que todavía no tienen nada, con el rótulo tal como
   * se ve en el formulario. Mira lo mismo que aborta guardar(): el nombre y el
   * precio de la unidad principal.
   *
   * @param {HTMLElement} modal el contenedor del formulario
   * @returns {string[]} los rótulos de lo que falta, en orden de aparición
   */
  camposFaltantes(modal) {
    const faltan = [];

    const nombre = modal.querySelector('#nombre');
    if (!nombre || !nombre.value.trim()) faltan.push('Nombre del producto');

    const unidadPrincipal = modal.querySelector('[name="unidadPrincipal"]')?.value
      || (TIPOS_VENTA.find(t => t.value === this.tipoVenta) || TIPOS_VENTA[0]).subUnidades?.[0]?.value;
    const precio = unidadPrincipal ? modal.querySelector(`[name="precio_${unidadPrincipal}"]`) : null;
    if (!precio || !(parseFloat(precio.value) > 0)) faltan.push('Precio final');

    return faltan;
  }

  /**
   * Apaga o prende el botón guardar según camposFaltantes(). No se le pone el
   * atributo `disabled`: con eso el toque ni llega y el usuario no se entera
   * de qué falta. El apagado es sólo cara (btn-apagado + aria-disabled); el
   * click, en bindEvents, se frena y contesta.
   *
   * @param {HTMLElement} modal el contenedor del formulario
   */
  actualizarBotonGuardar(modal) {
    const boton = modal.querySelector('button[type="submit"][form="form-producto"]');
    if (!boton) return;
    const falta = this.camposFaltantes(modal).length > 0;
    boton.classList.toggle('btn-apagado', falta);
    if (falta) boton.setAttribute('aria-disabled', 'true');
    else boton.removeAttribute('aria-disabled');
  }

  async guardar(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const nombre = formData.get('nombre')?.toString().trim();

    // Lo mismo que mira el botón: si falta algo se dice qué y no se guarda.
    // Sin este corte, el Enter del teclado mandaría el form igual.
    const faltan = this.camposFaltantes(e.target);
    if (faltan.length) {
      toast.warning(`Te faltan campos: ${faltan.join(', ')}`);
      return;
    }

    // visible es mucho mejor que un 0 que el usuario no ve.
    const stockNum = dbUtils.leerNumero(formData.get('stock'), 'Stock', { min: 0 });
    if (stockNum.error) { toast.error(stockNum.error); return; }

    const stockMinNum = dbUtils.leerNumero(formData.get('stockMinimo'), 'Stock mínimo', { min: 0 });
    if (stockMinNum.error) { toast.error(stockMinNum.error); return; }

    const stock = stockNum.valor;
    const stockMinimo = stockMinNum.valor;

    const precios = [];
    const tipoActual = TIPOS_VENTA.find(t => t.value === this.tipoVenta) || TIPOS_VENTA[0];
    const subUnidades = tipoActual?.subUnidades || [];

    for (const sub of subUnidades) {
      const leido = dbUtils.leerNumero(formData.get(`precio_${sub.value}`), sub.label, { min: 0 });
      if (leido.error) { toast.error(leido.error); return; }

      if (leido.valor > 0) {
        precios.push({ unidad: sub.value, valor: leido.valor, label: sub.label, icon: sub.icon });
      }
    }

    const unidadPrincipal = formData.get('unidadPrincipal')
      || subUnidades[0]?.value
      || tipoActual.unidadBase;

    // // El precio que se guarda en producto.precio tiene que ser el de la
    // unidad // PRINCIPAL elegida, no el de la primera sub-unidad. Antes
    // tomaba precios[0] // (que es siempre la unidad base), así que si el
    // usuario elegía "500g" como // principal el catálogo mostraba el
    // precio del kilo con la etiqueta de la // unidad principal al lado:
    // dos números que no iban juntos.

    const precioDePrincipal = precios.find(p => p.unidad === unidadPrincipal);

    if (!precioDePrincipal) {
      // Sin precio para la unidad principal no se guarda: el producto quedaría

      // confuso que este arreglo busca evitar. Se avisa y se aborta para que
      // el usuario ponga el precio o elija otra unidad.
      const sub = subUnidades.find(s => s.value === unidadPrincipal);
      toast.error(`Falta el precio de la unidad principal (${sub?.label || unidadPrincipal}). Poné el precio o elegí otra unidad.`);
      return;
    }

    const precioPrincipal = precioDePrincipal.valor;

    let codigoBarras = formData.get('codigoBarras')?.toString().trim() || null;
    const codigoProveedor = formData.get('codigoProveedor')?.toString().trim() || null;

    // limpian los ids vacíos, porque un id con espacios alrededor rompería

    const categoriaIds = (formData.get('categoriaIds') || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);

    // Proveedor y notas son texto libre. Se guardan sin espacios en los bordes
    // para que no se comparen distintos dos productos con el mismo proveedor.
    // El proveedor además se normaliza: el pedido de faltantes se manda por
    // proveedor y "distribuidora del sur" escrito con minúscula tiene que caer
    // en el mismo grupo que "Distribuidora del Sur".
    const proveedor = normalizarProveedor(formData.get('proveedor'));
    const notas = formData.get('notas')?.toString().trim() || '';

    // Código de barras repetido: no se rechaza con un toast, se abre el diálogo que
    // decide. Guardar en silencio dejaría dos productos con el mismo código, y el
    // escáner no puede adivinar a cuál de los dos pertenece.
    if (codigoBarras && (!this.isEditing || this.producto.codigoBarras !== codigoBarras)) {
      const conflictos = await dbUtils.buscarPorCodigoBarras(codigoBarras);
      if (conflictos.length > 0) {
        const r = await abrirCodigoDuplicado({
          codigo: codigoBarras,
          productos: conflictos,
          origen: 'formulario',
          onBorrar: this.onBorrarProducto
            || (p => dbUtils.eliminarProducto(p.id))
        });

        if (r.accion === 'cancelar') return;
        if (r.accion === 'sufijo') codigoBarras = r.codigo;
        else if (r.accion === 'sin-codigo') codigoBarras = null;
        // 'guardar' (acepta el duplicado) y 'resuelto' (el usuario borró
        // todos // los conflictos) dejan el código como estaba escrito.

      }
    }

    const costoNum = dbUtils.leerNumero(formData.get('costo'), 'Costo', { min: 0 });
    if (costoNum.error) { toast.error(costoNum.error); return; }

    const ivaNum = dbUtils.leerNumero(formData.get('ivaPorcentaje'), 'IVA (%)', { min: 0, max: 100 });
    if (ivaNum.error) { toast.error(ivaNum.error); return; }

    const margenNum = dbUtils.leerNumero(formData.get('margenPorcentaje'), 'Margen (%)', { min: 0 });
    if (margenNum.error) { toast.error(margenNum.error); return; }

    const costo = costoNum.valor;
    const ivaPorcentaje = ivaNum.valor;
    const margenPorcentaje = margenNum.valor;
    const fecha = formData.get('fecha') || new Date().toISOString().split('T')[0];

    const datosProducto = {
      nombre,
      precio: precioPrincipal,
      precios,
      costo,
      ivaPorcentaje,
      margenPorcentaje,
      tipoVenta: this.tipoVenta,
      unidadStock: formData.get('unidadStock') || '',
      stock,
      stockMinimo,
      categoriaIds,
      proveedor,
      notas,
      codigoBarras,
      codigoProveedor,
      imagenId: this.imagenId,
      // Registro silencioso de "este producto está sin foto y el usuario lo
      // sabe". No se muestra en ninguna parte a propósito: el usuario lo pidió
      // así. Sirve para no confundir dos cosas que en pantalla se ven igual:
      //
      //   - creadoSinFoto: true  -> nunca tuvo foto, o se la quitó él. El 📦
      //     del catálogo es la foto, no un síntoma.
      //   - creadoSinFoto: false con imagenId puesta pero sin blob -> se le
      //     perdió la foto por fuera de la app, y ahí sí hay que avisarle
      //     (ver p.fotoPerdida en getAllProductosConImagenes).
      //
      // Sin este campo, el 90% de los productos de un negocio chico nunca va a
      // tener foto y todos mostrarían un cartel de "Falta la foto" que no
      // significaría nada. Se escribe siempre (no sólo cuando es true) para
      // que el estado sea explícito y no dependa de si el campo existe.
      creadoSinFoto: !this.imagenId,
      fecha,
      unidadPrincipal,
      actualizadoEl: new Date().toISOString()
    };

    try {
      /*
       * Se guarda por `guardarProducto()` y no con `db.productos.update()` a
       * mano, porque esa función es la que recalcula los campos derivados: el
       * estado de stock, el nombre por el que se ordena, el precio por el que se
       * ordena y el texto por el que se busca.
       *
       * Si el nombre o el precio se guardaran sin recalcular, el producto se
       * guardaría bien pero no aparecería al buscarlo ni al ordenarlo, y el
       * contador del panel de estados quedaría mal. Sin error: sólo la lista
       * vacía.
       */
      if (this.isEditing && this.producto?.id) {
        await dbUtils.guardarProducto({ ...this.producto, ...datosProducto }, this.producto.id);
        toast.success('Producto actualizado');
      } else {
        await dbUtils.guardarProducto(datosProducto);
        toast.success('Producto agregado');
      }

      this._guardado = true;
      this.cerrar();
      this.onSave();
    } catch (error) {
      console.error('Error guardando:', error);
      toast.error('Error al guardar');
    }
  }

  renderPreciosHTML(unidadBase, tipoActual, subUnidades = []) {
    const precios = this.producto?.precios || [];

    const subs = subUnidades.length > 0
      ? subUnidades
      : [{ value: unidadBase || tipoActual.unidadBase || 'unid', label: tipoActual.label, icon: tipoActual.icon }];

    const unidadPrincipalGuardada = this.producto?.unidadPrincipal || subs[0].value;
    const principal = subs.find(s => s.value === unidadPrincipalGuardada) || subs[0];
    const baseUnidad = principal.value;
    const baseLabel = principal.label;

    const precioBase = precios.find(p => p.unidad === baseUnidad) || { valor: this.producto?.precio || 0 };
    const otrosPrecios = precios.filter(p => p.unidad !== baseUnidad);

    let html = `
      <div class="precios-cabecera">
        <div class="columna apilado-2 solo-detallado">
          <div>
            <label for="unidad-principal" class="etiqueta">${icono('verificar')} Unidad que se ve en el catálogo</label>
            <select id="unidad-principal" name="unidadPrincipal" class="campo detalle">
              ${subs.map(s => `
                <option value="${escAttr(s.value)}" ${s.value === baseUnidad ? 'selected' : ''}>${esc(s.label)}</option>
              `).join('')}
            </select>
          </div>
          <p class="micro tenue">El stock siempre se lleva en ${esc(tipoActual.unidadBase)}, sin convertir.</p>
        </div>

        <div class="columna apilado-2">
          <div>
            <label for="precio_${escAttr(baseUnidad)}" class="etiqueta">${icono('dinero')} Precio final</label>
            <div class="posicionado">
              <span class="buscador-lupa">$</span>
              <input
                type="number"
                id="precio_${escAttr(baseUnidad)}"
                name="precio_${baseUnidad}"
                class="campo campo-con-icono fuerte"
                step="0.01"
                min="0"
                placeholder="0.00"
                value="${escAttr(precioBase.valor ?? '')}"
                inputmode="decimal"
              >
            </div>
          </div>
          <p class="micro tenue solo-detallado">Se muestra como ${esc(baseLabel)} en el catálogo y en el pedido.</p>
        </div>
      </div>

      <p class="etiqueta-seccion con-margen-arriba solo-detallado">${icono('medida')}<span>Los otros precios</span></p>
    `;

    for (const sub of subs.filter(s => s.value !== baseUnidad)) {
      // Una fila por unidad que YA tenga precio guardado. Las que no tienen no se
    // dibujan: antes salía una por sub-unidad con un 0 de relleno, que son
    // precios que el usuario no escribió y que igual parecían existir. Para
    // agregar una está el botón "Agregar otro precio".
    const precioSub = otrosPrecios.find(p => p.unidad === sub.value);
    if (!precioSub) continue;
    html += `
        <div class="precio-item fila solo-detallado" data-unidad="${escAttr(sub.value)}">
          <span class="detalle medio crece">${esc(sub.label)}</span>
          <div class="posicionado crece">
            <span class="buscador-lupa">$</span>
            <input
              type="number"
              name="precio_${escAttr(sub.value)}"
              class="campo campo-con-icono"
              step="0.01"
              min="0"
              placeholder="0.00"
              value="${escAttr(precioSub.valor ?? '')}"
              inputmode="decimal"
            >
          </div>
          <button
            type="button"
            class="btn-fantasma btn-cuadro texto-peligro eliminar-precio"
            data-unidad="${escAttr(sub.value)}"
            aria-label="Eliminar precio ${escAttr(sub.label)}"
          >
            ✕
          </button>
        </div>
      `;
    }

    return html;
  }

  limpiarImagenesSinGuardar() {
    if (this._guardado || this._imagenesNuevas.size === 0) return;

    const ids = [...this._imagenesNuevas];
    this._imagenesNuevas.clear();

    db.imagenes.bulkDelete(ids).catch(error => {
      console.error('No se pudieron borrar imágenes huérfanas:', error);
    });
  }

  /**
   * Cierra el formulario y devuelve una promesa que se resuelve cuando el modal
   * ya salió del DOM y onClose se ha llamado.
   *
   * La promesa importa porque quien abra OTRO formulario al terminar éste
   * (escaneo de un código ya existente → editar ese producto) necesita que
   * onClose se haya ejecutado antes. Si no, el onClose diferido 200 ms del
   * formulario viejo llegaría después de que el nuevo se abriera y pondría a
   * "false" el flag de "formulario abierto", permitiendo abrir un tercero
   * encima del segundo.
   *
   * Cerrar sin esperar (✕, Escape, guardar) sigue funcionando: la promesa se
   * simplemente ignora.
   */
  cerrar() {
    if (this.handleKeydown) {
      document.removeEventListener('keydown', this.handleKeydown);
    }

    this._outsideClick?.abort();

    // catálogo no se tocan: son de App y las revoca él al recargar la vista.
    if (this.imagenUrl && this._imagenUrlPropia) {
      imagenUtils.revocarObjectURL(this.imagenUrl);
      this.imagenUrl = null;
      this._imagenUrlPropia = false;
    }

    this.limpiarImagenesSinGuardar();

    if (this.modal) {
      this.modal.classList.add('anim-bajar');
      this.modal.classList.remove('anim-subir');

      return new Promise((resolve) => {
        setTimeout(() => {
          if (this.modal && this.modal.parentNode) {
            this.modal.remove();
          }
          this.modal = null;
          this.onClose();
          resolve();
        }, 200);
      });
    } else {
      this.onClose();
      return Promise.resolve();
    }
  }
}

/**
 * Abre el formulario de producto.
 * @param {Function}  onSave          Se llama tras guardar correctamente.
 * @param {Function}  onClose         Se llama SIEMPRE al cerrar (✕, Escape, clic fuera).
 * @param {Object}   [producto]       Producto a editar, o semilla {codigoBarras}.
 * @param {Function} [onBuscarCodigo] Se llama con el código escaneado cuando
 *                                    se escanea desde el formulario un código
 *                                    que ya está en la BD. Sin este callback,
 *                                    el aviso "Este código ya existe" no
 *                                    puede mostrar dónde está: sólo cerraría
 *                                    el formulario.
 * @param {Function} [onBorrarProducto] Se llama con el producto en conflicto que el
 *                                    usuario decide borrar desde el diálogo de código
 *                                    repetido. Si no se pasa, el formulario borra
 *                                    directo contra la base y la vista queda sin
 *                                    recargar.
 * @param {'detallado'|'rapida'} [modo] 'rapida' sólo muestra foto, nombre y
 *                                    precio final; 'detallado' (por defecto) es
 *                                    la ficha completa.
 */
export async function abrirFormularioProducto(
  onSave,
  onClose,
  producto = null,
  onBuscarCodigo = null,
  onBorrarProducto = null,
  modo = 'detallado'
) {
  const form = new ProductoForm(onSave, onClose, producto, onBuscarCodigo, onBorrarProducto, modo);
  await form.abrir();
  return form;
}
