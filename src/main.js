/*
 * Los estilos se cargan en este orden y el orden importa, porque el CSS se
 * aplica de arriba abajo: lo que se escribe después gana cuando dos reglas dicen
 * lo mismo con el mismo peso.
 *
 *   1. tokens.css   - las variables: colores, tamaños, espacios.
 *   2. base.css     - el reinicio y los valores que se heredan.
 *   3. disposicion  - el armazón: columna, cabecera, pestañas, rejilla.
 *   4. controles    - botones y campos.
 *   5. superficies  - tarjetas, diálogos, insignias, avisos.
 *   6. tipografia   - tamaños de texto y estados vacíos.
 *   7. espacios     - rellenos y márgenes sueltos.
 *
 * El reinicio va PRIMERO, después de las variables y antes de que las capas de
 * arriba definan su propia cara: los botones y los campos sacan sus reglas en
 * controles.css, que llega después y pisa al reinicio con el mismo peso. Con el
 * reinicio al final era el archivo que pisaba a los demás, y una regla suya
 * (la altura de los svg, por ejemplo) ganaba por casualidad y no por diseño.
 */
import './css/tokens.css';
import './css/base.css';
import './css/disposicion.css';
import './css/controles.css';
import './css/superficies.css';
import './css/tipografia.css';
import './css/espacios.css';
import './App.js';

if (import.meta.hot) {
  import.meta.hot.accept();

  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 8;
  let isDisconnected = false;

  import.meta.hot.on('vite:ws:connect', () => {
    reconnectAttempts = 0;
    isDisconnected = false;
  });

  import.meta.hot.on('vite:ws:disconnect', () => {
    isDisconnected = true;
  });

  const originalOn = import.meta.hot.on.bind(import.meta.hot);
  import.meta.hot.on = (event, handler) => {
    if (event === 'vite:ws:reconnect') {
      return originalOn(event, (...args) => {
        reconnectAttempts++;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.info('[HMR] Servidor no disponible tras', MAX_RECONNECT_ATTEMPTS, 'intentos. Deteniendo reconexión.');
          return;
        }
        console.debug('[HMR] Reintento', reconnectAttempts, '/', MAX_RECONNECT_ATTEMPTS);
        handler(...args);
      });
    }
    return originalOn(event, handler);
  };

  import.meta.hot.on('vite:error', (err) => {
    if (isDisconnected && reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      import.meta.hot.close();
    }
  });
}
