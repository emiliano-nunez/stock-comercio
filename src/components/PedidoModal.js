import { dbUtils, getUnidadBase, claveProveedor } from '../db.js';
import { toast } from '../utils/toast.js';
import { esc, escAttr } from '../utils/html.js';
import { icono } from '../utils/iconos.js';

// El título que se manda arriba de todo del texto copiado, para que el
// proveedor reconozca de qué lista viene.
const TITULO_PEDIDO = '*PEDIDO DE FALTANTES - Mi Comercio*';

// Los productos sin proveedor no van con los demás: no son un proveedor más,
// son productos para los que todavía no se escribió de dónde comprarlos. Van
// al final y con otro título, porque su destino es otro.
const TITULO_SIN_PROVEEDOR = 'SIN PROVEEDOR ASIGNADO';

/**
 * Cuánto pedir de un producto si el usuario no dijo otra cosa.
 *
 * Es la diferencia entre el mínimo y lo que hay, redondeada hacia arriba y con
 * un 50% de margen. El mínimo es lo que el usuario escribió como "a partir de
 * acá me falta", así que la diferencia ya es lo que hay que reponer; el margen
 * es para que el mismo faltante no vuelva a aparecer la semana que viene.
 */
function sugerido(p) {
  const faltante = Math.max(0, (p.stockMinimo || 0) - (p.stock || 0));
  return Math.ceil(faltante * 1.5);
}

/**
 * Cuánto pedir de un producto.
 *
 * El valor sale de `cantidades`, que es lo que el usuario tocó en pantalla. Si
 * no tocó nada, es el sugerido. El sugerido no se vuelve a calcular al copiar:
 * si se recalculara, cambiar el stock desde el pedido haría que la cantidad
 * saltara sola mientras el usuario está escribiendo el mensaje al proveedor.
 */
function lineaPedido(p, cantidad) {
  const unidad = getUnidadBase(p.tipoVenta);
  return `- ${p.nombre}: ${cantidad} ${unidad}`;
}

/**
 * Reparte los productos por proveedor.
 *
 * La clave de agrupación no es el nombre tal cual: es la forma normalizada del
 * nombre (ver claveProveedor). "Lácteos del Sur" y "lácteos del sur" son el mismo
 * proveedor, y si se agruparan por el texto exacto el usuario recibiría dos
 * listas para mandarle al mismo lugar.
 *
 * Se agrupan por nombre, no por la primera aparición: el pedido se arma una vez
 * por semana y tiene que salir siempre en el mismo orden, o el usuario no
 * reconoce la lista.
 */
function agruparPorProveedor(productos) {
  const grupos = new Map();

  for (const p of productos) {
    const nombre = (p.proveedor || '').trim();
    const clave = nombre ? claveProveedor(nombre) : '';
    if (!grupos.has(clave)) {

      // clave no tiene mayúsculas ni tildes, y mostrarla sería mostrar algo que
      // el usuario nunca escribió.
      grupos.set(clave, { clave, nombre, productos: [] });
    }
    grupos.get(clave).productos.push(p);
  }

  const conNombre = [...grupos.values()]
    .filter(g => g.clave)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const sinNombre = grupos.get('');
  return sinNombre ? [...conNombre, sinNombre] : conNombre;
}

/**
 * El texto de un grupo, listo para pegar en un chat.
 *
 * El nombre del proveedor va arriba porque es a él a quien se le manda. Sin esa
 * línea, una lista de veinte productos sin nombres de fábrica no dice a quién
 * hay que pedirle cada cosa.
 */
function textoGrupo(grupo, cantidades) {
  const lineas = grupo.productos
    .map(p => lineaPedido(p, cantidades.get(p.id) ?? sugerido(p)))
    .join('\n');
  const titulo = grupo.clave ? grupo.nombre.toUpperCase() : TITULO_SIN_PROVEEDOR;
  return `${titulo}\n${lineas}`;
}

export class PedidoModal {
  constructor(onClose) {
    this.onClose = onClose;
    this.modal = null;
    this.productos = [];
    this.grupos = [];
    // Lo que el usuario pidió de cada producto. Se arma con el sugerido y se

    this.cantidades = new Map();
  }

  async abrir() {
    this.productos = await dbUtils.getProductosStockBajo();
    this.grupos = agruparPorProveedor(this.productos);
    this.cantidades = new Map(this.productos.map(p => [p.id, sugerido(p)]));
    this.modal = this.crearModal();
    document.body.appendChild(this.modal);

    await new Promise(r => requestAnimationFrame(r));

    this.handleKeydown = (e) => {
      if (e.key === 'Escape') this.cerrar();
    };
    document.addEventListener('keydown', this.handleKeydown);
  }

