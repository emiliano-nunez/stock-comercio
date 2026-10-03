# DepoApp

**Versión 1.10.2** · el mismo número de `package.json`, que es de donde sale el que muestra la app al pie del inventario.

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

## Instalar y usar

```bash
npm install
npm run dev      # para trabajar
npm run build    # genera la versión para publicar
```

La versión publicada está en
<https://emiliano-nunez.github.io/stock-comercio/>.

En un teléfono se instala desde el navegador y queda como una app. La cámara sólo
funciona si la página está en HTTPS o en `localhost`.

## Cómo está hecho

| | |
|---|---|
| Build | Vite |
| App web instalable | vite-plugin-pwa + Workbox |
| Base de datos | IndexedDB con Dexie, en el dispositivo |
| Estilos | CSS propio, con variables |
| Cámara | API nativa del navegador |
| Escáner | html5-qrcode |
| Imágenes | browser-image-compression |

La carpeta `src/` tiene la aplicación: `App.js` es el punto de partida, `db.js`
la base de datos, `components/` los diálogos y `css/` los estilos.

## Antes de tocar nada

```bash
node verificar-sintaxis.mjs     # que todos los archivos estén bien escritos
node verificar-caracteres.mjs   # que no se hayan colado letras de otro idioma
npm run build                   # que compile de verdad
```

Los dos primeros son los que más salvan: el primero corta el trabajo apenas se
toca un archivo, y el segundo encuentra los caracteres raros que aparecen cuando
un archivo se guarda con la codificación equivocada y quedan ahí sin que nadie los
vea.

## Despliegue

Cada `push` a `main` publica solo. No hay que hacer nada más.

## Licencia

MIT