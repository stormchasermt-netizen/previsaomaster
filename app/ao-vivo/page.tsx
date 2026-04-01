'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

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

  useEffect(() => {
    if (!user || (user.type !== 'admin' && user.type !== 'superadmin')) {
      router.push('/');
    }
  }, [user, router]);

  if (!user || (user.type !== 'admin' && user.type !== 'superadmin')) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  return <AoVivo2Content />;
}
