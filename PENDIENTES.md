# Pendientes

Lo que está fuera de la app hoy y falta decidir o falta hacer. Es una lista de
trabajo, no un changelog: lo que ya está hecho y commiteado está en el historial
de git, no acá.

Ordenado por lo que duele más si no se hace, no por facilidad.

---

## P0 — Si se pierden, se pierden

### El punto de restauración diario vive donde están los datos

`crearPuntoRestauracionDiario()` (App.js) guarda un snapshot dentro del mismo
IndexedDB que el inventario. Sirve para deshacer un error reciente, no para
recuperarse de que se borre la base: si se borra la base, se borra también el
punto de restauración. Son la misma cosa.

Es la debilidad estructural de una app local-first sin respaldo: todo lo que
ofrece "Volver atrás" está guardado junto a los datos que debería proteger.

**Arreglo:** un respaldo real, con el archivo fuera del navegador (ver abajo).
El punto de restauración no se mueve: hacen falta las dos cosas.

### iOS borra los datos de las PWA después de unos días sin uso

No es un bug de la app y no se puede arreglar desde la app. En iOS, una PWA que
no se abre durante unos días pierde su IndexedDB sin aviso. Es el motivo por el
que el respaldo automático tiene que existir antes de que esto llegue a un
local real.

**Mitigación posible:** avisarle al usuario, en la app, cuántos días lleva sin
abrirse. No evita la pérdida; sólo deja de ser silenciosa.

---

## Postergado por decisión del usuario

### Respaldo automático

Hoy el respaldo es manual: hay que abrir el historial y apretar "Exportar
backup". Exportar e importar funcionan y están probados (`src/utils/backup.js`,
con punto de restauración previo al import, para que un clic equivocado no
destruya el inventario).

Lo que falta es que el usuario no dependa de acordarse. Candidatos: exportar al
cerrar la app, o avisar cada cierta cantidad de días si no se exportó desde
hace mucho.

### Libro de movimientos / caja diaria

No existe la tabla `movimientos`. El historial registra cambios con su motivo,
pero no es un libro de ventas: no hay entradas por venta, no hay cobros, no se
puede saber cuánto se vendió en el día ni cuánto dinero entró.

Es un módulo entero, no un arreglo. Va después de que el respaldo esté cerrado,
porque sin respaldo todo lo que se registre se puede perder igual.

### Canal de pedidos sofisticado

`PedidoModal.js` arma el texto del pedido y lo manda por WhatsApp. Lo que falta
es todo lo demás: recibir pedidos, estado del pedido, historial de pedidos.

### v6 del esquema con índice único en `codigoBarras`

Hoy el índice de `codigoBarras` **no** es único a propósito, y la decisión tiene
un motivo concreto: un índice único en IndexedDB también indexa el `null`, así
que sólo un producto de todo el inventario podría quedarse sin código.

La consecuencia es que dos productos pueden compartir código, y la app tiene que
resolverlo en el momento, con el diálogo de código repetido. Ese es el canje
actual.

Pasar a índice único obligaría a que **todos** los productos tengan código. Para
un local que venda piezas sin código, por ejemplo, es una pérdida y no una
mejora. Se deja así salvo que el usuario pida lo contrario.

---

## Falta validar en el dispositivo

Nada de esto se ha visto en un teléfono. En el código no hay forma de
comprobarlo.

- [ ] Catálogo agrupado por estado de stock: los tres grupos se leen bien, el
      orden elegido se respeta dentro de cada grupo, y "Cargar más" trae de más
      sin romper el reparto entre los grupos.
- [ ] Código de barras visible en la tarjeta del catálogo, sin que empuje el
      precio ni el stock hacia abajo en una tarjeta angosta.
- [ ] Diálogo de código repetido: los dos overlays apilados (escáner y diálogo)
      se leen bien, y los botones de 52px no se pisan con la lista de conflictos
      en un teléfono angosto.
- [ ] Las cuatro salidas del diálogo: sufijo, sin código, borrar el viejo,
      cancelar. Y que borrar deje punto de restauración y se pueda deshacer.
- [ ] Cerrar y reabrir la app para probar el punto de restauración diario.
- [ ] Lo nuevo, que todavía nadie vio en un teléfono: varias categorías en un
      mismo producto, el campo de proveedor, las notas, y la hoja que se abre
      al tocar una tarjeta del catálogo.
