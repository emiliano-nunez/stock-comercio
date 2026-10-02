import { TIPOS_VENTA, estadoStock, getPrecioPrincipal, getUnidadPrincipal, getUnidadBase, categoriasDe, COLORES_CATEGORIAS } from '../db.js';
import { esc, escAttr, fmtPrecio } from '../utils/html.js';

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
 * La hoja que está abierta ahora, a nivel del módulo y no de la función.
 *
 * Sin esto, abrir una hoja no descarta la anterior: quedan dos velos apilados y
 * el velo viejo se queda escuchando el Escape, así que una sola tecla de salida
 * cierra las dos y después la segunda no hace nada. Con el dedo no se llega
 * (el velo tapa el contenido), pero sí con el teclado: las tarjetas son
 * alcanzables con el Tab y el Enter de una tarjeta con el foco puesto abre la
 * hoja sin importar que haya otra abierta.
 */
let abierta = null;

/**
 * La hoja del producto: todo lo que hay que mirar de un producto sin abrir el
 * formulario.
 *
 * Es una planilla a propósito, y no otra tarjeta: el formulario tiene 18 campos,
 * y para leer un stock o un precio hay que llegar hasta el de abajo. Acá los
 * datos salen en una grilla de dos columnas, un dato por renglón, que se lee de
 * arriba abajo como un ticket.
 *
 * No tiene guardado ni edición: es una ventana de lectura. Editar es una acción
 * aparte y explícita, al pie.
 *
 * @param {object}   opciones
 * @param {object}   opciones.producto    el producto tal como lo carga la app
 * @param {object[]} opciones.categorias  todas, para resolver nombres y colores
 * @param {Function} [opciones.onEditar]  se llama con el producto al pedir editar
 * @returns {{ cerrar: Function }}        para poder cerrarla desde afuera
 */
export function abrirDetalleProducto({ producto, categorias = [], onEditar }) {
  const p = producto;
  if (!p) return { cerrar() {} };

  // Sólo puede haber una hoja. Si ya había una abierta, se cierra antes de
  // montar la nueva; si no, quedan dos velos superpuestos y el que quedó abajo
  // se sigue escuchando el Escape.
  abierta?.cerrar();

  const tipo = TIPOS_VENTA.find(t => t.value === p.tipoVenta) || TIPOS_VENTA[0];
  const unidadStock = getUnidadBase(p.tipoVenta);
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
   * Cada renglón de la planilla es un par (lo que se busca, lo que se encontró).
   * Armarla con una lista y no con el HTML escrito a mano es lo que permite que
   * un dato vacío no ocupe una fila: los renglones sin contenido no se pintan, y
   * la planilla queda corta en vez de llena de líneas en blanco.
   */
  const filas = [];
  const fila = (dato, valor, extra = '') => {
    if (valor === null || valor === undefined || valor === '') return;
    filas.push(`<tr><th scope="row">${esc(dato)}</th><td class="planilla-valor ${extra}">${valor}</td></tr>`);
  };

  fila('Stock', `${stock} <span class="tenue">${esc(unidadStock)}</span>`);
  fila('Mínimo', `${stockMinimo} <span class="tenue">${esc(unidadStock)}</span>`);
  fila('Estado', `<span class="insignia ${claseEstado}">${textoEstado}</span>`);

  // El precio sale en la unidad corta (unidad, kg, 500g) y no en el nombre largo
  // de la opción ("Por Kilo (kg)"), porque es lo mismo que se usa en la tarjeta y
  // en el pedido, y así el número se lee siempre igual en los tres lugares.
  //
  // Si el producto no tiene precio para la unidad principal y se cae al de otra,
  // se avisa: un "$4.500/500g" con el precio del kilo al lado no sirve de nada.
  if (precio.valor) {
    fila(
      'Precio',
      `$${fmtPrecio(precio.valor)}<span class="tenue">/${esc(precio.unidad)}${precio.esPrincipal ? '' : ' (referencia)'}</span>`
    );
  }

  /*
   * Los precios de las demás unidades van en renglones propios, como una lista de
   * precios, y no apretados en el mismo renglón del principal. El renglón se
   * rotula con la unidad y no con el nombre de la opción, por el mismo motivo
   * que arriba: "Precio kg", "Precio 500g", dos palabras menos por renglón.
   */
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
            ? `<p class="aviso aviso-atencion fila-corta"><span class="no-crece">⚠️</span><span>Falta la foto: no se encuentra en el dispositivo</span></p>`
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
            <p class="detalle">${esc(notas)}</p>
          </div>
        ` : ''}
      </div>

      <div class="dialogo-pie dialogo-pie-fija">
        <button type="button" id="detalle-editar" class="btn-secundario btn-crece">✏️ Editar</button>
        <button type="button" id="detalle-cerrar-pie" class="btn-principal btn-crece">Cerrar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const cerrar = () => {
    document.removeEventListener('keydown', alTeclado);
    modal.remove();
    // Sólo se limpia la referencia si sigue siendo esta hoja. Si al cerrarla
    // desde adentro ya había otra montada encima, el puntero tiene que quedar en
    // la nueva, no en una que ya no existe.
    if (abierta === hoja) abierta = null;
  };
  const alTeclado = (e) => {
    if (e.key === 'Escape') cerrar();
  };
  document.addEventListener('keydown', alTeclado);

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
