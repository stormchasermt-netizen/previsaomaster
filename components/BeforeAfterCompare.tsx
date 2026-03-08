'use client';

import React, { useState, useRef, useCallback } from 'react';

type Props = {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
};

/** Comparação antes/depois com divisor arrastável. */
export function BeforeAfterCompare({ beforeUrl, afterUrl, beforeLabel = 'Antes', afterLabel = 'Depois', className = '' }: Props) {
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const pct = Math.max(5, Math.min(95, (x / rect.width) * 100));
      setSplit(pct);
    },
    []
  );

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onTouchStart = (e: React.TouchEvent) => {
    setDragging(true);
  };

  React.useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onMouseUp = () => setDragging(false);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) handleMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => setDragging(false);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [dragging, handleMove]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-lg bg-slate-900 ${className}`}
      style={{ aspectRatio: '16/10' }}
    >
      {/* Imagem "Depois" (fundo) */}
      <div className="absolute inset-0">
        <img src={afterUrl} alt={afterLabel} className="w-full h-full object-cover" />
        <span className="absolute bottom-2 right-2 text-xs font-medium bg-black/60 text-white px-2 py-1 rounded">
          {afterLabel}
        </span>
      </div>
      {/* Imagem "Antes" (clipeada) */}
      <div
        className="absolute inset-0 z-10"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      >
        <img src={beforeUrl} alt={beforeLabel} className="w-full h-full object-cover" />
        <span className="absolute bottom-2 left-2 text-xs font-medium bg-black/60 text-white px-2 py-1 rounded">
          {beforeLabel}
        </span>
      </div>
      {/* Divisor arrastável */}
      <div
        className="absolute top-0 bottom-0 z-20 w-1 cursor-ew-resize select-none"
        style={{ left: `${split}%`, transform: 'translateX(-50%)' }}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
      >
        <div className="absolute inset-y-0 -left-2 -right-2" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-10 rounded-full bg-white shadow-lg border-2 border-slate-700 flex items-center justify-center">
          <div className="flex gap-0.5">
            <span className="w-0.5 h-4 bg-slate-600 rounded" />
            <span className="w-0.5 h-4 bg-slate-600 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
