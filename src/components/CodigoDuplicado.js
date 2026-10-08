import { db, estadoStock, insigniaEstado, unidadStockTexto } from '../db.js';
import { esc, fmtPrecio } from '../utils/html.js';
import { icono } from '../utils/iconos.js';

/**
 * Diálogo de código de barras repetido.
 *
 * El índice de codigoBarras NO es único, a propósito: un índice único en
 * IndexedDB también indexa el null, y entonces sólo un producto de todo el
 * inventario podría quedarse sin código. La consecuencia de esa decisión es que
 * dos productos pueden compartir código, y cuando pasa hay que darle al usuario
 * algo con qué decidir en vez de elegirle uno por su cuenta.
 *
 * El lector de códigos busca por similitud y no por coincidencia exacta, así que
 * un sufijo "-2" no le impide encontrar el producto: sirve para que el usuario
 * los distinga a ojo en la lista, que es lo que hace falta cuando él mismo
 * duplicó el producto y sabe cuál es cuál.
 */

const MAX_LISTADOS = 8;

/**
 * Primer código libre de la familia `base`, `base-2`, `base-3`...
 *
 * Se consulta por prefijo y no sólo por coincidencia exacta. Si el usuario
 * guardó "7790-2" en algún momento, sigue ocupando el lugar aunque hoy no haya
 * ningún "7790" pelado, y saltarse el prefijo volvería a elegir un código ya
 * tomado.
 *
 * @param {string} base
 * @returns {Promise<string|null>} null si ninguno queda libre (con 998 sufijos
 *   encima el código base no es un código real).
 */
export async function primerCodigoLibre(base) {
  const baseTxt = String(base);
  const filas = await db.productos
    .where('codigoBarras')
    .startsWith(baseTxt)
    .toArray();

  const usados = new Set(filas.map(f => String(f.codigoBarras)));
  if (!usados.has(baseTxt)) return baseTxt;

  for (let n = 2; n <= 999; n++) {
    const candidato = `${baseTxt}-${n}`;
    if (!usados.has(candidato)) return candidato;
  }
  return null;
}

/**
 * Abre el diálogo y resuelve con la decisión del usuario.
 *
 * @param {Object}    opciones
 * @param {string}    opciones.codigo     Código escaneado, o el que se está por guardar
 * @param {Array}     opciones.productos  Productos que ya lo tienen
 * @param {'escaner'|'formulario'} opciones.origen
 * @param {Function} [opciones.onAbrir]  (producto) => void. Sólo en escaner: en
 *   el formulario no se ofrece, porque abrir otro producto taparía el formulario
 *   con lo que el usuario viene escribiendo.
 * @param {Function}  opciones.onBorrar   (producto) => Promise<void>. Borra el
 *   producto y recarga; quien lo pasa decide si deja punto de restauración.
 * @returns {Promise<{accion: string, codigo?: string, producto?: object}>}
 *   `accion` es una de: 'crear' | 'abrir' | 'guardar' | 'sufijo' | 'sin-codigo'
 *   | 'resuelto' | 'cancelar'.
 */
