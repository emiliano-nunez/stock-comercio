import { db, dbUtils } from '../db.js';
import { toast } from '../utils/toast.js';
import { esc, escAttr } from '../utils/html.js';
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

export class HistorialModal {
  constructor(onRestore, onClose) {
    this.onRestore = onRestore;
    this.onClose = onClose;
    this.modal = null;
  }

  async abrir() {
    this.historial = await dbUtils.getHistorial();

    // Dos cifras distintas y con dos botones distintos, porque son dos cosas

    //   delHistorial -> fotos de productos que el usuario ya borró. Ocupan

    // La app no borra fotos sola, así que las dos crecen sin que el usuario lo

    this.fotosSueltas = { cantidad: 0, megas: 0 };
    this.fotosDelHistorial = { cantidad: 0, megas: 0 };
    try {
      [this.fotosSueltas, this.fotosDelHistorial] = await Promise.all([
        dbUtils.medirImagenesSinUsar(),
        dbUtils.medirFotosDelHistorial()
      ]);
    } catch (error) {
      // Medir no es crítico: si falla, los botones simplemente no aparecen.
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

    // El cuerpo y el footer con los botones de backup se construyen siempre,

    // recién vacía no había forma de exportar ni de importar un backup: justo
    // cuando el usuario más lo necesita para recuperar datos.
    const cuerpo = this.historial.length === 0
      ? `
        <div class="dialogo-cuerpo centro-texto">
          <span class="vacio-icono">📭</span>
          <h3 class="subtitulo con-margen-arriba-amplia">Sin historial</h3>
          <p class="apagado con-margen-arriba">No hay puntos de restauración disponibles.<br>Podés importar un backup para recuperar tu inventario.</p>
        </div>
      `
      : `
        <div class="dialogo-cuerpo dialogo-cuerpo-scroll">
          ${this.historial.map((item, index) => `
            <button
              type="button"
              class="entrada-lista ${index === 0 ? 'entrada-lista-destacada' : ''}"
              data-snapshot-id="${escAttr(item.id)}"
            >
              <div class="miniatura miniatura-marca">
                <span class="mediano">${icono('sincronizar')}</span>
              </div>
              <div class="crece ancho-cero">
                <p class="fuerte cortado">${esc(this.formatearMotivo(item.motivo))}</p>
                <p class="micro">📅 ${esc(this.formatearFecha(item.fecha))}</p>
              </div>
              <span class="detalle tenue">${item.snapshotProductos?.length || 0} productos</span>
            </button>
          `).join('')}
        </div>
        <p class="centro-texto detalle apagado">Toca un estado para restaurar el inventario</p>
      `;

    // espacio. Y con confirmación aparte, porque una foto puede ser justo la que
    // el usuario anda buscando.
    const sueltas = this.fotosSueltas || { cantidad: 0, megas: 0 };
    const delHistorial = this.fotosDelHistorial || { cantidad: 0, megas: 0 };
    const limpiezaHTML = (sueltas.cantidad > 0 || delHistorial.cantidad > 0) ? `
      <div class="apilado-chico">
        ${sueltas.cantidad > 0 ? `
          <button id="btn-limpiar-fotos" class="btn-fantasma btn-ancho micro apagado btn-peligro-suave">
            🧹 Liberar ${sueltas.cantidad} foto(s) suelta(s) (${sueltas.megas.toFixed(1)} MB)
          </button>
        ` : ''}
        ${delHistorial.cantidad > 0 ? `
          <button id="btn-limpiar-fotos-historial" class="btn-fantasma btn-ancho micro apagado btn-peligro-suave">
            🗄️ Liberar ${delHistorial.cantidad} foto(s) de productos borrados (${delHistorial.megas.toFixed(1)} MB)
          </button>
        ` : ''}
      </div>
    ` : '';

    modal.innerHTML = `
      <div class="dialogo dialogo-columna">
        <div class="dialogo-cabecera dialogo-cabecera-fija">
          <h2 class="titulo titulo-icono">${icono('sincronizar')} Volver Atrás</h2>
          <button id="cerrar-historial" class="btn-fantasma btn-icono" aria-label="Cerrar">✕</button>
        </div>
        ${cuerpo}
        ${avisoActualizacion()}
        <div class="dialogo-pie apilado pie-suave">
          <div class="fila">
            <button id="btn-exportar-backup" class="btn-secundario btn-crece detalle">${icono('descargar')}<span>Exportar Backup</span></button>
            <button id="btn-importar-backup" class="btn-principal btn-crece detalle">${icono('subir')}<span>Importar Backup</span></button>
          </div>
          ${limpiezaHTML}
          <input type="file" id="input-importar-backup" accept=".json,application/json" class="oculto">
        </div>
      </div>
    `;

    modal.querySelector('#cerrar-historial').addEventListener('click', () => this.cerrar());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.cerrar();
    });

    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-snapshot-id]');
      if (btn) {
        this.restaurar(btn.dataset.snapshotId);
      }
    });

    modal.querySelector('#btn-exportar-backup')?.addEventListener('click', async () => {
      try {
        const json = await exportarBackup();
        descargarBackup(json);
        toast.success('Backup exportado');
      } catch (e) {
        console.error(e);
        toast.error('Error exportando backup');
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
          `Backup importado: ${resultado.productos} productos, ${resultado.categorias} categorías`
          + (resultado.reversible ? '. Podés volver atrás desde Volver Atrás.' : '')
        );
        this.cerrar();
        if (this.onRestore) this.onRestore();
      } catch (error) {
        console.error(error);
        toast.error('Error importando: ' + error.message);
      }
    });

    // imagen, y por eso lleva su propia confirmación con el detalle de qué se
    // va a perder: si el usuario saca la foto de un producto, esa foto queda

    // es el usuario que la quiere de vuelta y no la encuentra.
    modal.querySelector('#btn-limpiar-fotos')?.addEventListener('click', async () => {
      const s = this.fotosSueltas || { cantidad: 0, megas: 0 };
      const confirmado = await this.pedirConfirmacion({
        titulo: 'Liberar fotos sin producto',
        aceptar: 'Liberar',
        cuerpo: `
          <p>
            Se van a <strong>borrar ${s.cantidad} foto(s)</strong>
            (${s.megas.toFixed(1)} MB) que no están en ningún producto ni en
            ningún punto de restauración.
          </p>
          <p class="detalle apagado">
            Suelen ser fotos que reemplazaste o de productos que ya borraste.
            Si la de algún producto sigue en pie, <strong>no</strong> aparece acá.
          </p>
          <p class="detalle texto-aviso">
            ⚠️ Esto no se puede deshacer. Si querés asegurarte, exportá un
            backup antes.
          </p>
        `
      });
      if (!confirmado) return;

      try {
        const borradas = await dbUtils.limpiarImagenesSinUsar();
        toast.success(`${borradas} foto(s) liberadas`);
        this.cerrar();
        this.onRestore?.();
      } catch (error) {
        console.error('Error liberando fotos:', error);
        toast.error('No se pudieron liberar las fotos: ' + (error.message || ''));
      }
    });

    // fuerte de la app: borra fotos que fueron de productos del usuario. Por
    // eso el diálogo dice las tres cosas que importan —qué se borra, qué NO se
    // toca y qué se pierde—, y por eso la decisión queda anotada en el
    // historial: si el usuario vuelve a necesitar esa foto dentro de tres meses,

    modal.querySelector('#btn-limpiar-fotos-historial')?.addEventListener('click', async () => {
      const s = this.fotosDelHistorial || { cantidad: 0, megas: 0 };
      const confirmado = await this.pedirConfirmacion({
        titulo: 'Liberar fotos de productos borrados',
        aceptar: 'Borrar las fotos',
        cuerpo: `
          <p>
            Vas a <strong>borrar ${s.cantidad} foto(s)</strong>
            (${s.megas.toFixed(1)} MB) que son de productos que ya eliminaste.
            Están guardadas sólo para que "Volver Atrás" te las devuelva.
          </p>
          <div class="nota-info detalle">
            <p class="fuerte con-margen-abajo-chica">Esto NO toca:</p>
            <ul class="lista">
              <li>Las fotos de los productos que tenés ahora.</li>
              <li>Los productos borrados: si restaurás, vuelven igual.</li>
            </ul>
          </div>
          <div class="nota-peligro detalle">
            <p class="fuerte con-margen-abajo-chica">Esto SÍ:</p>
            <ul class="lista">
              <li>Las fotos se van para siempre.</li>
              <li>Si restaurás un producto borrado, <strong>vuelve sin foto</strong>.</li>
            </ul>
          </div>
          <p class="detalle apagado">
            Lo borrás <strong>vos</strong>, a propósito, y queda anotado en el
            historial. Si más adelante te faltan esas fotos, no se perdieron
            solas: acá está escrito que las liberaste vos. Si sólo querés
            recuperar espacio, exportá un backup antes.
          </p>
        `
      });
      if (!confirmado) return;

      let borradas = 0;
      try {
        borradas = await dbUtils.liberarFotosDelHistorial();
      } catch (error) {
        console.error('Error liberando fotos del historial:', error);
        toast.error('No se pudieron liberar: ' + (error.message || ''));
        return;
      }

      // queremos que el usuario piense que las fotos siguen ahí. Se avisa en los

      try {
        await dbUtils.crearPuntoRestauracion(
          `Limpieza de fotos: ${borradas} foto(s) liberadas a propósito`
        );
        toast.success(`${borradas} foto(s) liberadas. Quedó anotado en el historial.`);
      } catch (error) {
        console.error('Se liberaron las fotos pero no se pudo anotar:', error);
        toast.warning(
          `Se liberaron ${borradas} foto(s), pero no se pudo anotar en el historial.`
        );
      }

      this.cerrar();
      this.onRestore?.();
    });

    return modal;
  }

  /**
 * La fecha de un punto de restauración, como DD/MM/AAAA HH:MM.
 *
 * Se arma a mano y no con `toLocaleString` porque el resultado de ese cambia
 * según el aparato: en unos sale "02/10/2026, 16:37" y en otros
 * "10/2/2026, 04:37 p. m.". Una lista de fechas tiene que seguir el mismo
 * formato en todos los teléfonos, porque el orden de los puntos es lo que dice
 * cuál es más reciente.
 *
 * Sale de la fecha local, no de la de UTC: el horario que importa es el del
 * que restoreó, no el de Greenwich.
 */
