import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { AppUser } from '@/lib/types';
import { GOOGLE_CLIENT_ID, ADMIN_EMAILS } from '@/lib/constants';

// Declare Google Types for TypeScript
declare const google: any;

const ACCESS_TOKEN_KEY = 'previsao_access_token';
const ACCESS_TOKEN_EXPIRY_KEY = 'previsao_access_token_expiry';

function setAccessTokenRef(token: string, expiresInSeconds: number) {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  sessionStorage.setItem(ACCESS_TOKEN_EXPIRY_KEY, String(Date.now() + expiresInSeconds * 1000));
}

function getStoredToken(): string | null {
  const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
  const expiry = sessionStorage.getItem(ACCESS_TOKEN_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() >= parseInt(expiry, 10) - 60000) return null;
  return token;
}

interface AuthContextType {
  user: AppUser | null;
  loginWithGoogle: () => void;
  updateUsername: (name: string) => void;
  logout: () => void;
  isLoading: boolean;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children?: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load user from local storage on mount
  useEffect(() => {
    const stored = localStorage.getItem('previsao_user');
    if (stored) {
      setUser(JSON.parse(stored));
    }
    setIsLoading(false);
  }, []);

  const loginWithGoogle = () => {
    // DEBUG: Mostra a origem exata no console para conferência
    const currentOrigin = window.location.origin;
    console.log("--- INICIANDO LOGIN GOOGLE ---");
    console.log("Client ID Configurado:", GOOGLE_CLIENT_ID);
    console.log("Sua URL Atual (Origin):", currentOrigin);
    console.log("NOTA: Adicione '" + currentOrigin + "' em 'Origens JavaScript autorizadas' no Google Cloud Console se o login falhar.");

    // Check if script is loaded
    if (typeof google === 'undefined') {
        alert('Erro: Serviço de login do Google não carregou. Verifique se bloqueadores de anúncio (AdBlock) não estão impedindo o script.');
        return;
    }

    try {
        // Initialize the Token Client (OAuth2)
        const client = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.appdata',
            callback: async (tokenResponse: any) => {
                if (tokenResponse && tokenResponse.access_token) {
                    setAccessTokenRef(tokenResponse.access_token, tokenResponse.expires_in || 3600);
                    await fetchGoogleUserProfile(tokenResponse.access_token);
                } else {
                    console.warn("Resposta do token vazia ou popup fechado pelo usuário.", tokenResponse);
                }
            },
            error_callback: (err: any) => {
                console.error("Erro no callback do Google:", err);
                if (err.type === 'popup_closed') {
                    return; // User closed popup, ignore
                }
                if (err.message && err.message.includes('origin_mismatch')) {
                     alert(`Erro de Origem: O Google bloqueou o login vindo de "${currentOrigin}".\n\nAdicione essa URL exata no Google Cloud Console em "Origens JavaScript Autorizadas".`);
                } else {
                     alert(`Erro no Login Google: ${err.message || JSON.stringify(err)}`);
                }
            }
        });

        // Força o prompt de seleção de conta
        client.requestAccessToken({ prompt: 'select_account' }); 

    } catch (e: any) {
        console.error("EXCEÇÃO ao inicializar cliente Google:", e);
        alert(`Erro crítico ao iniciar login: ${e.message}`);
    }
  };

  const fetchGoogleUserProfile = async (accessToken: string) => {
      try {
          setIsLoading(true);
          const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: {
                  Authorization: `Bearer ${accessToken}`
              }
          });
          
          if (!res.ok) throw new Error('Falha ao obter dados do usuário');
          
          const googleUser = await res.json();
          
          // Determine User Type based on hardcoded list
          const isAdmin = ADMIN_EMAILS.includes(googleUser.email);
          
          const appUser: AppUser = {
              uid: googleUser.sub,
              displayName: googleUser.name,
              email: googleUser.email,
              photoURL: googleUser.picture,
              type: isAdmin ? 'admin' : 'user'
          };

          // Save Session
          setUser(appUser);
          localStorage.setItem('previsao_user', JSON.stringify(appUser));
          console.log("Login realizado com sucesso para:", appUser.email);

      } catch (error) {
          console.error("Erro no login Google API:", error);
          alert("Erro ao conectar com o Google para buscar perfil. Verifique sua conexão.");
      } finally {
          setIsLoading(false);
      }
  };

  const updateUsername = (name: string) => {
    if (user) {
        const updated = { ...user, displayName: name };
        setUser(updated);
        localStorage.setItem('previsao_user', JSON.stringify(updated));
    }
  }

  const logout = () => {
    if (typeof google !== 'undefined' && user?.email) {
        try {
            google.accounts.id.disableAutoSelect();
        } catch (e) {
            // Ignore
        }
    }
    
    setUser(null);
    localStorage.removeItem('previsao_user');
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(ACCESS_TOKEN_EXPIRY_KEY);
  };

  const getAccessToken = (): Promise<string | null> => {
    return new Promise((resolve) => {
      const token = getStoredToken();
      if (token) {
        resolve(token);
        return;
      }
      if (typeof google === 'undefined' || !user) {
        resolve(null);
        return;
      }
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.appdata',
          callback: (tokenResponse: any) => {
            if (tokenResponse?.access_token) {
              setAccessTokenRef(tokenResponse.access_token, tokenResponse.expires_in || 3600);
              resolve(tokenResponse.access_token);
            } else {
              resolve(null);
            }
          },
          error_callback: () => resolve(null),
        });
        client.requestAccessToken({ prompt: 'none' });
      } catch {
        resolve(null);
      }
    });
  };

  return (
    <AuthContext.Provider value={{ user, loginWithGoogle, updateUsername, logout, isLoading, getAccessToken }}>
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