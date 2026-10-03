import { TIPOS_VENTA, estadoStock, getPrecioPrincipal, getUnidadPrincipal, getUnidadBase, categoriasDe, COLORES_CATEGORIAS } from '../db.js';
import { esc, escAttr, fmtPrecio } from '../utils/html.js';
import { icono } from '../utils/iconos.js';

/**
 * La fecha de compra es un día, no un instante: la elige el usuario en un
 * `<input type="date">` y llega como "2026-03-12".
 *
 * Pasarla por `new Date()` la corre un día entero para cualquiera que esté al
 * oeste de UTC, porque "2026-03-12" se interpreta como medianoche UTC y al
 * pasarlo a la zona local son las 21 del día anterior. Por eso se desarma el
 * texto: son tres números que ya están en el orden que se quieren mostrar.
 */
function fechaEnDia(fecha) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha || ''));
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : String(fecha || '');
}

/*
 * La hoja abierta ahora, a nivel del módulo. Sin esto quedarían dos velos
 * apilados y el de abajo seguiría escuchando el Escape.
 */
let abierta = null;

/**
 * La hoja del producto: todo lo que hay que mirar sin abrir el formulario.
 *
 * Es una planilla a propósito, y no otra tarjeta: el formulario tiene 18 campos y
 * para leer un stock hay que llegar hasta el de abajo. Acá los datos salen en una
 * grilla de dos columnas, un dato por renglón, que se lee como un ticket. No tiene
 * guardado: es una ventana de lectura, editar es una acción aparte al pie.
 *
 * @param {object}   opciones
 * @param {object}   opciones.producto    el producto tal como lo carga la app
 * @param {object[]} opciones.categorias  todas, para resolver nombres y colores
 * @param {Function} [opciones.onEditar]  se llama con el producto al pedir editar
 * @param {Function} [opciones.onAjustar] recibe +1 o -1 y devuelve el stock nuevo,
 *   o null si no se pudo guardar
 * @returns {{ cerrar: Function }}        para poder cerrarla desde afuera
 */
