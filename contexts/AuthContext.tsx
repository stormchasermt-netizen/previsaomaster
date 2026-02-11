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
  }, []);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Erro no login com Google via Firebase:", error);
      alert("Ocorreu um erro ao tentar fazer login. A janela pode ter sido fechada ou houve um problema de rede.");
    }
  };

  const updateUsername = async (name: string) => {
    if (auth.currentUser) {
      try {
        await updateProfile(auth.currentUser, { displayName: name });
        // The onAuthStateChanged listener will automatically pick up the change
        setUser(prevUser => prevUser ? { ...prevUser, displayName: name } : null);
      } catch (error) {
        console.error("Erro ao atualizar nome de usuário:", error);
      }
    }
  };

  const logout = async () => {
    await signOut(auth);
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
