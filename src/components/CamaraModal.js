import { imagenUtils } from '../utils/imagen.js';
import { db, dbUtils } from '../db.js';
import { toast } from '../utils/toast.js';

export class CamaraModal {
  constructor(onCapture) {
    this.onCapture = onCapture;
    this.stream = null;
    this.videoElement = null;
    this.modal = null;
    this.facingMode = 'environment'; // Cámara trasera por defecto
  }
  
  // Crear y mostrar el modal
  async abrir() {
    this.modal = this.crearModal();
    document.body.appendChild(this.modal);
    
    // Pequeño delay para que la animación funcione
    await new Promise(r => requestAnimationFrame(r));
    
    try {
      await this.iniciarCamara();
    } catch (error) {
      this.cerrar();
      throw error;
    }
  }
  
  // Crear estructura del modal
  crearModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content relative overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-gray-100 bg-primary-50 rounded-t-2xl">
          <h2 class="text-touch-lg font-bold text-gray-900">📷 Sacar Foto</h2>
          <button id="cerrar-camara" class="btn-ghost p-2" aria-label="Cerrar cámara">
            ✕
          </button>
        </div>
        
        <!-- Visor de cámara -->
        <div class="relative bg-black p-2">
          <video 
            id="video-camara" 
            class="w-full aspect-square object-cover rounded-xl" 
            playsinline 
            muted
            aria-label="Vista previa de la cámara"
          ></video>
          
          <!-- Controles superpuestos -->
          <div class="absolute bottom-4 left-4 right-4 flex items-center justify-between gap-4">
            <button 
              id="cambiar-camara" 
              class="btn-primary flex items-center gap-2"
              aria-label="Cambiar cámara"
            >
              🔄 Cambiar
            </button>
            <button 
              id="capturar-foto" 
              class="btn-primary flex-1 flex items-center justify-center gap-2 text-touch-lg"
              aria-label="Capturar foto"
            >
              📸 Capturar
            </button>
          </div>
        </div>
        
        <!-- Indicador de ayuda -->
        <div class="p-4 text-center text-sm text-gray-500 bg-gray-50 rounded-b-2xl">
          Apunta al producto y toca <strong>Capturar</strong>
        </div>
      </div>
    `;
    
    // Event listeners
    // Ojo: estos handlers son async y lanzan. Sin un catch se produciría una
    // promesa rechazada sin manejar (unhandled rejection) y el usuario se
    // quedaría con el botón en "Procesando..." sin saber qué pasó.
    modal.querySelector('#cerrar-camara').addEventListener('click', () => this.cerrar());
    
    modal.querySelector('#cambiar-camara').addEventListener('click', () => {
      this.cambiarCamara().catch(error => {
        console.error('Error cambiando de cámara:', error);
        toast.error(error.message || 'No se pudo cambiar de cámara');
      });
    });
    
    modal.querySelector('#capturar-foto').addEventListener('click', () => {
      this.capturar().catch(error => {
        console.error('Error capturando:', error);
        toast.error(error.message || 'No se pudo capturar la foto');
      });
    });
    
    // Cerrar al tocar fuera del contenido
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.cerrar();
    });
    
    this.videoElement = modal.querySelector('#video-camara');
    return modal;
  }
  
  // Iniciar stream de cámara
  async iniciarCamara() {
    // Verificar si estamos en contexto seguro (HTTPS o localhost)
    const esContextoSeguro = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    
    if (!esContextoSeguro) {
      throw new Error('La cámara requiere HTTPS. En red local (HTTP) no funciona. Usa la galería o despliega en Vercel/Netlify para HTTPS gratis.');
    }
    
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: this.facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      
      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();
    } catch (error) {
      console.error('Error accediendo a la cámara:', error);
      
      let mensaje = 'No se pudo acceder a la cámara.';
      if (error.name === 'NotAllowedError') {
        mensaje = 'Permisos de cámara denegados. Actívalos en la configuración del navegador.';
      } else if (error.name === 'NotFoundError') {
        mensaje = 'No se encontró ninguna cámara en el dispositivo.';
      } else if (error.name === 'NotReadableError') {
        mensaje = 'La cámara está en uso por otra aplicación.';
      }
      
      throw new Error(mensaje);
    }
  }
  
  // Cambiar entre cámara frontal/trasera
  async cambiarCamara() {
    const anterior = this.facingMode;
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    
    // Detener stream actual
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    
    try {
      await this.iniciarCamara();
    } catch (error) {
      // Si la nueva cámara no arranca, se vuelve a la anterior para no dejar
      // el visor en negro sin cámara.
      this.facingMode = anterior;
      try {
        await this.iniciarCamara();
      } catch {
        // La original tampoco funciona: se propaga el error original.
      }
      throw error;
    }
  }
  
  // Capturar foto
  async capturar() {
    if (!this.videoElement || this.videoElement.readyState < 2) {
      throw new Error('La cámara no está lista');
    }
    
    // Deshabilitar botón durante captura
    const btnCapturar = this.modal.querySelector('#capturar-foto');
    btnCapturar.disabled = true;
    btnCapturar.innerHTML = '⏳ Procesando...';
    
    try {
      const blob = await imagenUtils.capturarDeVideo(this.videoElement);
      
      // Guardar en IndexedDB, con miniatura para el catálogo.
      // La miniatura se calcula antes de avisar al formulario para que el
      // guardado siga siendo una sola operación desde el punto de vista del
      // usuario: cuando se le avisa, la foto ya está lista para usarse.
      const imagenId = dbUtils.generarId('img');
      const thumb = await imagenUtils.crearThumb(blob);
      await dbUtils.guardarImagen(imagenId, blob, thumb);
      
      // Crear URL temporal para previsualización.
      // Se usa la imagen COMPLETA, no la miniatura: el preview del formulario
      // es un cuadrado de ~320px y la miniatura de 200px se vería borroso.
      const imagenUrl = imagenUtils.crearObjectURL(blob);
      
      // Cerrar modal y notificar
      this.cerrar();
      this.onCapture({ imagenId, imagenUrl, blob });
      
    } catch (error) {
      console.error('Error capturando foto:', error);
      // Rehabilitar el botón para que el usuario pueda reintentar
      btnCapturar.disabled = false;
      btnCapturar.innerHTML = '📸 Capturar';
      throw error;
    }
  }
  
  // Cerrar modal y limpiar recursos
  cerrar() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.modal) {
      this.modal.classList.add('animate-slide-down');
      this.modal.classList.remove('animate-slide-up');
      
      setTimeout(() => {
        if (this.modal && this.modal.parentNode) {
          this.modal.remove();
        }
        this.modal = null;
      }, 200);
    }
  }
}

// Función helper para usar fácilmente
export async function abrirCamara(onCapture) {
  const camara = new CamaraModal(onCapture);
  await camara.abrir();
  return camara;
}