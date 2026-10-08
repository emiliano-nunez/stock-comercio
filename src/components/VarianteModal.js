import { COLORES_CATEGORIAS, nombreDeVariante, nombreBaseDe } from '../db.js';
import { esc, escAttr } from '../utils/html.js';
import { icono } from '../utils/iconos.js';

/**
 * Diálogo para crear una variante de un producto.
 *
 * Es el reemplazo de duplicar: en vez de una copia suelta, la copia nace
 * vinculada a la familia. El diálogo sólo pide lo que distingue a la variante
 * —etiqueta y color— porque el resto (precio, costo, categoría, foto) se copia
 * del original y el usuario lo revisa en el formulario que se abre después.
 *
 * No toca la base: devuelve la elección y el que llama arma los datos.
 *
 * @param {object} opciones
 * @param {object} opciones.producto producto del que nace la variante
 * @param {object|null} [opciones.base] producto que abrió la familia, si existe
 * @returns {Promise<{etiqueta: string, color: string}|null>} null si se cancela
 */
export function abrirVarianteModal({ producto, base = null }) {
  return new Promise((resolve) => {
    const nombreBase = base && base.id !== producto.id ? base.nombre : nombreBaseDe(producto);
    // Siempre un color elegible, y siempre cambiable: el color de una variante
    // es un dato real que el usuario decide, no uno que se le asigna.
    const colorInicial = COLORES_CATEGORIAS[0];

    const box = document.createElement('div');
    box.className = 'velo';

    const cerrar = (valor) => {
      box.remove();
      document.removeEventListener('keydown', onKey);
      resolve(valor);
    };
    const onKey = (e) => { if (e.key === 'Escape') cerrar(null); };

    box.innerHTML = `
      <div class="dialogo">
        <div class="dialogo-cabecera">
          <h2 class="titulo titulo-icono">${icono('duplicar')}<span>Crear variante</span></h2>
          <button type="button" class="btn-fantasma btn-icono no-crece" data-accion="cancelar" aria-label="Cerrar">✕</button>
        </div>
        <form id="form-variante" class="dialogo-cuerpo apilado-3" novalidate>
          <p class="detalle apagado">
            Nueva variante de <strong>«${esc(nombreBase)}»</strong>. Copia el precio,
            el costo, la categoría y la foto; el stock arranca en 0 y el código se
            carga después.
          </p>
          <div>
            <label for="variante-etiqueta" class="etiqueta">Etiqueta</label>
            <input type="text" id="variante-etiqueta" class="campo" maxlength="40"
              autocomplete="off" placeholder="Negro, Rojo, Diseño floral…">
          </div>
          <div>
            <label class="etiqueta">Color</label>
            <div class="fila envuelto">
              ${COLORES_CATEGORIAS.map(color => `
                <button type="button" class="color-btn muestra-color ${color === colorInicial ? 'muestra-color-elegida' : ''}" data-color="${escAttr(color)}" style="background-color: ${escAttr(color)}; border-color: ${escAttr(color)}40;" aria-label="Color ${escAttr(color)}"></button>
              `).join('')}
            </div>
          </div>
          <div class="recuadro">
            <p class="micro apagado">El nombre va a quedar así</p>
            <p class="fuerte rompe-palabras js-nombre-variante">${esc(nombreBase)}</p>
          </div>
        </form>
        <div class="dialogo-pie apilado">
          <p class="detalle apagado">
            Después de crearla se abre el formulario con todo copiado: sólo faltan
            el código y revisar lo que cambie.
          </p>
          <div class="fila">
            <button type="button" class="btn-secundario btn-crece" data-accion="cancelar">Cancelar</button>
            <button type="submit" form="form-variante" class="btn-principal btn-crece" disabled>
              ${icono('verificar')}<span>Crear variante</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const input = box.querySelector('#variante-etiqueta');
    const vista = box.querySelector('.js-nombre-variante');
    const botonCrear = box.querySelector('[type="submit"]');
    let color = colorInicial;

    const refrescar = () => {
      const etiqueta = input.value.trim();
      botonCrear.disabled = etiqueta.length === 0;
      vista.textContent = etiqueta ? `${nombreBase} — ${etiqueta}` : nombreBase;
    };

    box.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        color = btn.dataset.color;
        box.querySelectorAll('.color-btn').forEach(b => {
          b.classList.toggle('muestra-color-elegida', b === btn);
        });
      });
    });

    input.addEventListener('input', refrescar);

    box.querySelector('#form-variante').addEventListener('submit', (e) => {
      e.preventDefault();
      const etiqueta = input.value.trim();
      if (!etiqueta) return;
      cerrar({ etiqueta, color });
    });

    box.addEventListener('click', (e) => {
      if (e.target === box) return cerrar(null);
      if (e.target.closest('[data-accion="cancelar"]')) return cerrar(null);
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(box);
    input.focus();
  });
}
