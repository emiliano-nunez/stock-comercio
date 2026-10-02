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
      statusEl.className = 'dialogo-cuerpo centro-texto detalle texto-marca pie-suave';
      
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
    
    statusEl.className = 'dialogo-cuerpo centro-texto detalle texto-peligro apilado-3';
    statusEl.innerHTML = `
      <p>${mensaje}</p>
      ${reintentable ? '<button id="btn-reintentar-scanner" class="btn-secundario detalle">🔄 Reintentar</button>' : ''}
    `;
    
    if (reintentable) {
      statusEl.querySelector('#btn-reintentar-scanner')?.addEventListener('click', async () => {
        statusEl.className = 'dialogo-cuerpo centro-texto detalle apagado';
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
    statusEl.className = 'dialogo-cuerpo centro-texto detalle texto-marca-fuerte';
    
    // Verificar si el código ya existe en la base de datos.
    // Se piden TODOS los que coinciden, no sólo el primero: el índice de
    // codigoBarras no es único, y con .first() el usuario veía un producto
    // arbitrario sin enterarse de que había otro con el mismo código.
    //
    // Se pasa la lista entera y no "el primero + cuántos hay": el diálogo de
    // código repetido tiene que poder nombrar los productos en conflicto para
    // que el usuario elija, y con un primero + un número no hay nada que elegir.
    const coincidencias = await dbUtils.buscarPorCodigoBarras(codigo);

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
      this.onScan(codigo, coincidencias);
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