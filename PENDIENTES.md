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
un motivo concreto: un índice único en IndexedDB también indexa el `null`, así que
sólo un producto de todo el inventario podría quedarse sin código.

La consecuencia es que dos productos pueden compartir código, y la app tiene que
resolverlo en el momento, con el diálogo de código repetido. Ese es el canje
actual.

Pasar a índice único obligaría a que **todos** los productos tengan código. Para
un local que venda piezas sin código, por ejemplo, es una pérdida y no una mejora.
Se deja así salvo que el usuario pida lo contrario.

---

## Falta probar en un teléfono

Casi nada de esto se puede comprobar desde el escritorio. La lista se anotó
cuando se cambió y nadie lo miró en un aparato; lo que ya se comprobó no está acá.

- [ ] **El lector de códigos.** La zona de escaneo estaba en 0,8 píxeles y la
      cámara se veía pero no se leía nada; ya está en una función que mide sobre el
      visor real. Falta escanear un EAN de verdad y confirmar que lo detecta.
- [ ] **La tarjeta de actualización.** Va con `autoUpdate`: la versión nueva se
      activa sola en segundo plano y la tarjeta avisa arriba, con un botón que
      recarga. Falta provocar una versión nueva y ver que aparece la tarjeta y que
      el botón trae la versión nueva.
- [ ] **El buscar de la app.** Escribir dos letras en el buscador de proveedores y
      ver si la lista sale, si no queda cortada abajo con muchos, y si al elegir
      uno se escribe el nombre tal cual.
- [ ] **La búsqueda sin tildes.** `limon` tiene que encontrar `Limón`.
- [ ] **Notas con varios renglones.** Escribirlas con enters, guardar, y abrirlas
      otra vez en la hoja del producto: los saltos tienen que estar.
- [ ] **El ajuste de stock en la hoja.** El + y el −, y que el número del centro
      cambie al tocarlos.
- [ ] **El formulario con todo a la vez.** Confirmar que se llega bien al final con
      las veinte filas y que "Agregar otro precio" sigue agregando.
- [ ] **El pedido por proveedor.** Que los grupos salgan bien, que copiar un
      proveedor copie sólo el suyo, y que "copiar los que no tienen proveedor" no
      mezcle los otros.
- [ ] **La cantidad a pedir del pedido.** Que el `−` no baje de cero y que
      escribir un número raro (35, 100) quede bien.
- [ ] **Los accesos directos** de la pantalla de inicio abren el escáner y el
      formulario.
- [ ] **La app funciona sin conexión**, con la app ya abierta y con la app cerrada.

### Lo que cambió de verdad y hay que volver a mirar

No son cambios de traducción, son de aspecto. Cada vez que se cambia uno hay que
mirarlo en un teléfono:

- El estándar de estilo nuevo: tarjeta, cabecera, buscador, formularios, diálogos
  y las listas de categorías, estados y proveedores.
- La tarjeta del inventario pasó a tres columnas en todo lo que no es escritorio:
  foto, información y los botones de editar y borrar en un solo renglón.
- El mínimo táctil bajó de 52px a 40px. Hay que comprobar que ningún ícono queda
  desproporcionado dentro de su botón y que el botón del escáner, que va pegado
  al campo del buscador, sigue del mismo alto que el campo.
- La cabecera es verde claro y el ícono de la app también. Hay que ver si la
  PWA instalada, que usa ese ícono y ese color de barra, se ve bien en el
  lanzador del teléfono.

### El diálogo de código repetido

Es el único con dos overlays apilados (el escáner y el diálogo), así que es el
que más se ha probado:

- [ ] Que los dos overlays se lean bien y que los botones no se pisen con la lista
      de conflictos en un teléfono angosto.
- [ ] Las cuatro salidas: sufijo, sin código, borrar el viejo, cancelar. Y que
      borrar deje punto de restauración y se pueda deshacer.
- [ ] "Ver en el inventario" del aviso: busca el código en el inventario.

### Catálogo

- [ ] Catálogo agrupado por estado de stock: los tres grupos se leen bien, el
      orden elegido se respeta dentro de cada grupo, y "Cargar más" trae de más
      sin romper el reparto entre los grupos.
- [ ] Código de barras visible en la tarjeta del catálogo, sin que empuje el
      precio ni el stock hacia abajo en una tarjeta angosta.

### La lista de proveedores

Es una tabla (v7) que se arma sola con los proveedores que ya estaban en los
productos:

- [ ] Agregar uno nuevo, renombrarlo y que se actualicen los productos que lo
      tienen, sacarlo de la lista, y que un producto con el mismo nombre escrito
      con otra tilde caiga en el mismo grupo.

### Lo que ya se comprobó

- El usuario probó la app instalada: la cámara abre y la PWA se instala bien.
- La página publicada se abre en un navegador de verdad, sin 404 ni error de
  carga; las hojas de CSS cargan y las variables se aplican; la app dibuja; tocar
  una tarjeta abre la hoja del producto; el formulario abre con sus veinte
  campos; y en 320, 390, 768 y 1280px nada se sale de lado.

---

## Descartado

Cosas que se llegaron a considerar y se quitaron. No están pedidas; quedan
anotadas para que no se vuelvan a proponer.

- **Botón de borrar inventario.** El inventario lo borra el usuario, producto por
  producto, con su punto de restauración. Una herramienta para tirar todo no
  debería estar al alcance de un toque.
- **Limpieza automática de fotos huérfanas al arrancar.** Una foto es dato del
  usuario: la app no borra fotos sola. Hay un diálogo de limpieza manual en el
  historial, que dice qué NO toca.
- **Verificador de palabras en otro idioma.** Detectaba descuidos míos al
  escribir comentarios, no errores de la app, y obligaba a mantener una lista de
  palabras que había que ir ajustando. Se dejó sólo el chequeo de CJK y mojibake,
  que sí detectan un archivo guardado con la codificación mal.

---

## Fallas que no se ven ni al compilar

Quedan anotadas porque el próximo deploy las va a enseñar de nuevo si algo vuelve
a tocarse:

- **Pages se puede quedar sirviendo el código fuente.** Por defecto sirve la rama
  que se le indique, y en la raíz del repo el `index.html` es la plantilla de
  desarrollo de Vite, que carga `/src/main.js` en crudo. El navegador no muestra
  nada y no hay error. La fuente de Pages tiene que ser "GitHub Actions", no una
  rama.
- **La ruta de publicación hay que sacarla del nombre del repo, y el cálculo se
  puede invertir.** Un repo de proyecto se sirve en `/<nombre>/` y uno de usuario
  en la raíz; confundirlos publica la app pidiendo archivos en `/assets/...`, que
  es 404 silencioso.
- **La barra del host sirve el archivo crudo, no el módulo transformado.** Una
  regla que no existe en `dist/` no aparece en `/src/App.js` aunque esté en el
  código. La prueba real es el bundle de `dist/`.
