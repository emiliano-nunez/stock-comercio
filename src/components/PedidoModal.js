import { dbUtils, getUnidadBase, claveProveedor } from '../db.js';
import { toast } from '../utils/toast.js';
import { esc, escAttr } from '../utils/html.js';

// El título que se manda arriba de todo cuando se copia o se envía el pedido
// entero. El mismo prefijo para WhatsApp y para el portapapeles, para que el
// texto sea reconocible de dónde salió en los dos casos.
const TITULO_PEDIDO = '*PEDIDO DE FALTANTES - Mi Comercio*';

// Los productos sin proveedor no van con los demás: no son un proveedor más,
// son productos para los que todavía no se escribió de dónde comprarlos. Van
// al final y con otro título, porque su destino es otro.
const TITULO_SIN_PROVEEDOR = 'SIN PROVEEDOR ASIGNADO';

/**
 * Cuánto pedir de un producto.
 *
 * Se calcula por producto y no por grupo para que la lista de la pantalla y el
 * texto que se copia no puedan desincronizarse entre sí.
 */
function lineaPedido(p) {
  const unidad = getUnidadBase(p.tipoVenta);
  const faltante = Math.max(0, (p.stockMinimo || 0) - (p.stock || 0));
  const sugerido = Math.ceil(faltante * 1.5);
  return `- ${p.nombre}: ${sugerido} ${unidad}`;
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
      // El nombre que se muestra es el primero que apareció, no la clave: la
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
function textoGrupo(grupo) {
  const lineas = grupo.productos.map(lineaPedido).join('\n');
  const titulo = grupo.clave ? grupo.nombre.toUpperCase() : TITULO_SIN_PROVEEDOR;
  return `${titulo}\n${lineas}`;
}

export class PedidoModal {
  constructor(onClose) {
    this.onClose = onClose;
    this.modal = null;
    this.productos = [];
    this.grupos = [];
  }
  
  async abrir() {
    this.productos = await dbUtils.getProductosStockBajo();
    this.grupos = agruparPorProveedor(this.productos);
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
            <h2 class="titulo">📋 Pedido de Faltantes</h2>
            <button id="cerrar-pedido" class="btn-fantasma btn-icono" aria-label="Cerrar">✕</button>
          </div>
          <div class="dialogo-cuerpo centro-texto">
            <span class="vacio-icono">✅</span>
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
        <div class="dialogo">
          <div class="dialogo-cabecera">
            <h2 class="titulo">📋 Pedido de Faltantes</h2>
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
            <div class="fila">
              <button id="btn-copiar" class="btn-principal btn-crece">
                📋 Copiar todo
              </button>
              <button id="btn-whatsapp" class="btn-secundario btn-crece fila-centro">
                <svg class="flecha-medio" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.454.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378 9.86 9.86 0 01-1.118-6.435 9.874 9.874 0 013.956-8.36 9.872 9.872 0 016.342 2.154 9.864 9.864 0 012.162 6.323 9.87 9.87 0 01-2.162 7.575c-.263.166-.547.298-.792.347-.13.024-.372.025-.52-.024zm3.707-10.154c-1.134.915-2.416 1.643-3.502 1.967-.45.137-.917.19-1.232.083-.44-.173-.862-.47-1.365-.958-.426-.41-.685-.788-.78-.97-.099-.173-.198-.359-.198-.52 0-.198.087-.33.25-.497.174-.163.733-.732 1.19-.83.117-.025.234-.024.336.049.106.074.198.173.33.273.297.223 1.134 1.152 1.365 1.355.163.149.149.313.1.437-.025.11-.249.223-.436.248l-.57.074c-.693.098-2.006.373-2.705 1.297-.75.978-.737 2.454-.668 2.793.084.39.33.713.669.94.436.297 1.212.388 1.84.273.766-.15 2.315-.732 2.766-2.097.33-1.004.05-2.035-.644-2.888z"/></svg>
              WhatsApp
            </button>
            </div>
            ${haySinProveedor ? `
              <button id="btn-copiar-sin-proveedor" class="btn-secundario btn-ancho">
                📋 Copiar los ${this.grupos.find(g => !g.clave).productos.length} que no tienen proveedor
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }
    
    modal.querySelector('#cerrar-pedido')?.addEventListener('click', () => this.cerrar());
    modal.querySelector('#cerrar-pedido-ok')?.addEventListener('click', () => this.cerrar());
    modal.querySelector('#btn-whatsapp')?.addEventListener('click', () => this.enviarWhatsApp());
    modal.querySelector('#btn-copiar')?.addEventListener('click', () => this.copiar(this.textoTodo(), 'Pedido completo copiado'));
    modal.querySelector('#btn-copiar-sin-proveedor')?.addEventListener('click', () => {
      this.copiar(this.textoGrupo(this.grupos.find(g => !g.clave)), 'Copiados los que no tienen proveedor');
    });
    
    // Un botón de copiar por grupo. Va por índice y no por la clave del
    // proveedor porque la clave lleva tildes y espacios normalizados: usarla
    // como atributo obligaría a escaparla, y es un dato que no hace falta
    // volver a escribir en el HTML.
    modal.querySelectorAll('.btn-copiar-grupo').forEach(btn => {
      btn.addEventListener('click', () => {
        const grupo = this.grupos[Number(btn.dataset.grupo)];
        this.copiar(textoGrupo(grupo), `Copiado el pedido de ${grupo.nombre || 'los que no tienen proveedor'}`);
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
          ${grupo.productos.map(p => {
            const unidad = getUnidadBase(p.tipoVenta);
            const stock = p.stock || 0;
            const minimo = p.stockMinimo || 0;
            const faltante = Math.max(0, minimo - stock);
            const sugerido = Math.ceil(faltante * 1.5);
            return `
              <div class="recuadro recuadro-suave fila fila-separada">
                <div class="crece ancho-cero">
                  <p class="medio cortado">${esc(p.nombre)}</p>
                  <p class="detalle apagado">Stock: <span class="fuerte ${stock === 0 ? 'texto-peligro' : 'texto-aviso'}">${stock} ${unidad}</span> / Mín: ${minimo} ${unidad}</p>
                </div>
                <span class="marca con-margen-izquierda">Pedir: ${sugerido}</span>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }
  
  /**
   * El pedido entero, con los proveedores de título.
   *
   * Va agrupado y no como una lista corrida porque el texto se manda por chat: un
   * bloque de treinta productos sin saber a quién van es algo que el usuario
   * tiene que ordenar a mano antes de escribirlo.
   */
  textoTodo() {
    return `${TITULO_PEDIDO}\n\n${this.grupos.map(textoGrupo).join('\n\n')}`;
  }
  
  enviarWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(this.textoTodo())}`, '_blank');
    toast.success('Abriendo WhatsApp...');
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

export async function abrirPedido(onClose) {
  const modal = new PedidoModal(onClose);
  await modal.abrir();
  return modal;
}
