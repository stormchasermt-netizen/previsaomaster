'use client';

import React, { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { MultiplayerProvider } from '@/contexts/MultiplayerContext';
import { setDriveTokenGetter } from '@/lib/drive';

function DriveInit() {
  const { user, getAccessToken } = useAuth();
  useEffect(() => {
    if (user) setDriveTokenGetter(getAccessToken);
    else setDriveTokenGetter(() => Promise.resolve(null));
  }, [user, getAccessToken]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DriveInit />
      <ToastProvider>
        <MultiplayerProvider>
          {children}
        </MultiplayerProvider>
      </ToastProvider>
    </AuthProvider>
  );
}