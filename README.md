# Stock Comercio - PWA Control de Inventario Local-First

Aplicación de control de stock diseñada para comerciantes con baja alfabetización digital, funcionando 100% offline en dispositivos de gama baja (ej. Samsung Galaxy A10 con 2GB RAM).

## 🚀 Características Principales

- **Cero autenticación**: Abre y usa directamente
- **100% Offline**: Funciona sin internet, sin cuentas, sin Play Store
- **Cámara embebida**: Fotos directas dentro de la app (getUserMedia)
- **Escáner de códigos**: Lectura de códigos de barras integrado (html5-qrcode)
- **Venta dual**: Por unidad (librería) o por peso (verdulería)
- **Historial automático**: Puntos de restauración + botón "Deshacer" inmediato
- **Optimizado para 2GB RAM**: Imágenes comprimidas <100KB (WebP)
- **PWA instalable**: Se instala desde el navegador como app nativa
- **Pedido a proveedor**: Genera lista de faltantes y envía por WhatsApp

## 🛠 Stack Tecnológico

| Componente | Tecnología |
|------------|------------|
| Build | Vite.js |
| PWA/Offline | vite-plugin-pwa + Workbox |
| UI | TailwindCSS |
| Base de Datos | IndexedDB + Dexie.js |
| Cámara | getUserMedia (API nativa) |
| Escáner | html5-qrcode |
| Compresión | browser-image-compression |

## 📦 Instalación y Desarrollo

### Prerrequisitos
- Node.js 18+ 
- npm 9+

### Instalar dependencias
```bash
npm install
```

### Desarrollo
```bash
npm run dev
```
Abre http://localhost:5173 en tu navegador.

### Build de producción
```bash
npm run build
```
Los archivos optimizados se generan en `dist/`.

### Preview de producción
```bash
npm run preview
```

## 📱 Instalación en Dispositivo (PWA)

1. Despliega en Vercel/Netlify/GitHub Pages (HTTPS obligatorio)
2. Abre la URL en el navegador del móvil
3. Chrome: Menú ► "Instalar aplicación"
4. Safari: Compartir ► "Añadir a pantalla de inicio"
5. El icono aparece en el launcher como app nativa

## 🎯 Flujo de Usuario (MVP)

```
Abrir app → Ver inventario → Tocar [+] Agregar
                              ↓
                        [📷 Cámara] o [🖼️ Galería] → Foto auto-comprimida
                              ↓
                        [🔍 Escanear] o escribir código
                              ↓
                        Seleccionar: [📦 Unidad] o [⚖️ Peso]
                              ↓
                        Ajustar stock con botones [+] [−] grandes
                              ↓
                        [✅ Guardar] → Lista actualizada al instante
```

### Acciones rápidas en lista
- **[+] / [−]**: Ajuste directo de stock (unidad o 0.5kg)
- **[📋 Duplicar]**: Abre el formulario con una copia para crear una variante.
  No se guarda nada hasta que el usuario confirma, así que cancelar no deja
  rastro. Copia todos los datos menos el código de barras.
- **[✏️ Editar]**: Editar producto completo
- **[🗑️ Eliminar]**: Eliminar con "Deshacer" 5 segundos
- **Buscador**: Filtrar por nombre o código
- **[🔍] Header**: Escanear y saltar a producto

### Red de seguridad
- **Deshacer inmediato**: Barra toast 5 seg tras borrar/editar
- **Volver atrás (🔄)**: Historial cronológico (máx 10 puntos)
- **Restauración**: Un toque vuelve al estado anterior sin perder fotos. El
  diálogo dice, con nombres, qué productos vuelven y cuáles desaparecen, y
  antes de pisar nada se guarda el estado actual como un punto nuevo: restaurar
  un punto viejo también se puede deshacer.

### Pedido a proveedor (📋)
- Filtra automáticamente `stock ≤ stockMinimo`
- Calcula cantidad sugerida (faltante × 1.5)
- Un toque: Abre WhatsApp con texto formateado

## 🗂 Estructura del Proyecto

