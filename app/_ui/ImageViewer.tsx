'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Maximize2, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { isTopmostTrap, useFocusTrap } from './useFocusTrap';
import s from './ImageViewer.module.css';

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

export interface ImageViewerProps {
  open: boolean;
  images: string[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  title?: string;
  caption?: (index: number, total: number) => string;
  canDownload?: boolean;
  onDownload?: (url: string, index: number) => void;
}

export function ImageViewer({
  open,
  images,
  index,
  onIndexChange,
  onClose,
  title,
  caption,
  canDownload,
  onDownload,
}: ImageViewerProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);
  const [zoomStep, setZoomStep] = useState(0);
  const [rotation, setRotation] = useState(0);

  const total = images.length;
  const hasMany = total > 1;

  const reset = useCallback(() => {
    setZoomStep(0);
    setRotation(0);
  }, []);

  const go = useCallback(
    (delta: number) => {
      if (!hasMany) return;
      reset();
      onIndexChange((index + delta + total) % total);
    },
    [hasMany, index, onIndexChange, reset, total],
  );

  useEffect(() => { reset(); }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isTopmostTrap(trapRef.current)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoomStep((z) => Math.min(z + 1, ZOOM_STEPS.length - 1)); }
      else if (e.key === '-') { e.preventDefault(); setZoomStep((z) => Math.max(z - 1, 0)); }
      else if (e.key.toLowerCase() === 'r') { e.preventDefault(); setRotation((r) => (r + 90) % 360); }
      else if (e.key === '0') { e.preventDefault(); reset(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, go, reset]);

  if (!open || total === 0) return null;

  const src = images[index];
  const zoom = ZOOM_STEPS[zoomStep];
  const label = caption ? caption(index, total) : `Image ${index + 1} of ${total}`;

  return (
    <div
      ref={trapRef}
      className={s.root}
      role="dialog"
      aria-modal="true"
      aria-label={title ? `${title} — ${label}` : label}
      onClick={onClose}
    >
      <div className={s.bar} onClick={(e) => e.stopPropagation()}>
        <div className={s.meta}>
          {title ? <span className={s.title}>{title}</span> : null}
          <span className={s.caption}>{label}</span>
        </div>
        <div className={s.controls}>
          <button
            type="button"
            className={s.ctrl}
            onClick={() => setZoomStep((z) => Math.max(z - 1, 0))}
            disabled={zoomStep === 0}
            aria-label="Zoom out"
            title="Zoom out (−)"
          >
            <ZoomOut size={16} />
          </button>
          <span className={s.zoomLabel} aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className={s.ctrl}
            onClick={() => setZoomStep((z) => Math.min(z + 1, ZOOM_STEPS.length - 1))}
            disabled={zoomStep === ZOOM_STEPS.length - 1}
            aria-label="Zoom in"
            title="Zoom in (+)"
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            className={s.ctrl}
            onClick={() => setRotation((r) => (r + 90) % 360)}
            aria-label="Rotate"
            title="Rotate (R)"
          >
            <RotateCw size={16} />
          </button>
          <button
            type="button"
            className={s.ctrl}
            onClick={reset}
            aria-label="Reset view"
            title="Reset view (0)"
          >
            <Maximize2 size={16} />
          </button>
          {canDownload && onDownload ? (
            <button
              type="button"
              className={s.ctrl}
              onClick={() => onDownload(src, index)}
              aria-label="Download image"
              title="Download image"
            >
              <Download size={16} />
            </button>
          ) : null}
          <button
            type="button"
            className={[s.ctrl, s.ctrlClose].join(' ')}
            onClick={onClose}
            aria-label="Close viewer"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className={s.stage} onClick={onClose}>
        {hasMany ? (
          <button
            type="button"
            className={[s.nav, s.navPrev].join(' ')}
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            aria-label="Previous image"
            title="Previous (←)"
          >
            <ChevronLeft size={22} />
          </button>
        ) : null}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          className={s.image}
          style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
          onClick={(e) => e.stopPropagation()}
        />

        {hasMany ? (
          <button
            type="button"
            className={[s.nav, s.navNext].join(' ')}
            onClick={(e) => { e.stopPropagation(); go(1); }}
            aria-label="Next image"
            title="Next (→)"
          >
            <ChevronRight size={22} />
          </button>
        ) : null}
      </div>

      {hasMany ? (
        <div className={s.dots} onClick={(e) => e.stopPropagation()}>
          {images.map((url, i) => (
            <button
              key={url + i}
              type="button"
              className={[s.dot, i === index && s.dotActive].filter(Boolean).join(' ')}
              onClick={() => { reset(); onIndexChange(i); }}
              aria-label={`Go to image ${i + 1}`}
              aria-current={i === index || undefined}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
