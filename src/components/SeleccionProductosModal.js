import { esc, escAttr } from '../utils/html.js';
import { icono } from '../utils/iconos.js';

/**
 * Selector de productos en lote para una categoría o un proveedor.
 *
 * Antes la única forma de sacarle una categoría a diez productos era abrir cada
 * ficha y tildarla a mano. Acá se eligen de a varios, sin salir de la pantalla
 * de categorías.
 *
 * La selección ES el resultado: lo que queda tildado después de guardar es lo
 * que va a tener la categoría o el proveedor, y lo que no queda tildado, no.
 * Por eso arrancan tildados los que ya lo tienen hoy. Tildar uno nuevo lo
 * agrega y destildar uno viejo lo saca, y el usuario no tiene que elegir entre
 * esas dos cosas: no son dos botones, es la misma confirmación.
 *
 * @param {Object}   opciones
 * @param {'categoria'|'proveedor'} opciones.tipo  qué se está gestionando.
 * @param {string}   opciones.nombre   el nombre de esa categoría o proveedor.
 * @param {string}   [opciones.color]  el punto de color, sólo para categorías.
 * @param {Array}    opciones.productos  el inventario completo, ya cargado.
 * @param {(p: object) => boolean} opciones.yaTiene  si el producto ya está en
 *   esa categoría o ya tiene ese proveedor.
 * @returns {Promise<{accion: string, ids: string[]}>} `accion` es una de:
 *   'guardar' | 'catalogo' | 'cancelar'.
 */
