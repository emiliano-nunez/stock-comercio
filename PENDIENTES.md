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

El resto del checklist de validación está en el README.

---

## Publicación

La app está publicada en **https://emiliano-nunez.github.io/stock-comercio/**.
Cada push a `main` la republica solo. El repo es `emiliano-nunez/stock-comercio`,
público.

Lo que se comprobó sobre la página publicada: responde 200, todos los archivos
que el HTML pide existen, el service worker se registra con el alcance
`/stock-comercio/`, y el manifiesto que se sirve lleva `start_url`, `scope` y los
dos accesos directos con la ruta ya puesta.

### Sigue sin probarse en un navegador

No hay navegador conectado, así que lo anterior es leer la página publicada, no
mirarla. Que todos los archivos respondan 200 descarta la causa de la pantalla en
blanco, que era la de las rutas, pero no dice que la app se vea bien.

Pendiente de mirar de verdad:

- [ ] La grilla del inventario en una pantalla grande: dos columnas, el tope de
      ancho de 768px, y que el botón flotante quede pegado a la columna y no a
      la ventana.
- [ ] La app instalada abre y funciona, y los dos accesos directos de la
      pantalla de inicio abren el escáner y el formulario.
- [ ] La cámara con HTTPS, que es la única forma de que funcione: por la red
      local el navegador la bloquea.
- [ ] La app funciona sin conexión, con la app ya abierta y con la app cerrada.
- [ ] El service worker con `autoUpdate` puede mostrar la versión anterior durante
      las pruebas. Si un cambio parece no aplicarse, recargar a mano antes de
      diagnosticarlo como un error.

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