formatearFecha(fechaISO) {
    const d = fechaISO instanceof Date ? fechaISO : new Date(fechaISO);
    if (Number.isNaN(d.getTime())) return 'Sin fecha';
    const dos = n => String(n).padStart(2, '0');
    return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
  }

  formatearMotivo(motivo) {
    const motivos = {
      'manual': 'Restauración manual',
      'cierre': 'Cierre diario',
      'precios': 'Cambio de precios',
      'inventario': 'Inventario masivo',

      'eliminacion': 'Antes de una eliminación',
      // Motivo que genera importarBackup() para que el import se pueda deshacer
      'Antes de importar backup': 'Antes de importar un backup',
      // inventario, para que restaurar un punto viejo sea reversible. Sin esto
      // el usuario no tenía forma de volver atrás de un "Volver Atrás".
      'Antes de restaurar': 'Antes de restaurar (tu estado actual)'
    };

    // número de fotos liberadas detrás. Se dejan pasar tal cual a propósito: el
    // detalle ES el motivo, y recortarlo para que entre en un diccionario
    // perdería justo lo que el usuario necesita leer dentro de tres meses

    if (typeof motivo === 'string' && motivo.startsWith('Limpieza de fotos:')) {
      return motivo;
    }

    return motivos[motivo] || motivo;
  }

  /**
   * Diálogo de confirmación superpuesto, con el estilo de la app.
   *
   * Se prefiere a confirm() nativo porque el texto necesita detalle (cuántos
   * productos entran/salen, si es reversible) y el nativo no admite formato
   * ni botones con su propio texto.
   *
   * @param {Function} [alAceptar] recibe el nodo del diálogo y devuelve el
   *   valor a resolver. Sin esto resuelve siempre `true`. Existe para los
   *   diálogos que traen un control (el de restaurar, con su interruptor de
   *   fotos) y en vez de sí/no necesitan devolver la elección.
   * @returns {Promise<boolean|any>} true si el usuario acepta, o lo que
   *   devuelva alAceptar.
   */
  pedirConfirmacion({ titulo, cuerpo, aceptar = 'Aceptar', aceptarDeshabilitado = false, alAceptar = null }) {
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
            <button class="btn-principal btn-crece" data-accion="aceptar" ${aceptarDeshabilitado ? 'disabled' : ''}>${esc(aceptar)}</button>
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
        const accion = boton.dataset.accion;
        if (accion === 'aceptar') cerrar(alAceptar ? alAceptar(box) : true);
        else if (accion === 'cancelar') cerrar(false);
      });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(box);
    });
  }

  async confirmarRestauracion(item) {
    const productos = item.snapshotProductos || [];
    const total = productos.length;

    // "se sustituirá el inventario por el estado del 12/03" y el usuario tenía

    let cambios = { vuelven: [], seVan: [] };
    if (total > 0) {
      try {
        cambios = await dbUtils.compararConSnapshot(item.id);
      } catch (error) {
        // No es motivo para bloquear la restauración: si no se puede comparar,
        // se restaura igual y el usuario ve el resultado en pantalla.
        console.error('No se pudo comparar con el punto de restauración:', error);
      }
    }

    // Cuántas fotos van a volver de verdad. Casi todas, porque desde que la

    let resumen = { total, conFoto: 0, disponibles: 0 };
    if (total > 0) {
      try {
        resumen = await dbUtils.resumenFotos(productos);
      } catch (error) {
        // No es motivo para bloquear la restauración: si no se puede contar,
        // se restaura igual y el usuario ve lo que haya.
        console.error('No se pudo contar las fotos del snapshot:', error);
      }
    }
    const perdidas = resumen.conFoto - resumen.disponibles;

    // una línea. Poner los 300 sería un diálogo que no se lee y no se decide.
    const lista = (listaProductos) => {
      const MAX = 6;
      const visibles = listaProductos.slice(0, MAX)
        .map(p => `<li class="cortado">• ${esc(p.nombre)}</li>`)
        .join('');
      const resto = listaProductos.length - MAX;
      return visibles + (resto > 0
        ? `<li class="apagado">… y ${resto} producto(s) más</li>`
        : '');
    };

    const vuelvenHTML = cambios.vuelven.length > 0 ? `
      <div class="nota-info">
        <p class="detalle fuerte con-margen-abajo-chica">
          ↩️ Vuelven ${cambios.vuelven.length} producto(s) que borraste después de esa fecha
        </p>
        <ul class="detalle apilado-chico">${lista(cambios.vuelven)}</ul>
      </div>
    ` : '';

    const seVanHTML = cambios.seVan.length > 0 ? `
      <div class="nota-peligro">
        <p class="detalle fuerte con-margen-abajo-chica">
          🗑️ Desaparecen ${cambios.seVan.length} producto(s) que cargaste o cambiaste después
        </p>
        <ul class="detalle apilado-chico">${lista(cambios.seVan)}</ul>
        <p class="micro apagado con-margen-arriba-chica">
          No se pierden: antes de aplicar se guarda este estado como un punto
          nuevo, así que podés volver atrás desde acá mismo.
        </p>
      </div>
    ` : '';

    const sinCambios = total > 0 && cambios.vuelven.length === 0 && cambios.seVan.length === 0;

    return this.pedirConfirmacion({
      titulo: 'Restaurar inventario',
      aceptar: 'Restaurar',
      aceptarDeshabilitado: total === 0,
      cuerpo: `
        <p>
          Se sustituirá el inventario actual por el estado del
          <strong>${esc(this.formatearFecha(item.fecha))}</strong>
          (${esc(this.formatearMotivo(item.motivo))}), con ${total} producto(s).
        </p>
        ${total === 0 ? '<p class="detalle texto-peligro">Este punto no contiene productos, no se puede aplicar.</p>' : ''}
        ${vuelvenHTML}
        ${seVanHTML}
        ${sinCambios ? '<p class="detalle apagado">No hay diferencias de productos: sólo cambian precios o stocks.</p>' : ''}
        ${resumen.conFoto > 0 ? `
          <label class="opcion">
            <input type="checkbox" id="restaurar-fotos" checked
                   class="casilla">
            <span class="detalle">
              <span class="fuerte">Traer también las fotos</span>
              <span class="apagado">
                ${resumen.disponibles} de ${resumen.conFoto} producto(s) con foto
                pueden volver con su imagen.
              </span>
            </span>
          </label>
        ` : ''}
        ${perdidas > 0 ? `
          <p class="detalle texto-aviso">
            ⚠️ ${perdidas} de esas fotos ya no están en el dispositivo, así que
            esos productos van a volver sin imagen.
          </p>
        ` : ''}
        <p class="detalle apagado">Los cambios que hagas después de restaurar no se podrán deshacer desde aquí.</p>
      `,
      alAceptar: (box) => ({
        conFotos: box.querySelector('#restaurar-fotos')?.checked !== false
      })
    });
  }

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

    if (!resumen) return true;  // que sea importarBackup quien rechace el archivo

    const hayDatos = await db.productos.count();

    return this.pedirConfirmacion({
      titulo: 'Importar backup',
      aceptar: 'Reemplazar todo',
      cuerpo: `
        <p>
          <strong>${esc(nombreArchivo)}</strong> contiene
          ${resumen.productos} producto(s) y ${resumen.categorias} categoría(s).
        </p>
        ${resumen.fecha ? `<p class="detalle apagado">Backup del ${esc(this.formatearFecha(resumen.fecha))}.</p>` : ''}
        ${hayDatos > 0
          ? `<p class="texto-peligro">
               Se <strong>reemplazarán los ${hayDatos} producto(s) que tenés ahora</strong>,
               incluidas sus categorías e imágenes.
             </p>
             <p class="detalle apagado">
               No pasa nada: antes de importar se guarda un punto de restauración
               con tu inventario actual, y podés volver con "Volver Atrás".
             </p>`
          : '<p class="detalle apagado">Tu base está vacía, no se pierde nada.</p>'}
      `
    });
  }

  async restaurar(snapshotId) {
    const item = this.historial.find(h => h.id === snapshotId);
    if (!item) {
      toast.error('Punto de restauración no encontrado');
      return;
    }

    // Devuelve { conFotos } si el usuario acepta, o false si cancela.
    const eleccion = await this.confirmarRestauracion(item);
    if (!eleccion) return;

    try {
      await dbUtils.restaurarDesdeSnapshot(snapshotId, { conFotos: eleccion.conFotos });
      const n = item.snapshotProductos?.length || 0;
      toast.success(
        eleccion.conFotos
          ? `Inventario restaurado: ${n} producto(s)`
          : `Inventario restaurado sin fotos: ${n} producto(s)`
      );
      this.cerrar();
      this.onRestore?.();
    } catch (error) {
      console.error('Error restaurando:', error);
      toast.error(error.message || 'Error al restaurar');
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
 * Abre el modal de historial.
 * @param {Function} [onRestore] Se llama tras restaurar un punto o importar un backup.
 * @param {Function} [onClose]   Se llama SIEMPRE al cerrar (✕, Escape o clic fuera).
 *                              Imprescindible para que quien lo abrió pueda
 *                              limpiar su flag de "ya está abierto"; sin esto el
 *                              botón que lo invoca queda inutilizable.
 */
export async function abrirHistorial(onRestore, onClose) {
  const modal = new HistorialModal(onRestore, onClose);
  await modal.abrir();
  return modal;
}
