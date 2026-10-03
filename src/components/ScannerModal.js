import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { dbUtils } from '../db.js';
import { esc } from '../utils/html.js';
import { icono } from '../utils/iconos.js';

export class ScannerModal {
  constructor(onScan) {
    this.onScan = onScan;
    this.scanner = null;
    this.modal = null;
    this.isScanning = false;
    // Pasa a true en cuanto el usuario cierra el modal (a mano o por cÃ³digo).

    // formulario de producto sobre un escÃ¡ner que el usuario ya descartÃ³.
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

      // aquÃ­, asÃ­ que el usuario veÃ­a desaparecer el modal sin explicaciÃ³n.
      this.escanerFallido = true;
      console.error('No se pudo iniciar el escÃ¡ner:', error);
    }
  }

  crearModal() {
    const modal = document.createElement('div');
    modal.className = 'velo';
    modal.innerHTML = `
      <div class="dialogo dialogo-sin-desplazar">
        <!-- Header -->
        <div class="dialogo-cabecera">
          <h2 class="titulo titulo-icono">${icono('escanear')}<span>Escanear CÃ³digo</span></h2>
          <button id="cerrar-scanner" class="btn-fantasma btn-icono" aria-label="Cerrar escÃ¡ner">
            âœ•
          </button>
        </div>

        <!-- Visor del escÃ¡ner -->
        <div class="marco-video">
          <div id="scanner-container" class="visor-video"></div>

          <!-- Marco de escaneo visual -->
          <div class="capa-centrada">
            <div class="marco-escaner">
              <div class="pista">
                Coloca el cÃ³digo dentro del marco
              </div>
            </div>
          </div>
        </div>

        <!-- Estado -->
        <div id="scanner-status" class="dialogo-cuerpo centro-texto detalle apagado pie-suave">
          Iniciando cÃ¡mara...
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

    const esContextoSeguro = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

    if (!esContextoSeguro) {
      // No se reintenta: sin HTTPS no hay soluciÃ³n, hace falta escribir el cÃ³digo.
      this.mostrarError(
        'El lector de la cÃ¡mara necesita HTTPS. Esta pÃ¡gina estÃ¡ abierta por HTTP, y los navegadores sÃ³lo dan la cÃ¡mara en conexiones seguras.',
        { reintentable: false }
      );
      throw new Error('El escÃ¡ner requiere HTTPS');
    }

    this.scanner = new Html5Qrcode('scanner-container');

    try {

      const cameras = await Html5Qrcode.getCameras();
      let cameraId = null;

      const isMobile = /Android|iPhone|iPad|iPod|mobile/i.test(navigator.userAgent);
      if (isMobile) {
        const backCam = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('rear') || c.label.toLowerCase().includes('environment'));
        cameraId = backCam?.id || cameras[0]?.id;
      } else {

        cameraId = cameras[0]?.id;
      }

      if (!cameraId) {
        throw new Error('No se encontraron cÃ¡maras');
      }

      const config = {
        fps: 15,
        /*
         * La zona que se escanea tiene que ser una FUNCIÃ“N, no un objeto.
         *
         * html5-qrcode interpreta distinto cada forma: un nÃºmero suelto es una
         * fracciÃ³n del visor, una funciÃ³n recibe el ancho y alto reales del
         * visor, y un objeto {width, height} son PÃXELES ABSOLUTOS. Con un
         * objeto de 0.8 x 0.4 la zona medÃ­a 0,8 pÃ­xeles, la librerÃ­a tiraba
         * "minimum size of 'config.qrbox' dimension value is 50px" y el bucle
         * que decodifica los cuadros nunca llegaba a correr. Se veÃ­a la cÃ¡mara
         * y no se detectaba nada, sin ningÃºn error en pantalla.
         *
         * Como funciÃ³n se mide sobre el visor real. Va ancha y baja porque los
         * cÃ³digos de barras son una lÃ­nea horizontal, y siempre por encima de los
         * 50px que la librerÃ­a exige en cada lado.
         */
        qrbox: (ancho, alto) => ({
          width: Math.max(50, Math.round(ancho * 0.9)),
          height: Math.max(50, Math.min(alto * 0.5, Math.round(alto * 0.4))),
        }),
        aspectRatio: undefined,
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

        }
      );

      await new Promise(r => setTimeout(r, 300));
      if (!this.scanner.isScanning) {
        throw new Error('La cÃ¡mara se abriÃ³ pero el lector no pudo arrancar.');
      }

      this.isScanning = true;
      const statusEl = this.modal.querySelector('#scanner-status');
      statusEl.textContent = 'Apunta la cÃ¡mara al cÃ³digo de barras';
      statusEl.className = 'dialogo-cuerpo centro-texto detalle texto-marca pie-suave';

    } catch (error) {
      console.error('Error iniciando escÃ¡ner:', error);
      await this.soltarCamara();

      let mensaje = 'No se pudo acceder a la cÃ¡mara.';
      if (error?.name === 'NotAllowedError') {
        mensaje = 'Permisos de cÃ¡mara denegados. ActÃ­valos en el candado de la barra de direcciones.';
      } else if (error?.name === 'NotFoundError') {
        mensaje = 'No se encontrÃ³ ninguna cÃ¡mara en este dispositivo.';
      } else if (error?.name === 'NotReadableError') {
        mensaje = 'La cÃ¡mara estÃ¡ siendo usada por otra aplicaciÃ³n.';
      } else if (error?.message) {
        mensaje = error.message;
      }
      this.mostrarError(mensaje);
      throw error;
    }
  }

  async soltarCamara() {
    this.isScanning = false;
    if (!this.scanner) return;
    try {
      await this.scanner.clear();
    } catch {
      // clear() tira si el escÃ¡ner nunca llegÃ³ a renderizar. No hay nada que soltar.
    }
  }

  /**
   * Deja el escÃ¡ner en un estado donde no puede escanear y explica quÃ© pasÃ³.
   *
   * AdemÃ¡s de avisar, ofrece escribir el cÃ³digo a mano. No siempre hay salida:
   * sin HTTPS, sin permiso de cÃ¡mara o con otra app usando la cÃ¡mara, el lector
   * no tiene arreglo, y obligar al usuario a cerrar y buscar el cÃ³digo en el
   * buscador era un rodeo por algo que se resuelve en la misma pantalla.
   */
  mostrarError(mensaje, { reintentable = true } = {}) {
    const statusEl = this.modal?.querySelector('#scanner-status');
    if (!statusEl) return;

    // corriendo y el usuario cree que todavÃ­a estÃ¡ leyendo.
    this.modal.querySelector('.marco-video')?.classList.add('oculto');
    this.isScanning = false;

    statusEl.className = 'dialogo-cuerpo centro-texto detalle apilado-3';
    statusEl.innerHTML = `
      <p class="texto-peligro">${esc(mensaje)}</p>
      <p class="apagado">La cÃ¡mara no va a servir para leer el cÃ³digo. PodÃ©s apagarla y escribirlo vos mismo: la app trabaja igual.</p>
      <div class="apilado">
        <button id="btn-codigo-a-mano" class="btn-principal">${icono('lapiz')} Escribir el cÃ³digo a mano</button>
        ${reintentable ? `<button id="btn-reintentar-scanner" class="btn-secundario">${icono('refrescar')} Reintentar la cÃ¡mara</button>` : ''}
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

        }
      });
    }
  }

  /**
   * El campo para escribir el cÃ³digo a mano.
   *
   * Se arma como form y no como un input suelto para que la tecla Enter mande
   * el mismo cÃ³digo que el botÃ³n, que es lo que espera cualquiera que estÃ©
   * tipeando un cÃ³digo de barras.
   */
  mostrarCampoCodigo() {
    const statusEl = this.modal.querySelector('#scanner-status');
    this.isScanning = false;

    statusEl.className = 'dialogo-cuerpo centro-texto detalle apilado-3';
    statusEl.innerHTML = `
      <p class="medio">EscribÃ­ el cÃ³digo de barras</p>
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
          aria-label="CÃ³digo de barras"
        >
        <p id="aviso-codigo-manual" class="texto-peligro oculto">PonÃ© el cÃ³digo y volvÃ© a buscar.</p>
        <button type="submit" class="btn-principal">Buscar este cÃ³digo</button>
      </form>
    `;

    const form = statusEl.querySelector('#form-codigo-manual');
    const campo = statusEl.querySelector('#campo-codigo-manual');
    const aviso = statusEl.querySelector('#aviso-codigo-manual');

    // El foco abre el teclado al toque, sin que el usuario tenga que tocar el

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

    if (navigator.vibrate) {
      navigator.vibrate(200);
    }

    this.reproducirBeep();

    const statusEl = this.modal.querySelector('#scanner-status');
    statusEl.textContent = `âœ… CÃ³digo detectado: ${codigo}`;
    statusEl.className = 'dialogo-cuerpo centro-texto detalle texto-marca-fuerte';

    await this.resolverCodigo(codigo, 800);
  }

  /**
   * Cierra el escÃ¡ner y le entrega el cÃ³digo a la app, exista o no en la base.
   *
   * Lo usan tanto el cÃ³digo leÃ­do por la cÃ¡mara como el que escribiÃ³ el usuario a
   * mano: si cada uno armara su propio camino, el que escribe a mano se
   * saltarÃ­a la bÃºsqueda de duplicados y el diÃ¡logo de cÃ³digo repetido.
   *
   * modal se vaya. El cÃ³digo escrito a mano no la necesita: no hay de quÃ©
   * taparse la vista.
   */
  async resolverCodigo(codigo, espera = 0) {

    // codigoBarras no es Ãºnico, y con .first() el usuario veÃ­a un producto

    //

    // que el usuario elija, y con un primero + un nÃºmero no hay nada que elegir.
    const coincidencias = await dbUtils.buscarPorCodigoBarras(codigo);

    await this.detenerEscaneo();

    if (espera > 0) {
      await new Promise(r => setTimeout(r, espera));
    }

    // Si en esos milisegundos el usuario cerrÃ³ el escÃ¡ner a mano (âœ•, Escape o

    if (this._cerrado) return;

    await this.cerrar();
    this.onScan(codigo, coincidencias);
  }

  async detenerEscaneo() {
    if (this.scanner && this.isScanning) {
      try {
        await this.scanner.stop();
      } catch (e) {

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
