import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { dbUtils } from '../db.js';
import { esc } from '../utils/html.js';

export class ScannerModal {
  constructor(onScan) {
    this.onScan = onScan;
    this.scanner = null;
    this.modal = null;
    this.isScanning = false;
    // Pasa a true en cuanto el usuario cierra el modal (a mano o por código).
    // Lo consulta el callback diferido de onCodigoDetectado para no abrir el
    // formulario de producto sobre un escáner que el usuario ya descartó.
    this._cerrado = false;
  }
  
  async abrir() {
    this._cerrado = false;
    this.escanerFallido = false;
    this.isScanning = false;
    this.modal = this.crearModal();
    document.body.appendChild(this.modal);
    
    await new Promise(r => requestAnimationFrame(r));
    
    try {
      await this.iniciarEscaneo();
    } catch (error) {
      // El modal se deja abierto mostrando el error: iniciarEscaneo() ya lo
      // escribe en #scanner-status con un mensaje accionable. Antes se cerraba
      // aquí, así que el usuario veía desaparecer el modal sin explicación.
      this.escanerFallido = true;
      console.error('No se pudo iniciar el escáner:', error);
    }
  }
  
  crearModal() {
    const modal = document.createElement('div');
    modal.className = 'velo';
    modal.innerHTML = `
      <div class="dialogo dialogo-sin-desplazar">
        <!-- Header -->
        <div class="dialogo-cabecera">
          <h2 class="titulo">🔍 Escanear Código</h2>
          <button id="cerrar-scanner" class="btn-fantasma btn-icono" aria-label="Cerrar escáner">
            ✕
          </button>
        </div>
        
        <!-- Visor del escáner -->
        <div class="marco-video">
          <div id="scanner-container" class="visor-video"></div>
          
          <!-- Marco de escaneo visual -->
          <div class="capa-centrada">
            <div class="marco-escaner">
              <div class="pista">
                Coloca el código dentro del marco
              </div>
            </div>
          </div>
        </div>
        
        <!-- Estado -->
        <div id="scanner-status" class="dialogo-cuerpo centro-texto detalle apagado pie-suave">
          Iniciando cámara...
        </div>
      </div>
    `;
    
    modal.querySelector('#cerrar-scanner').addEventListener('click', () => this.cerrar());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.cerrar();
    });
    
    return modal;
  }
  
  async iniciarEscaneo() {
    // Verificar contexto seguro (HTTPS o localhost)
    const esContextoSeguro = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    
    if (!esContextoSeguro) {
      // No se reintenta: sin HTTPS no hay solución, hace falta escribir el código.
      this.mostrarError(
        'El lector de la cámara necesita HTTPS. Esta página está abierta por HTTP, y los navegadores sólo dan la cámara en conexiones seguras.',
        { reintentable: false }
      );
      throw new Error('El escáner requiere HTTPS');
    }
    
    this.scanner = new Html5Qrcode('scanner-container');
    
    try {
      // Obtener cámaras disponibles
      const cameras = await Html5Qrcode.getCameras();
      let cameraId = null;
      
      // Preferir cámara trasera en móvil, frontal en desktop
      const isMobile = /Android|iPhone|iPad|iPod|mobile/i.test(navigator.userAgent);
      if (isMobile) {
        const backCam = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('rear') || c.label.toLowerCase().includes('environment'));
        cameraId = backCam?.id || cameras[0]?.id;
      } else {
        // Desktop: usar la primera disponible (webcam frontal)
        cameraId = cameras[0]?.id;
      }
      
      if (!cameraId) {
        throw new Error('No se encontraron cámaras');
      }
      
      // Configuración optimizada para códigos de barras 1D (EAN, UPC, etc.)
      const config = {
        fps: 15,
        /*
         * La zona que se escanea tiene que ser una FUNCIÓN, no un objeto.
         *
         * html5-qrcode interpreta distinto cada forma: un número suelto es una
         * fracción del visor, una función recibe el ancho y alto reales del
         * visor, y un objeto {width, height} son PÍXELES ABSOLUTOS. Con un
         * objeto de 0.8 x 0.4 la zona medía 0,8 píxeles, la librería tiraba
         * "minimum size of 'config.qrbox' dimension value is 50px" y el bucle
         * que decodifica los cuadros nunca llegaba a correr. Se veía la cámara
         * y no se detectaba nada, sin ningún error en pantalla.
         *
         * Como función se mide sobre el visor real. Va ancha y baja porque los
         * códigos de barras son una línea horizontal, y siempre por encima de los
         * 50px que la librería exige en cada lado.
         */
        qrbox: (ancho, alto) => ({
          width: Math.max(50, Math.round(ancho * 0.9)),
          height: Math.max(50, Math.min(alto * 0.5, Math.round(alto * 0.4))),
        }),
        aspectRatio: undefined, // Dejar que use el nativo de la cámara
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
        disableFlip: false,
      };
      
      await this.scanner.start(
        cameraId,
        config,
        (decodedText, decodedResult) => this.onCodigoDetectado(decodedText),
        (errorMessage) => {
          // Ignorar errores de escaneo continuo (normal)
        }
      );
      
      /*
       * start() resuelve cuando la cámara ya se está viendo, y eso NO significa
       * que se esté escaneando: la librería arma el bucle de decodificación
       * después, y si algo falla en el medio el error se pierde dentro del
       * callback. isScanning es la única señal de que ese bucle arrancó.
       *
       * Sin esta espera, un fallo así se ve como un escáner que funciona: la
       * cámara en pantalla y el cartel de "apunta la cámara" para siempre.
       */
      await new Promise(r => setTimeout(r, 300));
      if (!this.scanner.isScanning) {
        throw new Error('La cámara se abrió pero el lector no pudo arrancar.');
      }
      
      this.isScanning = true;
      const statusEl = this.modal.querySelector('#scanner-status');
      statusEl.textContent = 'Apunta la cámara al código de barras';
      statusEl.className = 'dialogo-cuerpo centro-texto detalle texto-marca pie-suave';
      
    } catch (error) {
      console.error('Error iniciando escáner:', error);
      await this.soltarCamara();
      // Mensaje según la causa, en lugar de uno genérico que no dice nada
      let mensaje = 'No se pudo acceder a la cámara.';
      if (error?.name === 'NotAllowedError') {
        mensaje = 'Permisos de cámara denegados. Actívalos en el candado de la barra de direcciones.';
      } else if (error?.name === 'NotFoundError') {
        mensaje = 'No se encontró ninguna cámara en este dispositivo.';
      } else if (error?.name === 'NotReadableError') {
        mensaje = 'La cámara está siendo usada por otra aplicación.';
      } else if (error?.message) {
        mensaje = error.message;
      }
      this.mostrarError(mensaje);
      throw error;
    }
  }
  
  /**
   * Apaga la cámara aunque el escáner no llegó a marcarse como escaneando.
   *
   * Si el arranque falla después de que la cámara ya arrancó, el foco queda
   * encendido en el teléfono y el próximo intento choca contra un stream vivo.
   * Por eso no alcanza con detenerEscaneo(), que sólo actúa cuando isScanning
   * está en true.
   */
  async soltarCamara() {
    this.isScanning = false;
    if (!this.scanner) return;
    try {
      await this.scanner.clear();
    } catch {
      // clear() tira si el escáner nunca llegó a renderizar. No hay nada que soltar.
    }
  }
  
  /**
   * Deja el escáner en un estado donde no puede escanear y explica qué pasó.
   *
   * Además de avisar, ofrece escribir el código a mano. No siempre hay salida:
   * sin HTTPS, sin permiso de cámara o con otra app usando la cámara, el lector
   * no tiene arreglo, y obligar al usuario a cerrar y buscar el código en el
   * buscador era un rodeo por algo que se resuelve en la misma pantalla.
   */
  mostrarError(mensaje, { reintentable = true } = {}) {
    const statusEl = this.modal?.querySelector('#scanner-status');
    if (!statusEl) return;
    
    // El visor se apaga. Si queda encendido detrás del error, el video sigue
    // corriendo y el usuario cree que todavía está leyendo.
    this.modal.querySelector('.marco-video')?.classList.add('oculto');
    this.isScanning = false;
    
    statusEl.className = 'dialogo-cuerpo centro-texto detalle apilado-3';
    statusEl.innerHTML = `
      <p class="texto-peligro">${esc(mensaje)}</p>
      <p class="apagado">La cámara no va a servir para leer el código. Podés apagarla y escribirlo vos mismo: la app trabaja igual.</p>
      <div class="apilado">
        <button id="btn-codigo-a-mano" class="btn-principal">⌨️ Escribir el código a mano</button>
        ${reintentable ? '<button id="btn-reintentar-scanner" class="btn-secundario">🔄 Reintentar la cámara</button>' : ''}
      </div>
    `;
    
    statusEl.querySelector('#btn-codigo-a-mano')?.addEventListener('click', () => this.mostrarCampoCodigo());
    
    if (reintentable) {
      statusEl.querySelector('#btn-reintentar-scanner')?.addEventListener('click', async () => {
        statusEl.className = 'dialogo-cuerpo centro-texto detalle apagado';
        statusEl.textContent = 'Reintentando...';
        this.modal.querySelector('.marco-video')?.classList.remove('oculto');
        try {
          await this.iniciarEscaneo();
        } catch {
          // mostrarError() ya dejó el mensaje en el DOM
        }
      });
    }
  }
  
  /**
   * El campo para escribir el código a mano.
   *
   * Se arma como form y no como un input suelto para que la tecla Enter mande
   * el mismo código que el botón, que es lo que espera cualquiera que esté
   * tipeando un código de barras.
   */
  mostrarCampoCodigo() {
    const statusEl = this.modal.querySelector('#scanner-status');
    this.isScanning = false;
    
    statusEl.className = 'dialogo-cuerpo centro-texto detalle apilado-3';
    statusEl.innerHTML = `
      <p class="medio">Escribí el código de barras</p>
      <form id="form-codigo-manual" class="apilado" novalidate>
        <input
          type="text"
          id="campo-codigo-manual"
          class="campo"
          inputmode="numeric"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="Ej: 7791234567890"
          aria-label="Código de barras"
        >
        <p id="aviso-codigo-manual" class="texto-peligro oculto">Poné el código y volvé a buscar.</p>
        <button type="submit" class="btn-principal">Buscar este código</button>
      </form>
    `;
    
    const form = statusEl.querySelector('#form-codigo-manual');
    const campo = statusEl.querySelector('#campo-codigo-manual');
    const aviso = statusEl.querySelector('#aviso-codigo-manual');
    
    // El foco abre el teclado al toque, sin que el usuario tenga que tocar el
    // campo: en un teléfono es un toque menos y el teclado tapa la mitad de la
    // pantalla.
    campo.focus();
    
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const codigo = campo.value.trim();
      if (!codigo) {
        aviso.classList.remove('oculto');
        campo.focus();
        return;
      }
      aviso.classList.add('oculto');
      this.resolverCodigo(codigo);
    });
  }
  
  async onCodigoDetectado(codigo) {
    if (!this.isScanning) return;
    
    this.isScanning = false;
    
    // Vibración háptica
    if (navigator.vibrate) {
      navigator.vibrate(200);
    }
    
    // Sonido de beep (opcional)
    this.reproducirBeep();
    
    // Actualizar UI
    const statusEl = this.modal.querySelector('#scanner-status');
    statusEl.textContent = `✅ Código detectado: ${codigo}`;
    statusEl.className = 'dialogo-cuerpo centro-texto detalle texto-marca-fuerte';
    
    await this.resolverCodigo(codigo, 800);
  }
  
  /**
   * Cierra el escáner y le entrega el código a la app, exista o no en la base.
   *
   * Lo usan tanto el código leído por la cámara como el que escribió el usuario a
   * mano: si cada uno armara su propio camino, el que escribe a mano se
   * saltaría la búsqueda de duplicados y el diálogo de código repetido.
   *
   * La espera deja tiempo para que se vea el "código detectado" antes de que el
   * modal se vaya. El código escrito a mano no la necesita: no hay de qué
   * taparse la vista.
   */
  async resolverCodigo(codigo, espera = 0) {
    // Se piden TODOS los que coinciden, no sólo el primero: el índice de
    // codigoBarras no es único, y con .first() el usuario veía un producto
    // arbitrario sin enterarse de que había otro con el mismo código.
    //
    // Se pasa la lista entera y no "el primero + cuántos hay": el diálogo de
    // código repetido tiene que poder nombrar los productos en conflicto para
    // que el usuario elija, y con un primero + un número no hay nada que elegir.
    const coincidencias = await dbUtils.buscarPorCodigoBarras(codigo);
    
    await this.detenerEscaneo();
    
    if (espera > 0) {
      await new Promise(r => setTimeout(r, espera));
    }
    
    // Si en esos milisegundos el usuario cerró el escáner a mano (✕, Escape o
    // clic fuera), se respeta su decisión: no se le abre el formulario del
    // producto encima del escáner que acaba de descartar.
    if (this._cerrado) return;
    
    // await: el modal debe salir del DOM antes de que se abra el formulario.
    await this.cerrar();
    this.onScan(codigo, coincidencias);
  }
  
  async detenerEscaneo() {
    if (this.scanner && this.isScanning) {
      try {
        await this.scanner.stop();
      } catch (e) {
        // Ignorar errores al detener
      }
      this.isScanning = false;
    }
  }
  
  reproducirBeep() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      setTimeout(() => oscillator.stop(), 100);
    } catch (e) {
      // Ignorar si no hay soporte de audio
    }
  }
  
  /**
   * Cierra el escáner. Idempotente y devuelve una promesa que se resuelve
   * cuando el modal ya salió del DOM.
   *
   * La promesa la necesita onCodigoDetectado(): su callback corre 800 ms
   * después del escaneo y debe esperar a que el modal desaparezca antes de abrir
   * el formulario del producto, para no montar uno sobre el otro.
   */
  cerrar() {
    if (this._cerrado) return Promise.resolve();
    this._cerrado = true;
    
    this.detenerEscaneo();
    
    if (!this.modal) return Promise.resolve();
    
    this.modal.classList.add('anim-bajar');
    this.modal.classList.remove('anim-subir');
    
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.modal && this.modal.parentNode) {
          this.modal.remove();
        }
        this.modal = null;
        resolve();
      }, 200);
    });
  }
}

export async function abrirScanner(onScan) {
  const scanner = new ScannerModal(onScan);
  await scanner.abrir();
  return scanner;
}