import { db, dbUtils, TIPOS_VENTA, categoriasDe, normalizarProveedor } from '../db.js';
import { imagenUtils } from '../utils/imagen.js';
import { abrirCamara } from './CamaraModal.js';
import { abrirScanner } from './ScannerModal.js';
import { abrirCodigoDuplicado } from './CodigoDuplicado.js';
import { toast } from '../utils/toast.js';
import { esc, escAttr } from '../utils/html.js';
import { normalizarTexto } from '../utils/texto.js';
import { icono } from '../utils/iconos.js';

export class ProductoForm {
  constructor(onSave, onClose, producto = null, onBuscarCodigo = null, onBorrarProducto = null) {
    this.onSave = onSave;
    this.onClose = onClose;
    this.producto = producto;

    this.onBuscarCodigo = onBuscarCodigo;
    // Se invoca cuando el usuario borra un producto en conflicto desde el

    this.onBorrarProducto = onBorrarProducto;

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
    // cancela en vez de guardar, quedan huérfanas en db.imagenes para siempre

    this._imagenesNuevas = new Set();
    this._guardado = false;
  }

  async abrir() {

    // _guardado del primer guardado exitoso quedaba en true para siempre y

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

    // campo porque el toque puede caer en cualquier lado, y con un retardo
    // porque si no el clic que elige una opción llega después del blur y no

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

    // vez, con nombre y color, porque el botón del selector tiene que pintar las

    //

    const categoriasElegidas = categoriasDe(this.producto)
      .map(id => this.categorias.find(c => c.id === id))
      .filter(Boolean);
    const MAXIMO_EN_EL_BOTON = 3;

    const tipoActual = TIPOS_VENTA.find(t => t.value === this.tipoVenta) || TIPOS_VENTA[0];
    const step = tipoActual.step;
    const unidadBase = tipoActual.unidadBase || 'unid';
    const stockInicial = this.producto?.stock || 0;

    const stockMinInicial = this.producto?.stockMinimo
      ?? (this.tipoVenta.startsWith('peso') ? 1 : 5);
    const costoInicial = this.producto?.costo || '';

    modal.innerHTML = `
      <div class="dialogo dialogo-ancho dialogo-columna">
        <!-- Header -->
        <div class="dialogo-cabecera dialogo-cabecera-fija">
          <h2 class="titulo">
            ${this.isEditing ? '✏️ Editar Producto' : '➕ Nuevo Producto'}
          </h2>
          <button id="cerrar-form" class="btn-fantasma btn-icono" aria-label="Cerrar">✕</button>
        </div>

        <!-- Form scrollable -->
        <form id="form-producto" class="dialogo-cuerpo apilado-3 crece">
          <!-- Foto del producto -->
          <div class="form-cabecera">
            <div class="form-foto">
              <div class="etiqueta">${icono('camara')} Foto</div>
              <div class="posicionado">
                <div id="preview-container" class="marco-foto marco-foto-vacio">
                  ${this.imagenUrl ? `
                    <img src="${this.imagenUrl}" class="foto-llena" alt="Foto del producto">
                    <button type="button" id="quitar-foto" class="boton-cerrar-foto" aria-label="Quitar foto">✕</button>
                  ` : `
                    <div class="vacio">
                      <span class="vacio-icono">${icono('camara')}</span>
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
                <input type="file" id="input-galeria" accept="image/*" capture="environment" class="oculto">
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
                  autofocus
                >
              </div>

              <div>
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

              <div>
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
                    value="${costoInicial}"
                    inputmode="decimal"
                  >
                </div>
              </div>
            </div>
          </div>

          <!-- Tipo de venta -->
          <div>
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
                    data-value="${tipo.value}"
                    aria-selected="${this.tipoVenta === tipo.value}"
                  >
                    <span class="mediano">${tipo.icon}</span>
                    <span class="medio">${tipo.label}</span>
                    <span class="micro apagado empuja-derecha">${tipo.unidadBase}</span>
                  </li>
                `).join('')}
              </ul>
              <input type="hidden" id="tipoVenta" name="tipoVenta" value="${this.tipoVenta}">
            </div>
          </div>

          <!-- Stock y Stock Mínimo -->
          <div class="cuadricula-apilada">
            <div>
              <label for="stock" class="etiqueta">
                ${icono('medida')} Stock actual ${tipoActual.icon}
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
                  value="${stockInicial}"
                  inputmode="decimal"
                >
                <button type="button" class="btn-secundario btn-cuadro" data-stock-action="increment" aria-label="Aumentar stock">+</button>
              </div>
            </div>

            <div>
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
                  value="${stockMinInicial}"
                  inputmode="decimal"
                >
                <button type="button" class="btn-secundario btn-cuadro" data-stockmin-action="increment" aria-label="Aumentar stock mínimo">+</button>
              </div>
            </div>
          </div>

<!-- Categorías -->
          <div>
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

          <!-- Fecha -->
          <div>
            <label for="fecha" class="etiqueta">${icono('calendario')} Fecha</label>
            <input
              type="date"
              id="fecha"
              name="fecha"
              class="campo"
              value="${this.producto?.fecha || new Date().toISOString().split('T')[0]}"
            >
          </div>

          <!-- Calculadora de Precio -->
          <div id="calculadora-precio" class="recuadro recuadro-marca">
            <div class="etiqueta-seccion">${icono('calculadora')} Calculadora de Precio</div>

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
                    value="${this.producto?.ivaPorcentaje ?? 0}"
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
                    value="${this.producto?.margenPorcentaje ?? 50}"
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

          <!-- Precios por unidad (base + sub-unidades) -->
          <div id="precios-container">
            <div class="etiqueta">${icono('dinero')} Precios por unidad</div>
            <div class="apilado" id="precios-lista">
              ${this.renderPreciosHTML(unidadBase, tipoActual, tipoActual.subUnidades)}
            </div>
            <button
              type="button"
              id="btn-agregar-precio"
              class="btn-secundario btn-ancho detalle con-margen-arriba"
            >
              ${icono('mas')}<span>Agregar otro precio</span>
            </button>
          </div>

          <!--
            Proveedor y notas van al final del formulario, no antes de los
            precios. Las notas son texto libre del usuario, un papel aparte:
            metidas en medio de los campos se perdían entre el costo y la
            calculadora, y no era el último dato que completaba.
          -->
          <div>
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

          <div class="pos-it">
            <label for="notas" class="etiqueta-seccion">📝 Notas de este producto</label>
            <textarea
              id="notas"
              name="notas"
              class="area-texto"
              rows="3"
              placeholder="Ej: este distribuidor me trae los productos ordenados"
            >${esc(this.producto?.notas || '')}</textarea>
          </div>

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

    //

    // burbujea hasta acá, pero con e.target apuntando al elemento tocado, nunca

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

    modal.querySelector('#btn-camara').addEventListener('click', () => this.abrirCamara());

    modal.querySelector('#btn-galeria').addEventListener('click', () => {
      modal.querySelector('#input-galeria').click();
    });

    modal.querySelector('#input-galeria').addEventListener('change', (e) => {
      this.seleccionarDeGaleria(e.target.files[0]);
      e.target.value = '';
    });

    const btnQuitar = modal.querySelector('#quitar-foto');
    if (btnQuitar) {
      btnQuitar.addEventListener('click', () => this.quitarFoto());
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

      // si no, cada apertura del formulario deja un listener en document que

      document.addEventListener('click', (e) => {
        if (!categoriaToggle.contains(e.target) && !categoriaOptions.contains(e.target)) {
          cerrarCategorias();
        }
      }, { signal: this._outsideClick.signal });

      categoriaListo?.addEventListener('click', cerrarCategorias);

      //
      // la segunda categoría exigiría volver a abrirla, y elegir tres sería

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

          // contenido entero en vez de tocar el texto del contenedor, porque

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

        // (subUnidades) y no desde las entradas de precios, porque al pasar por

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
          aria-label="Eliminar precio ${subUnidad.label}"
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
              data-value="${opt.value}"
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

  actualizarPorTipoVenta(modal, tipoActual) {
    const step = tipoActual.step;
    const unidadBase = tipoActual.unidadBase || 'unid';
    const subUnidades = tipoActual.subUnidades || [];

    const stockInput = modal.querySelector('#stock');
    const stockMinInput = modal.querySelector('#stockMinimo');
    stockInput.step = step;
    stockMinInput.step = step;

    const stockLabel = modal.querySelector('label[for="stock"]');
    stockLabel.innerHTML = `${icono('medida')} Stock actual ${tipoActual.icon}`;

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

    // Ojo: NO usar :first-of-type, porque el primer <div> hijo de #precios-lista

    const precioInput = modal.querySelector('#precios-lista .precio-item input[name^="precio_"]');
    const ivaInput = modal.querySelector('#ivaPorcentaje');
    const margenInput = modal.querySelector('#margenPorcentaje');
    const precioCalculadoEl = modal.querySelector('#precioCalculado');
    const costoBaseEl = modal.querySelector('#costoBase');
    const ivaCalculadoEl = modal.querySelector('#ivaCalculado');
    const margenCalculadoEl = modal.querySelector('#margenCalculado');

    if (!costoInput || !precioInput || !ivaInput || !margenInput
        || !precioCalculadoEl || !costoBaseEl || !ivaCalculadoEl || !margenCalculadoEl) {
      console.warn('[Calculadora] Faltan elementos, no se inicializa');
      return;
    }

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
      const precioActual = parseFloat(precioInput.value) || 0;
      if (precioActual === 0 || Math.abs(precioActual - this.ultimoPrecioCalculado) < 0.01) {
        precioInput.value = precioCalc > 0 ? precioCalc.toFixed(2) : '';
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

    if (!precioInput.dataset.listener) {
      precioInput.dataset.listener = '1';

      // Si el usuario edita manualmente el precio final, no sobrescribir automáticamente
      precioInput.addEventListener('focus', () => {
        this.usuarioEditandoPrecio = true;
      });

      precioInput.addEventListener('blur', () => {
        this.usuarioEditandoPrecio = false;

        const precioManual = parseFloat(precioInput.value) || 0;
        if (precioManual > 0) {
          this.ultimoPrecioCalculado = precioManual;
        }
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

    // blob ya no existía, así que si el usuario se arrepentía de quitar la
    // foto y cerraba el formulario, la imagen se perdía para siempre y sin

    //

  }

  actualizarPreview(url) {
    const container = this.modal.querySelector('#preview-container');
    if (url) {
      container.innerHTML = `
        <img src="${url}" class="foto-llena" alt="Foto del producto">
        <button type="button" id="quitar-foto" class="boton-cerrar-foto" aria-label="Quitar foto">✕</button>
      `;
      container.querySelector('#quitar-foto').addEventListener('click', () => this.quitarFoto());
    } else {
      container.innerHTML = `
        <div class="vacio">
          <span class="vacio-icono">${icono('camara')}</span>
          <p class="detalle con-margen-arriba-chica">Sin foto</p>
        </div>
      `;
    }
  }

  async abrirScanner() {
    try {

      // verdadero en JavaScript: por eso escanear un código nuevo decía siempre

      await abrirScanner(async (codigo, coincidencias) => {
        // El escáner se abre encima del formulario: si el usuario cerró el

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

              // diferido de 200 ms tiene que ejecutarse antes, si no dejaría el

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

  async guardar(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const nombre = formData.get('nombre')?.toString().trim();

    if (!nombre) {
      toast.error('El nombre es obligatorio');
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

    // (que es siempre la unidad base), así que si el usuario elegía "500g" como

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

    // limpian los ids vacíos, porque un id con espacios alrededor rompería

    const categoriaIds = (formData.get('categoriaIds') || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);

    // para que no se comparen distintos dos productos con el mismo proveedor.

    const proveedor = normalizarProveedor(formData.get('proveedor'));
    const notas = formData.get('notas')?.toString().trim() || '';

    //

    // propósito, así que la repetición es posible y el usuario tiene que poder

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
        // 'guardar' (acepta el duplicado) y 'resuelto' (el usuario borró todos

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
      stock,
      stockMinimo,
      categoriaIds,
      proveedor,
      notas,
      codigoBarras,
      imagenId: this.imagenId,
      // Registro silencioso de "este producto está sin foto y el usuario lo
      // sabe". No se muestra en ninguna parte a propósito: el usuario lo pidió

      //
      //   - creadoSinFoto: true  -> nunca tuvo foto, o se la quitó él. El 📦

      //
      // Sin este campo, el 90% de los productos de un negocio chico nunca va a

      // significaría nada. Se escribe siempre (no sólo cuando es true) para

      creadoSinFoto: !this.imagenId,
      fecha,
      unidadPrincipal,
      actualizadoEl: new Date().toISOString()
    };

    try {
      if (this.isEditing && this.producto?.id) {

        //

        // no tiene por qué coincidir con el del producto, y las entradas

        const huellaPrecios = (lista) => (lista || [])
          .map(p => `${p.unidad}:${p.valor}`)
          .sort()
          .join('|');
        const cambioPrecio = huellaPrecios(this.producto.precios) !== huellaPrecios(precios);
        if (cambioPrecio) {
          await dbUtils.crearPuntoRestauracion('precios');
        }

        await db.productos.update(this.producto.id, datosProducto);

        toast.success('Producto actualizado');
      } else {
        const id = dbUtils.generarId('prod');
        await db.productos.add({ id, ...datosProducto });
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
    const baseIcon = principal.icon;

    const precioBase = precios.find(p => p.unidad === baseUnidad) || { valor: this.producto?.precio || 0 };
    const otrosPrecios = precios.filter(p => p.unidad !== baseUnidad);

    let html = `
      <div class="con-margen-abajo">
        <label for="unidad-principal" class="etiqueta">⭐ Unidad en la que se muestra el precio</label>
        <p class="micro tenue con-margen-abajo-chica">El precio que ves en el catálogo y en el pedido. El stock siempre se lleva en ${esc(tipoActual.unidadBase)}.</p>
        <select id="unidad-principal" name="unidadPrincipal" class="campo detalle">
          ${subs.map(s => `
            <option value="${escAttr(s.value)}" ${s.value === baseUnidad ? 'selected' : ''}>${esc(s.icon)} ${esc(s.label)}</option>
          `).join('')}
        </select>
      </div>

      <!-- Precio base (unidad principal) -->
      <div class="precio-item fila" data-unidad="${escAttr(baseUnidad)}">
        <span class="mediano">${esc(baseIcon)}</span>
        <span class="detalle medio crece">${esc(baseLabel)}</span>
        <div class="posicionado crece">
          <span class="buscador-lupa">$</span>
          <input
            type="number"
            name="precio_${baseUnidad}"
            class="campo campo-con-icono fuerte"
            step="0.01"
            min="0"
            placeholder="0.00"
            value="${precioBase.valor || ''}"
            inputmode="decimal"
          >
        </div>
        <span class="micro medio texto-marca">(principal)</span>
      </div>
    `;

    for (const sub of subs.filter(s => s.value !== baseUnidad)) {
      const precioSub = otrosPrecios.find(p => p.unidad === sub.value) || { valor: 0 };
      html += `
        <div class="precio-item fila" data-unidad="${escAttr(sub.value)}">
          <span class="mediano">${esc(sub.icon)}</span>
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
              value="${precioSub.valor || ''}"
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
 */
export async function abrirFormularioProducto(
  onSave,
  onClose,
  producto = null,
  onBuscarCodigo = null,
  onBorrarProducto = null
) {
  const form = new ProductoForm(onSave, onClose, producto, onBuscarCodigo, onBorrarProducto);
  await form.abrir();
  return form;
}
