import { useEffect, useRef, useState } from 'react';

export function useWakeLock() {
  const [isLocked, setIsLocked] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    // Função para solicitar o bloqueio
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
          setIsLocked(true);
          console.log('Wake Lock active');

          // Se o bloqueio for liberado (ex: user trocou de aba), tenta pegar de novo quando voltar
          wakeLockRef.current.addEventListener('release', () => {
            console.log('Wake Lock released');
            setIsLocked(false);
          });
        }
      } catch (err) {
        console.warn('Wake Lock request failed:', err);
      }
    };

    requestWakeLock();

    // Re-solicitar se a visibilidade da página mudar (ex: voltou da minimização)
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && !isLocked) {
        await requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return { isLocked };
}