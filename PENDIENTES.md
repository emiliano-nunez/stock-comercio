# Pendientes

Lo que está fuera de la app hoy y falta decidir o falta hacer. Es una lista de
trabajo, no un changelog: lo que ya está hecho y commiteado está en el historial
de git, no acá.

Ordenado por lo que duele más si no se hace, no por facilidad.

---

## P0 — Si se pierden, se pierden

### No hay respaldo, y el riesgo es de iOS

La app no guarda historial. No hay puntos de restauración, no hay "volver atrás", y
un borrado no se deshace dentro de la app. Lo que protege al usuario es una sola
cosa: **exportar la copia de seguridad**, que deja un archivo en el disco.

El riesgo concreto es que **iOS borra los datos de una PWA que no se abre durante
unos días**, sin aviso. No es un bug de la app y no se puede arreglar desde la app.
Es el motivo por el que el respaldo automático tiene que existir antes de que esto
llegue a un local real.

Hoy el respaldo es manual: hay que apretar "Copia" en la barra y después elegir
dónde se guarda. Candidatos:

- Recordarle al usuario cuántos días lleva sin exportar. No evita la pérdida;
  sólo deja de ser silenciosa, que es la mitad del problema.
- Ofrecer la exportación al compartir o al cerrar.

**Arreglo:** un respaldo real, con el archivo fuera del navegador, más el aviso
de los días.

### Importar una copia no se puede deshacer

`importarBackup()` reemplaza productos, categorías, proveedores, fotos e historial
de golpe, en una transacción. Si algo sale mal a mitad de camino, la base queda
entera como estaba, pero **después de que terminó, no hay vuelta atrás**: el
historial ya no existe.

Hoy el diálogo lo dice y ofrece exportar antes de importar. Lo que falta es la
otra mitad: que el propio import se guarde una copia de lo que había, y que la
app la ofrezca para volver.

---

## Postergado por decisión del usuario

### Libro de movimientos / caja diaria

No existe la tabla `movimientos`. El historial de cambios se borró con el resto del
historial, así que hoy no hay ningún registro: cambiar el stock no deja rastro.

Eso es una decisión del usuario y se respeta, pero conviene que sea consciente: sin
registro de movimientos no se puede saber cuánto se vendió en el día, cuánto dinero
entró, ni por qué el stock de un producto no cuadra.

Es un módulo entero, no un arreglo. Va después de que el respaldo esté cerrado,
porque sin respaldo todo lo que se registre se puede perder igual.

### Canal de pedidos sofisticado

`PedidoModal.js` arma el texto del pedido y lo manda por WhatsApp. Lo que falta es
todo lo demás: recibir pedidos, estado del pedido, historial de pedidos.

### Índice único en `codigoBarras`

Hoy el índice de `codigoBarras` **no** es único a propósito, y la decisión tiene un
motivo concreto: un índice único en IndexedDB también indexa el `null`, así que sólo
un producto de todo el inventario podría quedarse sin código.

La consecuencia es que dos productos pueden compartir código, y la app lo resuelve
en el momento con el diálogo de código repetido.

Pasar a índice único obligaría a que **todos** los productos tengan código. Para un
local que venda piezas sin código, por ejemplo, es una pérdida y no una mejora.
Se deja así salvo que el usuario pida lo contrario.

---

## Falta probar en un teléfono

Casi nada de esto se puede comprobar desde el escritorio. La lista se anotó cuando
se cambió y nadie lo miró en un aparato; lo que ya se comprobó no está acá.

- [ ] **La lista con muchos productos.** Es el cambio más grande de los últimos
      tiempos: el filtro, el orden y los contadores pasaron a la base, la búsqueda
      espera 250ms, y `this.productos` pasó a ser la página que se pinta. Con dos
      o trescientos productos hay que ver que la lista abre rápido, que "cargar
      más" sigue andando, que los tres paneles muestran los números correctos, y
      que al filtrar y después borrar un producto que quedó fuera de la pantalla,
      el borrado igual ocurre.
- [ ] **El lector de códigos.** La zona de escaneo estaba en 0,8 píxeles y la
      cámara se veía pero no se leía nada; ya está en una función que mide sobre el
      visor real. Falta escanear un EAN de verdad y confirmar que lo detecta.
- [ ] **La tarjeta de actualización.** Va con `autoUpdate`: la versión nueva se
      activa sola en segundo plano y la tarjeta avisa arriba. Falta provocar una
      versión nueva y ver que aparece y que el botón trae la versión nueva.
