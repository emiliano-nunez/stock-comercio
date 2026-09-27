import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { dbUtils } from '../db.js';

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
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content relative overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-gray-100 bg-primary-50 rounded-t-2xl">
          <h2 class="text-touch-lg font-bold text-gray-900">🔍 Escanear Código</h2>
          <button id="cerrar-scanner" class="btn-ghost p-2" aria-label="Cerrar escáner">
            ✕
          </button>
        </div>
        
        <!-- Visor del escáner -->
        <div class="relative bg-black p-2">
          <div id="scanner-container" class="w-full aspect-square rounded-xl overflow-hidden"></div>
          
          <!-- Marco de escaneo visual -->
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div class="w-3/4 h-3/4 border-4 border-primary-500/50 rounded-xl 
                        before:content-[''] before:absolute before:top-[-6px] before:left-[-6px] before:w-8 before:h-8 before:border-t-4 before:border-l-4 before:border-primary-500
                        after:content-[''] after:absolute after:top-[-6px] after:right-[-6px] after:w-8 after:h-8 after:border-t-4 after:border-r-4 after:border-primary-500
                        relative">
              <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 text-white text-xs bg-black/70 px-2 py-1 rounded whitespace-nowrap">
                Coloca el código dentro del marco
              </div>
            </div>
          </div>
        </div>
        
        <!-- Estado -->
        <div id="scanner-status" class="p-4 text-center text-sm text-gray-500 bg-gray-50">
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
        '🔒 El escáner requiere HTTPS. En red local (HTTP) no funciona. Escribe el código a mano o despliega en Vercel/Netlify para HTTPS gratis.',
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
        // qrbox como porcentaje del video (más grande para webcams)
        qrbox: { width: 0.8, height: 0.4 },
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
      
      this.isScanning = true;
      const statusEl = this.modal.querySelector('#scanner-status');
      statusEl.textContent = 'Apunta la cámara al código de barras';
      statusEl.className = 'p-4 text-center text-sm text-primary-600 bg-primary-50';
      
    } catch (error) {
      console.error('Error iniciando escáner:', error);
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
  
  // Mostrar un error en el modal con opción de reintentar
  mostrarError(mensaje, { reintentable = true } = {}) {
    const statusEl = this.modal?.querySelector('#scanner-status');
    if (!statusEl) return;
    
    statusEl.className = 'p-4 text-center text-sm text-danger-600 bg-danger-50 space-y-3';
    statusEl.innerHTML = `
      <p>${mensaje}</p>
      ${reintentable ? '<button id="btn-reintentar-scanner" class="btn-secondary text-sm">🔄 Reintentar</button>' : ''}
    `;
    
    if (reintentable) {
      statusEl.querySelector('#btn-reintentar-scanner')?.addEventListener('click', async () => {
        statusEl.className = 'p-4 text-center text-sm text-gray-500 bg-gray-50';
        statusEl.textContent = 'Reintentando...';
        try {
          await this.iniciarEscaneo();
        } catch {
          // mostrarError() ya dejó el mensaje en el DOM
        }
      });
    }
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
    statusEl.className = 'p-4 text-center text-sm text-primary-800 bg-primary-100';
    
    // Verificar si el código ya existe en la base de datos.
    // Se piden TODOS los que coinciden, no sólo el primero: el índice de
    // codigoBarras no es único, y con .first() el usuario veía un producto
    // arbitrario sin enterarse de que había otro con el mismo código.
    const coincidencias = await dbUtils.buscarPorCodigoBarras(codigo);
    const productoExistente = coincidencias[0] || null;
    const hayDuplicados = coincidencias.length > 1;
    
    // Cerrar scanner
    await this.detenerEscaneo();
    
    // Cerrar modal con pequeño delay para mostrar feedback
    setTimeout(async () => {
      // Si en estos 800 ms el usuario cerró el escáner a mano (✕, Escape o clic
      // fuera), se respeta su decisión: antes se le abría el formulario del
      // producto igualmente, encima del escáner que acababa de descartar.
      if (this._cerrado) return;
      
      // await: el modal debe salir del DOM antes de que se abra el formulario.
      await this.cerrar();
      this.onScan(codigo, productoExistente, hayDuplicados ? coincidencias.length : 0);
    }, 800);
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
    
    this.modal.classList.add('animate-slide-down');
    this.modal.classList.remove('animate-slide-up');
    
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