```
├── index.html              # Entry point HTML
├── vite.config.js          # Config Vite + PWA
├── tailwind.config.js      # Colores, tamaños touch, safe-area
├── postcss.config.js       # PostCSS plugins
├── package.json
├── public/
│   ├── manifest.json       # PWA Manifest
│   ├── icons/              # Iconos PWA (generar con generar-iconos.html)
│   └── generar-iconos.html # Herramienta para crear PNGs
└── src/
    ├── main.js             # Bootstrap
    ├── main.css            # Tailwind + componentes custom
    ├── db.js               # Dexie schema + utils
    ├── App.js              # Componente principal
    ├── utils/
    │   ├── imagen.js       # Compresión WebP <100KB
    │   └── toast.js        # Notificaciones + Deshacer
    └── components/
        ├── CamaraModal.js  # getUserMedia + canvas + compresión
        ├── ScannerModal.js # html5-qrcode + vibración + beep
        ├── ProductoForm.js # Formulario adaptativo unidad/peso
        ├── HistorialModal.js # Lista de snapshots + restaurar + liberar fotos
        └── PedidoModal.js  # Faltantes → WhatsApp
```

## 📊 Esquema de Base de Datos (IndexedDB)

```javascript
// 4 stores independientes. Éste es el esquema vigente (db.version(5)):
productos: 'id, categoriaId, codigoBarras, tipoVenta, costo, fechaCompra'
categorias: 'id, nombre, color'
imagenes: 'id'  // { id, blob, thumb, creadoEl }
historial: 'id, fecha'  // Snapshots de productos para restauración
```

Notas:

- `db.js` declara las versiones 1 a 5. Las intermedias se mantienen aunque ya no
  se usen: Dexie las necesita para reindexar bases existentes.
- La v5 saca tres índices que ninguna consulta usaba: `nombre` (la búsqueda es
  de subcadena, no puede aprovechar índice, y la app filtra en memoria),
  `precios` (indexar un array genera una entrada de índice **por elemento**) y
  `unidadMedida` (el campo quedó sin uso).
- `codigoBarras` **no** es único a propósito. Un índice único en IndexedDB
  también indexa el `null`, así que sólo un producto podría quedarse sin código
  de barras. Los duplicados se detectan con `dbUtils.buscarPorCodigoBarras()`,
  que los devuelve todos, y el escáner avisa en vez de abrir uno al azar.
- `tipoVenta` toma sus valores de `TIPOS_VENTA`: `unidad`, `peso_kg`,
  `peso_100g`, `peso_500g`, `docena`, `metro`, `litro`. **Nunca** el string
  `'peso'`. Para la unidad del stock usar `getUnidadBase(tipoVenta)`, y para la
  del precio `getPrecioPrincipal(producto)`.
- `unidadPrincipal` define **la unidad del precio**, no la del stock. El stock y
  el mínimo siempre van en la unidad base del tipo de venta y no se convierten,
  porque entre sub-unidades no hay factores de conversión definidos (no se sabe
  cuántas unidades tiene una caja).
- Los snapshots del historial guardan **metadatos** de producto, no los blobs de
  las imágenes. Las fotos se recuperan igual porque **no se borran** al eliminar
  un producto ni al cambiarle la foto: quedan en `imagenes` y el `imagenId` de
  cada snapshot sigue resolviendo. Duplicar los blobs dentro de cada snapshot
  sería inviable con 2GB de RAM (10 snapshots × N productos × 100KB).
- **La app nunca borra una foto sola.** Es dato del usuario. Al arrancar sólo se
  miden las que no están en uso (`dbUtils.medirImagenesSinUsar()`) y se avisa por
  consola. Las dos formas de liberarlas están en el historial, cada una con su
  botón y su confirmación:
  - 🧹 `limpiarImagenesSinUsar()` borra las que **no referencia nadie** (fotos
    canceladas o reemplazadas).
  - 🗄️ `liberarFotosDelHistorial()` borra las que **sólo referencia el
    historial**, o sea las de productos que el usuario ya eliminó. Los productos
    siguen restaurándose; lo que no vuelve es la foto. Cada borrado queda
    anotado en el historial con el motivo `Limpieza de fotos: N foto(s)...`,
    para que dentro de tres meses el usuario sepa que las liberó él.
  - Las dos clasificaciones salen de `dbUtils._repartoDeImagenes()`, y sus
    conjuntos son disjuntos: un botón nunca borra lo que el otro protegió.
    Cubierto por `probar-fotos.mjs`.
- Un producto que apunta a una foto que no está en la base se marca con
  `fotoPerdida` al cargarlo (no se persiste: depende del estado actual) y el
  catálogo avisa "Falta la foto". El campo `creadoSinFoto` se escribe siempre al
  guardar y sirve para no confundir "nunca tuvo foto" con "se le perdió".
