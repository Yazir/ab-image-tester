import sharp from 'sharp';
import fs from 'fs';

const MAX_DIMENSION = 2048;

const PROCESSABLE = new Set(['png', 'jpg', 'jpeg', 'webp']);

export async function processImage(filePath: string, ext: string): Promise<void> {
  const cleanExt = ext.replace(/\./g, '').toLowerCase();

  if (!PROCESSABLE.has(cleanExt)) return;

  let pipeline = sharp(filePath);
  const metadata = await pipeline.metadata();

  if (!metadata.width || !metadata.height) return;

  const needsResize = metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION;

  if (needsResize) {
    pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
  }

  let buf: Buffer;
  if (cleanExt === 'png') {
    buf = await pipeline.png({ quality: 70, effort: 10 }).toBuffer();
  } else if (cleanExt === 'jpg' || cleanExt === 'jpeg') {
    buf = await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  } else if (cleanExt === 'webp') {
    buf = await pipeline.webp({ quality: 95 }).toBuffer();
  } else {
    return;
  }

  fs.writeFileSync(filePath, buf);
}
