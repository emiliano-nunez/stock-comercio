/*
 * El reinicio va AL FINAL a propósito, que es lo único aquí que parece al revés.
 * Lo de arriba da por hecho que base.css ya hizo su trabajo: si el reinicio
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
