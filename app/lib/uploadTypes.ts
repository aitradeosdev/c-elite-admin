export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function magicMatchesExt(buf: Buffer, ext: string): boolean {
  if (buf.length < 12) return false;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
             && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
  const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
  const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
              && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  switch (ext) {
    case 'png':  return isPng;
    case 'jpg':
    case 'jpeg': return isJpeg;
    case 'webp': return isWebp;
    default: return false;
  }
}
