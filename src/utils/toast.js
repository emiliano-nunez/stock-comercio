import { esc } from './html.js';

export class ToastManager {
  constructor() {
    this.container = null;
    this.toasts = new Map();
    this.init();
  }

  init() {
    this.container = document.createElement('div');
    this.container.id = 'pila-avisos';

    this.container.className = 'pila-avisos';
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

    const colores = {
      success: 'aviso-ok',
      error: 'aviso-error',
      warning: 'aviso-alerta',
      info: 'aviso-info'
    };

    const iconos = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };

    const toast = document.createElement('div');

    toast.className = `aviso anim-aviso-entra ${colores[type] || colores.info} ${action ? 'aviso-con-boton' : 'aviso-sin-boton'}`;

    // El mensaje suele traer el nombre de un producto, que es dato del usuario, así
    // que va escapado antes de entrar en el HTML.
    toast.innerHTML = action
      ? `
        <div class="fila fila-amplia">
          <span class="mediano">${iconos[type] || iconos.info}</span>
          <span class="crece detalle">${esc(message)}</span>
        </div>
        <button class="btn-transparente">${esc(action)}</button>
      `
      : `
        <div class="fila fila-amplia">
          <span class="mediano">${iconos[type] || iconos.info}</span>
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

    if (duration > 0) {
      setTimeout(() => this.remove(id), duration);
    }

    return id;
  }

  remove(id) {
    const toast = this.toasts.get(id);
    if (toast) {
      toast.classList.add('anim-aviso-sale');
      toast.classList.remove('anim-aviso-entra');
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

  undo(message, onUndo, duration = 5000) {
    return this.show(message, {
      type: 'info',
      duration,
      action: '↩️ DESHACER',
      onAction: onUndo
    });
  }
}

export const toast = new ToastManager();
