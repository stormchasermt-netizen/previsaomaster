import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import clsx from 'clsx';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  onClose: (id: string) => void;
}

export function Toast({ id, message, type, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, 5000);
    return () => clearTimeout(timer);
  }, [id, onClose]);

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-emerald-400" />,
    error: <AlertCircle className="w-5 h-5 text-red-400" />,
    info: <Info className="w-5 h-5 text-cyan-400" />,
  };

  const colors = {
    success: 'bg-slate-800 border-emerald-500/30 text-white',
    error: 'bg-slate-800 border-red-500/30 text-white',
    info: 'bg-slate-800 border-cyan-500/30 text-white',
  };

  return (
    <div className={clsx(
      "flex items-center gap-3 p-4 rounded-lg border shadow-xl transition-all animate-in slide-in-from-right-full duration-300 max-w-sm w-full pointer-events-auto",
      colors[type]
    )}>
      <div className="shrink-0">{icons[type]}</div>
      <p className="text-sm font-medium grow">{message}</p>
      <button onClick={() => onClose(id)} className="shrink-0 text-slate-400 hover:text-white">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}