'use client';

import { forwardRef, useState } from 'react';
import s from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

export interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: AvatarSize;
  decorative?: boolean;
  alt?: string;
  className?: string;
}

export interface AvatarView {
  image: string | null;
  label: string;
  initials: string;
  pixels: number;
}

export const AVATAR_PIXELS: Readonly<Record<AvatarSize, number>> = { xs: 20, sm: 28, md: 32, lg: 40 };

const SIZE_CLASS: Readonly<Record<AvatarSize, string>> = { xs: s.xs, sm: s.sm, md: s.md, lg: s.lg };
const INITIAL_COUNT: Readonly<Record<AvatarSize, number>> = { xs: 1, sm: 2, md: 2, lg: 2 };
const LEADING_CHARACTER = /[\p{L}\p{N}]\p{M}*/u;

function capital(letter: string): string {
  const upper = letter.toUpperCase();
  return Array.from(upper).length === Array.from(letter).length ? upper : letter;
}

export function initialsOf(name: string | null | undefined, max = 2): string {
  const letters: string[] = [];
  if (typeof name === 'string') {
    for (const word of name.normalize('NFC').split(/\s+/)) {
      const found = LEADING_CHARACTER.exec(word);
      if (found) letters.push(capital(found[0]));
    }
  }
  if (letters.length === 0) return '?';
  if (letters.length === 1 || !(max >= 2)) return letters[0];
  return `${letters[0]}${letters[letters.length - 1]}`;
}

export function resolveAvatar(
  { src, name, alt, decorative = false, size = 'sm' }: Omit<AvatarProps, 'className'>,
  failedSrc: string | null = null,
): AvatarView {
  const url = typeof src === 'string' ? src.trim() : '';
  return {
    image: url !== '' && url !== failedSrc ? url : null,
    label: decorative ? '' : (alt ?? name ?? '').trim(),
    initials: initialsOf(name, INITIAL_COUNT[size] ?? INITIAL_COUNT.sm),
    pixels: AVATAR_PIXELS[size] ?? AVATAR_PIXELS.sm,
  };
}

function replayEarlyError(image: HTMLImageElement | null) {
  if (image && image.complete && image.naturalWidth === 0) image.src = image.src;
}

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { src, name, size = 'sm', decorative = false, alt, className },
  ref,
) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const view = resolveAvatar({ src, name, alt, decorative, size }, failedSrc);
  const image = view.image;
  const classes = [s.avatar, SIZE_CLASS[size] ?? s.sm, !image && s.fallback, className].filter(Boolean).join(' ');

  if (image) {
    return (
      <span ref={ref} className={classes}>
        <img
          ref={replayEarlyError}
          className={s.image}
          src={image}
          alt={view.label}
          width={view.pixels}
          height={view.pixels}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(image)}
        />
      </span>
    );
  }

  return (
    <span
      ref={ref}
      className={classes}
      role={view.label ? 'img' : undefined}
      aria-label={view.label || undefined}
    >
      <span aria-hidden translate="no">{view.initials}</span>
    </span>
  );
});
