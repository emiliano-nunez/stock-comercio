import { db, dbUtils } from '../db.js';
import { toast } from '../utils/toast.js';
import { esc } from '../utils/html.js';
import { fechaYHora } from '../utils/texto.js';
import { exportarBackup, importarBackup, descargarBackup, leerBackupArchivo } from '../utils/backup.js';
import { icono } from '../utils/iconos.js';

/**
 * Dos cosas que hay que decir y que no están en otro lado.
 *
 * La app se actualiza sola. Eso no lo sabe nadie, y la consecuencia importante
 * es otra: si algo parece que no cambió, la respuesta es abrirla de nuevo, no
 * reinstalar. Y reinstalar es peligroso acá, porque el inventario vive sólo en
 * ese aparato y desinstalar lo borra.
 *
 * Va siempre a la vista y no dentro de un desplegable: escondido, esto es
 * exactamente el tipo de cosa que el usuario no encuentra cuando la necesita.
 */
function avisoActualizacion() {
  return `
    <div class="recuadro apilado-chico con-margen-arriba">
      <div class="etiqueta-seccion">Actualizar la app</div>
      <p class="detalle">
        Se actualiza sola, no hay que hacer nada. Si te parece que algo no cambió,
        <strong class="fuerte">cerrá la app del todo</strong> (no la tapes: sacala
        de la pantalla de apps) y abrila de nuevo.
      </p>
      <p class="detalle">
        <strong class="fuerte">No la borres nunca para actualizarla.</strong> Tus
        productos están guardados en este aparato y no hay copia en otro lado: si
        la borrás, los perdés.
      </p>
      <p class="micro apagado">
        Tu versión es la <strong class="fuerte">${esc(__VERSION__)}</strong>. Está
        escrita abajo, al final del inventario.
      </p>
    </div>
  `;
}

/**
 * La copia de seguridad.
 *
 * Este diálogo reemplaza al historial que había antes. No es una simplificación:
 * el historial guardaba una copia completa del inventario antes de cada borrado
 * y llegó a tener diez, con dos consecuencias malas. La primera es que occupies
 * espacio con diez inventarios que nadie miraba. La segunda es que "volver
 * atrás" no devolvía lo que el usuario había borrado sino **el inventario entero
 * de otra fecha**, con los productos que él había eliminado en los últimos días
 * de vuelta y en otra categoría. Y esas copias guardaban las fotos de esos
 * productos, así que la limpieza de fotos del historial terminaba borrando fotos
 * que el usuario había tenido.
 *
 * Ahora la app no guarda ningún historial y no hay forma de deshacer un borrado
 * dentro de ella. Lo que protege al usuario son dos cosas, y las dos se dicen
 * antes de que pase: **exportar la copia** antes de tocar nada, y **preguntar**
 * antes de borrar.
 */
export class CopiaSeguridadModal {
  constructor(onCambio, onClose) {
    this.onCambio = onCambio;
    this.onClose = onClose;
    this.modal = null;
  }

