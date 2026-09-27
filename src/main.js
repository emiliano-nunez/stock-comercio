import './main.css';
import './App.js';

/**
 * HMR con límite de reintentos - se rinde tras ~45s si el servidor no vuelve
 */
if (import.meta.hot) {
  import.meta.hot.accept();
  
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 8; // ~45s con backoff: 1+2+4+8+10+10+10 = 45s
  let isDisconnected = false;
  
  import.meta.hot.on('vite:ws:connect', () => {
    reconnectAttempts = 0;
    isDisconnected = false;
  });
  
  import.meta.hot.on('vite:ws:disconnect', () => {
    isDisconnected = true;
  });
  
  // Interceptar el reconnect interno de Vite
  const originalOn = import.meta.hot.on.bind(import.meta.hot);
  import.meta.hot.on = (event, handler) => {
    if (event === 'vite:ws:reconnect') {
      return originalOn(event, (...args) => {
        reconnectAttempts++;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.info('[HMR] Servidor no disponible tras', MAX_RECONNECT_ATTEMPTS, 'intentos. Deteniendo reconexión.');
          import.meta.hot.close(); // Cierra la conexión WebSocket y para el polling
          return;
        }
        console.debug('[HMR] Reintento', reconnectAttempts, '/', MAX_RECONNECT_ATTEMPTS);
        handler(...args);
      });
    }
    return originalOn(event, handler);
  };
  
  // También escuchar error de módulo no encontrado (servidor caído)
  import.meta.hot.on('vite:error', (err) => {
    if (isDisconnected && reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      import.meta.hot.close();
    }
  });
}