import imageCompression from 'browser-image-compression';

export const imagenUtils = {

  opcionesCompresion: {
    maxSizeMB: 0.1,
    maxWidthOrHeight: 800,
    useWebWorker: true,
    fileType: 'image/webp',
    quality: 0.75,
    initialQuality: 0.75,
    alwaysKeepResolution: false
  },

  async comprimir(archivo) {
    try {
      const archivoComprimido = await imageCompression(archivo, this.opcionesCompresion);
      return archivoComprimido;
    } catch (error) {
      console.error('Error comprimiendo imagen:', error);
      throw new Error('No se pudo comprimir la imagen');
    }
  },

  async fileAWebPBlob(archivo) {
    const comprimido = await this.comprimir(archivo);
    return comprimido;
  },

  // Tope de tamaño para la foto de cámara.
  //
  // La galería sí pasaba por browser-image-compression con maxSizeMB: 0.1, pero
  // la foto de cámara se codificaba suelta con calidad 0.75 y SIN medir nada. Una
  // escena con textura (etiqueta con texto, landa, superficie de góndola) se
  // va fácil de 100 KB. Y el impacto no era teórico: cargarTodo() trae
  // todos los blobs de imagen a memoria de una vez, así que el tamaño de cada
  // foto se multiplica por la cantidad de productos. Mismo techo que la galería
  // para que el usuario no reciba fotos de tamaños dispares según de dónde las sacó.
  maxBytesCamara: 100 * 1024,

  // Resolución mínima antes de rendirse. Más abajo la foto deja de servir:
  // el usuario tiene que poder distinguir el producto en la tarjeta del
  // catálogo y pasarlo bien al proveedor.

  minDimCamara: 320,

  // Va aparte porque el bucle de tamaño necesita reintentar varias veces.
  _encodeFrame(origen, ancho, alto, calidad) {
    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(origen, 0, 0, ancho, alto);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Error generando imagen'));
        },
        'image/webp',
        calidad
      );
    });
  },

  async capturarDeVideo(videoElement) {
    const maxDim = 800;
    const { videoWidth, videoHeight } = videoElement;

    if (!videoWidth || !videoHeight) {

      throw new Error('El vídeo aún no tiene dimensiones. Probá de nuevo.');
    }

    let ancho = videoWidth;
    let alto = videoHeight;
    if (videoWidth > maxDim || videoHeight > maxDim) {
      if (videoWidth > videoHeight) {
        ancho = maxDim;
        alto = Math.max(1, Math.round((videoHeight / videoWidth) * maxDim));
      } else {
        alto = maxDim;
        ancho = Math.max(1, Math.round((videoWidth / videoHeight) * maxDim));
      }
    }

    const origen = document.createElement('canvas');
    origen.width = ancho;
    origen.height = alto;
    const ctx = origen.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, ancho, alto);

    // Primero se baja la calidad manteniendo la resolución, y sólo después se
    // recorta, porque perder resolución duele más.
    const intentos = [];
    for (const calidad of [0.75, 0.6, 0.5, 0.4]) {
      intentos.push({ ancho, alto, calidad });
    }

    // Se sigue achicando mientras la dimensión mayor siga por encima del
    // mínimo: el factor se aplica siempre, y el lazo termina porque el factor
    // decae geométricamente.
    let escala = 1;
    while (Math.max(ancho, alto) * escala > this.minDimCamara) {
      escala *= 0.75;
      for (const calidad of [0.6, 0.45]) {
        intentos.push({
          ancho: Math.max(1, Math.round(ancho * escala)),
          alto: Math.max(1, Math.round(alto * escala)),
          calidad
        });
      }
    }

    let ultimoBlob = null;
    for (const intento of intentos) {
      const blob = await this._encodeFrame(origen, intento.ancho, intento.alto, intento.calidad);
      ultimoBlob = blob;
      if (blob.size <= this.maxBytesCamara) {
        return blob;
      }
    }

    const kb = Math.round(ultimoBlob.size / 1024);
    console.warn(
      `imagenUtils: la foto de cámara quedó en ${kb}KB, por encima del tope de ` +
      `${Math.round(this.maxBytesCamara / 1024)}KB. Revisar minDimCamara.`
    );
    return ultimoBlob;
  },

  crearObjectURL(blob) {
    return URL.createObjectURL(blob);
  },

  // Generar la miniatura que usa el catálogo.
  //
  // El catálogo pinta cada foto en una caja de 64-80px, pero lo guardado es de
  // hasta 800px: se estaban decodificando del orden de 150 veces más píxeles
  // de los que se veían. Y como cargarTodo() trae TODOS los blobs a memoria de
  // una vez (no se van descargando a medida que se scrollea), el ahorro es
  // directo en RAM, que es lo más escaso en el equipo objetivo.
  //
  // Se genera una sola vez, al guardar la foto. Las imágenes ya guardadas no
  // tienen miniatura y siguen usando la completa: no hace falta migración, se
  // van beneficiándose a medida que se re-guarden.
  //
  // @returns {Promise<Blob|null>} null si no se pudo generar, y en ese caso el
  // catálogo usa la imagen completa.

  async crearThumb(blob, maxDim = 200) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (error) {
      console.warn('No se pudo decodificar la imagen para la miniatura:', error);
      return null;
    }

    try {
      const escala = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * escala));
      const h = Math.max(1, Math.round(bitmap.height * escala));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);

      return await new Promise((resolve) => {
        canvas.toBlob(
          (b) => resolve(b || null),
          'image/webp',
          0.7
        );
      });
    } catch (error) {
      console.warn('No se pudo generar la miniatura, se usará la imagen completa:', error);
      return null;
    } finally {

      bitmap.close?.();
    }
  },

  revocarObjectURL(url) {
    URL.revokeObjectURL(url);
  },

  validarArchivo(archivo) {

    // Sólo formatos que browser-image-compression sabe decodificar en todos
    // los navegadores. HEIC/HEIF se aceptaban aquí pero fallaban al comprimir
    // (salvo Safari), así que el usuario elegía un archivo "válido" y le
    // salía "No se pudo comprimir la imagen".

    const tiposValidos = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSizeMB = 10;

    const extension = (archivo.name?.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    const esHeicPorExtension = ['heic', 'heif'].includes(extension);

    if (esHeicPorExtension) {
      return { valido: false, error: 'Formato HEIC no soportado. Convierte la foto a JPG o PNG.' };
    }

    if (!tiposValidos.includes(archivo.type)) {
      return { valido: false, error: 'Formato no soportado. Use JPG, PNG o WebP.' };
    }

    if (archivo.size > maxSizeMB * 1024 * 1024) {
      return { valido: false, error: `Archivo muy grande. Máximo ${maxSizeMB}MB.` };
    }

    return { valido: true };
  }
};