export function abrirSeleccionProductos({ tipo, nombre, color, productos, yaTiene }) {
  return new Promise((resolve) => {

    // Con el inventario entero pintado en cada pantalla el diálogo se volvía
    // lento, así que se muestran hasta estas filas y el buscador es la forma
    // de llegar al resto: si hay más, se avisa y se pide acotar.
    const MAX_FILAS = 60;

    const esCategoria = tipo === 'categoria';

    let seleccion = new Set(productos.filter(yaTiene).map(p => p.id));
    let texto = '';
    let yaEnfocoElBuscador = false;

    const box = document.createElement('div');
    box.className = 'velo';

    const cerrar = (valor) => {
      box.remove();
      document.removeEventListener('keydown', onKey);
      resolve(valor);
    };
    const onKey = (e) => { if (e.key === 'Escape') cerrar({ accion: 'cancelar', ids: [] }); };

    const coincide = (p) => {
      if (!texto) return true;
      const buscado = texto.toLowerCase();
      return String(p.nombre || '').toLowerCase().includes(buscado)
        || String(p.codigoBarras || '').toLowerCase().includes(buscado);
    };

    function filaProducto(p) {
      const dentro = yaTiene(p);
      const marcada = seleccion.has(p.id);

      /*
       * La etiqueta de estado. En categorías dice si ya la tiene; en
       * proveedores dice el que hoy tiene, porque un producto sólo puede tener
       * UNO y agregarle el nuevo reemplaza al actual --eso el usuario tiene
       * que verlo antes de tocar el botón, no después.
       */
      const estado = esCategoria
        ? (dentro ? '<span class="etiqueta-tenue no-crece">En la categoría</span>' : '')
        : (p.proveedor
            ? `<span class="micro apagado cortado">Ahora: ${esc(p.proveedor)}</span>`
            : '<span class="micro tenue">Sin proveedor</span>');

      return `
        <li
          class="fila-tocable fila-lista ${marcada ? 'opcion-elegida' : ''}"
          role="option"
          data-id="${escAttr(p.id)}"
          aria-selected="${marcada}"
        >
          <span class="columna crece ancho-cero">
            <span class="medio cortado">${esc(p.nombre)}</span>
            ${estado}
          </span>
          <span class="casilla-lista ${marcada ? 'casilla-lista-marcada' : ''}" aria-hidden="true">${icono('verificar')}</span>
        </li>
      `;
    }

    /*
     * Tildar no repinta la lista: sólo se toca la fila que se tocó y el pie.
     *
     * Repintar entero por cada tildado hacía dos cosas mal. La primera es que
     * se perdía la posición del scroll: tildar un producto de la fila cuarenta
     * devolvía la lista al principio, y para tildar el siguiente había que
     * buscarlo de nuevo. La segunda es que se reemplazaban todos los nodos, y
     * con eso el navegador perdía el foco de donde estuviera.
     */
    function alternar(id) {
      if (seleccion.has(id)) seleccion.delete(id);
      else seleccion.add(id);

      const marcada = seleccion.has(id);
      // `CSS.escape` y no entrecomillar a mano: el id viene del dato del
      // usuario (una copia de seguridad puede traer cualquier cosa) y con una
      // comilla adentro el selector no encontraría el nodo.
      const fila = box.querySelector(`.fila-lista[data-id="${CSS.escape(id)}"]`);
      if (fila) {
        fila.classList.toggle('opcion-elegida', marcada);
        fila.setAttribute('aria-selected', String(marcada));
        fila.querySelector('.casilla-lista')?.classList.toggle('casilla-lista-marcada', marcada);
      }

      actualizarPie();
    }

    /**
     * El contador de elegidos, con la lista ya tildada.
     *
     * Guardar no se apaga nunca. Una selección vacía es una orden válida
     * --saca lo que hoy tenía la categoría o el proveedor-- y además es el caso
     * de la categoría recién creada, que no tiene a nadie tildado todavía y
     * con el botón apagado no podría recibir su primer producto.
     */
    function actualizarPie() {
      const n = seleccion.size;

      const contador = box.querySelector('[data-contador]');
      if (contador) contador.textContent = n === 0
        ? ''
        : `${n} ${n === 1 ? 'producto elegido' : 'productos elegidos'}`;
    }

    function pintar() {
      const visibles = productos.filter(coincide);
      const aMostrar = visibles.slice(0, MAX_FILAS);
      const ocultos = visibles.length - aMostrar.length;

      box.innerHTML = `
        <div class="dialogo">
          <div class="dialogo-cabecera">
            <h2 class="titulo fila ancho-cero">
              ${esCategoria
                ? `<span class="punto no-crece" style="background-color: ${escAttr(color || '#64748B')}"></span>`
                : `<span class="no-crece">${icono('proveedor')}</span>`}
              <span class="cortado">${esc(nombre)}</span>
            </h2>
            <button class="btn-fantasma btn-icono no-crece" data-accion="cancelar" aria-label="Cerrar">✕</button>
          </div>

          <div class="dialogo-cuerpo apilado-3">
            <label class="solo-lector" for="selector-buscar">Buscar productos</label>
            <div class="posicionado">
              <input
                type="search"
                id="selector-buscar"
                class="campo buscador-campo"
                placeholder="Buscar por nombre o código"
                value="${escAttr(texto)}"
                autocomplete="off"
              >
              <span class="buscador-lupa">${icono('buscar')}</span>
            </div>

            ${visibles.length === 0 ? `
              <p class="detalle apagado centro-texto con-margen-arriba">
                ${productos.length === 0
                  ? 'Todavía no hay productos en el inventario.'
                  : `Ningún producto coincide con "${esc(texto)}"`}
              </p>
            ` : `
              <ul class="apilado" role="listbox" aria-multiselectable="true">
                ${aMostrar.map(filaProducto).join('')}
              </ul>
            `}

            ${ocultos > 0
              ? `<p class="detalle apagado centro-texto">y ${ocultos} más · usá el buscador para acotar</p>`
              : ''}

            <p class="detalle centro-texto marca" data-contador></p>
          </div>

          <div class="dialogo-pie apilado pie-acciones">
            <div class="fila">
              <button class="btn-secundario btn-crece" data-accion="catalogo">
                ${icono('caja')}<span>Ver en el catálogo</span>
              </button>
              <button class="btn-principal" data-accion="guardar">
                ${icono('verificar')}<span>Guardar</span>
              </button>
            </div>
          </div>
        </div>
      `;

      // El contador se pinta junto con la lista y no recién al primer tildado:
      // la selección ya arranca con los que hoy tienen la categoría o el
      // proveedor, y sin esto el pie decía "vacío" con tres productos tildados.
      actualizarPie();

      // El foco va al buscador sólo la primera vez: robarlo en cada repintado
      // dejaría la lista scrolleada al principio cada vez que se tilda algo.
      if (!yaEnfocoElBuscador) {
        box.querySelector('#selector-buscar')?.focus();
        yaEnfocoElBuscador = true;
      }
    }

    box.addEventListener('click', (e) => {
      if (e.target === box) return cerrar({ accion: 'cancelar', ids: [] });

      const fila = e.target.closest('.fila-lista[data-id]');
      if (fila) return alternar(fila.dataset.id);

      const boton = e.target.closest('[data-accion]');
      if (!boton || boton.disabled) return;

      const accion = boton.dataset.accion;
      if (accion === 'cancelar') return cerrar({ accion: 'cancelar', ids: [] });
      if (accion === 'catalogo') return cerrar({ accion: 'catalogo', ids: [] });
      return cerrar({ accion, ids: [...seleccion] });
    });

    /*
     * El buscador se escucha en `input`, y cada tecla vuelve a pintar la lista
     * entera con lo que filtra. Como el repintado reemplaza el campo, hay que
     * devolverle el foco y poner el cursor al final: sin eso, escribir
     * "harina" quedaba en "h" y con el campo vacío.
     */
    box.addEventListener('input', (e) => {
      if (e.target.id !== 'selector-buscar') return;
      texto = e.target.value;
      const foco = document.activeElement === e.target;
      pintar();
      if (foco) {
        const campo = box.querySelector('#selector-buscar');
        campo?.focus();
        campo?.setSelectionRange(texto.length, texto.length);
      }
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(box);
    pintar();
  });
}
