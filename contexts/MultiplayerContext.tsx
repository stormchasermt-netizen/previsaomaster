'use client';
import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Lobby, LobbyPlayer, PrevisaoDifficulty, PrevisaoEvent, ChatMessage } from '@/lib/types';
import { useAuth } from './AuthContext';
import { useRouter } from 'next/navigation';
import { useToast } from './ToastContext';
import { mockStore } from '@/lib/store';
import { db } from '@/lib/firebase';
import {
  doc,
  setDoc,
  onSnapshot,
  updateDoc,
  arrayUnion,
  arrayRemove,
  collection,
  addDoc,
  query,
  orderBy,
  deleteDoc,
  serverTimestamp,
  getDoc,
  runTransaction,
} from 'firebase/firestore';

interface MultiplayerContextType {
  lobby: Lobby | null;
  currentEventData: PrevisaoEvent | null;
  isHost: boolean;
  createLobby: (difficulty: PrevisaoDifficulty) => Promise<string>;
  joinLobby: (code: string) => Promise<boolean>;
  leaveLobby: () => void;
  startGame: (eventId: string) => void;
  submitRoundScore: (score: number, distance: number, streak: number) => void;
  triggerForceFinish: () => void;
  forceEndRound: () => void;
  nextRound: (eventId: string) => void;
  endMatch: () => void;
  sendInvite: (targetUid: string, lobbyCodeOverride?: string) => Promise<void>;
  incomingInvite: { lobbyCode: string; hostName: string } | null;
  acceptInvite: () => void;
  declineInvite: () => void;
  recentPlayers: { uid: string; displayName: string; photoURL?: string, lastSeen: number }[];
  chatMessages: ChatMessage[];
  sendChatMessage: (text: string) => void;
  forceStartGame: () => void;
}

const MultiplayerContext = createContext<MultiplayerContextType | undefined>(undefined);

