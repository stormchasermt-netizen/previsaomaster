'use client';

import React from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { MultiplayerProvider } from '@/contexts/MultiplayerContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <MultiplayerProvider>
          {children}
        </MultiplayerProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
