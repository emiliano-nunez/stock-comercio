# DepoApp

App de control de stock para comercios. Funciona sin internet y guarda todo en el
dispositivo: no hay cuentas, ni servidor, ni nube.

## Qué hace

- Productos con foto, código de barras, categorías, proveedor y notas
- Stock con mínimo, que avisa cuando hay que reponer
- Escáner de códigos de barras con la cámara
- Pedido de faltantes dividido por proveedor, para copiar y mandar
- Copias de seguridad en archivo, e historial para volver atrás

## Requisitos

- Node.js 18 o superior

## Instalar

```bash
npm install
```

## Desarrollo

```bash
npm run dev       # servidor de desarrollo
npm run build     # genera la versión para publicar
npm run preview   # sirve la versión generada, como va a quedar
```

## Publicación

Cada `push` a `main` publica solo, no hay que hacer nada más. La app está en
<https://emiliano-nunez.github.io/stock-comercio/>.

En un teléfono se instala desde el navegador y queda como una app. La cámara sólo
funciona si la página está en HTTPS o en `localhost`.

## Dónde están los datos

Todo vive en el IndexedDB del navegador, en el dispositivo donde se usa la app.
No hay servidor: la base no se sincroniza entre equipos y no se puede recuperar
desde otro aparato.

La app **no guarda ningún historial**. No hay puntos de restauración, no hay
"volver atrás" y un borrado no se puede deshacer dentro de la app. Lo que la
protege son dos cosas:

- **Exportar la copia de seguridad**, desde el botón "Copia" de la barra. Deja un
  archivo en el dispositivo con todo: productos, categorías, proveedores y fotos.
- **Preguntar antes de borrar**, con el nombre de lo que va a desaparecer.

Conviene exportar seguido: iOS borra los datos de una PWA que lleva unos días sin
abrirse, y no avisa.

Si el producto se borra, su foto queda guardada igual, sin que nadie la use. No se
borra sola nunca: se ve cuántas hay en la copia de seguridad y se liberan sólo si
lo decidís.

## Cómo está hecho

| | |
|---|---|
| Build | Vite |
| App instalable | vite-plugin-pwa + Workbox |
| Base de datos | IndexedDB con Dexie |
| Estilos | CSS propio, con variables |
| Cámara | API nativa del navegador |
| Escáner | html5-qrcode |
| Imágenes | browser-image-compression |

## Estructura

```
index.html            la página que sirve Vite
vite.config.js        build, PWA y la ruta de publicación
src/
  main.js             punto de entrada
  App.js              el estado de la app y el HTML que se arma
  db.js               el esquema, las consultas y las escrituras
  components/         los diálogos: producto, escáner, cámara, copia, pedido
  utils/              texto, íconos, fechas, avisos, imágenes, respaldo
  css/                los estilos, divididos por tema
public/icons/         el ícono de la app y el de los accesos directos
medir-costo.mjs       mide el costo del filtrado, sin tocar la base
```

## Cómo se lee y se escribe un producto

Todo el HTML se arma con template literals, así que hay dos reglas que no se
negocian:

- **Todo texto del usuario pasa por `esc` o `escAttr`.** Y dentro de un atributo
  siempre, aunque el valor sea un número o una constante: la regla es "en un
  atributo, escapado", no "en un atributo, escapado si me acordé".
- **Toda escritura de un producto pasa por `dbUtils.guardarProducto()`**, que
  recalcula los campos derivados por los que se filtra y se ordena. Si uno se
  olvidara, la escritura no fallaría: fallaría el filtro, y devolvería la lista
  vacía sin decir por qué.

## Los estilos

Los colores, las medidas y los espaciados salen de variables de CSS, no de números
escritos en las reglas. `src/css/tokens.css` tiene dos bloques que hay que conocer:

- **Las medidas táctiles.** `--toque-min` es el alto y el ancho mínimo de cualquier
  control que se toque con el dedo. Todo lo demás lo toma de ahí.
- **El estándar de la interfaz.** Un bloque con los valores de diseño de la tarjeta,
  la cabecera, el buscador, los formularios y los diálogos, con los nombres por
  componente. Cuando hace falta un valor nuevo se agrega ahí.

## Antes de tocar nada

```bash
npm run verificar   # los seis verificadores
npm test            # la app arrancada de verdad
npm run build       # que compile de verdad
```

Los seis verificadores nacieron de bugs que llegaron a la página publicada:

| | Qué encuentra |
|---|---|
| `verificar-sintaxis.mjs` | un archivo mal escrito |
| `verificar-caracteres.mjs` | letras de otro idioma coladas en el código |
| `verificar-imports.mjs` | una llamada a una función propia sin su import |
| `verificar-plantillas.mjs` | un acento grave en un comentario que corta una plantilla |
| `verificar-escapado.mjs` | una interpolación sin escapar dentro de un atributo |
| `verificar-propiedades.mjs` | un método que lee un campo que la clase no escribe, o un método cuyo nombre pisa una propiedad |

Los tres primeros cortan el trabajo apenas se toca un archivo. Los dos últimos
evitan que un dato del usuario salga crudo en el HTML. El sexto cubre la clase de
bug que más llegó a la pantalla: un `this.algo` que ya no existe, o un `this.algo`
que existe pero tapó al método del mismo nombre.

### `npm test`

Los seis verificadores miran el archivo, y hay errores que sólo existen cuando el
código corre: un método de Dexie que no existe en la versión instalada, un campo
renombrado que quedó con una referencia suelta, un método tapado por una propiedad.
Contra el texto del archivo no se ven.

`pruebas/arranque.test.mjs` corre la app de verdad, con un DOM de verdad (`jsdom`)
y una base IndexedDB de verdad en memoria (`fake-indexeddb`), y afirma que el
inventario se dibuja, que las consultas devuelven la página que se pidió y que no
hay errores en consola. Salió de los cuatro bugs seguidos que llegaron al usuario
antes de que existiera.

La publicación corre los tres: `npm run publicar` es la puerta, y es la que usan
GitHub Actions y Netlify.

## Los íconos

`public/icons/icon.svg` es el original. Los PNG se generan de ahí:

```bash
node generar-iconos.mjs          # los ocho tamaños del ícono de la app
node generar-iconos-accesos.mjs  # los dos de los accesos directos
```

## Licencia

MIT
