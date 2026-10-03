/*
 * Los estilos se cargan en este orden y el orden importa, porque el CSS se
 * aplica de arriba abajo: lo que se escribe después gana cuando dos reglas dicen
 * lo mismo con el mismo peso.
 *
 *   1. tokens.css   - las variables: colores, tamaños, espacios.
 *   2. disposicion  - el armazón: columna, cabecera, pestañas, rejilla.
 *   3. controles    - botones y campos.
 *   4. superficies  - tarjetas, diálogos, insignias, avisos.
 *   5. tipografia   - tamaños de texto y estados vacíos.
 *   6. espacios     - rellenos y márgenes sueltos.
 *   7. base.css     - el reinicio y los valores que se heredan.
 *
 * El reinicio va AL FINAL a propósito, que es lo único aquí que parece al revés.
 * Todo lo de arriba da por hecho que base.css ya hizo su trabajo: los botones y
 * los campos sacan más abajo su propio fondo y su propio borde, y el tamaño de
 * un título lo pone el selector de la etiqueta y no una clase. Si el reinicio
 * entrara primero, las capas de arriba lo pisarían y quedaría a medias.
 */
import './css/tokens.css';
import './css/disposicion.css';
import './css/controles.css';
import './css/superficies.css';
import './css/tipografia.css';
import './css/espacios.css';
import './css/base.css';
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
