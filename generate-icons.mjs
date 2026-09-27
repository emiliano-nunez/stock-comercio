import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const outDir = path.join(__dirname, 'public', 'icons');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#16a34a');
  gradient.addColorStop(1, '#15803d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  const radius = size * 0.1875;
  ctx.roundRect(0, 0, size, size, radius);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  
  ctx.font = `bold ${size * 0.55}px system-ui`;
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📦', size/2, size/2 + size*0.05);
  
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(outDir, `icon-${size}x${size}.png`), buffer);
  console.log('Created icon-' + size + 'x' + size + '.png');
});

console.log('All icons generated!');