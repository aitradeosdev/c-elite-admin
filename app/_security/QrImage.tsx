import { isQrDataUri } from '../lib/adminSecurity';
import s from './security.module.css';

export const QR_SIZE = 176;
export const QR_ALT = 'QR code for setting up CardElite Admin two-step sign-in. If you cannot scan it, use the setup key.';
export const QR_MISSING = 'The QR code could not be shown. Use the setup key instead.';

export interface QrImageProps {
  src: string;
  size?: number;
  className?: string;
}

export function QrImage({ src, size = QR_SIZE, className }: QrImageProps) {
  if (!isQrDataUri(src)) return <p className={s.qrMissing}>{QR_MISSING}</p>;
  return (
    <div className={[s.qrFrame, className].filter(Boolean).join(' ')}>
      <img src={src} width={size} height={size} alt={QR_ALT} className={s.qrImage} decoding="async" draggable={false} />
    </div>
  );
}
