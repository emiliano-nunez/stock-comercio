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
desde otro aparato. Para no perder nada hay que usar **Exportar backup** desde el
historial, que deja un archivo en el disco.

Conviene hacerlo seguido: iOS borra los datos de una PWA que lleva unos días sin
abrirse, y no avisa.

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
  App.js              el estado de la app y todo el HTML que se arma
  db.js               el esquema y las consultas
  components/         los diálogos: producto, escáner, cámara, historial, pedido
  utils/              texto, íconos, fechas, avisos, imágenes
  css/                los estilos, divididos por tema
public/icons/         el ícono de la app y el de los accesos directos
```

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
node verificar-sintaxis.mjs     # que todos los archivos estén bien escritos
node verificar-caracteres.mjs   # que no se hayan colado letras de otro idioma
node verificar-imports.mjs      # que toda llamada tenga su import
node verificar-plantillas.mjs   # que ningún comentario corte una plantilla
npm run build                   # que compile de verdad
```

Los dos primeros son los que más salvan: el primero corta el trabajo apenas se
toca un archivo, y el segundo encuentra los caracteres raros que quedan cuando un
archivo se guarda con la codificación equivocada.

## Los íconos

`public/icons/icon.svg` es el original. Los PNG se generan de ahí:

```bash
node generar-iconos.mjs          # los ocho tamaños del ícono de la app
node generar-iconos-accesos.mjs  # los dos de los accesos directos
```

## Licencia

MIT
