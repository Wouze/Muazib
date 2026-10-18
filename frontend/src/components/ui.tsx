import React, { useEffect, useRef } from 'react';

export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}
import type { Tier } from '../types';
import { initials } from '../lib/format';

export const TIER_STYLES: Record<Tier, { label: string; accent: string; badge: string; title: string }> = {
  hard_constraint: {
    label: 'Hard rule',
    accent: 'border-l-terracotta-500',
    badge: 'bg-terracotta-50 text-terracotta-700 ring-terracotta-200',
    title: 'text-terracotta-700'
  },
  soft_preference: {
    label: 'Preference',
    accent: 'border-l-palm-500',
    badge: 'bg-palm-50 text-palm-700 ring-palm-200',
    title: 'text-palm-700'
  },
  ephemeral: {
    label: 'This visit only',
    accent: 'border-l-plum-500',
    badge: 'bg-plum-50 text-plum-700 ring-plum-200',
    title: 'text-plum-700'
  }
};

const LOGO_SIZES = {
  sm: 'h-7 w-6',
  md: 'h-11 w-10 sm:h-14 sm:w-12',
  lg: 'h-28 w-24'
};

export function Logo({ size = 'md', className, framed }: { size?: keyof typeof LOGO_SIZES; className?: string; framed?: boolean }) {
  const img = (
    <img
      src="/logo.svg"
      alt={size === 'md' && !framed ? "Mu'azib" : ''}
      className={`${className ?? LOGO_SIZES[size]} object-contain shrink-0`}
    />
  );
  if (framed) {
    return (
      <span className="h-9 w-9 shrink-0 rounded-2xl bg-sand-50 ring-1 ring-sand-200 flex items-center justify-center">
        {img}
      </span>
    );
  }
  return img;
}

const AVATAR_TONES = [
  'bg-saffron-100 text-saffron-700 ring-saffron-200',
  'bg-terracotta-100 text-terracotta-700 ring-terracotta-200',
  'bg-palm-100 text-palm-700 ring-palm-200',
  'bg-plum-100 text-plum-700 ring-plum-200'
];

export function Avatar({ name, index = 0, size = 'md' }: { name: string; index?: number; size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 'h-6 w-6 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' }[size];
  return (
    <span
      aria-hidden="true"
      className={`${dims} ${AVATAR_TONES[index % AVATAR_TONES.length]} shrink-0 rounded-full ring-1 font-semibold flex items-center justify-center`}
    >
      {initials(name)}
    </span>
  );
}

export function SectionHeader({
  icon,
  title,
  subtitle,
  count,
  tone
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count?: number;
  tone: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 ${tone}`}>{icon}</div>
        <div>
          <h3 className="text-sm font-semibold text-date-900">{title}</h3>
          <p className="text-xs text-date-500">{subtitle}</p>
        </div>
      </div>
      {count !== undefined && (
        <span className="text-xs font-semibold text-date-600 bg-sand-100 rounded-full px-2.5 py-0.5 tabular-nums">{count}</span>
      )}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-date-500 border border-dashed border-sand-300 rounded-xl px-3.5 py-3 bg-sand-50">{children}</div>
  );
}

export function Modal({ onClose, children, labelledBy }: { onClose: () => void; children: React.ReactNode; labelledBy: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-date-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="relative w-full max-w-sm bg-white border border-sand-200 rounded-2xl p-6 shadow-xl msg-in"
      >
        {children}
      </div>
    </div>
  );
}

export function Toast({ text, tone }: { text: string; tone: 'info' | 'error' }) {
  const styles =
    tone === 'error'
      ? 'bg-terracotta-700 text-white'
      : 'bg-date-900 text-sand-50';
  return (
    <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 msg-in">
      <div className={`${styles} rounded-full px-4 py-2.5 text-sm font-medium shadow-lg`}>{text}</div>
    </div>
  );
}
