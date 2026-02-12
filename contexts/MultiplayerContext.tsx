'use client';
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
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
  // REMOVED P2P SPECIFIC PROPS
  // downloadProgress, requestEventData, playerPings, myPing
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
  
  const createLobby = async (difficulty: PrevisaoDifficulty): Promise<string> => {
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
  };

  const joinLobby = async (code: string): Promise<boolean> => {
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
  };
  
  const leaveLobby = async () => {
    if (!user || !lobby || !db) return;

    const lobbyRef = doc(db, 'lobbies', lobby.code);
    
    // Stop listening to updates
    lobbyUnsubscribe.current?.();
    chatUnsubscribe.current?.();
    setLobby(null);
    setChatMessages([]);
    
    if (lobby.hostId === user.uid) {
      // Host leaves, delete the lobby for everyone
      await deleteDoc(lobbyRef);
    } else {
      // Player leaves, remove them from the players array
      const playerToRemove = lobby.players.find(p => p.uid === user.uid);
      if (playerToRemove) {
        await updateDoc(lobbyRef, {
          players: arrayRemove(playerToRemove)
        });
      }
    }
    router.push('/');
  };

  const startGame = async (eventId: string) => {
      if (!lobby || !db || lobby.hostId !== user?.uid) return;
      
      const lobbyRef = doc(db, 'lobbies', lobby.code);
      await updateDoc(lobbyRef, {
          status: 'loading',
          currentEventId: eventId,
          loadingStartTime: serverTimestamp(),
          roundEndTime: null,
          roundsPlayed: (lobby.roundsPlayed || 0) + 1,
          // Reset players for new round
          players: lobby.players.map(p => ({
              ...p,
              hasSubmitted: false,
              lastRoundScore: 0,
              lastRoundDistance: 0,
          }))
      });
  };

  const submitRoundScore = async (score: number, distance: number, streak: number) => {
      if (!user || !lobby || !db) return;
      const lobbyRef = doc(db, 'lobbies', lobby.code);
      const playerIndex = lobby.players.findIndex(p => p.uid === user.uid);
      if (playerIndex === -1) return;

      const updatedPlayers = [...lobby.players];
      const player = { ...updatedPlayers[playerIndex] };

      player.hasSubmitted = true;
      player.lastRoundScore = score;
      player.lastRoundDistance = distance;
      player.totalScore += score;
      player.streakCount = streak;
      
      updatedPlayers[playerIndex] = player;

      await updateDoc(lobbyRef, { players: updatedPlayers });

      // If all players submitted, auto-advance to results for host
      if (updatedPlayers.every(p => p.hasSubmitted) && lobby.hostId === user.uid) {
           setTimeout(async () => {
                const currentLobbyState = await getDoc(lobbyRef);
                if(currentLobbyState.exists() && (currentLobbyState.data() as Lobby).status === 'playing') {
                     await updateDoc(lobbyRef, { status: 'round_results' });
                }
           }, 1000); // 1 sec delay
      }
  };

  const nextRound = async (eventId: string) => { await startGame(eventId); };

  const triggerForceFinish = async () => {
      if (!lobby || !db || lobby.hostId !== user?.uid) return;
      const lobbyRef = doc(db, 'lobbies', lobby.code);
      await updateDoc(lobbyRef, { roundEndTime: Date.now() + 15000 });
  };
  
  const forceEndRound = async () => {
      if (!lobby || !db || lobby.hostId !== user?.uid) return;
      const lobbyRef = doc(db, 'lobbies', lobby.code);
      const playersWithZeroScore = lobby.players.map(p => {
          if (!p.hasSubmitted) {
              return { ...p, hasSubmitted: true, lastRoundScore: 0, lastRoundDistance: 99999 };
          }
          return p;
      });
      await updateDoc(lobbyRef, { players: playersWithZeroScore, status: 'round_results' });
  };

  const endMatch = async () => {
      if (!lobby || !db || lobby.hostId !== user?.uid) return;
      const lobbyRef = doc(db, 'lobbies', lobby.code);
      await updateDoc(lobbyRef, { status: 'finished' });
  };

  const sendInvite = async (targetUid: string, lobbyCodeOverride?: string) => {
      if (!user || !db) return;
      const code = lobbyCodeOverride || lobby?.code;
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
  };

  const acceptInvite = async () => {
      if (!incomingInvite || !user || !db) return;
      const code = incomingInvite.lobbyCode;
      setIncomingInvite(null);
      await deleteDoc(doc(db, 'invites', user.uid));
      await joinLobby(code);
  };
  
  const declineInvite = async () => {
      if (!user || !db) return;
      setIncomingInvite(null);
      await deleteDoc(doc(db, 'invites', user.uid));
  };

  const sendChatMessage = async (text: string) => {
      if (!user || !lobby || !text.trim() || !db) return;
      const chatRef = collection(db, 'lobbies', lobby.code, 'messages');
      const message: Omit<ChatMessage, 'id'> = {
          senderId: user.uid,
          senderName: user.displayName,
          text: text.trim(),
          timestamp: Date.now()
      };
      await addDoc(chatRef, message);
  };

  const forceStartGame = async () => {
      if (lobby?.hostId === user?.uid && lobby?.status === 'loading' && db) {
          const lobbyRef = doc(db, 'lobbies', lobby.code);
          await updateDoc(lobbyRef, { status: 'playing' });
      }
  };

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