export function abrirDetalleProducto({ producto, categorias = [], onEditar, onAjustar }) {
  const p = producto;
  if (!p) return { cerrar() {} };

  abierta?.cerrar();

  const tipo = TIPOS_VENTA.find(t => t.value === p.tipoVenta) || TIPOS_VENTA[0];
  const unidadStock = getUnidadBase(p.tipoVenta);
  // El paso se muestra junto al número para que un stock que sube de a uno no

  const step = tipo.step;
  const principal = getUnidadPrincipal(p);
  const precio = getPrecioPrincipal(p);
  const stock = p.stock || 0;
  const stockMinimo = p.stockMinimo || 0;

  const cats = categoriasDe(p)
    .map(id => categorias.find(c => c.id === id))
    .filter(Boolean);

  const estado = estadoStock(p);
  const claseEstado = estado === 'vacio' ? 'insignia-sin' : estado === 'poco' ? 'insignia-poco' : 'insignia-ok';
  const textoEstado = estado === 'vacio' ? 'Agotado' : estado === 'poco' ? 'Poco' : 'OK';

  const filas = [];
  const fila = (dato, valor, extra = '') => {
    if (valor === null || valor === undefined || valor === '') return;
    filas.push(`<tr><th scope="row">${esc(dato)}</th><td class="planilla-valor ${extra}">${valor}</td></tr>`);
  };

  fila('Stock', `${stock} <span class="tenue">${esc(unidadStock)}</span>`, 'js-detalle-stock');
  fila('Mínimo', `${stockMinimo} <span class="tenue">${esc(unidadStock)}</span>`);
  fila('Estado', `<span class="insignia ${claseEstado}">${textoEstado}</span>`, 'js-detalle-estado');

  /*
   * El precio sale en la unidad corta (unidad, kg, 500g) y no en el nombre largo
   * de la opción ("Por Kilo (kg)"), porque es lo mismo que se usa en la tarjeta y
   * en el pedido, y así el número se lee siempre igual en los tres lugares.
   *
   * Si el producto no tiene precio para la unidad principal y se cae al de otra,
   * se avisa: un "$4.500/500g" con el precio del kilo al lado no sirve de nada.
   */
  if (precio.valor) {
    fila(
      'Precio',
      `$${fmtPrecio(precio.valor)}<span class="tenue">/${esc(precio.unidad)}${precio.esPrincipal ? '' : ' (referencia)'}</span>`
    );
  }

  const otros = (Array.isArray(p.precios) ? p.precios : []).filter(pr => pr.unidad !== precio.unidad && pr.valor > 0);
  for (const otro of otros) {
    fila(`Precio ${otro.unidad}`, `$${fmtPrecio(otro.valor)}`);
  }

  fila('Costo', p.costo ? `$${fmtPrecio(p.costo)}<span class="tenue">/${esc(unidadStock)}</span>` : '');

  /*
   * La unidad principal y el tipo de venta no van siempre en renglón propio. Son
   * datos que el renglón del precio ya está diciendo, y en la planilla cada
   * renglón de más es un renglón que hay que bajar. Sólo aparecen cuando la
   * unidad principal no es la que se está mirando el precio, que es el único
   * caso en que ocultarlas haría pensar una cosa y se vería otra.
   */
  if (principal.value !== precio.unidad) {
    fila('Unidad principal', esc(principal.label));
  }
  if (tipo.value !== principal.value) {
    fila('Venta por', esc(tipo.label));
  }

  fila('Categorías', cats.length
    ? cats.map(c => `<span class="ficha-categoria"><span class="punto-chico" style="background-color: ${escAttr(c.color || COLORES_CATEGORIAS[0])}"></span><span>${esc(c.nombre)}</span></span>`).join(' ')
    : '');
  fila('Proveedor', p.proveedor ? esc(p.proveedor) : '');
  fila('Código', p.codigoBarras ? `<span class="mono">${esc(p.codigoBarras)}</span>` : '');
  fila('Fecha', p.fecha ? esc(fechaEnDia(p.fecha)) : '');

  const notas = (p.notas || '').trim();

  /*
   * El ajuste de stock vive acá y no en la tarjeta: en la tarjeta ocupaba dos
   * filas de cada producto y sólo hace falta mientras se está vendiendo o
   * cargando un pedido.
   *
   * El rótulo va en su propia línea arriba de los botones. En una fila sola los
   * tres controles con su mínimo táctil de 52px más el rótulo no entran en un
   * teléfono, y lo que sobra es el texto: se ve cortado sin aviso. Arriba se lee
   * entero o pasa a dos líneas, pero nunca se corta.
   */
  const ajustarHTML = `
    <div class="apilado-chico con-margen-abajo-chica">
      <span class="micro medio tenue ancho-entero">Ajuste de stock · ${esc(unidadStock)} · ${esc(step)} por toque</span>
      <div class="fila fila-centro">
        <button type="button" class="btn-resta" id="detalle-resta"
          aria-label="Quitar ${escAttr(step)} ${escAttr(unidadStock)}">−</button>
        <span class="campo-numero" id="detalle-stock">${stock}</span>
        <button type="button" class="btn-suma" id="detalle-suma"
          aria-label="Agregar ${escAttr(step)} ${escAttr(unidadStock)}">+</button>
      </div>
    </div>
  `;

  const modal = document.createElement('div');
  modal.className = 'velo';
  modal.innerHTML = `
    <div class="dialogo dialogo-columna" role="dialog" aria-modal="true" aria-labelledby="detalle-titulo">
      <div class="dialogo-cabecera dialogo-cabecera-fija">
        <h2 class="titulo cortado" id="detalle-titulo">${esc(p.nombre || 'Producto')}</h2>
        <button type="button" id="detalle-cerrar" class="btn-fantasma btn-icono no-crece" aria-label="Cerrar">✕</button>
      </div>

      <div class="dialogo-cuerpo apilado-3">
        ${
          p.fotoPerdida
            ? `<p class="aviso aviso-atencion fila-corta"><span class="no-crece">${icono('alerta')}</span><span>Falta la foto: no se encuentra en el dispositivo</span></p>`
            : ''
        }

        ${p.imagenUrl ? `
          <div class="marco-foto marco-foto-centrado">
            <img src="${escAttr(p.imagenUrl)}" class="foto-llena" alt="${escAttr(p.nombre)}">
          </div>
        ` : ''}

        <table class="planilla">
          <tbody>${filas.join('')}</tbody>
        </table>

        ${notas ? `
          <div class="pos-it">
            <div class="etiqueta-seccion">📝 Notas</div>
            <p class="detalle texto-libre">${esc(notas)}</p>
          </div>
        ` : ''}
      </div>

      <div class="dialogo-pie dialogo-pie-fija apilado">
          ${ajustarHTML}
          <div class="fila">
            <button type="button" id="detalle-editar" class="btn-secundario btn-icono-solo" aria-label="Editar este producto">${icono('editar')}</button>
            <button type="button" id="detalle-cerrar-pie" class="btn-principal btn-crece">Cerrar</button>
          </div>
        </div>
    </div>
  `;

  document.body.appendChild(modal);

  const cerrar = () => {
    document.removeEventListener('keydown', alTeclado);
    modal.remove();

    if (abierta === hoja) abierta = null;
  };
  const alTeclado = (e) => {
    if (e.key === 'Escape') cerrar();
  };
  document.addEventListener('keydown', alTeclado);

  /*
   * El ajuste lo hace la app, que es la que sabe guardar y refrescar el
   * inventario. Acá sólo se le pide y se pinta lo que devuelve: si el guardado
   * falla, ajustarStock devuelve null y el número no se mueve, así que la hoja
   * nunca muestra un stock que no está guardado.
   *
   * La insignia de estado se refresca en el mismo paso: el renglón de stock y el
   * de estado son el mismo dato dicho de dos formas, y verlos distintos en la
   * misma pantalla invita a desconfiar de los dos.
   */
  const pintarStock = (nuevo) => {
    const numero = modal.querySelector('#detalle-stock');
    if (numero) numero.textContent = nuevo;

    const celdaEstado = modal.querySelector('.js-detalle-estado');
    if (!celdaEstado) return;
    const bajo = nuevo === 0 ? 'vacio' : nuevo <= stockMinimo ? 'poco' : 'ok';
    const clases = bajo === 'vacio' ? 'insignia-sin' : bajo === 'poco' ? 'insignia-poco' : 'insignia-ok';
    const texto = bajo === 'vacio' ? 'Agotado' : bajo === 'poco' ? 'Poco' : 'OK';
    celdaEstado.className = `planilla-valor js-detalle-estado`;
    celdaEstado.innerHTML = `<span class="insignia ${clases}">${texto}</span>`;

    const celdaStock = modal.querySelector('.js-detalle-stock');
    if (celdaStock) celdaStock.innerHTML = `${nuevo} <span class="tenue">${esc(unidadStock)}</span>`;
  };

  const ajustar = async (delta) => {
    if (!onAjustar) return;
    const nuevo = await onAjustar(delta);
    if (nuevo !== null && nuevo !== undefined) pintarStock(nuevo);
  };

  modal.querySelector('#detalle-suma')?.addEventListener('click', () => ajustar(1));
  modal.querySelector('#detalle-resta')?.addEventListener('click', () => ajustar(-1));

  modal.querySelector('#detalle-cerrar').addEventListener('click', cerrar);
  modal.querySelector('#detalle-cerrar-pie').addEventListener('click', cerrar);
  modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });
  modal.querySelector('#detalle-editar').addEventListener('click', () => {
    cerrar();
    onEditar?.(p);
  });

  const hoja = { cerrar };
  abierta = hoja;
  return hoja;
}
