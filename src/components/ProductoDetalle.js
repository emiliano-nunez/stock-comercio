import { TIPOS_VENTA, estadoStock, getPrecioPrincipal, getUnidadPrincipal, getUnidadBase, unidadStockTexto, pasoUnidadStock, categoriasDe, COLORES_CATEGORIAS } from '../db.js';
import { esc, escAttr, fmtPrecio } from '../utils/html.js';
import { fechaEnDia } from '../utils/texto.js';
import { icono } from '../utils/iconos.js';

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
 * @param {object[]} [opciones.variantes] las hermanas de la misma familia
 * @param {Function} [opciones.onEditar]  se llama con el producto al pedir editar
 * @param {Function} [opciones.onAjustar] recibe +1 o -1 y devuelve el stock nuevo,
 *   o null si no se pudo guardar
 * @param {Function} [opciones.onVariante] al pedir crear variante de este producto
 * @param {Function} [opciones.onVerVariante] al tocar un chip de variante, con su id
 * @returns {{ cerrar: Function }}        para poder cerrarla desde afuera
 */
export function abrirDetalleProducto({ producto, categorias = [], variantes = [], onEditar, onAjustar, onVariante, onVerVariante }) {
  const p = producto;
  if (!p) return { cerrar() {} };

  abierta?.cerrar();

  const tipo = TIPOS_VENTA.find(t => t.value === p.tipoVenta) || TIPOS_VENTA[0];
  // El stock se cuenta en la unidad propia del producto si la tiene; el costo
  // sigue en la unidad de venta porque costo y precio tienen que estar en la
  // misma unidad para que cierre la calculadora de margen.
  const unidadBase = getUnidadBase(p.tipoVenta);
  // Cuánto mueve cada toque el ajuste. Se muestra junto al número para que un
  // stock que sube de a uno no parezca un error de tipeo.
  const step = pasoUnidadStock(p.unidadStock, p.tipoVenta);
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

  /*
   * Todas las filas aparecen siempre.
   *
   * Antes la fila se sacaba entera cuando el valor venía vacío, así que la planilla
   * cambiaba de largo según el producto y no se distinguía "no lo llenó" de "este
   * producto no tiene ese dato". Ahora la fila está siempre y el hueco se dice con
   * un guion, que es lo que el usuario lee como campo sin llenar.
   */
  const filas = [];
  const SIN_LLENAR = '<span class="sin-llenar">sin llenar</span>';

  /*
   * El cuarto parámetro es el campo de los Ajustes al que pertenece el renglón.
   * Con `campo`, la fila se marca con `.campo-<nombre>` y la regla del body la
   * apaga igual que al bloque equivalente del formulario: lo que el usuario
   * escondió no se muestra en ninguna de las dos vistas.
   */
  const fila = (dato, valor, extra = '', campo = '') => {
    const vacio = valor === null || valor === undefined || valor === '';
    const celda = vacio ? SIN_LLENAR : valor;
    const clase = campo ? ` class="campo-${campo}"` : '';
    filas.push(
      `<tr${clase}><th scope="row">${esc(dato)}</th><td class="planilla-valor ${extra}">${celda}</td></tr>`
    );
  };

  // Estado va con stock: es el mismo dato dicho de otra forma, y ver el uno sin
  // el otro en la misma planilla invita a desconfiar.
  fila('Stock', `${stock} <span class="tenue">${esc(unidadStockTexto(p, stock))}</span>`, 'js-detalle-stock', 'stock');
  fila('Mínimo', `${stockMinimo} <span class="tenue">${esc(unidadStockTexto(p, stockMinimo))}</span>`, '', 'stock-minimo');
  fila('Estado', `<span class="insignia ${claseEstado}">${textoEstado}</span>`, 'js-detalle-estado', 'stock');

  /*
   * Las hermanas de este producto: las variantes si ésta es la base, las otras
   * variantes si ésta es variante. Cada chip abre la otra ficha, que es como se
   * salta entre colores para ajustar stock. Sólo hay fila con familia de
   * verdad: en un producto común no hay nada que mostrar.
   */
  if (variantes.length) {
    const chips = variantes.map(v => `
      <button type="button" class="chip-variante js-ver-variante" data-id="${escAttr(v.id)}">
        ${v.varianteColor ? `<span class="punto-chico" style="background-color: ${escAttr(v.varianteColor)}"></span>` : ''}
        <span class="cortado">${esc(v.nombre)}</span>
      </button>`).join('');
    fila('Variantes', `<span class="fila envuelto">${chips}</span>`, 'js-variantes');
  }

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

  fila('Costo', p.costo ? `$${fmtPrecio(p.costo)}<span class="tenue">/${esc(unidadBase)}</span>` : '', '', 'calculadora');

  /*
   * La línea de cambios guardados: cada entrada es lo que valía antes de un
   * cambio, de la más reciente a la más vieja. Sólo aparece cuando hay
   * historial: un producto recién creado no tiene nada que contar todavía.
   */
  const historial = (Array.isArray(p.historialPrecios) ? p.historialPrecios : [])
    .filter(h => h && typeof h === 'object');
  if (historial.length) {
    const lineas = [...historial].reverse().map(h => {
      const partes = [];
      if (h.precio > 0) partes.push(`precio $${fmtPrecio(h.precio)}`);
      if (h.costo > 0) partes.push(`costo $${fmtPrecio(h.costo)}`);
      return `${fechaEnDia(h.fecha)} · ${partes.join(' · ') || '—'}`;
    }).join('<br>');
    fila('Historial de precios', `<span class="micro apagado">${lineas}</span>`);
  }

  /*
   * La unidad principal y el tipo de venta no van siempre en renglón propio. Son
   * datos que el renglón del precio ya está diciendo, y en la planilla cada
   * renglón de más es un renglón que hay que bajar. Sólo aparecen cuando la
   * unidad principal no es la que se está mirando el precio, que es el único
   * caso en que ocultarlas haría pensar una cosa y se vería otra.
   */
  if (principal.value !== precio.unidad) {
    fila('Unidad principal', esc(principal.label), '', 'tipo-venta');
  }
  if (tipo.value !== principal.value) {
    fila('Venta por', esc(tipo.label), '', 'tipo-venta');
  }

  fila('Categorías', cats.length
    ? cats.map(c => `<span class="ficha-categoria"><span class="punto-chico" style="background-color: ${escAttr(c.color || COLORES_CATEGORIAS[0])}"></span><span>${esc(c.nombre)}</span></span>`).join(' ')
    : '', '', 'categorias');
  fila('Proveedor', p.proveedor ? esc(p.proveedor) : '', '', 'proveedor');
  fila('Código', p.codigoBarras ? `<span class="mono">${esc(p.codigoBarras)}</span>` : '', '', 'codigo-barras');
  fila('Código del proveedor', p.codigoProveedor ? `<span class="mono">${esc(p.codigoProveedor)}</span>` : '', '', 'codigo-proveedor');
  fila('Fecha', p.fecha ? esc(fechaEnDia(p.fecha)) : '', '', 'fecha');

  const notas = (p.notas || '').trim();

  /*
   * El ajuste de stock vive acá y no en la tarjeta: en la tarjeta ocupaba dos
   * filas de cada producto y sólo hace falta mientras se está vendiendo o
   * cargando un pedido.
   *
   * El rótulo va en su propia línea arriba de los botones. En una fila sola los
   * tres controles con su mínimo táctil más el rótulo no entran en un
   * teléfono, y lo que sobra es el texto: se ve cortado sin aviso. Arriba se lee
   * entero o pasa a dos líneas, pero nunca se corta.
   */
  const ajustarHTML = `
    <div class="apilado-chico con-margen-abajo-chica campo-stock">
      <span class="micro medio tenue ancho-entero">Ajuste de stock · ${esc(unidadStockTexto(p, step))} · ${esc(step)} por toque</span>
      <div class="fila fila-centro">
        <button type="button" class="btn-resta" id="detalle-resta"
          aria-label="Quitar ${escAttr(step)} ${escAttr(unidadStockTexto(p, step))}">−</button>
        <span class="campo-numero" id="detalle-stock">${stock}</span>
        <button type="button" class="btn-suma" id="detalle-suma"
          aria-label="Agregar ${escAttr(step)} ${escAttr(unidadStockTexto(p, step))}">+</button>
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
            ? `<p class="nota-atencion fila-corta campo-foto"><span class="no-crece">${icono('alerta')}</span><span>Falta la foto: no se encuentra en el dispositivo</span></p>`
            : ''
        }

        ${p.imagenUrl ? `
          <div class="marco-foto marco-foto-centrado campo-foto">
            <img src="${escAttr(p.imagenUrl)}" class="foto-llena" alt="${escAttr(p.nombre)}">
          </div>
        ` : ''}

        <table class="planilla">
          <tbody>${filas.join('')}</tbody>
        </table>

        ${notas ? `
          <div class="pos-it campo-notas">
            <div class="etiqueta-seccion">📝 Notas</div>
            <p class="detalle texto-libre">${esc(notas)}</p>
          </div>
        ` : ''}
      </div>

      <div class="dialogo-pie dialogo-pie-fija apilado pie-acciones">
          ${ajustarHTML}
          <div class="fila">
            <!--
              El botón de crear variante vive acá y no en la tarjeta en el
              teléfono. La tarjeta lleva los botones en una columna al costado y
              con los tres dedos la fila de la tarjeta se pone más alta;
              sacándolo de la tarjeta, la columna queda con dos. En el escritorio
              el botón vuelve a la tarjeta, que es donde se lo usa, y acá se
              esconde.
            -->
            <button
              type="button"
              id="detalle-variante"
              class="btn-secundario btn-icono-solo variante-detalle"
              aria-label="Crear variante de este producto"
            >${icono('duplicar')}</button>
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
    if (celdaStock) celdaStock.innerHTML = `${nuevo} <span class="tenue">${esc(unidadStockTexto(p, nuevo))}</span>`;
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

  modal.querySelector('#detalle-variante')?.addEventListener('click', () => {
    cerrar();
    onVariante?.(p);
  });

  // Cada chip abre la ficha de su hermana. No se cierra la actual a mano: al
  // crear la nueva hoja, la que estaba abierta se cierra sola.
  modal.querySelectorAll('.js-ver-variante').forEach(chip => {
    chip.addEventListener('click', () => onVerVariante?.(chip.dataset.id));
  });

  const hoja = { cerrar };
  abierta = hoja;
  return hoja;
}
