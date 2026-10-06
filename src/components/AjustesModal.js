import { dbUtils } from '../db.js';
import { CAMPOS, aplicarCampos } from '../utils/campos.js';
import { icono } from '../utils/iconos.js';

/*
 * El panel de los campos del formulario, en dos modos con la misma cara:
 *
 *   encuesta  se abre una sola vez, al primer arranque, todavía sin registro
 *             en la base. Es la pregunta de qué campos necesita el cliente.
 *   ajustes   el botón de la cabecera, para cambiar de idea después.
 *
 * En los dos se guarda al cerrar, por cualquier camino (Listo, ✕, Escape o el
 * fondo): lo que se tocó es lo que se quiere, y un interruptor que se pierde
 * por tocarse la X equivocada es una puerta de atrás para el olvido. No hay
 * "deshacer", y tampoco lo necesita: volver a encender un campo devuelve sus
 * datos, porque apagar nunca borra.
 *
 * El guardado es el registro entero de `apagados`, y el refresco de la vista es
 * un solo `aplicarCampos()` sobre el body: el formulario y la ficha se enteran
 * del mismo modo que la carga rápida, con la clase que traen puesta.
 */
let abierta = null;

/**
 * Abre el panel de campos.
 *
 * @param {object} [opciones]
 * @param {'encuesta'|'ajustes'} [opciones.modo] encuesta la primera vez,
 *   ajustes desde el botón de la cabecera
 * @returns {Promise<{cerrar: Function}>} para poder cerrarlo desde afuera
 */
export async function abrirAjustes({ modo = 'ajustes' } = {}) {
  abierta?.cerrar();

  // El estado inicial sale de la base y no de un default: si el usuario ya
  // eligió, la encuesta nunca se abre, pero el botón de ajustes sí puede.
  let apagados = new Set();
  try {
    const registro = await dbUtils.leerCamposFormulario();
    apagados = new Set(registro?.apagados || []);
  } catch (error) {
    console.error('[Ajustes] No se pudieron leer los campos guardados:', error);
  }

  const esEncuesta = modo === 'encuesta';

  const modal = document.createElement('div');
  modal.className = 'velo';

  const fila = (campo) => {
    const activo = !apagados.has(campo.clave);
    return `
      <button
        type="button"
        class="fila-tocable ancho-entero"
        data-campo="${campo.clave}"
        aria-pressed="${activo}"
      >
        <span class="no-crece">${icono(campo.icono)}</span>
        <span class="crece">${campo.etiqueta}</span>
        <span class="casilla-lista ${activo ? 'casilla-lista-marcada' : ''}" aria-hidden="true">${icono('verificar')}</span>
      </button>
    `;
  };

  modal.innerHTML = `
    <div class="dialogo dialogo-columna" role="dialog" aria-modal="true" aria-labelledby="ajustes-titulo">
      <div class="dialogo-cabecera dialogo-cabecera-fija">
        <h2 class="titulo titulo-icono" id="ajustes-titulo">${icono(esEncuesta ? 'bombilla' : 'ajuste')}<span>${esEncuesta ? 'Elegí tus campos' : 'Ajustes de campos'}</span></h2>
        <button type="button" id="ajustes-cerrar" class="btn-fantasma btn-icono" aria-label="Cerrar">✕</button>
      </div>

      <div class="dialogo-cuerpo dialogo-cuerpo-scroll apilado-3">
        <p class="detalle">${
          esEncuesta
            ? 'Tocá los campos que querés usar al cargar y editar productos. Lo que apagues no se muestra ni en el formulario ni en la ficha, y se puede cambiar después desde Ajustes, en la cabecera.'
            : 'Lo que apagues no se muestra en el formulario de productos ni en la ficha de detalle. Los datos ya guardados no se pierden: si encendés un campo de nuevo, vuelven a aparecer.'
        }</p>

        <div class="recuadro apilado-chico">
          ${CAMPOS.map(fila).join('')}
        </div>

        <p class="micro tenue">Nombre y precio final siempre se muestran: sin ellos no se guarda nada.</p>
      </div>

      <div class="dialogo-pie dialogo-pie-fija">
        <button type="button" id="ajustes-listo" class="btn-principal btn-crece">
          ${icono('verificar')}<span>Listo</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const cerrar = async () => {
    document.removeEventListener('keydown', alTeclado);
    modal.remove();

    if (abierta === hoja) abierta = null;

    try {
      await dbUtils.guardarCamposFormulario([...apagados]);
      aplicarCampos([...apagados]);
    } catch (error) {
      console.error('[Ajustes] No se pudieron guardar los campos:', error);
    }
  };

  const alTeclado = (e) => {
    if (e.key === 'Escape') cerrar();
  };
  document.addEventListener('keydown', alTeclado);

  modal.querySelectorAll('[data-campo]').forEach(boton => {
    boton.addEventListener('click', () => {
      const activo = boton.getAttribute('aria-pressed') === 'true';
      const nuevo = !activo;

      boton.setAttribute('aria-pressed', String(nuevo));
      boton.querySelector('.casilla-lista').classList.toggle('casilla-lista-marcada', nuevo);

      const clave = boton.dataset.campo;
      if (nuevo) apagados.delete(clave);
      else apagados.add(clave);
    });
  });

  modal.querySelector('#ajustes-cerrar').addEventListener('click', cerrar);
  modal.querySelector('#ajustes-listo').addEventListener('click', cerrar);
  modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

  const hoja = { cerrar };
  abierta = hoja;
  return hoja;
}