- [ ] **El buscar.** Escribir dos letras en el buscador de proveedores y ver si la
      lista sale, si no queda cortada abajo con muchos, y si al elegir uno se
      escribe el nombre tal cual.
- [ ] **La búsqueda sin tildes.** `limon` tiene que encontrar `Limón`. Y tiene que
      seguir encontrando los códigos de barras y los nombres de proveedor, que
      ahora viven en un solo campo normalizado.
- [ ] **Notas con varios renglones.** Escribirlas con enters, guardar, y abrirlas
      otra vez en la hoja del producto: los saltos tienen que estar.
- [ ] **El ajuste de stock en la hoja.** El + y el −, y que el número del centro
      cambie al tocarlos. Y con dos pestañas abiertas: abrir la misma app en el
      teléfono y en la computer, cambiar el stock en una, y ver que la otra se
      actualiza sola al volver al frente.
- [ ] **El formulario con todo a la vez.** Confirmar que se llega bien al final con
      todas las filas y que "Agregar otro precio" sigue agregando.
- [ ] **El pedido por proveedor.** Que los grupos salgan bien, que copiar un
      proveedor copie sólo el suyo, y que "copiar los que no tienen proveedor" no
      mezcle los otros.
- [ ] **La cantidad a pedir del pedido.** Que el `−` no baje de cero y que
      escribir un número raro (35, 100) quede bien.
- [ ] **Los accesos directos** de la pantalla de inicio abren el escáner y el
      formulario.
- [ ] **La app funciona sin conexión**, con la app ya abierta y con la app cerrada.
- [ ] **La copia de seguridad.** Exportar, cambiar algo, importar el archivo, y
      confirmar que vuelve todo. Y que el diálogo de importación diga con claridad
      que no se puede deshacer.

### Lo que cambió de verdad y hay que volver a mirar

No son cambios de traducción, son de aspecto o de comportamiento:

- El estándar de estilo: tarjeta, cabecera, buscador, formularios, diálogos y las
  listas de categorías, estados y proveedores.
- La tarjeta del inventario pasó a tres columnas en todo lo que no es escritorio.
- El mínimo táctil bajó de 52px a 40px. Hay que comprobar que ningún ícono queda
  desproporcionado dentro de su botón.
- La cabecera es verde claro y el ícono también. Ver si la PWA instalada se ve
  bien en el lanzador.
- La cabecera es más clara en escritorio, con más aire arriba del nombre.

### El diálogo de código repetido

Es el único con dos overlays apilados (el escáner y el diálogo), así que es el
que más se ha probado:

- [ ] Que los dos overlays se lean bien y que los botones no se pisen con la lista
      de conflictos en un teléfono angosto.
- [ ] Las cuatro salidas: sufijo, sin código, borrar el viejo, cancelar. Y que el
      texto diga que no se puede deshacer, que es lo que ahora dice.

### Catálogo

- [ ] Catálogo agrupado por estado de stock: los tres grupos se leen bien, el
      orden elegido se respeta dentro de cada grupo, y "Cargar más" trae de más
      sin romper el reparto entre los grupos.
- [ ] Código de barras visible en la tarjeta del catálogo, sin que empuje el
      precio ni el stock hacia abajo en una tarjeta angosta.

### La lista de proveedores

Es una tabla que se arma sola con los proveedores que ya estaban en los productos:

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

- **El historial de puntos de restauración.** Se sacó entero. Guardaba una copia
  completa del inventario antes de cada borrado, hasta diez copias, y "volver
  atrás" devolvía el inventario entero de otra fecha con los productos que el
  usuario había eliminado, más las fotos de esos productos. Lo que lo reemplaza es
  la copia de seguridad y la pregunta antes de borrar.
- **Botón de borrar inventario.** El inventario lo borra el usuario, producto por
  producto. Una herramienta para tirar todo no debería estar al alcance de un
  toque.
- **Limpieza automática de fotos huérfanas al arrancar.** Una foto es dato del
  usuario: la app no borra fotos sola. Hay un diálogo de limpieza manual en la
  copia de seguridad, que dice qué NO toca.
- **Verificador de palabras en otro idioma.** Detectaba descuidos al escribir
  comentarios, no errores de la app. Se dejó el chequeo de CJK y mojibake, que sí
  detectan un archivo guardado con la codificación mal.

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
- **Los archivos del repo están con CRLF.** Una búsqueda de varias líneas escrita
  con `\n` no encuentra nada, y el error se lee como "el patrón no existe" cuando
  lo que pasa es que los finales de línea son otros.
