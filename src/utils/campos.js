/**
 * Los campos que el usuario puede apagar en el formulario de producto.
 *
 * Cada uno tiene su clave en minúscula y con guiones, que es a la vez el sufijo
 * de la clase en el body (`sin-<clave>`), del bloque que se esconde
 * (`.campo-<clave>`) y del campo en la base (`apagados`). Un solo nombre en
 * tres lugares: no hay nada que traducir ni recordar.
 *
 * Nombre y precio final no están: son obligatorios para guardar, así que no se
 * pueden apagar.
 */
export const CAMPOS = [
  { clave: 'foto', etiqueta: 'Foto', icono: 'camara' },
  { clave: 'codigo-barras', etiqueta: 'Código de barras', icono: 'etiqueta' },
  { clave: 'codigo-proveedor', etiqueta: 'Código del proveedor', icono: 'etiqueta' },
  { clave: 'tipo-venta', etiqueta: 'Tipo de venta', icono: 'medida' },
  { clave: 'calculadora', etiqueta: 'Calculadora (costo, IVA y margen)', icono: 'calculadora' },
  { clave: 'stock', etiqueta: 'Stock', icono: 'caja' },
  { clave: 'stock-minimo', etiqueta: 'Stock mínimo', icono: 'alerta' },
  { clave: 'fecha', etiqueta: 'Fecha', icono: 'calendario' },
  { clave: 'proveedor', etiqueta: 'Proveedor', icono: 'proveedor' },
  { clave: 'categorias', etiqueta: 'Categorías', icono: 'carpeta' },
  { clave: 'notas', etiqueta: 'Notas', icono: 'lapiz' }
];

/**
 * Marca en el body qué campos están apagados.
 *
 * El apagado vive en el body y no en cada componente: así el formulario, la
 * ficha de detalle y la carga rápida se enteran por el mismo lado, con una
 * sola clase, y ningún componente necesita leer la base para saber qué mostrar.
 * Cada bloque visible se marca con `.campo-<clave>` y el CSS cruza las dos
 * listas.
 *
 * Se reemplaza la lista entera en cada llamada, así que cambiar de selección
 * no deja clases viejas sueltas.
 *
 * @param {string[]} apagados las claves de los campos que no se quieren ver
 */
export function aplicarCampos(apagados) {
  const todas = CAMPOS.map(c => `sin-${c.clave}`);
  const nuevas = (Array.isArray(apagados) ? apagados : [])
    .map(clave => `sin-${clave}`)
    .filter(clase => todas.includes(clase));

  document.body.classList.remove(...todas);
  if (nuevas.length) document.body.classList.add(...nuevas);
}
