/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        danger: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        }
      },
      fontSize: {
        'touch': ['1.125rem', { lineHeight: '1.5rem' }],
        'touch-lg': ['1.25rem', { lineHeight: '1.75rem' }],
        'touch-xl': ['1.5rem', { lineHeight: '2rem' }],
      },
      minHeight: {
        'touch': '52px',
        'touch-lg': '60px',
      },
      // El mínimo táctil de 52px aplica a las DOS dimensiones. Sin minWidth los
      // botones cuadrados del catálogo (editar/eliminar, +/−) se armaban con
      // w-9 (36px) o w-11 (44px) y quedaban por debajo del mínimo, que es
      // justo lo que hace fallar el toque con dedos grandes.
      minWidth: {
        'touch': '52px',
        'touch-lg': '60px',
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      }
    },
  },
  plugins: [],
}