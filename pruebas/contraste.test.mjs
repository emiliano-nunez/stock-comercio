/*
 * El contraste de los tokens, verificado antes de compilar.
 *
 * Por que existe: en esta app casi ningún color está escrito en un componente,
 * está declarado una sola vez en `tokens.css`. Eso es bueno para mantenerlo y
 * malo para detectar un error, porque cuando un gris queda demasiado claro no
 * se rompe nada: la app sigue funcionando, la tarjeta se ve más delicada, y lo
 * único que falla es que alguien no pueda leer el código de barras. Ni el
 * build ni el linter se enteran.
 *
 * El caso que motivó el archivo es `--interfaz-texto-3`. Estaba en `#999999`,
 * que da 2.85 a 1 sobre blanco, y se usaba en dos textos que hay que leer: el
 * código de barras de la tarjeta y el "sin llenar" de la ficha. Nadie lo
 * reportó como roto durante no se sabe cuánto tiempo, porque un texto ilegible
 * no es un error visible: es un texto que la gente deja de mirar.
 *
 * Se testea el token y no el componente por el mismo motivo: si mañana el
 * "sin llenar" se pinta con otro token, o el gris se mueve por un motivo
 * distinto, el número sigue estando acá.
 *
 * Corre en los DOS temas. El tema oscuro se arma superponiendo las
 * declaraciones del `:root` del media query sobre las del `:root` claro, que es
 * exactamente lo que hace el navegador: el bloque oscuro no redefine todo,
 * sólo pisa lo que cambia.
 *
 * Entorno node: no hay pantalla que simular y leer un archivo no necesita
 * jsdom. Ver pruebas/manifest.test.mjs, que razona lo mismo.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const RUTA = new URL('../src/css/tokens.css', import.meta.url);

/** Todo el CSS sin comentarios. */
const crudo = readFileSync(RUTA, 'utf8');

/*
 * Los comentarios se sacan antes de parsear, y no por estética.
 *
 * En este archivo los comentarios explican decisiones y traen hexadecimales y
 * "--algo: valor" escritos como prosa: `#999999` aparece en el comentario de
 * `--interfaz-texto-3` como el valor que tuvo, y sin este paso el test leería
 * dos valores para el mismo token y se quedaría con el viejo.
 */
const limpio = crudo.replace(/\/\*[\s\S]*?\*\//g, '');

const INICIO_OSCURO = limpio.indexOf('@media (prefers-color-scheme: dark)');
const claroCrudo = limpio.slice(0, INICIO_OSCURO < 0 ? limpio.length : INICIO_OSCURO);
const oscuroCrudo = INICIO_OSCURO < 0 ? '' : limpio.slice(INICIO_OSCURO);

/**
 * Lee todas las declaraciones `--nombre: valor;` de un trozo de CSS.
 *
 * @param {string} css
 * @returns {Record<string,string>} el token sin los guiones iniciales, ej. `gris-500`
 */
function declaraciones(css) {
  const fuera = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(css))) fuera[m[1].slice(2)] = m[2].trim();
  return fuera;
}

const CLARO = declaraciones(claroCrudo);
const OSCURO = { ...CLARO, ...declaraciones(oscuroCrudo) };

/**
 * El valor escrito, sin resolver `var()`, para los mensajes de error.
 *
 * @param {string} nombre
 * @param {Record<string,string>} tema
 */
function escrito(nombre, tema) {
  return tema[nombre.replace(/^--/, '')] ?? '(no existe)';
}

const TEMAS = [
  ['claro', CLARO],
  ['oscuro', OSCURO],
];

/**
 * Resuelve un valor de token a `#rrggbb`, o `null` si no es un color opaco.
 *
 * Devuelve `null` --y no lanza-- para los colores con alfa, que son los fondos
 * tenues de los chips (`rgb(22 99 196 / 15%)`). El contraste de un color con
 * alfa depende de qué haya debajo, así que no tiene un número propio: se
 * mide el TEXTO de encima contra el fondo compuesto, que es lo que hace el
 * navegador y lo que revisa la app en vivo.
 *
 * @param {string} nombre  con o sin los guiones iniciales: `--gris-500` y
 *                         `gris-500` son la misma entrada
 * @param {Record<string,string>} tema
 * @returns {string|null}
 */
