import { esc } from './html.js';

export class ToastManager {
  constructor() {
    this.container = null;
    this.toasts = new Map();
    this.init();
  }
  
  init() {
    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    // Posición más alta para evitar teclado + botón sticky bottom
    this.container.className = 'fixed bottom-24 left-3 right-3 md:left-auto md:right-3 md:w-96 z-[100] flex flex-col gap-2 items-end pointer-events-none';
    document.body.appendChild(this.container);
  }
  
  show(message, options = {}) {
    const id = Date.now() + Math.random();
    const {
      type = 'info',
      duration = 3000,
      action = null,
      onAction = null
    } = options;
    
    const colors = {
      success: 'bg-primary-600',
      error: 'bg-danger-500',
      warning: 'bg-warning-500',
      info: 'bg-gray-800'
    };
    
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    
    const toast = document.createElement('div');
    // El layout y el color los pone esta clase, no el .toast de main.css: ese
    // sólo aporta posición y acabado. Ver el comentario en main.css.
    //
    // Un toast SIN acción cabe bien en una línea (icono + texto). Uno CON
    // acción necesita el botón a 52px de alto, y en el ancho de una línea
    // (max-w-xs = 320px) el mensaje quedaba en un tercio de espacio y se
    // partía en tres renglones. Por eso los de acción se apilan en vertical y
    // ocupan el ancho disponible.
    toast.className = action
      ? `toast ${colors[type]} text-white animate-slide-up w-full md:w-auto md:max-w-sm pointer-events-auto flex flex-col items-stretch gap-3`
      : `toast ${colors[type]} text-white animate-slide-up w-full md:w-auto max-w-xs pointer-events-auto flex items-center gap-4`;
    // El mensaje suele traer el nombre de un producto (dato del usuario), así
    // que se escapa antes de inyectarlo como HTML.
    //
    // El botón de acción usa el mismo mínimo táctil de 52px que el resto de la
    // app: es el control que el usuario toca cuando se equivocó, y con
    // px-3 py-1 text-xs quedaba en ~28px de alto, el más pequeño de toda la
    // interfaz y justo el que más necesita ser fácil de acertar.
    toast.innerHTML = action
      ? `
        <div class="fila fila-amplia">
          <span class="mediano">${icons[type]}</span>
          <span class="crece detalle">${esc(message)}</span>
        </div>
        <button class="btn-transparente">${esc(action)}</button>
      `
      : `
        <div class="fila fila-amplia">
          <span class="mediano">${icons[type]}</span>
          <span class="crece detalle">${esc(message)}</span>
        </div>
      `;
    
    if (action && onAction) {
      toast.querySelector('button').addEventListener('click', () => {
        onAction();
        this.remove(id);
      });
    }
    
    this.container.appendChild(toast);
    this.toasts.set(id, toast);
    
    // Auto remove
    if (duration > 0) {
      setTimeout(() => this.remove(id), duration);
    }
    
    return id;
  }
  
  remove(id) {
    const toast = this.toasts.get(id);
    if (toast) {
      toast.classList.add('anim-bajar');
      toast.classList.remove('anim-subir');
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
        this.toasts.delete(id);
      }, 200);
    }
  }
  
  success(message, options) {
    return this.show(message, { ...options, type: 'success' });
  }
  
  error(message, options) {
    return this.show(message, { ...options, type: 'error', duration: 5000 });
  }
  
  warning(message, options) {
    return this.show(message, { ...options, type: 'warning' });
  }
  
  info(message, options) {
    return this.show(message, { ...options, type: 'info' });
  }
  
  // Toast especial para "Deshacer" con acción
  undo(message, onUndo, duration = 5000) {
    return this.show(message, {
      type: 'info',
      duration,
      action: '↩️ DESHACER',
      onAction: onUndo
    });
  }
}

// Singleton
export const toast = new ToastManager();