  async abrir() {
    this.fotosSueltas = { cantidad: 0, megas: 0 };
    try {
      this.fotosSueltas = await dbUtils.medirImagenesSinUsar();
    } catch (error) {
      // Medir no es crítico: si falla, el botón simplemente no aparece.
      console.error('No se pudieron medir las fotos sin uso:', error);
    }

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

    const s = this.fotosSueltas || { cantidad: 0, megas: 0 };

    const limpiezaHTML = s.cantidad > 0 ? `
      <div class="apilado-chico">
        <button id="btn-limpiar-fotos" class="btn-fantasma btn-ancho micro apagado btn-peligro-suave">
          🧹 Liberar ${s.cantidad} foto(s) suelta(s) (${s.megas.toFixed(1)} MB)
        </button>
      </div>
    ` : '';

    modal.innerHTML = `
      <div class="dialogo dialogo-columna">
        <div class="dialogo-cabecera dialogo-cabecera-fija">
          <h2 class="titulo titulo-icono">${icono('descargar')} Copia de seguridad</h2>
          <button id="cerrar-copia" class="btn-fantasma btn-icono" aria-label="Cerrar">✕</button>
        </div>

        <div class="dialogo-cuerpo dialogo-cuerpo-scroll apilado-3">
          <div class="recuadro apilado-chico">
            <div class="etiqueta-seccion">${icono('descargar')} Guardar una copia</div>
            <p class="detalle">
              Tus productos están <strong class="fuerte">sólo en este aparato</strong>.
              No hay servidor, ni nube, ni copia en otro lado. Si se borra el
              navegador o se desinstala la app, se van con él.
            </p>
            <p class="detalle">
              Exportar deja un archivo en el dispositivo. Ese archivo es la única
              forma de recuperar el inventario si algo pasa, y también la única
              forma de llevarlo a otro teléfono.
            </p>
            <p class="detalle texto-aviso">
              ⚠️ <strong class="fuerte">Exportá antes de borrar o cambiar algo
              importante.</strong> Un borrado ya no se puede deshacer.
            </p>
          </div>

          <div class="nota-info detalle">
            <p class="fuerte con-margen-abajo-chica">${icono('proteger')} La app no borra fotos sola</p>
            <p>
              Una foto es dato del usuario. Cuando se borra un producto, su foto
              queda guardada igual, sin que nadie la use. Acá se ve cuántas hay y
              se liberan <strong class="fuerte">sólo si vos lo decís</strong>.
            </p>
          </div>

          ${avisoActualizacion()}
        </div>

        <div class="dialogo-pie apilado pie-suave">
          <div class="fila">
            <button id="btn-exportar-backup" class="btn-secundario btn-crece detalle">${icono('descargar')}<span>Exportar copia</span></button>
            <button id="btn-importar-backup" class="btn-principal btn-crece detalle">${icono('subir')}<span>Importar copia</span></button>
          </div>
          ${limpiezaHTML}
          <input type="file" id="input-importar-backup" accept=".json,application/json" class="oculto">
        </div>
      </div>
    `;

    modal.querySelector('#cerrar-copia').addEventListener('click', () => this.cerrar());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.cerrar();
    });

    modal.querySelector('#btn-exportar-backup')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        descargarBackup(await exportarBackup());
        toast.success('Copia exportada');
      } catch (error) {
        console.error('No se pudo exportar la copia de seguridad:', error);
        toast.error('No se pudo exportar la copia');
      } finally {
        btn.disabled = false;
      }
    });

    modal.querySelector('#btn-importar-backup')?.addEventListener('click', () => {
      modal.querySelector('#input-importar-backup').click();
    });

    modal.querySelector('#input-importar-backup')?.addEventListener('change', async (e) => {
      const archivo = e.target.files[0];
      if (!archivo) return;
      e.target.value = '';

      try {
        const json = await leerBackupArchivo(archivo);

        const confirmado = await this.confirmarImportacion(archivo.name, json);
        if (!confirmado) return;

        const resultado = await importarBackup(json);
        toast.success(
          `Copia importada: ${resultado.productos} productos, ${resultado.categorias} categorías`
        );
        this.cerrar();
        this.onCambio?.();
      } catch (error) {
        console.error('No se pudo importar la copia:', error);
        toast.error('Error importando: ' + error.message);
      }
    });

    modal.querySelector('#btn-limpiar-fotos')?.addEventListener('click', async () => {
      const confirmado = await this.pedirConfirmacion({
        titulo: 'Liberar fotos sin producto',
        aceptar: 'Liberar',
        cuerpo: `
          <p>
            Se van a <strong>borrar ${s.cantidad} foto(s)</strong>
            (${s.megas.toFixed(1)} MB) que no están en ningún producto.
          </p>
          <p class="detalle apagado">
            Suelen ser fotos que reemplazaste, o de productos que ya borraste. Si
            la de algún producto sigue en pie, <strong>no</strong> aparece acá.
          </p>
          <p class="detalle texto-aviso">
            ⚠️ Esto no se puede deshacer. Si querés asegurarte, exportá una copia
            antes.
          </p>
        `
      });
      if (!confirmado) return;

      try {
        const borradas = await dbUtils.limpiarImagenesSinUsar();
        toast.success(`${borradas} foto(s) liberadas`);
        this.cerrar();
        this.onCambio?.();
      } catch (error) {
        console.error('Error liberando fotos:', error);
        toast.error('No se pudieron liberar las fotos: ' + (error.message || ''));
      }
    });

    return modal;
  }

  /**
   * Diálogo de confirmación superpuesto, con el estilo de la app.
   *
   * Se prefiere a confirm() nativo porque el texto necesita detalle (cuántas
   * fotos entran, si es reversible) y el nativo no admite formato ni botones con
   * su propio texto.
   */
  pedirConfirmacion({ titulo, cuerpo, aceptar = 'Aceptar' }) {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'velo';
      box.innerHTML = `
        <div class="dialogo">
          <div class="dialogo-cabecera dialogo-cabecera-aviso">
            <h2 class="titulo fila">
              <span>${icono('alerta')}</span> ${esc(titulo)}
            </h2>
            <button class="btn-fantasma btn-icono" data-accion="cancelar" aria-label="Cerrar">✕</button>
          </div>
          <div class="dialogo-cuerpo apilado-3">${cuerpo}</div>
          <div class="dialogo-pie">
            <button class="btn-secundario btn-crece" data-accion="cancelar">Cancelar</button>
            <button class="btn-principal btn-crece" data-accion="aceptar">${esc(aceptar)}</button>
          </div>
        </div>
      `;

      const cerrar = (valor) => {
        box.remove();
        document.removeEventListener('keydown', onKey);
        resolve(valor);
      };
      const onKey = (e) => { if (e.key === 'Escape') cerrar(false); };

      box.addEventListener('click', (e) => {
        if (e.target === box) return cerrar(false);
        const boton = e.target.closest('[data-accion]');
        if (!boton || boton.disabled) return;
        cerrar(boton.dataset.accion === 'aceptar');
      });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(box);
    });
  }

  /**
   * Importar reemplaza el inventario entero, así que antes hay que decir qué hay
   * hoy y qué se va, y ofrecer la salida de exportar.
   */
  async confirmarImportacion(nombreArchivo, json) {
    let resumen = null;
    try {
      const b = JSON.parse(json);
      resumen = {
        productos: b.productos?.length || 0,
        categorias: b.categorias?.length || 0,
        fecha: b.fecha
      };
    } catch {
      // Dejar que importarBackup lance el error de formato después.
    }

    // Que sea importarBackup quien rechace el archivo: este diálogo no valida.
    if (!resumen) return true;

    const hayDatos = await db.productos.count();

    return this.pedirConfirmacion({
      titulo: 'Importar copia',
      aceptar: 'Reemplazar todo',
      cuerpo: `
        <p>
          <strong>${esc(nombreArchivo)}</strong> contiene
          ${resumen.productos} producto(s) y ${resumen.categorias} categoría(s).
        </p>
        ${resumen.fecha ? `<p class="detalle apagado">Copia del ${esc(fechaYHora(resumen.fecha) || 'Sin fecha')}.</p>` : ''}
        ${hayDatos > 0
          ? `<p class="texto-peligro">
               Se <strong>reemplazarán los ${hayDatos} producto(s) que tenés
               ahora</strong>, incluidas sus categorías e imágenes.
             </p>
             <p class="detalle texto-aviso">
               ⚠️ Esto <strong>no</strong> se puede deshacer. Si querés volver a
               este inventario después, exportá una copia antes de importar.
             </p>`
          : '<p class="detalle apagado">Tu base está vacía, no se pierde nada.</p>'}
      `
    });
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
 * Abre el modal de copia de seguridad.
 * @param {Function} [onCambio] Se llama tras importar una copia o liberar fotos.
 * @param {Function} [onClose]   Se llama SIEMPRE al cerrar (✕, Escape o clic fuera).
 *                              Imprescindible para que quien lo abrió pueda
 *                              limpiar su flag de "ya está abierto"; sin esto el
 *                              botón que lo invoca queda inutilizable.
 */
export async function abrirCopiaSeguridad(onCambio, onClose) {
  const modal = new CopiaSeguridadModal(onCambio, onClose);
  await modal.abrir();
  return modal;
}