function aHex(nombre, tema) {
  if (!nombre) return null;
  const v = (tema[nombre.replace(/^--/, '')] || '').trim();
  if (!v) return null;

  const varMatch = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (varMatch) return aHex(varMatch[1], tema);

  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3
      ? hex[1].split('').map((c) => c + c).join('')
      : hex[1];
    return `#${h.toLowerCase()}`;
  }

  // `rgb(r g b / alpha)` o `rgba(r, g, b, alpha)`: si el alfa es 1 sí sirve.
  const rgb = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const partes = rgb[1].split(/[,/]/).map((s) => s.trim());
    const [r, g, b] = partes.slice(0, 3).map(Number);
    const alfa = partes[3] === undefined ? 1 : parseFloat(partes[3]);
    if ([r, g, b].some(Number.isNaN)) return null;
    if (alfa !== 1) return null;
    const a = (n) => n.toString(16).padStart(2, '0');
    return `#${a(r)}${a(g)}${a(b)}`;
  }

  return null;
}

/** Luminancia relativa de un `#rrggbb`, según la fórmula de WCAG 2.1. */
function luminancia(hex) {
  const h = hex.slice(1);
  const canales = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2];
}

/** Razón de contraste entre dos `#rrggbb`, de 1 a 21. */
function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/*
 * Los pares que la app pinta de verdad y que tienen requisito de contraste.
 *
 * Cada entrada dice contra qué va cada color. Los de 4.5 son texto normal;
 * los de 3 son elementos gráficos informativos (anillos de foco, bordes de
 * campos) como exige WCAG 2.1.
 *
 * NO están:
 * - `--color-borde` sobre `--fondo-pagina`: los bordes viven en tarjetas sobre
 *   `--color-superficie`, no en el body.
 * - `--interfaz-azul` sobre `--color-marca-tenue`: ese par no ocurre en la UI
 *   (los chips de categoría usan verde/ámbar/rojo, no azul).
 * - `--color-borde-tenue`: es decorativo (separadores sutiles), WCAG 1.4.11
 *   no lo exige.
 */
const PARES = [
  // El texto de la app, sobre los dos fondos que existen.
  ['--color-texto', '--color-superficie', 4.5],
  ['--color-texto', '--fondo-pagina', 4.5],
  ['--color-texto-suave', '--color-superficie', 4.5],
  ['--color-texto-suave', '--fondo-pagina', 4.5],
  ['--color-texto-tenue', '--color-superficie', 4.5],
  ['--color-texto-tenue', '--fondo-pagina', 4.5],
  ['--color-marca', '--color-superficie', 4.5],
  ['--color-marca-fuerte', '--color-superficie', 4.5],

  // El estándar de la interfaz.
  ['--interfaz-texto', '--color-superficie', 4.5],
  ['--interfaz-texto', '--interfaz-fondo', 4.5],
  ['--interfaz-texto-2', '--color-superficie', 4.5],
  ['--interfaz-texto-3', '--color-superficie', 4.5],
  ['--interfaz-texto-3', '--fondo-pagina', 4.5],
  ['--interfaz-texto-3', '--interfaz-fondo', 4.5],

  // La cabecera.
  ['--cabecera-texto', '--cabecera-fondo', 4.5],

  // El azul como texto (item encendido del menú, enlaces) y como fondo
  // con letra clara encima (botón principal). El original daba 3.64.
  ['--interfaz-azul', '--color-superficie', 4.5],
  ['--interfaz-azul', '--fondo-pagina', 4.5],
  ['--color-superficie', '--interfaz-azul', 4.5],

  // Botones: texto sobre su fondo de acción.
  ['--color-texto-invertido', '--interfaz-azul-fuerte', 4.5],
  ['--color-texto-invertido', '--interfaz-azul-mas-fuerte', 4.5],
  ['--color-texto-invertido', '--color-marca', 4.5],
  ['--color-texto-invertido', '--color-peligro', 4.5],

  // Estados de error.
  ['--interfaz-error', '--color-superficie', 4.5],

  // Insignias de stock.
  ['--gris-700', '--gris-100', 4.5],
  ['--verde-texto', '--verde-100', 4.5],
  ['--verde-800', '--verde-50', 4.5],
  ['--ambar-700', '--ambar-100', 4.5],
  ['--ambar-700', '--ambar-50', 4.5],
  ['--rojo-700', '--rojo-100', 4.5],
  ['--rojo-700', '--rojo-50', 4.5],

  // Tooltip (pista).
  ['--pista-texto', '--pista-fondo', 4.5],

  // Lo gráfico que SÍ necesita 3:1: anillo de foco, bordes de campo.
  ['--interfaz-azul-foco', '--color-superficie', 3],
  ['--interfaz-azul-foco', '--fondo-pagina', 3],
  ['--color-borde', '--color-superficie', 3],
  ['--campo-borde', '--color-superficie', 3],
];