export function MultiplayerProvider({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();

  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [currentEventData, setCurrentEventData] = useState<PrevisaoEvent | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [incomingInvite, setIncomingInvite] = useState<{ lobbyCode: string; hostName: string } | null>(null);
  const [recentPlayers, setRecentPlayers] = useState<any[]>([]);

  // Refs for cleanup
  const lobbyUnsubscribe = useRef<() => void>();
  const chatUnsubscribe = useRef<() => void>();
  const inviteUnsubscribe = useRef<() => void>();
  
  // Ref for latest lobby state to use in stable callbacks
  const lobbyStateRef = useRef(lobby);
  useEffect(() => {
    lobbyStateRef.current = lobby;
  }, [lobby]);

  // Load recent players from local storage once
  useEffect(() => {
    const stored = localStorage.getItem('previsao_recent_players');
    if (stored) {
        try {
            setRecentPlayers(JSON.parse(stored));
        } catch (e) {
            console.error("Failed to parse recent players", e);
        }
    }
  }, []);

  // Listen for invites for the current user
  useEffect(() => {
    if (user && db) {
      const inviteRef = doc(db, 'invites', user.uid);
      inviteUnsubscribe.current = onSnapshot(inviteRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setIncomingInvite({ lobbyCode: data.lobbyCode, hostName: data.hostName });
        } else {
          setIncomingInvite(null);
        }
      });
    } else {
      inviteUnsubscribe.current?.();
    }
    return () => inviteUnsubscribe.current?.();
  }, [user]);

  // Sync current event data when lobby points to a new event
  useEffect(() => {
    if (lobby?.currentEventId) {
      if (currentEventData?.id !== lobby.currentEventId) {
        mockStore.getEventById(lobby.currentEventId).then(event => {
          if (event) setCurrentEventData(event);
        });
      }
    } else {
      if (currentEventData) setCurrentEventData(null);
    }
  }, [lobby?.currentEventId, currentEventData?.id]);

  const addToRecentPlayers = useCallback((player: { uid: string; displayName: string; photoURL?: string }) => {
    setRecentPlayers(prev => {
        const filtered = prev.filter((p: any) => p.uid !== player.uid);
        const updated = [{ ...player, lastSeen: Date.now() }, ...filtered].slice(0, 10);
        localStorage.setItem('previsao_recent_players', JSON.stringify(updated));
        return updated;
    });
  }, []);
  
  const createLobby = useCallback(async (difficulty: PrevisaoDifficulty): Promise<string> => {
      if (!user || !db) throw new Error("Usuário não logado ou DB não inicializado.");

      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const lobbyRef = doc(db, 'lobbies', code);

      const newLobby: Lobby = {
          code,
          hostId: user.uid,
          status: 'waiting',
          difficulty,
          players: [{
              uid: user.uid,
              displayName: user.displayName,
              photoURL: user.photoURL,
              isHost: true,
              totalScore: 0,
              lastRoundScore: 0,
              lastRoundDistance: 0,
              streakCount: 0,
              hasSubmitted: false
          }],
          currentEventId: null,
          roundEndTime: null,
          roundsPlayed: 0,
          createdAt: Date.now(),
      };

      await setDoc(lobbyRef, newLobby);
      router.push(`/lobby/${code}`);
      return code;
  }, [user, router]);

  const joinLobby = useCallback(async (code: string): Promise<boolean> => {
      if (!user || !db) return false;

      // Clean up previous listeners
      lobbyUnsubscribe.current?.();
      chatUnsubscribe.current?.();
      
      const lobbyRef = doc(db, 'lobbies', code);
      const lobbySnap = await getDoc(lobbyRef);

      if (!lobbySnap.exists()) {
          addToast('Sala não encontrada.', 'error');
          return false;
      }
      
      const lobbyData = lobbySnap.data() as Lobby;
      const isPlayerInLobby = lobbyData.players.some(p => p.uid === user.uid);

      if (lobbyData.players.length >= 20 && !isPlayerInLobby) {
          addToast('A sala está cheia.', 'error');
          return false;
      }
      if (lobbyData.status !== 'waiting' && !isPlayerInLobby) {
          addToast('A partida já começou.', 'error');
          return false;
      }

      // Attach listener to lobby
      lobbyUnsubscribe.current = onSnapshot(lobbyRef, (snapshot) => {
          if (snapshot.exists()) {
              const data = snapshot.data() as Lobby;
              setLobby(data);
          } else {
              addToast('A sala foi encerrada pelo host.', 'info');
              setLobby(null);
              router.push('/');
          }
      });
      
      // Attach listener to chat
      const chatRef = collection(db, 'lobbies', code, 'messages');
      const q = query(chatRef, orderBy('timestamp', 'asc'));
      chatUnsubscribe.current = onSnapshot(q, (snapshot) => {
          const messages = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ChatMessage));
          setChatMessages(messages);
      });
      
      // If not already in lobby, add the player
      if (!isPlayerInLobby) {
          const newPlayer: LobbyPlayer = {
              uid: user.uid,
              displayName: user.displayName,
              photoURL: user.photoURL,
              isHost: false,
              totalScore: 0,
              lastRoundScore: 0,
              lastRoundDistance: 0,
              streakCount: 0,
              hasSubmitted: false
          };
          await updateDoc(lobbyRef, {
              players: arrayUnion(newPlayer)
          });
          
          // Only add to recent players once on join
          const host = lobbyData.players.find(p => p.isHost);
          if (host) addToRecentPlayers(host);
          
          addToast('Você entrou na sala!', 'success');
      }

      return true;
  }, [user, addToast, addToRecentPlayers, router]);
  
  const leaveLobby = useCallback(async () => {
    const currentLobby = lobbyStateRef.current;
    if (!user || !currentLobby || !db) return;

    const lobbyRef = doc(db, 'lobbies', currentLobby.code);
    
    lobbyUnsubscribe.current?.();
    chatUnsubscribe.current?.();
    setLobby(null);
    setChatMessages([]);
    
    if (currentLobby.hostId === user.uid) {
      await deleteDoc(lobbyRef);
    } else {
      const playerToRemove = currentLobby.players.find(p => p.uid === user.uid);
      if (playerToRemove) {
        await updateDoc(lobbyRef, {
          players: arrayRemove(playerToRemove)
        });
      }
    }
    router.push('/');
  }, [user, router]);

  const startGame = useCallback(async (eventId: string) => {
      const currentLobby = lobbyStateRef.current;
      if (!currentLobby || !db || currentLobby.hostId !== user?.uid) return;
      
      const lobbyRef = doc(db, 'lobbies', currentLobby.code);
      await updateDoc(lobbyRef, {
          status: 'loading',
          currentEventId: eventId,
          loadingStartTime: serverTimestamp(),
          roundEndTime: null,
          roundsPlayed: (currentLobby.roundsPlayed || 0) + 1,
          players: currentLobby.players.map(p => ({
              ...p,
              hasSubmitted: false,
              lastRoundScore: 0,
              lastRoundDistance: 0,
          }))
      });
  }, [user]);

  const submitRoundScore = useCallback(async (score: number, distance: number, streak: number) => {
      const currentLobby = lobbyStateRef.current;
      if (!user || !currentLobby || !db) return;
      const lobbyRef = doc(db, 'lobbies', currentLobby.code);

      try {
          await runTransaction(db, async (transaction) => {
              const lobbySnap = await transaction.get(lobbyRef);
              if (!lobbySnap.exists()) return;
              const lobbyData = lobbySnap.data() as Lobby;
              const playerIndex = lobbyData.players.findIndex(p => p.uid === user!.uid);
              if (playerIndex === -1) return;

              const updatedPlayers = [...lobbyData.players];
              const player = { ...updatedPlayers[playerIndex] };
              player.hasSubmitted = true;
              player.lastRoundScore = score;
              player.lastRoundDistance = distance;
              player.totalScore = (player.totalScore || 0) + score;
              player.streakCount = streak;
              updatedPlayers[playerIndex] = player;

              const allSubmitted = updatedPlayers.every(p => p.hasSubmitted);
              if (allSubmitted) {
                  transaction.update(lobbyRef, { players: updatedPlayers, status: 'round_results' });
              } else {
                  transaction.update(lobbyRef, { players: updatedPlayers });
              }
          });
      } catch (e: any) {
          console.error('submitRoundScore error:', e);
          addToast(e?.message || 'Erro ao enviar pontuação.', 'error');
      }
  }, [user, addToast]);

  const nextRound = useCallback(async (eventId: string) => { 
      await startGame(eventId); 
  }, [startGame]);

  const triggerForceFinish = useCallback(async () => {
      const currentLobby = lobbyStateRef.current;
      if (!currentLobby || !db || currentLobby.hostId !== user?.uid) return;
      try {
          const lobbyRef = doc(db, 'lobbies', currentLobby.code);
          await updateDoc(lobbyRef, { roundEndTime: Date.now() + 15000 });
      } catch (e: any) {
          console.error('triggerForceFinish error:', e);
          addToast(e?.message || 'Erro ao iniciar timer.', 'error');
      }
  }, [user, addToast]);
  
  const forceEndRound = useCallback(async () => {
      const currentLobby = lobbyStateRef.current;
      if (!currentLobby || !db || currentLobby.hostId !== user?.uid) return;
      try {
          const lobbyRef = doc(db, 'lobbies', currentLobby.code);
          const playersWithZeroScore = currentLobby.players.map((p: LobbyPlayer) => {
              if (!p.hasSubmitted) {
                  return { ...p, hasSubmitted: true, lastRoundScore: 0, lastRoundDistance: 99999 };
              }
              return p;
          });
          await updateDoc(lobbyRef, { players: playersWithZeroScore, status: 'round_results', roundEndTime: null });
      } catch (e: any) {
          console.error('forceEndRound error:', e);
          addToast(e?.message || 'Erro ao finalizar rodada.', 'error');
      }
  }, [user, addToast]);

  const endMatch = useCallback(async () => {
      const currentLobby = lobbyStateRef.current;
      if (!currentLobby || !db || currentLobby.hostId !== user?.uid) return;
      const lobbyRef = doc(db, 'lobbies', currentLobby.code);
      await updateDoc(lobbyRef, { status: 'finished' });
  }, [user]);

  const sendInvite = useCallback(async (targetUid: string, lobbyCodeOverride?: string) => {
      const currentLobby = lobbyStateRef.current;
      if (!user || !db) return;
      const code = lobbyCodeOverride || currentLobby?.code;
      if (!code) {
          addToast('Crie ou entre em uma sala para convidar.', 'error');
          return;
      }
      const inviteRef = doc(db, 'invites', targetUid);
      await setDoc(inviteRef, {
          lobbyCode: code,
          hostName: user.displayName,
          createdAt: serverTimestamp()
      });
      addToast('Convite enviado!', 'success');
  }, [user, addToast]);

  const acceptInvite = useCallback(async () => {
      if (!incomingInvite || !user || !db) return;
      const code = incomingInvite.lobbyCode;
      setIncomingInvite(null);
      await deleteDoc(doc(db, 'invites', user.uid));
      await joinLobby(code);
  }, [incomingInvite, user, joinLobby]);
  
  const declineInvite = useCallback(async () => {
      if (!user || !db) return;
      setIncomingInvite(null);
      await deleteDoc(doc(db, 'invites', user.uid));
  }, [user]);

  const sendChatMessage = useCallback(async (text: string) => {
      const currentLobby = lobbyStateRef.current;
      if (!user || !currentLobby || !text.trim() || !db) return;
      const chatRef = collection(db, 'lobbies', currentLobby.code, 'messages');
      const message: Omit<ChatMessage, 'id'> = {
          senderId: user.uid,
          senderName: user.displayName,
          text: text.trim(),
          timestamp: Date.now()
      };
      await addDoc(chatRef, message);
  }, [user]);

  const forceStartGame = useCallback(async () => {
      const currentLobby = lobbyStateRef.current;
      if (currentLobby?.hostId === user?.uid && currentLobby?.status === 'loading' && db) {
          const lobbyRef = doc(db, 'lobbies', currentLobby.code);
          await updateDoc(lobbyRef, { status: 'playing' });
      }
  }, [user]);

  // Memoized context value to prevent unnecessary re-renders of consuming components
  const contextValue = useMemo(() => ({
    lobby, currentEventData, isHost: lobby?.hostId === user?.uid,
    createLobby, joinLobby, leaveLobby, startGame, submitRoundScore,
    triggerForceFinish, forceEndRound, nextRound, endMatch,
    sendInvite, incomingInvite, acceptInvite, declineInvite, recentPlayers,
    chatMessages, sendChatMessage, forceStartGame
  }), [
    lobby, currentEventData, user?.uid, recentPlayers, chatMessages, incomingInvite,
    createLobby, joinLobby, leaveLobby, startGame, submitRoundScore,
    triggerForceFinish, forceEndRound, nextRound, endMatch,
    sendInvite, acceptInvite, declineInvite, sendChatMessage, forceStartGame
  ]);

  return (
    <MultiplayerContext.Provider value={contextValue}>
      {children}
    </MultiplayerContext.Provider>
  );
}

export function useMultiplayer() {
  const context = useContext(MultiplayerContext);
  if (context === undefined) throw new Error('useMultiplayer must be used within a MultiplayerProvider');
  return context;
}