- [ ] Cómo quedó el aspecto después de sacar Tailwind. La mayor parte se ve
      igual, pero hay tres cambios que son de verdad, no de traducción:
      - Las pestañas de arriba medían 38px de alto y el botón del escáner
        38px de ancho, los dos por debajo del mínimo táctil. Ahora los dos
        llegan a 52px.
      - Las pestañas se salían de la pantalla 12px a cada lado, y el borde de
        arriba no cerraba con los bordes. Ahora van de borde a borde.
      - El fondo de la app pasó de verde a gris, y el cuerpo de letra de 16px
        a 18px. El verde era una clase de Tailwind pegada en el `<body>` y los
        16px venían del reinicio de Tailwind; los valores de diseño siempre
        fueron el gris y los 18px.

El resto del checklist de validación está en el README.

### Ya comprobado en el teléfono

El usuario probó la app instalada y confirmó que la cámara abre y que la PWA se
instala bien.

### Falta probar en el teléfono

Todo lo de esta lista se cambió o se decidió en esta tanda y todavía nadie lo
miró en un aparato. Casi nada se puede comprobar desde el escritorio.

- [ ] **El lector de códigos.** Se arregló: la zona de escaneo estaba en 0,8
      píxeles y la cámara se veía pero no se leía nada. Falta escanear un EAN de
      verdad y confirmar que lo detecta.
- [ ] **La tarjeta de actualización.** Va con `autoUpdate`: la versión nueva se
      activa sola en segundo plano y la tarjeta avisa arriba, con un botón que
      recarga. Se probó `prompt` y no servía: la tarjeta vive dentro del bundle,
      así que el usuario con la versión vieja, que es a quien hay que avisarle,
      no tiene el código que avisa y nunca la ve. Falta provocar una versión
      nueva y ver que aparece la tarjeta y que el botón trae la versión nueva.
- [ ] **El pie con la versión.** Debe decir `v1.0.9` abajo del inventario, en
      las dos versiones: la del host y la publicada. Es para distinguir cuál de
      las dos se está probando.
- [ ] **El buscador de proveedores.** Escribir dos letras y ver si la lista sale,
      si no queda cortada abajo con muchos proveedores, y si al elegir uno se
      escribe el nombre tal cual.
- [ ] **La búsqueda sin tildes.** `limon` tiene que encontrar `Limón`.
- [ ] **Notas con varios renglones.** Escribirlas con enters, guardar, y
      abrirlas otra vez en la hoja del producto: los saltos tienen que estar.
- [ ] **El ajuste de stock en la hoja.** El + y el − de arriba de Editar/Cerrar,
      y que el número del centro cambie al tocarlos.
- [ ] **El botón flotante de agregar.** Estaba sin fondo: el reinicio de
      `base.css` le pone `background: none` a todos los botones y la clase nunca
      lo compensó, así que se veía sólo el signo + sobre las tarjetas.
- [ ] **El formulario con todas las opciones a la vez.** El bloque plegable se
      sacó por decisión del usuario: ahora costo, fecha, calculadora y precios
      se ven siempre. Confirmar que se llega bien al final y que "Agregar otro
      precio" sigue agregando.
- [ ] **La grilla del catálogo en pantalla grande:** 3 columnas en el celular y 4
      en PC, con la foto tope de 200px.
- [ ] **La grilla del inventario en pantalla grande:** 1 columna en el celular y 2
      en PC, que es distinta de la del catálogo a propósito.
- [ ] **El pedido por proveedor.** Que los grupos salgan bien, que copiar un
      proveedor copie sólo el suyo, y que "copiar los que no tienen proveedor"
      no mezcle los otros.
- [ ] **La lista de proveedores en la pestaña de categorías.** Es una tabla
      nueva (v7) que se arma sola con los proveedores que ya estaban en los
      productos. Falta probar: agregar uno nuevo, renombrarlo y que se actualicen
      los productos que lo tienen, sacarlo de la lista, y que un producto con el
      mismo nombre escrito con otra tilde caiga en el mismo grupo.
- [ ] **El escáner con un código nuevo.** Decía siempre "Este código ya
      existe": el segundo parámetro del escáner es una lista de productos y se
      comprobaba como si fuera uno. Los arrays vacíos son verdaderos, así que la
      condición era siempre cierta.
- [ ] **"Ver en el inventario" del aviso de código repetido.** Antes llevaba al
      formulario de edición; ahora busca el código en el inventario.
- [ ] **La cantidad a pedir del pedido.** Ahora es editable con botones y a
      mano, y el texto copiado sale con ese número. Confirmar que el `−` no baje
      de cero y que escribir un número raro (35, 100) quede bien.
- [ ] **El aviso de eliminar un producto.** Se multiplicaba: "Cargar más" sumaba
      un listener sobre el mismo contenedor, así que un clic borraba N veces y
      salían N avisos. Ahora los listeners delegados se atan una sola vez.
- [ ] **El color de categoría al azar:** que dos categorías seguidas casi nunca
      salgan del mismo color.