describe('contraste de los tokens', () => {
  it('tokens.css tiene las dos hojas de color', () => {
    // Sin la hoja oscura el test pasaría siempre en claro y no estaría
    // revisando nada de lo que hizo falta arreglar.
    expect(INICIO_OSCURO).toBeGreaterThan(-1);
    expect(Object.keys(CLARO).length).toBeGreaterThan(60);
    expect(declaraciones(oscuroCrudo)).toMatchObject({
      'interfaz-azul': expect.any(String),
      'color-superficie': expect.any(String),
      'cabecera-fondo': expect.any(String),
    });
  });

  for (const [tema, tokens] of TEMAS) {
    describe(`tema ${tema}`, () => {
      it('todos los pares llegan al mínimo', () => {
        const quejidos = [];

        for (const [frente, fondo, minimo] of PARES) {
          const vFrente = aHex(frente, tokens);
          const vFondo = aHex(fondo, tokens);

          if (!vFrente || !vFondo) {
            quejidos.push(
              `${frente} -> ${fondo}: no se resuelve a un color opaco `
              + `(${escrito(frente, tokens)} / ${escrito(fondo, tokens)})`
            );
            continue;
          }

          const razon = contraste(vFrente, vFondo);
          if (razon < minimo) {
            quejidos.push(
              `${frente} (${vFrente}) sobre ${fondo} (${vFondo}): `
              + `${razon.toFixed(2)} y hace falta ${minimo}`
            );
          }
        }

        expect(quejidos, quejidos.join('\n')).toEqual([]);
      });
    });
  }

  it('los grises de la interfaz son los de la paleta', () => {
    /*
     * Antes había dos escalas de gris conviviendo: la paleta usaba `--gris-600`
     * para el texto secundario y la interfaz su propio `#666666`, que era casi
     * el mismo pero no exactamente el mismo. Con dos escalas, arreglar un gris
     * en la paleta no arreglaba nada en la interfaz, que es exactamente cómo
     * `--interfaz-texto-3` pudo quedarse en `#999999` mientras la paleta ya
     * tenía un `--gris-500` legible.
     *
     * Ahora --interfaz-texto-3 subió a --gris-600 (igual que --interfaz-texto-2)
     * para pasar 4.5 sobre --interfaz-fondo y --fondo-pagina. El test verifica
     * que los valores resueltos son los de la paleta, no que sean escalones
     * distintos.
     */
    expect(aHex('interfaz-texto', CLARO)).toBe(aHex('gris-700', CLARO));
    expect(aHex('interfaz-texto-2', CLARO)).toBe(aHex('gris-600', CLARO));
    expect(aHex('interfaz-texto-3', CLARO)).toBe(aHex('gris-600', CLARO));

    // Y el gris de los textos más claros no vuelve a ser un gris propio: era
    // `#999999`, que no está en la paleta y daba 2.85 sobre blanco.
    expect(aHex('interfaz-texto-3', CLARO)).not.toBeNull();
    expect(contraste(aHex('interfaz-texto-3', CLARO), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('el mínimo táctil subió a lo que piden las guías', () => {
    // 44 de Apple, 48 de Material con 44 de tolerancia. Estuvo en 52 y en 40.
    const px = parseFloat(CLARO['toque-min']);
    expect(px).toBeGreaterThanOrEqual(44);
    // Y la escala tipográfica más chica no baja de ahí: la etiqueta del menú
    // inferior estaba en 10px, por debajo del escalón más bajo de la escala.
    expect(parseFloat(CLARO['bottom-nav-etiqueta'])).toBeGreaterThanOrEqual(
      parseFloat(CLARO['texto-xs'])
    );
  });
});
