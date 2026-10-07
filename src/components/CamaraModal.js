import { imagenUtils } from '../utils/imagen.js';
import { dbUtils } from '../db.js';
import { toast } from '../utils/toast.js';
import { icono } from '../utils/iconos.js';

export class CamaraModal {
  constructor(onCapture) {
    this.onCapture = onCapture;
    this.stream = null;
    this.videoElement = null;
    this.modal = null;
    this.facingMode = 'environment';
  }

  async abrir() {
    this.modal = this.crearModal();
    document.body.appendChild(this.modal);

    // Pequeño delay para que la animación funcione
    await new Promise(r => requestAnimationFrame(r));

    try {
      await this.iniciarCamara();
    } catch (error) {
      this.mostrarAviso(error);
    }
  }

  crearModal() {
    const modal = document.createElement('div');
    modal.className = 'velo';
    modal.innerHTML = `
      <div class="dialogo dialogo-sin-desplazar">
        <!-- Header -->
        <div class="dialogo-cabecera">
          <h2 class="titulo titulo-icono">${icono('camara')}<span>Sacar Foto</span></h2>
          <button id="cerrar-camara" class="btn-fantasma btn-icono" aria-label="Cerrar cámara">
            ✕
          </button>
        </div>

        <!-- Visor de cámara -->
        <div class="marco-video">
          <video
            id="video-camara"
            class="foto-cuadro foto-llena"
            playsinline
            muted
            aria-label="Vista previa de la cámara"
          ></video>

          <!-- Controles superpuestos -->
          <div class="franja-inferior">
            <button
              id="cambiar-camara"
              class="btn-principal fila"
              aria-label="Cambiar cámara"
            >
              🔄 Cambiar
            </button>
            <button
              id="capturar-foto"
              class="btn-principal btn-crece fila-centro"
              aria-label="Capturar foto"
            >
              📸 Capturar
            </button>
          </div>
        </div>

        <!-- Aviso cuando la cámara no arranca -->
        <div id="aviso-camara" class="dialogo-cuerpo apilado oculto" role="alert">
          <p class="nota-atencion centro-texto" id="aviso-camara-texto"></p>
          <div class="fila">
            <button id="reintentar-camara" class="btn-principal btn-crece">🔄 Reintentar</button>
            <button id="cerrar-aviso-camara" class="btn-secundario btn-crece">Cerrar</button>
          </div>
        </div>

        <!-- Indicador de ayuda -->
        <div class="dialogo-pie centro-texto detalle apagado pie-suave">
          Apunta al producto y toca <strong>Capturar</strong>
        </div>
      </div>
    `;

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

    modal.querySelector('#reintentar-camara').addEventListener('click', () => {
      this.ocultarAviso();
      this.iniciarCamara().catch(error => this.mostrarAviso(error));
    });

    modal.querySelector('#cerrar-aviso-camara').addEventListener('click', () => this.cerrar());

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.cerrar();
    });

    this.videoElement = modal.querySelector('#video-camara');
    return modal;
  }

  async iniciarCamara() {

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

  /*
   * La cámara no arrancó: el modal se queda abierto con el motivo y con la
   * chance de reintentar, en vez de cerrarse sin explicar nada.
   */
  mostrarAviso(error) {
    this.modal.querySelector('#aviso-camara-texto').textContent = error.message;
    this.modal.querySelector('#aviso-camara').classList.remove('oculto');
    this.modal.querySelector('.marco-video').classList.add('oculto');
    this.modal.querySelector('.dialogo-pie').classList.add('oculto');
  }

  ocultarAviso() {
    this.modal.querySelector('#aviso-camara').classList.add('oculto');
    this.modal.querySelector('.marco-video').classList.remove('oculto');
    this.modal.querySelector('.dialogo-pie').classList.remove('oculto');
  }

  async cambiarCamara() {
    const anterior = this.facingMode;
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';

    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;

    try {
      await this.iniciarCamara();
    } catch (error) {

      this.facingMode = anterior;
      try {
        await this.iniciarCamara();
      } catch {

      }
      throw error;
    }
  }

  async capturar() {
    if (!this.videoElement || this.videoElement.readyState < 2) {
      throw new Error('La cámara no está lista');
    }

    const btnCapturar = this.modal.querySelector('#capturar-foto');
    btnCapturar.disabled = true;
    btnCapturar.innerHTML = '⏳ Procesando...';

    try {
      const blob = await imagenUtils.capturarDeVideo(this.videoElement);

      const imagenId = dbUtils.generarId('img');
      const thumb = await imagenUtils.crearThumb(blob);
      await dbUtils.guardarImagen(imagenId, blob, thumb);

      // es un cuadrado de ~320px y la miniatura de 200px se vería borroso.
      const imagenUrl = imagenUtils.crearObjectURL(blob);

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

  cerrar() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    if (this.modal) {
      this.modal.classList.add('anim-bajar');
      this.modal.classList.remove('anim-subir');

      setTimeout(() => {
        if (this.modal && this.modal.parentNode) {
          this.modal.remove();
        }
        this.modal = null;
      }, 200);
    }
  }
}

export async function abrirCamara(onCapture) {
  const camara = new CamaraModal(onCapture);
  await camara.abrir();
  return camara;
}
