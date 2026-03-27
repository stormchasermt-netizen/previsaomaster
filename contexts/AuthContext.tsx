'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, updateProfile, User } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import type { AppUser } from '@/lib/types';
import { ADMIN_EMAILS } from '@/lib/constants';

interface AuthContextType {
  user: AppUser | null;
  loginWithGoogle: () => void;
  updateUsername: (name: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children?: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // DEV MOCK: Permite que o agente ou desenvolvedor simule login sem Firebase Auth real.
    // Ative via console: localStorage.setItem('dev_mock_user', 'true') OU via URL: ?mock=true
    const setupMock = async () => {
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const isMockActive = localStorage.getItem('dev_mock_user') === 'true' || urlParams.get('mock') === 'true';

        if (isMockActive) {
          // No Mode Mock, não tentamos assinar no Firebase (evita erros de permissão se as regras forem rígidas)
          // Em vez disso, fornecemos um usuário de teste que a UI respeita.
          const mockAdmin: AppUser = {
            uid: 'dev-mock-admin-uid',
            displayName: 'AI Debugger (Admin)',
            email: 'admin@stormchasermt.com.br',
            photoURL: 'https://github.com/identicons/dev.png',
            type: 'admin'
          };
          setUser(mockAdmin);
          setIsLoading(false);
          return true;
        }
      }
      return false;
    };

    setupMock().then(isMocked => {
      if (isMocked) return;

      if (auth) {
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
          if (firebaseUser) {
            const isAdmin = firebaseUser.email ? ADMIN_EMAILS.includes(firebaseUser.email) : false;
            const appUser: AppUser = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName || 'Jogador',
              email: firebaseUser.email || '',
              photoURL: firebaseUser.photoURL || undefined,
              type: isAdmin ? 'admin' : 'user'
            };
            setUser(appUser);
          } else {
            setUser(null);
          }
          setIsLoading(false);
        });
        return () => unsubscribe();
      } else {
        setIsLoading(false);
        setUser(null);
      }
    });
  }, []);

  const loginWithGoogle = async () => {
    // Check if auth and provider are available before trying to log in
    if (!auth || !googleProvider) {
        alert("Erro de configuração do Firebase. Verifique suas chaves de API em lib/firebase.ts.");
        return;
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Erro no login com Google via Firebase:", error);
      if (error.code === 'auth/unauthorized-domain') {
        alert("Erro de autorização: O domínio deste aplicativo não foi autorizado para operações de login. Adicione o domínio atual à lista de 'Authorized domains' no seu console do Firebase em Authentication -> Settings -> Authorized domains.");
      } else if (error.code === 'auth/operation-not-allowed') {
        alert("Erro de Configuração: O login com Google não está ativado no seu projeto Firebase. Vá para o Firebase Console -> Authentication -> Sign-in method e ative o provedor 'Google'.");
      }
      else {
        alert("Ocorreu um erro ao tentar fazer login. A janela pode ter sido fechada ou houve um problema de rede.");
      }
    }
  };

  const updateUsername = async (name: string) => {
    if (auth?.currentUser) {
      try {
        await updateProfile(auth.currentUser, { displayName: name });
        setUser(prevUser => prevUser ? { ...prevUser, displayName: name } : null);
      } catch (error) {
        console.error("Erro ao atualizar nome de usuário:", error);
      }
    }
  };

  const logout = async () => {
    if (auth) {
      await signOut(auth);
    }
  };
  
  return (
    <AuthContext.Provider value={{ user, loginWithGoogle, updateUsername, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