  crearModal() {
    const modal = document.createElement('div');
    modal.className = 'velo';

    if (this.productos.length === 0) {
      modal.innerHTML = `
        <div class="dialogo">
          <div class="dialogo-cabecera">
            <h2 class="titulo titulo-icono">${icono('etiqueta')}<span>Pedido de Faltantes</span></h2>
            <button id="cerrar-pedido" class="btn-fantasma btn-icono" aria-label="Cerrar">✕</button>
          </div>
          <div class="dialogo-cuerpo centro-texto">
            <span class="vacio-icono">${icono('verificar')}</span>
            <h3 class="subtitulo con-margen-arriba-amplia">¡Todo en orden!</h3>
            <p class="apagado con-margen-arriba">No hay productos por debajo del stock mínimo</p>
          </div>
          <div class="dialogo-pie">
            <button id="cerrar-pedido-ok" class="btn-principal btn-ancho">Entendido</button>
          </div>
        </div>
      `;
    } else {
      const haySinProveedor = this.grupos.some(g => !g.clave);
      modal.innerHTML = `
        <div class="dialogo dialogo-columna">
          <div class="dialogo-cabecera dialogo-cabecera-fija">
            <h2 class="titulo titulo-icono">${icono('etiqueta')}<span>Pedido de Faltantes</span></h2>
            <button id="cerrar-pedido" class="btn-fantasma btn-icono" aria-label="Cerrar">✕</button>
          </div>

          <div class="dialogo-cuerpo dialogo-cuerpo-scroll">
            <p class="detalle con-margen-abajo">
              ${this.productos.length} producto(s) por debajo del stock mínimo.
              ${haySinProveedor ? 'Cada proveedor va en su propia lista.' : ''}
            </p>

            ${this.grupos.map((grupo, indice) => this.renderGrupoHTML(grupo, indice)).join('')}
          </div>

          <div class="dialogo-pie dialogo-pie-fija apilado">
            ${haySinProveedor ? `
              <button id="btn-copiar-sin-proveedor" class="btn-secundario btn-ancho">
                📋 Copiar los ${this.grupos.find(g => !g.clave).productos.length} que no tienen proveedor
              </button>
            ` : ''}
            <button id="btn-copiar" class="btn-principal btn-ancho">
              📋 Copiar el pedido entero
            </button>
          </div>
        </div>
      `;
    }

    modal.querySelector('#cerrar-pedido')?.addEventListener('click', () => this.cerrar());
    modal.querySelector('#cerrar-pedido-ok')?.addEventListener('click', () => this.cerrar());
    modal.querySelector('#btn-copiar')?.addEventListener('click', () => this.copiar(this.textoTodo(), 'Pedido copiado'));
    modal.querySelector('#btn-copiar-sin-proveedor')?.addEventListener('click', () => {
      this.copiar(this.textoGrupo(this.grupos.find(g => !g.clave)), 'Copiados los que no tienen proveedor');
    });

    // proveedor porque la clave lleva tildes y espacios normalizados: usarla
    // como atributo obligaría a escaparla, y es un dato que no hace falta

    modal.querySelectorAll('.btn-copiar-grupo').forEach(btn => {
      btn.addEventListener('click', () => {
        const grupo = this.grupos[Number(btn.dataset.grupo)];
        this.copiar(this.textoGrupo(grupo), `Copiado el pedido de ${grupo.nombre || 'los que no tienen proveedor'}`);
      });
    });

    // diálogo y no uno por botón porque la lista se vuelve a pintar cada vez

    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pedido="cantidad"]');
      if (!btn) return;
      this.cambiarCantidad(btn.dataset.id, Number(btn.dataset.delta));
    });

    modal.querySelectorAll('.campo-cantidad').forEach(campo => {
      campo.addEventListener('change', () => {
        const n = Math.max(0, Math.round(Number(campo.value) || 0));
        campo.value = n;
        this.cantidades.set(campo.dataset.id, n);
      });
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.cerrar();
    });

    return modal;
  }

  /**
   * Un proveedor con su lista y su botón de copiar.
   *
   * El botón va en la cabecera del grupo y no en el pie del diálogo porque cada
   * lista se manda por separado: el usuario copia la de un proveedor, la pega en
   * el chat de ese proveedor, y sigue con el siguiente.
   */
  renderGrupoHTML(grupo, indice) {
    return `
      <section class="con-margen-abajo-amplia">
        <div class="fila fila-separada con-margen-abajo-chica">
          <h3 class="subtitulo crece ${grupo.clave ? '' : 'texto-aviso'}">
            ${grupo.clave ? '🚚' : '❓'} ${esc(grupo.nombre || 'Sin proveedor')}
          </h3>
          <button
            class="btn-secundario detalle no-crece btn-copiar-grupo"
            data-grupo="${indice}"
            aria-label="Copiar el pedido de ${escAttr(grupo.nombre || 'los productos sin proveedor')}"
          >📋 Copiar</button>
        </div>

        ${grupo.clave ? '' : `
          <p class="micro apagado con-margen-abajo">
            Estos ${grupo.productos.length} productos no tienen proveedor. Se pueden pedir juntos, pero no sabés a quién mandárselos.
          </p>
        `}

        <div class="apilado">
          ${grupo.productos.map(p => this.renderFilaHTML(p)).join('')}
        </div>
      </section>
    `;
  }

  /**
   * Un producto del pedido: el stock se lee, la cantidad a pedir se ajusta.
   *
   * El stock NO lleva botones. Ajustarlo desde acá lo ponía a la misma altura
   * que la cantidad a pedir, que es lo que uno viene a cambiar, y hacía dudar
   * de cuál de los dos números estaba editando. El ajuste de stock vive en la
   * hoja del producto, donde el usuario lo está mirando con todos los datos
   * al lado.
   *
   * El de "Pedir" sí lleva botones de más y menos porque se usa mucho y con el
   * dedo, y además acepta escritura directa: hay cantidades que con botones de
   * a uno hay que tocar treinta veces.
   */
  renderFilaHTML(p) {
    const unidad = getUnidadBase(p.tipoVenta);
    const stock = p.stock || 0;
    const minimo = p.stockMinimo || 0;
    const cantidad = this.cantidades.get(p.id) ?? sugerido(p);
    const estadoStock = stock === 0 ? 'texto-peligro' : stock <= minimo ? 'texto-aviso' : 'texto-marca';

    return `
      <div class="recuadro recuadro-suave fila fila-separada fila-amplia envuelto">
        <div class="crece ancho-cero">
          <p class="medio cortado">${esc(p.nombre)}</p>
          <p class="micro apagado">
            Tenés <span class="fuerte ${estadoStock}">${stock} ${esc(unidad)}</span> · mínimo ${minimo}
          </p>
        </div>

        <div class="fila no-crece">
          <span class="micro tenue">Pedir</span>
          <div class="fila fila-corta">
            <button type="button" class="btn-resta" data-pedido="cantidad" data-id="${escAttr(p.id)}" data-delta="-1"
              aria-label="Pedir menos ${escAttr(p.nombre)}">−</button>
            <input type="number" class="campo-numero campo-cantidad" data-id="${escAttr(p.id)}"
              value="${cantidad}" min="0" inputmode="numeric"
              aria-label="Cantidad a pedir de ${escAttr(p.nombre)}">
            <button type="button" class="btn-suma" data-pedido="cantidad" data-id="${escAttr(p.id)}" data-delta="1"
              aria-label="Pedir más ${escAttr(p.nombre)}">+</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Cambia la cantidad a pedir de un producto.
   *
   * Sólo repinta el número de esa fila, no la lista entera: repintar todo
   * mientras el usuario va tocando producto por producto lo haría saltar, y en
   * una lista de veinte eso es inservizable.
   */
  cambiarCantidad(id, delta) {
    const actual = this.cantidades.get(id) ?? 0;
    const nuevo = Math.max(0, actual + delta);
    this.cantidades.set(id, nuevo);
    const campo = this.modal.querySelector(`.campo-cantidad[data-id="${CSS.escape(id)}"]`);
    if (campo) campo.value = nuevo;
  }

  /**
   * El pedido entero, con los proveedores de título.
   *
   * Va agrupado y no como una lista corrida porque el texto se manda por chat: un
   * bloque de treinta productos sin saber a quién van es algo que el usuario
   */
  textoTodo() {
    return `${TITULO_PEDIDO}\n\n${this.grupos.map(g => this.textoGrupo(g)).join('\n\n')}`;
  }

  textoGrupo(grupo) {
    return textoGrupo(grupo, this.cantidades);
  }

  async copiar(texto, mensaje) {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(mensaje);
    } catch (error) {
      console.error(error);
      toast.error('No se pudo copiar');
    }
  }

  cerrar() {
    if (this.handleKeydown) {
      document.removeEventListener('keydown', this.handleKeydown);
      this.handleKeydown = null;
    }

    // Idempotente: evita que dos llamadas seguidas disparen onClose dos veces
    if (this._cerrando) return;
    this._cerrando = true;

    if (this.modal) {
      this.modal.classList.add('anim-bajar');
      this.modal.classList.remove('anim-subir');

      setTimeout(() => {
        if (this.modal && this.modal.parentNode) {
          this.modal.remove();
        }
        this.modal = null;
        if (this.onClose) this.onClose();
      }, 200);
    } else if (this.onClose) {
      this.onClose();
    }
  }
}

/**
 * Abre el pedido de faltantes.
 *
 * @param {Function} onClose  se llama al cerrar
 */
export async function abrirPedido(onClose) {
  const modal = new PedidoModal(onClose);
  await modal.abrir();
  return modal;
}
