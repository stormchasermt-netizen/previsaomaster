'use client';
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
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

// Define Message Protocol (simplified for Firestore)
type MPMessage =
  | { type: 'CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'INVITE'; lobbyCode: string; hostName: string };

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

  // Refs
  const lobbyUnsubscribe = useRef<() => void | undefined>();
  const chatUnsubscribe = useRef<() => void | undefined>();
  const inviteUnsubscribe = useRef<() => void | undefined>();
  
  // Create a ref to hold the latest lobby state to avoid stale closures in callbacks.
  const lobbyStateRef = useRef(lobby);
  useEffect(() => {
    lobbyStateRef.current = lobby;
  }, [lobby]);

  // Load recent players from local storage
  useEffect(() => {
    const stored = localStorage.getItem('previsao_recent_players');
    if (stored) setRecentPlayers(JSON.parse(stored));
  }, []);

  // Teardown listeners on unmount or user logout
  useEffect(() => {
    return () => {
      lobbyUnsubscribe.current?.();
      chatUnsubscribe.current?.();
      inviteUnsubscribe.current?.();
    };
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
      setCurrentEventData(null);
    }
  }, [lobby?.currentEventId]);

  // Add a player to the 'recent players' list in local storage
  const addToRecentPlayers = (player: { uid: string; displayName: string; photoURL?: string }) => {
    const current = JSON.parse(localStorage.getItem('previsao_recent_players') || '[]');
    const filtered = current.filter((p: any) => p.uid !== player.uid);
    const updated = [{ ...player, lastSeen: Date.now() }, ...filtered].slice(0, 10);
    localStorage.setItem('previsao_recent_players', JSON.stringify(updated));
    setRecentPlayers(updated);
  };
  
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
  }, [user, db, router]);

  const joinLobby = useCallback(async (code: string): Promise<boolean> => {
      if (!user || !db) return false;

      // Clean up any previous listeners before joining a new lobby
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
              // Also add host to recent players when joining
              const host = data.players.find(p => p.isHost);
              if (host) addToRecentPlayers(host);
          } else {
              addToast('A sala foi encerrada pelo host.', 'info');
              setLobby(null);
              router.push('/');
          }
      });
      
      // Attach listener to chat subcollection
      const chatRef = collection(db, 'lobbies', code, 'messages');
      const q = query(chatRef, orderBy('timestamp', 'asc'));
      chatUnsubscribe.current = onSnapshot(q, (snapshot) => {
          const messages = snapshot.docs.map(doc => doc.data() as ChatMessage);
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
          addToast('Você entrou na sala!', 'success');
      }

      router.push(`/lobby/${code}`);
      return true;
  }, [user, db, router, addToast]);
  
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
  }, [user, db, router]);

  const startGame = useCallback(async (eventId: string) => {
      const currentLobby = lobbyStateRef.current;
      if (!currentLobby || !db || currentLobby.hostId !== user?.uid) return;
      const now = Date.now();
      const lobbyRef = doc(db, 'lobbies', currentLobby.code);
      await updateDoc(lobbyRef, {
          status: 'loading',
          currentEventId: eventId,
          loadingStartTime: now,
          roundEndTime: null,
          roundsPlayed: (currentLobby.roundsPlayed || 0) + 1,
          players: currentLobby.players.map(p => ({
              ...p,
              hasSubmitted: false,
              lastRoundScore: 0,
              lastRoundDistance: 0,
          }))
      });
  }, [user, db]);

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
  }, [user, db, addToast]);

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
          addToast(e?.message || 'Erro ao iniciar timer. Tente "Finalizar Agora".', 'error');
      }
  }, [user, db, addToast]);
  
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
  }, [user, db, addToast]);

  const endMatch = useCallback(async () => {
      const currentLobby = lobbyStateRef.current;
      if (!currentLobby || !db || currentLobby.hostId !== user?.uid) return;
      const lobbyRef = doc(db, 'lobbies', currentLobby.code);
      await updateDoc(lobbyRef, { status: 'finished' });
  }, [user, db]);

  const sendInvite = useCallback(async (targetUid: string, lobbyCodeOverride?: string) => {
      const currentLobby = lobbyStateRef.current;
      if (!user || !db) return;
      const code = lobbyCodeOverride || currentLobby?.code;
      if (!code) {
          addToast('Crie ou entre em uma sala para poder convidar.', 'error');
          return;
      }
      const inviteRef = doc(db, 'invites', targetUid);
      await setDoc(inviteRef, {
          lobbyCode: code,
          hostName: user.displayName,
          createdAt: serverTimestamp()
      });
      addToast('Convite enviado!', 'success');
  }, [user, db, addToast]);

  const acceptInvite = useCallback(async () => {
      if (!incomingInvite || !user || !db) return;
      const code = incomingInvite.lobbyCode;
      setIncomingInvite(null);
      await deleteDoc(doc(db, 'invites', user.uid));
      await joinLobby(code);
  }, [incomingInvite, user, db, joinLobby]);
  
  const declineInvite = useCallback(async () => {
      if (!user || !db) return;
      setIncomingInvite(null);
      await deleteDoc(doc(db, 'invites', user.uid));
  }, [user, db]);

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
  }, [user, db]);

  const forceStartGame = useCallback(async () => {
      const currentLobby = lobbyStateRef.current;
      if (currentLobby?.hostId === user?.uid && currentLobby?.status === 'loading' && db) {
          const lobbyRef = doc(db, 'lobbies', currentLobby.code);
          await updateDoc(lobbyRef, { status: 'playing' });
      }
  }, [user, db]);

  return (
    <MultiplayerContext.Provider value={{
      lobby, currentEventData, isHost: lobby?.hostId === user?.uid,
      createLobby, joinLobby, leaveLobby, startGame, submitRoundScore,
      triggerForceFinish, forceEndRound, nextRound, endMatch,
      sendInvite, incomingInvite, acceptInvite, declineInvite, recentPlayers,
      chatMessages, sendChatMessage, forceStartGame
    }}>
      {children}
    </MultiplayerContext.Provider>
  );
}

export function useMultiplayer() {
  const context = useContext(MultiplayerContext);
  if (context === undefined) throw new Error('useMultiplayer must be used within a MultiplayerProvider');
  return context;
}
