'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useToast } from '@/contexts/ToastContext';

const AoVivo2Content = dynamic(() => import('../ao-vivo-2/AoVivo2Content'), {
  ssr: false,
  loading: () => (
    <div className="min-h-[100dvh] bg-slate-950 flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
    </div>
  ),
});

export default function AoVivoPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();

  useEffect(() => {
    // Se ainda está a carregar o user ou é null, pode ser breve. Mas se é null após mount, redirecionar.
    // Deixamos o AuthContext determinar. Se user for falho ou não for admin/superadmin, encaminhar:
    if (user !== undefined) {
      if (!user || (user.type !== 'admin' && user.type !== 'superadmin')) {
        addToast('Acesso reservado a administradores.', 'error');
        router.push('/');
      }
    }
  }, [user, router, addToast]);

  // Enquanto valida o user
  if (user === undefined || !user || (user.type !== 'admin' && user.type !== 'superadmin')) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  return <AoVivo2Content />;
}
