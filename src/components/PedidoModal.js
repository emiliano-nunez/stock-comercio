import { db, dbUtils, getUnidadBase } from '../db.js';
import { toast } from '../utils/toast.js';
import { esc } from '../utils/html.js';

// Calcular cuánto pedir de cada producto con stock bajo.
// Se usa en las 3 vistas (lista, WhatsApp y portapapeles) para que no se
// desincronicen entre sí.
function calcularLineasPedido(productos) {
  return productos.map(p => {
    const unidad = getUnidadBase(p.tipoVenta);
    const faltante = Math.max(0, (p.stockMinimo || 0) - (p.stock || 0));
    const sugerido = Math.ceil(faltante * 1.5); // Sugerir 50% más
    return `- ${p.nombre}: ${sugerido} ${unidad}`;
  }).join('\n');
}

export class PedidoModal {
  constructor(onClose) {
    this.onClose = onClose;
    this.modal = null;
    this.productos = [];
  }
  
  async abrir() {
    this.productos = await dbUtils.getProductosStockBajo();
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
      // `lineas`/`textoPedido` no se usan en el HTML, sólo en WhatsApp y
      // portapapeles. Se calculan bajo demanda con calcularLineasPedido().
      modal.innerHTML = `
        <div class="dialogo">
          <div class="dialogo-cabecera">
            <h2 class="titulo">📋 Pedido de Faltantes</h2>
            <button id="cerrar-pedido" class="btn-fantasma btn-icono" aria-label="Cerrar">✕</button>
          </div>
          <div class="dialogo-cuerpo dialogo-cuerpo-scroll">
            <p class="detalle con-margen-abajo">${this.productos.length} producto(s) por debajo del stock mínimo:</p>
            <div class="apilado">
              ${this.productos.map(p => {
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
          </div>
          <div class="dialogo-pie apilado">
            <button id="btn-whatsapp" class="btn-principal btn-ancho fila-centro">
              <svg class="flecha-medio" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.454.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378 9.86 9.86 0 01-1.118-6.435 9.874 9.874 0 013.956-8.36 9.872 9.872 0 016.342 2.154 9.864 9.864 0 012.162 6.323 9.87 9.87 0 01-2.162 7.575c-.263.166-.547.298-.792.347-.13.024-.372.025-.52-.024zm3.707-10.154c-1.134.915-2.416 1.643-3.502 1.967-.45.137-.917.19-1.232.083-.44-.173-.862-.47-1.365-.958-.426-.41-.685-.788-.78-.97-.099-.173-.198-.359-.198-.52 0-.198.087-.33.25-.497.174-.163.733-.732 1.19-.83.117-.025.234-.024.336.049.106.074.198.173.33.273.297.223 1.134 1.152 1.365 1.355.163.149.149.313.1.437-.025.11-.249.223-.436.248l-.57.074c-.693.098-2.006.373-2.705 1.297-.75.978-.737 2.454-.668 2.793.084.39.33.713.669.94.436.297 1.212.388 1.84.273.766-.15 2.315-.732 2.766-2.097.33-1.004.05-2.035-.644-2.888z"/></svg>
              Enviar por WhatsApp
            </button>
            <button id="btn-copiar" class="btn-secundario btn-ancho fila-centro">
              📋 Copiar texto
            </button>
          </div>
        </div>
      `;
    }
    
    modal.querySelector('#cerrar-pedido')?.addEventListener('click', () => this.cerrar());
    modal.querySelector('#cerrar-pedido-ok')?.addEventListener('click', () => this.cerrar());
    modal.querySelector('#btn-whatsapp')?.addEventListener('click', () => this.enviarWhatsApp());
    modal.querySelector('#btn-copiar')?.addEventListener('click', () => this.copiarTexto());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.cerrar();
    });
    
    return modal;
  }
  
  enviarWhatsApp() {
    const texto = `*PEDIDO DE FALTANTES - Mi Comercio*\n${calcularLineasPedido(this.productos)}`;
    const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
    
    window.open(url, '_blank');
    toast.success('Abriendo WhatsApp...');
  }
  
  async copiarTexto() {
    const texto = `*PEDIDO DE FALTANTES - Mi Comercio*\n${calcularLineasPedido(this.productos)}`;
    
    try {
      await navigator.clipboard.writeText(texto);
      toast.success('Texto copiado al portapapeles');
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