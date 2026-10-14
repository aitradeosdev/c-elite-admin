import qrcode from 'qrcode-generator';

const QUIET_ZONE = 4;
const PIXELS_PER_MODULE = 4;

export function qrDataUri(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(Buffer.from(text, 'utf8').toString('latin1'), 'Byte');
  try {
    qr.make();
  } catch {
    throw new RangeError('The text is too long for a QR code');
  }
  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;
  const runs: string[] = [];
  for (let row = 0; row < count; row += 1) {
    let col = 0;
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < count && qr.isDark(row, col)) col += 1;
      runs.push(`M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${col - start}v1h-${col - start}z`);
    }
  }
  const pixels = size * PIXELS_PER_MODULE;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${pixels}" height="${pixels}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<path fill="#000" d="${runs.join('')}"/>` +
    '</svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