export function abrirCodigoDuplicado({ codigo, productos, origen, onAbrir, onBorrar }) {
  return new Promise((resolve) => {

    let conflictos = productos.map(p => ({ ...p }));

    const box = document.createElement('div');
    box.className = 'velo';

    const cerrar = (valor) => {
      box.remove();
      document.removeEventListener('keydown', onKey);
      resolve(valor);
    };
    const onKey = (e) => { if (e.key === 'Escape') cerrar({ accion: 'cancelar' }); };

    function filaProducto(p, indice) {
      const stock = p.stock || 0;
      const minimo = p.stockMinimo || 0;

      const badge = insigniaEstado(estadoStock(p));

      // El botón "Abrir" sólo aparece en el escáner: en el formulario taparía
      // lo que el usuario viene escribiendo sin avisar.
      const acciones = origen === 'escaner'
        ? `<button class="btn-secundario btn-crece" data-accion="abrir" data-indice="${indice}">Abrir</button>`
        : '';

      return `
        <div class="tarjeta apilado" data-fila="${indice}">
          <div class="fila fila-arriba fila-separada">
            <div class="ancho-cero">
              <p class="subtitulo cortado">${esc(p.nombre)}</p>
              <p class="detalle apagado con-margen-arriba-mini">
                Stock ${stock} ${esc(unidadStockTexto(p, stock))}
                ${minimo > 0 ? ` / mínimo ${minimo}` : ''} · ${esc(fmtPrecio(p.precio))}
              </p>
            </div>
            <span class="insignia insignia-pequena no-crece ${badge.clase}">${badge.texto}</span>
          </div>
          <div class="fila">
            ${acciones}
            <button class="btn-peligro btn-crece" data-accion="preguntar-borrar" data-indice="${indice}">Borrar</button>
          </div>
        </div>
      `;
    }

    function filaConfirmando(p, indice) {
      return `
        <div class="tarjeta apilado tarjeta-peligro" data-fila="${indice}">
          <p class="titulo-peligro">
            ¿Borrar <strong>${esc(p.nombre)}</strong>?
          </p>
          <p class="detalle texto-peligro">No se puede deshacer.</p>
          <div class="fila">
            <button class="btn-secundario btn-crece" data-accion="cancelar-borrar" data-indice="${indice}">No, dejarlo</button>
            <button class="btn-peligro btn-crece" data-accion="borrar" data-indice="${indice}">Sí, borrar</button>
          </div>
        </div>
      `;
    }

    function pintar() {
      const total = conflictos.length;
      const aMostrar = conflictos.slice(0, MAX_LISTADOS);
      const ocultos = total - aMostrar.length;
      const muchos = total > 1;

      // El pie cambia según el origen: cada uno ofrece decisiones distintas.

      const pie = origen === 'escaner'
        ? `
          <div class="dialogo-pie apilado">
            <p class="detalle apagado">
              Un mismo código no puede identificar a dos productos. Abrí el que
              corresponde, o creá uno nuevo si ninguno es el que buscabas.
            </p>
            <button class="btn-principal btn-ancho" data-accion="crear">
              Crear producto nuevo con este código
            </button>
            <button class="btn-secundario btn-ancho" data-accion="cancelar">Cancelar</button>
          </div>
        `
        : `
          <div class="dialogo-pie apilado">
            <p class="detalle apagado">
              Un mismo código no puede identificar a dos productos. Podés
              distinguirlo con un sufijo, guardarlo sin código, o borrar el
              producto de abajo que lo tenía.
            </p>
            <div class="fila">
              <button class="btn-secundario btn-crece" data-accion="sin-codigo">Sin código</button>
              <button class="btn-principal btn-crece" data-accion="guardar">Guardar igual</button>
            </div>
            <button class="btn-secundario btn-ancho" data-accion="sufijo" data-cargando="0">
              <span class="sufijo-campo">Distinguir con sufijo</span>
            </button>
            <button class="btn-fantasma btn-ancho" data-accion="cancelar">Cancelar</button>
          </div>
        `;

      box.innerHTML = `
        <div class="dialogo">
          <div class="dialogo-cabecera dialogo-cabecera-aviso">
            <h2 class="titulo fila ancho-cero">
              <span>${icono('alerta')}</span>
              <span class="cortado">Código repetido</span>
            </h2>
            <button class="btn-fantasma btn-icono no-crece" data-accion="cancelar" aria-label="Cerrar">✕</button>
          </div>

          <div class="dialogo-cuerpo apilado-3">
            <div class="recuadro">
              <p class="detalle con-medio">
                ${muchos
                  ? `Estos <strong>${total}</strong> productos usan el código`
                  : 'Este producto usa el código'}
              </p>
              <p class="mono fuerte con-margen-arriba rompe-palabras">${esc(codigo)}</p>
            </div>

            <div class="apilado">
              ${aMostrar.map((p, i) => filaProducto(p, i)).join('')}
            </div>

            ${ocultos > 0
              ? `<p class="detalle apagado centro-texto">y ${ocultos} producto(s) más con este código</p>`
              : ''}

            <p class="detalle apagado">
              ${origen === 'escaner'
                ? 'El escáner no puede saber cuál de los dos es: lo decidís vos.'
                : 'Ningún lector se va a perder: el código se sigue usando.'}
            </p>
          </div>

          ${pie}
        </div>
      `;

      // El sufijo disponible se calcula una vez por pintado y se muestra en el
      // botón, para que el usuario vea el código exacto que va a quedar antes
      // de aceptarlo y no después.

      if (origen === 'formulario') prepararSufijo().catch(console.error);
    }

    async function prepararSufijo() {
      const boton = box.querySelector('[data-accion="sufijo"]');
      const texto = boton?.querySelector('.sufijo-campo');
      if (!boton || !texto) return;
      const libre = await primerCodigoLibre(codigo);
      if (libre === codigo) {

        // El código volvió a quedar libre (el usuario borró el último conflicto
        // desde acá), así que ofrecerle un sufijo no tiene sentido.

        boton.disabled = true;
        texto.textContent = 'Distinguir con sufijo';
        return;
      }
      if (libre === null) {
        boton.disabled = true;
        texto.textContent = 'Distinguir con sufijo';
        return;
      }
      boton.dataset.candidato = libre;
      texto.textContent = `Distinguir: ${libre}`;
    }

    async function borrar(indice) {
      const producto = conflictos[indice];
      if (!producto) return;
      try {
        await onBorrar(producto);
      } catch (error) {
        console.error(error);
        box.querySelector(`[data-fila="${indice}"]`)?.replaceWith(filaProducto(producto, indice));
        return;
      }
      conflictos = conflictos.filter(p => p.id !== producto.id);

      // Si no queda ningún conflicto no hay nada que elegir: se cierra como
      // resuelto y el código se queda tal cual, el de siempre.
      if (conflictos.length === 0) return cerrar({ accion: 'resuelto' });
      pintar();
    }

    box.addEventListener('click', (e) => {
      if (e.target === box) return cerrar({ accion: 'cancelar' });
      const boton = e.target.closest('[data-accion]');
      if (!boton || boton.disabled) return;

      const accion = boton.dataset.accion;
      const indice = Number(boton.dataset.indice);

      switch (accion) {
        case 'cancelar':
          return cerrar({ accion: 'cancelar' });

        case 'crear':
          return cerrar({ accion: 'crear' });

        case 'guardar':
          return cerrar({ accion: 'guardar' });

        case 'sin-codigo':
          return cerrar({ accion: 'sin-codigo' });

        case 'sufijo': {
          const elegido = boton.dataset.candidato;
          if (!elegido) return;
          return cerrar({ accion: 'sufijo', codigo: elegido });
        }

        case 'abrir': {
          const producto = conflictos[indice];
          if (!producto) return;
          cerrar({ accion: 'abrir', producto });
          return onAbrir ? onAbrir(producto) : undefined;
        }

        case 'preguntar-borrar': {
          const producto = conflictos[indice];
          if (!producto) return;
          box.querySelector(`[data-fila="${indice}"]`)?.replaceWith(filaConfirmando(producto, indice));
          return;
        }

        case 'cancelar-borrar': {
          const producto = conflictos[indice];
          if (!producto) return;
          box.querySelector(`[data-fila="${indice}"]`)?.replaceWith(filaProducto(producto, indice));
          return;
        }

        case 'borrar':
          return borrar(indice);
      }
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(box);
    pintar();
  });
}