- **Duplicar un producto** (`App.duplicarProducto`) abre el formulario con una
  copia y no escribe nada hasta que el usuario guarda: si cancela, no queda
  ningún producto basura. Se copia todo (precios, stock, categoría, tipo de
  venta, unidad principal, foto) **menos el `id` y el `codigoBarras`**: sin el id
  el formulario crearía uno nuevo en vez de pisar el original, y el código de
  barras es identidad, no un dato — dos artículos con el mismo código es
  justamente lo que el escáner y el formulario avisan.
- Cada imagen tiene `thumb` (miniatura de 200px para el catálogo) además de
  `blob` (hasta 800px, para el preview del formulario). Las imágenes guardadas
  antes de que existieran las miniaturas no la tienen y usan `blob`: no hace
  falta migración. El backup exporta `blob` pero no `thumb`.

## 🎨 Guía UX/UI (Baja Alfabetización Digital)

- **Botones mínimos 52px** (accesibilidad táctil), en alto **y** en ancho.
  Tailwind lo expone como `min-h-touch min-w-touch` (ver `tailwind.config.js`).
  Los +/− del ajuste rápido y el de deshacer del toast están en 52px; los de
  duplicar / editar / eliminar miden ~81px por el reparto en partes iguales.
- **Texto + Ícono** en las acciones principales. Los botones duplicar / editar /
  eliminar van en su propia fila al pie de la tarjeta, repartidos por igual
  (~81px cada uno en un teléfono de 360px, por encima del mínimo de 52): con
  íconos solos de 52px, tres en la fila del título se comían 164 de los ~244px
  que quedan al lado de la miniatura y el nombre quedaba ilegible. Los +/− del
  ajuste rápido van sólo con signo, y cada botón tiene su `aria-label` con el
  nombre del producto.
- **Semáforo visual**: Verde (OK) · Amarillo (Bajo) · Rojo (Agotado)
- **Safe-area insets** para notches/cortes de pantalla
- **Feedback háptico** (vibración) en escaneo exitoso
- **Animaciones suaves** (fade, slide) sin jank en 2GB RAM

## 🔧 Scripts Útiles

```bash
# Generar iconos PWA (abrir en navegador)
# Abrir public/generar-iconos.html y click "Generar todos"

# Test BD en consola del navegador (sólo en `npm run dev`; el build de
# producción no incluye test-db.js)
import('./src/test-db.js').then(m => m.testDatabase())

# Clasificación y limpieza de fotos, en node y sin navegador.
# Extrae las funciones reales de src/db.js y las corre contra una base falsa.
node probar-fotos.mjs

# Chequeos estáticos
node verificar-sintaxis.mjs src      # los 13 archivos parsean
node verificar-caracteres.mjs        # sin CJK ni mojibake

# Limpieza total BD (consola)
localStorage.clear(); indexedDB.deleteDatabase('StockComercioDB')
```

## 📋 Checklist de Validación (Samsung A10)

- [ ] Instala como PWA sin Play Store
- [ ] Funciona en modo avión (offline total)
- [ ] 50 productos con foto → < 100MB storage
- [ ] Duplicar un producto abre el formulario con todo copiado, el código de
      barras vacío, y cancelar no deja nada en el inventario
- [ ] Crear un producto con foto → eliminarlo → **cerrar y reabrir la app** →
      "Volver Atrás" → el producto vuelve **con** la foto
- [ ] Un producto con foto y con `imagenId` pero sin blob muestra el aviso
      "Falta la foto" (probar borrando la fila en `imagenes` desde la consola)
- [ ] 🗄️ Liberar fotos de productos borrados: el diálogo dice qué NO toca, y
      después aparece en el historial la anotación "Limpieza de fotos: N..."
- [ ] Scroll fluido 60fps en lista
- [ ] Cámara abre < 2 seg, captura < 1 seg
- [ ] Escáner lee EAN-13 en < 3 seg
- [ ] Botones [+] [−] responden < 100ms
- [ ] "Deshacer" recupera producto borrado
- [ ] "Volver atrás" restaura estado anterior
- [ ] WhatsApp abre con pedido formateado

## 🚀 Despliegue

### Vercel (Recomendado)
```bash
npm i -g vercel
vercel --prod
```

### Netlify
```bash
npm run build
# Arrastrar carpeta dist/ a netlify.com/drop
```

### GitHub Pages
```bash
npm run build
# Push dist/ a rama gh-pages
```

> **Importante**: HTTPS obligatorio para PWA, Service Workers y APIs de cámara/escáner.

## 📄 Licencia

MIT - Libre para uso comercial y personal.

---

**Desarrollado siguiendo la Bitácora y Guía Definitiva de Desarrollo MVP**