- [ ] **Los dos accesos directos** de la pantalla de inicio abren el escáner y el
      formulario.
- [ ] **La app funciona sin conexión**, con la app ya abierta y con la app
      cerrada.

### Lo que cambió de verdad y hay que volver a mirar

Estos son cambios de aspecto, no de traducción. Los tres de la lista de arriba
siguen valiendo, y se suman estos:

- La cabecera pasó a tener "Historial" y "Pedido" con texto, no sólo el ícono.
- El desplegable de orden ahora usa la flecha de la app en vez de la del
  sistema.
- Las notas se muestran en un papelito amarillo, sin marco negro al escribirlas.
- El selector de orden y el buscador compartían una clase CSS definida en dos
  hojas con valores distintos; ahora está en una sola.

---

## Publicación

La app está publicada en **https://emiliano-nunez.github.io/stock-comercio/**.
Cada push a `main` la republica solo. El repo es `emiliano-nunez/stock-comercio`,
público.

Lo que se comprobó sobre la página publicada: responde 200, todos los archivos
que el HTML pide existen, el service worker se registra con el alcance
`/stock-comercio/`, y el manifiesto que se sirve lleva `start_url`, `scope` y los
dos accesos directos con la ruta ya puesta.

### Ya se miró en un navegador

La página publicada se abre ahora en un navegador de verdad, no sólo se lee. Se
comprueba en ella, y también contra el mismo build servido en un subdirectorio
como en el despliegue:

- Que no haya ni un 404 ni un error de página en toda la carga.
- Que las siete hojas de CSS se carguen y las variables se apliquen, que es
  donde se ve si el orden de carga quedó bien.
- Que la app dibuje, con las tres pestañas y el catálogo.
- Que tocar una tarjeta abra la hoja del producto, con el proveedor, las notas y
  las dos categorías del producto sembrado.
- Que el formulario abra con los 18 campos, incluidos los nuevos.
- Que en 320, 390, 768 y 1280px nada se salga de lado y que todo lo tocable
  llegue a 52px por los dos lados.
- Que el CSS que se sirve no traiga ninguna marca de Tailwind.

Esto descarta la pantalla en blanco, que era la de las rutas. No descarta que la
app se vea fea: eso lo decide una persona mirando su teléfono.

### Sigue sin probarse en un dispositivo

- [ ] La grilla del inventario en una pantalla grande: dos columnas, el tope de
      ancho de 768px, y que el botón flotante quede pegado a la columna y no a
      la ventana. Las medidas salen bien, el ojo no.
- [ ] Los dos accesos directos de la pantalla de inicio abren el escáner y el
      formulario.
- [ ] La app funciona sin conexión, con la app ya abierta y con la app cerrada.
- [ ] El service worker usa `autoUpdate`: la versión nueva se activa sola en
      segundo plano y la tarjeta de arriba es la que avisa. Para ver un cambio
      hay que tocar el botón de la tarjeta o recargar a mano dos veces.

### Lo que costó encontrar

Dos fallas que no se ven ni al compilar ni al leer el build, y que sólo aparecen
en la página publicada. Quedan anotadas porque el próximo deploy las va a
enseñar de nuevo si algo vuelve a tocarse:

- **Pages se puede quedar sirviendo el código fuente.** Por defecto sirve la
  rama que se le indique, y en la raíz del repo el `index.html` es la plantilla
  de desarrollo de Vite, que carga `/src/main.js` en crudo. El navegador no
  muestra nada y no hay error. La fuente de Pages tiene que ser "GitHub
  Actions", no una rama.
- **La ruta de publicación hay que sacarla del nombre del repo, y el cálculo se
  puede invertir.** Un repo de proyecto se sirve en `/<nombre>/` y uno de
  usuario en la raíz; confundirlos publica la app pidiendo archivos en
  `/assets/...`, que es 404 silencioso.


---

## Descartado

Cosas que se llegaron a considerar y se quitaron. No están pedidas; quedan
anotadas para que no se vuelvan a proponer.

- **Botón de borrar inventario.** El inventario lo borra el usuario, producto
  por producto, con su punto de restauración. Una herramienta para tirar todo
  no debería estar al alcance de un toque.
- **Limpieza automática de fotos huérfanas al arrancar.** Una foto es dato del
  usuario: la app no borra fotos sola. Hay un diálogo de limpieza manual en el
  historial, que dice qué NO toca.
- **Verificador de palabras en otro idioma.** Detectaba descuidos míos al
  escribir comentarios, no errores de la app, y obligaba a mantener una lista de
  palabras que había que ir ajustando. Se dejó sólo el chequeo de CJK y
  mojibake, que sí detectan un archivo guardado con la codificación mal.
