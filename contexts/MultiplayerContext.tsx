'use client';
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Lobby, LobbyPlayer, PrevisaoDifficulty, PrevisaoEvent, ChatMessage } from '@/lib/types';
import { useAuth } from './AuthContext';
import { useRouter } from 'next/navigation';
import { Peer, DataConnection } from 'peerjs';
import { useToast } from './ToastContext';
import { mockStore } from '@/lib/store';

// Define Message Protocol
type MPMessage = 
  | { type: 'SYNC_LOBBY'; lobby: Lobby }
  | { type: 'SYNC_EVENT_DATA'; event: PrevisaoEvent } 
  | { type: 'DATA_CHUNK'; dataType: 'EVENT_JSON' | 'LAYER_IMAGE'; meta?: any; chunkId: string; index: number; total: number; data: string }
  | { type: 'REPORT_PROGRESS'; uid: string; progress: number } // Client -> Host
  | { type: 'JOIN_REQUEST'; user: { uid: string; displayName: string; photoURL?: string } }
  | { type: 'REQUEST_EVENT_DATA'; uid: string }
  | { type: 'LEAVE'; uid: string }
  | { type: 'SUBMIT_SCORE'; uid: string; score: number; distance: number; streak: number }
  | { type: 'HOST_ACTION'; action: string; payload?: any }
  | { type: 'ERROR'; message: string }
  | { type: 'INVITE'; lobbyCode: string; hostName: string } // Invite protocol
  | { type: 'CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'PING'; sentAt: number }
  | { type: 'PONG'; sentAt: number };

interface MultiplayerContextType {
  lobby: Lobby | null;
  currentEventData: PrevisaoEvent | null;
  downloadProgress: number; // 0 to 100
  isHost: boolean;
  createLobby: (difficulty: PrevisaoDifficulty) => Promise<string>;
  joinLobby: (code: string) => Promise<boolean>;
  leaveLobby: () => void;
  startGame: (eventId: string) => void;
  requestEventData: () => void;
  submitRoundScore: (score: number, distance: number, streak: number) => void;
  triggerForceFinish: () => void;
  forceEndRound: () => void;
  nextRound: (eventId: string) => void;
  endMatch: () => void;
  // Invite System
  sendInvite: (targetUid: string, lobbyCodeOverride?: string) => Promise<void>;
  incomingInvite: { lobbyCode: string; hostName: string } | null;
  acceptInvite: () => void;
  declineInvite: () => void;
  recentPlayers: { uid: string; displayName: string; photoURL?: string, lastSeen: number }[];
  // Chat System
  chatMessages: ChatMessage[];
  sendChatMessage: (text: string) => void;
  forceStartGame: () => void;
  playerPings: Record<string, number>; // uid -> ping ms (host only)
  myPing: number | null; // Client's own ping to host
}

const MultiplayerContext = createContext<MultiplayerContextType | undefined>(undefined);

// PeerJS Server Configuration
// IMPORTANT: After deploying your own PeerJS server, update the host below.
// See peer-server/README.md for deployment instructions.
const PEER_SERVER_HOST = 'peerjs-server-275898169040.us-east1.run.app';
const PEER_SERVER_PORT = 443;
const PEER_SERVER_SECURE = true;
const PEER_SERVER_PATH = '/peerjs';
const PEER_SERVER_KEY = 'previsao';

const PEER_CONFIG: any = {
    host: PEER_SERVER_HOST,
    port: PEER_SERVER_PORT,
    secure: PEER_SERVER_SECURE,
    path: PEER_SERVER_PATH,
    key: PEER_SERVER_KEY,
    debug: 1, // 1 = errors only (helps debugging without flooding console)
    config: {
        iceServers: [
            // STUN Servers (free, for discovering public IP)
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            
            // TURN Servers - UDP (works on most Wi-Fi networks)
            {
                urls: 'turn:staticauth.openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject',
            },
            {
                urls: 'turn:staticauth.openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject',
            },
            
            // TURN Servers - TCP (CRITICAL for mobile 4G/LTE networks that block UDP)
            {
                urls: 'turn:staticauth.openrelay.metered.ca:80?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject',
            },
            {
                urls: 'turn:staticauth.openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject',
            },
            
            // TURNS (TLS) - works even on very restrictive networks
            {
                urls: 'turns:staticauth.openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject',
            },

            // Backup TURN servers (alternative free relay)
            {
                urls: 'turn:relay1.expressturn.com:443',
                username: 'efKXI3NJRZMSDO5RCM',
                credential: 'xQPR7eeqpSMSS6xW',
            },
            {
                urls: 'turn:relay1.expressturn.com:443?transport=tcp',
                username: 'efKXI3NJRZMSDO5RCM',
                credential: 'xQPR7eeqpSMSS6xW',
            },
        ],
        // ICE transport policy: try "all" first (direct + relay), fallback later if needed
        iceTransportPolicy: 'all',
        // Pre-allocate ICE candidates for faster connection (helps mobile)
        iceCandidatePoolSize: 10,
    }
};

const CHUNK_SIZE = 16384; // 16KB

export function MultiplayerProvider({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();

  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [currentEventData, setCurrentEventData] = useState<PrevisaoEvent | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [playerPings, setPlayerPings] = useState<Record<string, number>>({});
  const [myPing, setMyPing] = useState<number | null>(null);
  
  // Peers
  const [peer, setPeer] = useState<Peer | null>(null); // Lobby Peer (Host or Client)
  const [personalPeer, setPersonalPeer] = useState<Peer | null>(null); // For receiving invites on Home
  
  // Refs
  const lobbyRef = useRef<Lobby | null>(null);
  const eventDataRef = useRef<PrevisaoEvent | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]);
  const hostConnRef = useRef<DataConnection | null>(null);
  const connToUidRef = useRef<Map<DataConnection, string>>(new Map());
  const chunksBuffer = useRef<Map<string, string[]>>(new Map());
  
  // Timers
  const loadingStartTimeRef = useRef<number>(0);

  // Invite State
  const [incomingInvite, setIncomingInvite] = useState<{ lobbyCode: string; hostName: string } | null>(null);
  const [recentPlayers, setRecentPlayers] = useState<any[]>([]);

  useEffect(() => { lobbyRef.current = lobby; }, [lobby]);
  useEffect(() => { eventDataRef.current = currentEventData; }, [currentEventData]);
  
  useEffect(() => { if (!lobby) { setPlayerPings({}); setMyPing(null); } }, [lobby]);
  
  // Clear chat on lobby exit
  useEffect(() => { if (!lobby) setChatMessages([]); }, [lobby]);

  // Load recent players
  useEffect(() => {
      const stored = localStorage.getItem('previsao_recent_players');
      if (stored) setRecentPlayers(JSON.parse(stored));
  }, []);

  // --- PERSONAL PEER (Global Presence for Invites) ---
  // Only active when NOT in a lobby and User is logged in
  useEffect(() => {
      if (!user || lobby) {
          if (personalPeer) {
              personalPeer.destroy();
              setPersonalPeer(null);
          }
          return;
      }

      // Create Personal Peer
      const myPersonalId = `player_${user.uid}`;
      const pPeer = new Peer(myPersonalId, PEER_CONFIG);

      pPeer.on('open', (id) => {
          console.log("Global Presence Active:", id);
      });

      pPeer.on('connection', (conn) => {
          conn.on('data', (data: any) => {
              if (data.type === 'INVITE') {
                  setIncomingInvite({ lobbyCode: data.lobbyCode, hostName: data.hostName });
              }
          });
      });

      pPeer.on('error', (err: any) => {
           // Ignore ID taken errors (tab duplication) - it means another tab is open
           if (err.type === 'unavailable-id') {
               console.log("Personal Peer ID taken (another tab open). Invites disabled for this tab.");
               return; 
           }
           console.warn("Personal Peer Error", err);
      });

      setPersonalPeer(pPeer);

      return () => {
          pPeer.destroy();
      };
  }, [user, lobby]); // Re-run if user logs in or lobby state changes

  const broadcastLobby = (lobbyToBroadcast: Lobby) => {
      const msg: MPMessage = { type: 'SYNC_LOBBY', lobby: lobbyToBroadcast };
      connectionsRef.current.forEach(conn => {
          if (conn.open) {
              try { conn.send(msg); } catch(e) { console.error("Broadcast Error", e); }
          }
      });
  };

  // --- HOST HEARTBEAT & LOADING SYNC ---
  useEffect(() => {
      if (!lobby || lobby.hostId !== user?.uid) return;
      const interval = setInterval(() => {
          const currentLobby = lobbyRef.current;
          if (currentLobby && connectionsRef.current.length > 0) {
              broadcastLobby(currentLobby);
          }
          
          // Check if everyone finished loading
          if (currentLobby?.status === 'loading') {
              const allLoaded = currentLobby.players.every(p => (p.loadProgress || 0) >= 100);
              
              // 10 SECONDS DELAY: Ensure we wait at least 10s for data propagation
              const startT = currentLobby.loadingStartTime || loadingStartTimeRef.current;
              const timeElapsed = Date.now() - startT;
              const minTimePassed = timeElapsed > 10000;
              
              if (allLoaded && minTimePassed) {
                  // Transition to Playing
                  console.log("All players loaded and buffer time passed. Starting game!");
                  updateHostState(l => { l.status = 'playing'; });
              } else if (minTimePassed && timeElapsed > 20000) {
                  // AUTO-TIMEOUT: After 20s, start even if not everyone loaded (avoids infinite wait)
                  console.log("Loading timeout (20s) - starting game without players who didn't load.");
                  updateHostState(l => { l.status = 'playing'; });
              }
          }
      }, 1000); 
      return () => clearInterval(interval);
  }, [lobby?.hostId, user?.uid, lobby?.status]); 

  // --- HOST PING ---
  useEffect(() => {
      if (!lobby || lobby.hostId !== user?.uid) return;
      const interval = setInterval(() => {
          const sentAt = Date.now();
          connectionsRef.current.forEach(conn => {
              if (conn.open && connToUidRef.current.has(conn)) {
                  try { conn.send({ type: 'PING', sentAt }); } catch(e) {}
              }
          });
      }, 2500);
      return () => clearInterval(interval);
  }, [lobby?.hostId, user?.uid]);

  // --- CLIENT PING (measure own latency to host) ---
  useEffect(() => {
      if (!lobby || lobby.hostId === user?.uid || !hostConnRef.current) return;
      const interval = setInterval(() => {
          if (hostConnRef.current?.open) {
              try { hostConnRef.current.send({ type: 'PING', sentAt: Date.now() }); } catch(e) {}
          }
      }, 2500);
      return () => clearInterval(interval);
  }, [lobby?.hostId, user?.uid]);

  // --- HOST AUTO END ROUND ---
  useEffect(() => {
      if (!lobby || lobby.hostId !== user?.uid || lobby.status !== 'playing') return;
      const allSubmitted = lobby.players.every(p => p.hasSubmitted);
      if (allSubmitted && lobby.players.length > 0) {
          const timer = setTimeout(() => {
              if (lobbyRef.current?.status === 'playing') {
                   updateHostState(l => l.status = 'round_results');
              }
          }, 1000);
          return () => clearTimeout(timer);
      }
  }, [lobby, user?.uid]);

  // --- HOST ACTIONS ---

  const createLobby = (difficulty: PrevisaoDifficulty): Promise<string> => {
    return new Promise((resolve, reject) => {
        if (!user) { reject("User not logged in"); return; }
        if (peer) peer.destroy();

        const tryCreate = () => {
             const code = Math.random().toString(36).substring(2, 8).toUpperCase();
             const newPeer = new Peer(code, PEER_CONFIG);
             
             // CRITICAL: Track if initial open already happened.
             // peer.reconnect() fires 'open' again on the SAME peer object.
             // Without this flag, the lobby creation handler would run AGAIN on reconnect,
             // resetting the lobby state, losing all players, and navigating away from the game.
             let initialOpenHandled = false;
             let reconnectAttempts = 0;
             const MAX_RECONNECT = 5;

             // Handle incoming connections (works for both initial and reconnected state)
             newPeer.on('connection', (conn: DataConnection) => {
                 conn.on('open', () => {
                    connectionsRef.current = connectionsRef.current.filter(c => c.open);
                    connectionsRef.current.push(conn);
                    if (lobbyRef.current) {
                        conn.send({ type: 'SYNC_LOBBY', lobby: lobbyRef.current });
                    }
                 });
                 conn.on('data', (data: any) => {
                   handleHostMessage(data, conn);
                 });
                 conn.on('close', () => {
                   connectionsRef.current = connectionsRef.current.filter(c => c !== conn);
                   connToUidRef.current.delete(conn);
                 });
             });

             newPeer.on('open', (id) => {
                  if (!initialOpenHandled) {
                      // FIRST TIME: Create the lobby
                      initialOpenHandled = true;
                      console.log('Lobby Created:', id);
                      const newLobby: Lobby = {
                        code: id,
                        hostId: user.uid,
                        status: 'waiting',
                        difficulty,
                        players: [{
                          uid: user.uid,
                          displayName: user.displayName,
                          photoURL: user.photoURL,
                          isHost: true,
                          isReady: true,
                          hasSubmitted: false,
                          totalScore: 0,
                          lastRoundScore: 0,
                          lastRoundDistance: 0,
                          streakCount: 0,
                          loadProgress: 100
                        }],
                        currentEventId: null,
                        roundEndTime: null,
                        roundsPlayed: 0,
                        createdAt: Date.now()
                      };

                      setLobby(newLobby);
                      setPeer(newPeer);
                      router.push(`/lobby/${id}`);
                      resolve(id);
                  } else {
                      // RECONNECT: peer.reconnect() succeeded — just log, don't touch lobby state
                      console.log('Host reconnected to signaling server after', reconnectAttempts, 'attempts. Lobby preserved.');
                      addToast('Reconectado ao servidor!', 'success');
                      reconnectAttempts = 0;
                  }
             });

             // HOST RECONNECTION: if PeerJS signaling connection drops, use peer.reconnect()
             // This preserves ALL existing DataConnections (players stay connected)
             newPeer.on('disconnected', () => {
                 if (!initialOpenHandled) return; // Not yet created, ignore
                 if (!lobbyRef.current || newPeer.destroyed) return;
                 
                 reconnectAttempts++;
                 if (reconnectAttempts > MAX_RECONNECT) {
                     console.error('Host: Max reconnect attempts reached. Stopping retries.');
                     addToast('Conexão com o servidor P2P perdida. Jogadores conectados diretamente continuam na partida.', 'error');
                     return;
                 }
                 
                 console.warn(`Host PeerJS disconnected. Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT}...`);
                 
                 // Exponential backoff: 2s, 4s, 8s, 16s, 16s
                 const delay = Math.min(2000 * Math.pow(2, reconnectAttempts - 1), 16000);
                 setTimeout(() => {
                     if (!lobbyRef.current || newPeer.destroyed) return;
                     try {
                         newPeer.reconnect();
                     } catch(e) { 
                         console.error('Reconnect call failed:', e); 
                     }
                 }, delay);
             });

             newPeer.on('error', (err: any) => {
                  if (!initialOpenHandled) {
                      // During INITIAL creation: if ID is taken, try a new random code
                      if (err.type === 'unavailable-id') {
                          tryCreate();
                      } else {
                          addToast('Erro ao criar sala P2P: ' + err.type, 'error');
                      }
                  } else {
                      // AFTER creation (during game): just log, don't take destructive action
                      console.error('Host Peer Error:', err.type);
                      if (err.type === 'unavailable-id') {
                          console.log('Host ID conflict during reconnect. Server will clean up.');
                      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
                          console.warn('Host network error. Will auto-reconnect via disconnected handler.');
                      }
                  }
             });
        };
        
        tryCreate();
    });
  };

  const handleHostMessage = (msg: MPMessage, conn: DataConnection) => {
      const currentLobby = lobbyRef.current;
      const currentEvent = eventDataRef.current;
      if (!currentLobby) return;

      if (msg.type === 'JOIN_REQUEST') {
          if (currentLobby.players.length >= 20) {
              conn.send({ type: 'ERROR', message: 'A sala está cheia.' });
              setTimeout(() => conn.close(), 500);
              return;
          }

          const exists = currentLobby.players.find(p => p.uid === msg.user.uid);
          // Block new joins after game has started; only allow reconnects
          if (!exists && currentLobby.status !== 'waiting') {
              conn.send({ type: 'ERROR', message: 'A partida já começou. Entrada permitida apenas antes do início.' });
              setTimeout(() => conn.close(), 500);
              return;
          }
          connToUidRef.current.set(conn, msg.user.uid);
          let updatedLobby = { ...currentLobby };
          
          if (!exists) {
              updatedLobby.players.push({
                  uid: msg.user.uid,
                  displayName: msg.user.displayName,
                  photoURL: msg.user.photoURL,
                  isHost: false,
                  isReady: true,
                  hasSubmitted: false,
                  totalScore: 0,
                  lastRoundScore: 0,
                  lastRoundDistance: 0,
                  streakCount: 0,
                  loadProgress: 0
              });
              setLobby(updatedLobby);
              broadcastLobby(updatedLobby);
              
              // If game is in loading/playing, send data
              if ((updatedLobby.status === 'playing' || updatedLobby.status === 'loading') && currentEvent) {
                  transmitEventToPeer(conn, currentEvent);
              }
              
              addToast(`${msg.user.displayName} entrou!`, 'info');
              addToRecentPlayers(msg.user);
          } else {
              // Reconnect
              conn.send({ type: 'SYNC_LOBBY', lobby: updatedLobby });
              if ((updatedLobby.status === 'playing' || updatedLobby.status === 'loading') && currentEvent) {
                  transmitEventToPeer(conn, currentEvent);
              }
              broadcastLobby(updatedLobby);
          }
      }

      if (msg.type === 'REPORT_PROGRESS') {
          updateHostState(l => {
              const p = l.players.find(pl => pl.uid === msg.uid);
              if (p) {
                  p.loadProgress = msg.progress;
              }
          });
      }

      if (msg.type === 'REQUEST_EVENT_DATA') {
          if (currentEvent) {
              transmitEventToPeer(conn, currentEvent);
          }
      }

      if (msg.type === 'SUBMIT_SCORE') {
          const updatedLobby = { ...currentLobby };
          updatedLobby.players = updatedLobby.players.map(p => ({...p}));
          const player = updatedLobby.players.find(p => p.uid === msg.uid);
          if (player) {
              player.hasSubmitted = true;
              player.lastRoundScore = msg.score;
              player.lastRoundDistance = msg.distance;
              player.totalScore += msg.score;
              player.streakCount = msg.streak;
              setLobby(updatedLobby);
              broadcastLobby(updatedLobby);
          }
      }
      
      if (msg.type === 'LEAVE') {
           const updatedLobby = { ...currentLobby };
           updatedLobby.players = updatedLobby.players.filter(p => p.uid !== msg.uid);
           setLobby(updatedLobby);
           broadcastLobby(updatedLobby);
      }

      if (msg.type === 'PING') {
          conn.send({ type: 'PONG', sentAt: msg.sentAt });
          return;
      }
      if (msg.type === 'PONG') {
          const uid = connToUidRef.current.get(conn);
          if (uid !== undefined) {
              const rtt = Math.round(Date.now() - msg.sentAt);
              setPlayerPings(prev => ({ ...prev, [uid]: rtt }));
          }
          return;
      }
      if (msg.type === 'CHAT_MESSAGE') {
          setChatMessages(prev => {
              if (prev.some(m => m.id === msg.message.id)) return prev;
              return [...prev, msg.message];
          });
          // Host Relay to others
          connectionsRef.current.forEach(c => {
              if (c.open && c !== conn) { // Don't echo back to sender (dedup handles it but saves bandwidth)
                  try { c.send(msg); } catch(e) {}
              }
          });
      }
  };

  // --- CHAT SYSTEM ---
  const sendChatMessage = (text: string) => {
      if (!user || !text.trim()) return;
      
      const msg: ChatMessage = {
          id: Date.now().toString() + Math.random().toString().substring(2, 5),
          senderId: user.uid,
          senderName: user.displayName,
          text: text.trim(),
          timestamp: Date.now()
      };

      // Optimistic Update
      setChatMessages(prev => [...prev, msg]);

      // Send
      if (lobby?.hostId === user.uid) {
          // Host Broadcast
          const payload: MPMessage = { type: 'CHAT_MESSAGE', message: msg };
          connectionsRef.current.forEach(conn => { if(conn.open) conn.send(payload); });
      } else {
          // Client Send to Host
          if (hostConnRef.current) {
              hostConnRef.current.send({ type: 'CHAT_MESSAGE', message: msg });
          }
      }
  };

  const forceStartGame = () => {
      if (lobbyRef.current?.hostId === user?.uid && lobbyRef.current?.status === 'loading') {
          updateHostState(l => { l.status = 'playing'; });
      }
  };

  // --- INVITE SYSTEM ---

  const sendInvite = async (targetUid: string, lobbyCodeOverride?: string) => {
      const code = lobbyCodeOverride || lobby?.code;
      if (!code || !user) {
          console.warn("Invite failed: No lobby code available");
          return;
      }
      
      const tempPeer = new Peer(); // Disposable peer for sending
      tempPeer.on('open', () => {
          const conn = tempPeer.connect(`player_${targetUid}`);
          conn.on('open', () => {
              conn.send({ 
                  type: 'INVITE', 
                  lobbyCode: code, 
                  hostName: user.displayName 
              });
              addToast('Convite enviado!', 'success');
              setTimeout(() => { conn.close(); tempPeer.destroy(); }, 2000);
          });
          conn.on('error', () => {
              addToast('Não foi possível conectar ao jogador. Ele pode estar offline ou em partida.', 'error');
              tempPeer.destroy();
          });
      });
  };

  const acceptInvite = () => {
      if (incomingInvite) {
          joinLobby(incomingInvite.lobbyCode);
          setIncomingInvite(null);
      }
  };

  const declineInvite = () => {
      setIncomingInvite(null);
  };

  const addToRecentPlayers = (player: { uid: string; displayName: string; photoURL?: string }) => {
      const current = JSON.parse(localStorage.getItem('previsao_recent_players') || '[]');
      // Remove existing entry for this user
      const filtered = current.filter((p: any) => p.uid !== player.uid);
      // Add to top
      const updated = [{ ...player, lastSeen: Date.now() }, ...filtered].slice(0, 10);
      localStorage.setItem('previsao_recent_players', JSON.stringify(updated));
      setRecentPlayers(updated);
  };

  // --- DATA TRANSMISSION ---

  const sendPayloadInChunks = async (conns: DataConnection[], payload: string, dataType: 'EVENT_JSON' | 'LAYER_IMAGE', meta?: any) => {
      const chunkId = Date.now().toString() + Math.random().toString().substring(2,5);
      const totalChunks = Math.ceil(payload.length / CHUNK_SIZE);
      
      for (let i = 0; i < totalChunks; i++) {
          const chunk = payload.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          const msg: MPMessage = { type: 'DATA_CHUNK', dataType, chunkId, index: i, total: totalChunks, data: chunk, meta };
          for (const conn of conns) { if (conn.open) try { conn.send(msg); } catch(e) {} }
          if (i % 10 === 0) await new Promise(r => setTimeout(r, 20));
      }
  };

  const transmitEventToPeer = async (conn: DataConnection, fullEvent: PrevisaoEvent) => {
      const skeletonEvent = { ...fullEvent, layers: fullEvent.layers.map(l => ({...l, imageUrl: ''})) };
      await sendPayloadInChunks([conn], JSON.stringify(skeletonEvent), 'EVENT_JSON');
      for (const layer of fullEvent.layers) {
          if (layer.imageUrl && layer.imageUrl.length > 50) {
              await sendPayloadInChunks([conn], layer.imageUrl, 'LAYER_IMAGE', { layerId: layer.id, time: layer.time });
          }
      }
  };

  const broadcastFullEvent = async (fullEvent: PrevisaoEvent) => {
      const skeletonEvent = { ...fullEvent, layers: fullEvent.layers.map(l => ({...l, imageUrl: ''})) };
      const activeConns = connectionsRef.current.filter(c => c.open);
      await sendPayloadInChunks(activeConns, JSON.stringify(skeletonEvent), 'EVENT_JSON');
      for (const layer of fullEvent.layers) {
          if (layer.imageUrl && layer.imageUrl.length > 50) {
              await sendPayloadInChunks(activeConns, layer.imageUrl, 'LAYER_IMAGE', { layerId: layer.id, time: layer.time });
          }
      }
  };

  const handleIncomingChunk = (msg: any) => {
      const { chunkId, index, total, data, dataType, meta } = msg;
      
      if (!chunksBuffer.current.has(chunkId)) chunksBuffer.current.set(chunkId, new Array(total).fill(null));
      const buffer = chunksBuffer.current.get(chunkId)!;
      buffer[index] = data;
      
      // Calculate simplistic total progress (visual approximation)
      const percent = Math.round(((index + 1) / total) * 100);
      setDownloadProgress(percent);

      if (buffer.every(c => c !== null)) {
          const fullString = buffer.join('');
          chunksBuffer.current.delete(chunkId);

          if (dataType === 'EVENT_JSON') {
              try {
                  const event = JSON.parse(fullString);
                  setCurrentEventData(event);
                  // Notify Host of progress
                  if (hostConnRef.current && user) {
                      hostConnRef.current.send({ type: 'REPORT_PROGRESS', uid: user.uid, progress: 50 }); // 50% = Metadata loaded
                  }
              } catch (e) { console.error("JSON Parse Error", e); }
          } else if (dataType === 'LAYER_IMAGE') {
              setCurrentEventData(prev => {
                  if (!prev) return null;
                  const newLayers = prev.layers.map(l => {
                      if (l.id === meta.layerId && l.time === meta.time) return { ...l, imageUrl: fullString };
                      return l;
                  });
                  return { ...prev, layers: newLayers };
              });
              // Notify Host 
              if (hostConnRef.current && user) {
                  // Heuristic: If we have an image, we are likely mostly done
                  hostConnRef.current.send({ type: 'REPORT_PROGRESS', uid: user.uid, progress: 100 });
              }
          }
      }
  };

  // --- CLIENT LOGIC ---

  const joinLobby = async (code: string): Promise<boolean> => {
      if (!user) return false;
      if (peer) { peer.destroy(); setPeer(null); await new Promise(r => setTimeout(r, 500)); }

      // Detect mobile: longer timeouts, more attempts (4G/LTE often slower to establish WebRTC)
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const CONNECT_TIMEOUT = isMobile ? 35000 : 15000; // 35s mobile, 15s desktop
      const SYNC_TIMEOUT = isMobile ? 15000 : 8000; // 15s mobile, 8s desktop
      const MAX_ATTEMPTS = isMobile ? 8 : 5; // More attempts for mobile

      let peerUnavailableCount = 0; // Track "host not found" errors

      // Pre-check: verify if the host peer is registered on the PeerJS server
      const checkHostExists = async (): Promise<boolean> => {
          try {
              const response = await fetch(`https://${PEER_SERVER_HOST}/peerjs/check/${code}`, { signal: AbortSignal.timeout(5000) });
              if (response.ok) {
                  const data = await response.json();
                  return data.exists === true;
              }
          } catch(e) {
              console.warn('Could not pre-check host existence:', e);
          }
          return true; // If check fails, assume host exists and try connecting
      };

      const tryConnect = async (attempt: number): Promise<boolean | 'host_not_found'> => {
          return new Promise((resolve) => {
              console.log(`Tentativa de conexão ${attempt}...`);
              let isResolved = false;
              
              const fail = (msg?: string, result: false | 'host_not_found' = false) => { 
                  if (isResolved) return; 
                  isResolved = true;
                  try { clientPeer.destroy(); } catch(e) {}
                  if (attempt >= MAX_ATTEMPTS && msg) addToast(msg, 'error'); 
                  resolve(result); 
              };

              const connectionTimeout = setTimeout(() => { fail(attempt >= MAX_ATTEMPTS ? "Tempo esgotado. Verifique sua conexão." : undefined); }, CONNECT_TIMEOUT);

              const uniqueClientId = `player_${user.uid}_${Date.now().toString(36)}`;
              const clientPeer = new Peer(uniqueClientId, PEER_CONFIG);
              
              clientPeer.on('open', (id) => {
                  console.log(`Client peer open: ${id}, connecting to host: ${code}`);
                  const conn = clientPeer.connect(code, { reliable: true });

                  conn.on('open', () => {
                      clearTimeout(connectionTimeout);
                      console.log('Connection to host established!');
                      hostConnRef.current = conn;
                      setPeer(clientPeer);
                      conn.send({ type: 'JOIN_REQUEST', user: { uid: user.uid, displayName: user.displayName, photoURL: user.photoURL } });
                  });

                  conn.on('data', (data: any) => {
                      if (data.type === 'PING') {
                          try { conn.send({ type: 'PONG', sentAt: data.sentAt }); } catch(e) {}
                          return;
                      }
                      if (data.type === 'PONG') {
                          setMyPing(Math.round(Date.now() - data.sentAt));
                          return;
                      }
                      if (data.type === 'ERROR') {
                          clearTimeout(connectionTimeout);
                          addToast(data.message || 'Entrada recusada.', 'error');
                          fail(data.message, false);
                          return;
                      }
                      if (data.type === 'SYNC_LOBBY') {
                          setLobby(data.lobby);
                          if (data.lobby.status === 'loading' && data.lobby.currentEventId) {
                              setDownloadProgress(0);
                              let needData = false;
                              setCurrentEventData((prev) => {
                                  if (!prev || prev.id !== data.lobby.currentEventId) {
                                      chunksBuffer.current.clear();
                                      needData = true;
                                      return null;
                                  }
                                  return prev;
                              });
                              if (needData && user) {
                                  setTimeout(() => hostConnRef.current?.send({ type: 'REQUEST_EVENT_DATA', uid: user.uid }), 100);
                              }
                          }
                          if (data.lobby.players[0]) addToRecentPlayers(data.lobby.players[0]);
                          if (!isResolved) { 
                              isResolved = true; 
                              resolve(true); 
                              router.push(`/lobby/${code}`); 
                          }
                      }
                      if (data.type === 'DATA_CHUNK') handleIncomingChunk(data);
                      if (data.type === 'CHAT_MESSAGE') {
                          setChatMessages(prev => {
                              if (prev.some(m => m.id === data.message.id)) return prev;
                              return [...prev, data.message];
                          });
                      }
                  });
                  
                  conn.on('error', (err: any) => {
                      console.error('Connection error:', err);
                      if (!isResolved) {
                          clearTimeout(connectionTimeout);
                          fail(`Erro na conexão: ${err.type || err.message}`);
                      }
                  });

                  conn.on('close', () => { 
                      if(isResolved) { 
                          // Connection was established but dropped during game → try to reconnect
                          console.warn('Connection to host closed during game. Attempting to reconnect...');
                          addToast('Conexão perdida. Reconectando...', 'error');
                          
                          // Try to reconnect to the host
                          const tryReconnect = async () => {
                              for (let r = 1; r <= 3; r++) {
                                  await new Promise(res => setTimeout(res, r * 1500));
                                  try {
                                      const newConn = clientPeer.connect(code, { reliable: true });
                                      await new Promise<void>((res2, rej2) => {
                                          const t = setTimeout(() => { try { newConn.close(); } catch(e) {} rej2(); }, 8000);
                                          newConn.on('open', () => {
                                              clearTimeout(t);
                                              hostConnRef.current = newConn;
                                              newConn.send({ type: 'JOIN_REQUEST', user: { uid: user.uid, displayName: user.displayName, photoURL: user.photoURL } });
                                              // Re-attach data handler
                                              newConn.on('data', (d: any) => {
                                                  if (d.type === 'PING') { try { newConn.send({ type: 'PONG', sentAt: d.sentAt }); } catch(e) {} return; }
                                                  if (d.type === 'PONG') { setMyPing(Math.round(Date.now() - d.sentAt)); return; }
                                                  if (d.type === 'SYNC_LOBBY') setLobby(d.lobby);
                                                  if (d.type === 'DATA_CHUNK') handleIncomingChunk(d);
                                                  if (d.type === 'CHAT_MESSAGE') {
                                                      setChatMessages(prev => prev.some(m => m.id === d.message.id) ? prev : [...prev, d.message]);
                                                  }
                                              });
                                              newConn.on('close', () => {
                                                  setLobby(null); setCurrentEventData(null); addToast('Desconectado.', 'error'); router.push('/');
                                              });
                                              addToast('Reconectado!', 'success');
                                              res2();
                                          });
                                          newConn.on('error', () => { clearTimeout(t); rej2(); });
                                      });
                                      return; // Success
                                  } catch(e) {
                                      console.log(`Reconnect attempt ${r} failed`);
                                  }
                              }
                              // All reconnect attempts failed
                              setLobby(null); setCurrentEventData(null); addToast('Não foi possível reconectar. Voltando ao menu.', 'error'); router.push('/'); 
                          };
                          tryReconnect();
                      } else { 
                          fail(); 
                      } 
                  });
                  
                  setTimeout(() => {
                      if (!isResolved) {
                          console.log('Timeout waiting for SYNC_LOBBY');
                          try { conn.close(); } catch(e) {}
                          fail();
                      }
                  }, SYNC_TIMEOUT);
              });

              clientPeer.on('error', (err: any) => { 
                  clearTimeout(connectionTimeout);
                  console.error(`Client peer error (attempt ${attempt}):`, err.type, err);
                  
                  // "peer-unavailable" = host peer ID not found on server → room doesn't exist
                  if (err.type === 'peer-unavailable') {
                      peerUnavailableCount++;
                      fail(
                          `Sala "${code}" não encontrada no servidor. O host pode ter saído ou a sala foi encerrada.`,
                          'host_not_found'
                      );
                      return;
                  }
                  
                  // Network / server errors
                  if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
                      fail(attempt >= MAX_ATTEMPTS ? 'Erro de rede. Verifique sua conexão com a internet.' : undefined);
                      return;
                  }
                  
                  fail(attempt >= MAX_ATTEMPTS ? `Erro P2P: ${err.type}` : undefined); 
              });
          });
      };

      // Soft pre-check: verify if host exists (non-blocking — still tries connecting even if not found)
      addToast('Verificando sala...', 'info');
      const hostExists = await checkHostExists();
      if (!hostExists) {
          addToast('Conectando à sala...', 'info');
      }

      // Retry Loop
      for (let i = 1; i <= MAX_ATTEMPTS; i++) {
          if (i === 1 || i === MAX_ATTEMPTS || i % 2 === 0) {
              addToast(`Conectando... ${i}/${MAX_ATTEMPTS}`, 'info');
          }
          const result = await tryConnect(i);
          if (result === true) return true;
          
          // If host was not found 2+ times consecutively, stop retrying — host is gone
          if (result === 'host_not_found' && peerUnavailableCount >= 2) {
              addToast(`Sala "${code}" não encontrada. Possíveis causas: sala encerrada, host offline, ou rede instável. Tente novamente ou peça um novo código ao host.`, 'error');
              return false;
          }
          
          // Shorter delay for mobile (faster retries); longer for desktop
          const delayMs = isMobile ? Math.min(i * 800, 4000) : i * 1000;
          await new Promise(r => setTimeout(r, delayMs));
      }
      
      addToast('Não foi possível conectar à sala. A sala pode ter sido encerrada ou o host pode estar offline.', 'error');
      return false;
  };

  const requestEventData = () => {
      if (hostConnRef.current && user) hostConnRef.current.send({ type: 'REQUEST_EVENT_DATA', uid: user.uid });
  };

  const updateHostState = (updater: (l: Lobby) => void) => {
      if (!lobbyRef.current) return;
      const copy = { ...lobbyRef.current }; 
      copy.players = [...copy.players.map(p => ({...p}))];
      updater(copy);
      setLobby(copy);
      broadcastLobby(copy);
  };

  const startGame = async (eventId: string) => {
      if (lobbyRef.current?.hostId !== user?.uid) return;
      
      const allEvents = await mockStore.getEvents();
      const fullEvent = allEvents.find(e => e.id === eventId);
      
      if (fullEvent) {
          const now = Date.now();
          loadingStartTimeRef.current = now;

          // 1) Set LOADING state and broadcast FIRST so clients clear old event and show loading before chunks
          updateHostState(l => {
              l.status = 'loading';
              l.currentEventId = eventId;
              l.loadingStartTime = now;
              l.roundEndTime = null;
              l.roundsPlayed = (l.roundsPlayed || 0) + 1;
              l.players.forEach(p => {
                  p.hasSubmitted = false;
                  p.lastRoundScore = 0;
                  p.lastRoundDistance = 0;
                  p.loadProgress = p.isHost ? 100 : 0;
              });
          });

          setCurrentEventData(fullEvent);
          setDownloadProgress(0);

          // 2) Then send event data so clients receive chunks after they're already in "loading" state
          broadcastFullEvent(fullEvent);
          
          // Navigation happens automatically when client sees 'playing' status in Lobby.tsx
          // Host navigates himself because he sets state locally. Wait, Host state is synced.
          // Host needs to navigate to /jogar ONLY when status becomes playing.
      } else {
          addToast("Erro: Evento não encontrado.", 'error');
      }
  };

  const leaveLobby = () => {
      if (lobby && user) {
          setPlayerPings({});
          setMyPing(null);
          connToUidRef.current.clear();
          if (lobby.hostId === user.uid) { peer?.destroy(); setLobby(null); setPeer(null); setCurrentEventData(null); router.push('/'); } 
          else { if (hostConnRef.current) { hostConnRef.current.send({ type: 'LEAVE', uid: user.uid }); hostConnRef.current.close(); } peer?.destroy(); setLobby(null); setPeer(null); setCurrentEventData(null); router.push('/'); }
      }
  };

  const submitRoundScore = (score: number, distance: number, streak: number) => {
      if (!user) return;
      if (lobby?.hostId === user.uid) {
          updateHostState(l => {
              const me = l.players.find(p => p.uid === user.uid);
              if (me) { me.hasSubmitted = true; me.lastRoundScore = score; me.lastRoundDistance = distance; me.totalScore += score; me.streakCount = streak; }
          });
      } else { hostConnRef.current?.send({ type: 'SUBMIT_SCORE', uid: user.uid, score, distance, streak }); }
  };

  const nextRound = (eventId: string) => { startGame(eventId); };
  const triggerForceFinish = () => { if (lobbyRef.current?.hostId === user?.uid) updateHostState(l => { l.roundEndTime = Date.now() + 15000; }); };
  const forceEndRound = () => { if (lobbyRef.current?.hostId === user?.uid) updateHostState(l => { l.players.forEach(p => { if (!p.hasSubmitted) { p.hasSubmitted = true; p.lastRoundScore = 0; p.lastRoundDistance = 99999; } }); }); };
  const endMatch = () => { if (lobbyRef.current?.hostId === user?.uid) updateHostState(l => { l.status = 'finished'; }); };

  return (
    <MultiplayerContext.Provider value={{ 
      lobby, currentEventData, downloadProgress, isHost: lobby?.hostId === user?.uid,
      createLobby, joinLobby, leaveLobby, startGame, requestEventData, submitRoundScore, 
      triggerForceFinish, forceEndRound, nextRound, endMatch,
      sendInvite, incomingInvite, acceptInvite, declineInvite, recentPlayers,
      chatMessages, sendChatMessage, forceStartGame,
      playerPings, myPing
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
