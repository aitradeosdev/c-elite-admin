'use client';

import type { RefObject } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import s from './Pagination.module.css';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (next: number) => void;
  label?: string;
  noun?: string;
  disabled?: boolean;
  scrollTargetRef?: RefObject<HTMLElement | null>;
}

export function revealScrollTarget(target: HTMLElement | null | undefined): boolean {
  if (!target) return false;
  const view = target.ownerDocument?.defaultView ?? null;
  const offset = view ? Number.parseFloat(view.getComputedStyle(target).scrollMarginTop) || 0 : 0;
  if (target.getBoundingClientRect().top >= offset) return false;
  const reduce = Boolean(view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  return true;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  label = 'Pagination',
  noun = 'results',
  disabled,
  scrollTargetRef,
}: PaginationProps) {
  const safeSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (current - 1) * safeSize + 1;
  const to = Math.min(current * safeSize, total);

  const go = (next: number) => {
    onPageChange(next);
    if (scrollTargetRef) revealScrollTarget(scrollTargetRef.current);
  };

  return (
    <nav className={s.bar} aria-label={label}>
      <span className={s.summary} aria-live="polite">
        {total === 0
          ? `No ${noun}`
          : <>
              <span className={s.num}>{from.toLocaleString()}</span>–<span className={s.num}>{to.toLocaleString()}</span>
              {' of '}
              <span className={s.num}>{total.toLocaleString()}</span> {noun}
            </>}
      </span>
      {totalPages > 1 ? (
        <div className={s.controls}>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ChevronLeft size={14} aria-hidden />}
            onClick={() => go(current - 1)}
            disabled={disabled || current <= 1}
            aria-label="Previous page"
          >
            Previous
          </Button>
          <span className={s.page}>
            Page <span className={s.num}>{current}</span> of <span className={s.num}>{totalPages}</span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            rightIcon={<ChevronRight size={14} aria-hidden />}
            onClick={() => go(current + 1)}
            disabled={disabled || current >= totalPages}
            aria-label="Next page"
          >
            Next
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
