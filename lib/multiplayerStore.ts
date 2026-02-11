import { Lobby, LobbyPlayer, PrevisaoDifficulty } from './types';
import { mockStore } from './store';

// We simulate a realtime DB using LocalStorage + Custom Events
// Ideally this would be Firebase or a WebSocket server.

const LOBBY_PREFIX = 'previsao_lobby_';

export const multiplayerStore = {
  
  createLobby: (hostUser: any, difficulty: PrevisaoDifficulty): Lobby => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const lobby: Lobby = {
      code,
      hostId: hostUser.uid,
      status: 'waiting',
      difficulty,
      players: [{
        uid: hostUser.uid,
        displayName: hostUser.displayName,
        photoURL: hostUser.photoURL,
        isHost: true,
        isReady: true,
        hasSubmitted: false,
        totalScore: 0,
        lastRoundScore: 0,
        lastRoundDistance: 0,
        streakCount: 0
      }],
      currentEventId: null,
      roundEndTime: null,
      roundsPlayed: 0,
      createdAt: Date.now()
    };
    
    saveLobby(lobby);
    return lobby;
  },

  joinLobby: (code: string, user: any): Lobby | null => {
    const lobby = getLobby(code);
    if (!lobby) return null;

    const existingPlayer = lobby.players.find(p => p.uid === user.uid);
    if (!existingPlayer) {
      lobby.players.push({
        uid: user.uid,
        displayName: user.displayName,
        photoURL: user.photoURL,
        isHost: false,
        isReady: true,
        hasSubmitted: false,
        totalScore: 0,
        lastRoundScore: 0,
        lastRoundDistance: 0,
        streakCount: 0
      });
      saveLobby(lobby);
    }
    return lobby;
  },

  getLobby: (code: string): Lobby | null => {
    return getLobby(code);
  },

  updateLobbyStatus: (code: string, status: Lobby['status'], eventId?: string) => {
    const lobby = getLobby(code);
    if (!lobby) return;

    lobby.status = status;
    if (eventId) lobby.currentEventId = eventId;
    
    if (status === 'playing') {
      // Reset round specific flags
      lobby.players.forEach(p => {
        p.hasSubmitted = false;
        p.lastRoundScore = 0;
        p.lastRoundDistance = 0;
      });
      lobby.roundEndTime = null;
    }

    saveLobby(lobby);
  },

  submitScore: (code: string, uid: string, score: number, distance: number, streak: number) => {
    const lobby = getLobby(code);
    if (!lobby) return;

    const player = lobby.players.find(p => p.uid === uid);
    if (player) {
      player.hasSubmitted = true;
      player.lastRoundScore = score;
      player.lastRoundDistance = distance;
      player.totalScore += score;
      player.streakCount = streak;
    }

    // Check if everyone submitted
    const allSubmitted = lobby.players.every(p => p.hasSubmitted);
    if (allSubmitted) {
      // Small delay to let animations finish or simulate server
      // But typically we wait for host to advance, or advance automatically
      // User requested: "encerrado quando todos... ou criador"
      // We will mark status as 'round_results' automatically if all submitted?
      // Or just let the UI handle it. Let's trigger round_results if all done.
      // Actually, better to let host control or simple auto-transition.
      // Let's just save. The UI will react.
    }

    saveLobby(lobby);
  },

  startRoundTimer: (code: string) => {
    const lobby = getLobby(code);
    if (!lobby) return;
    lobby.roundEndTime = Date.now() + 15000; // 15 seconds
    saveLobby(lobby);
  },

  endMatch: (code: string) => {
    const lobby = getLobby(code);
    if(!lobby) return;
    lobby.status = 'finished';
    saveLobby(lobby);
  },

  leaveLobby: (code: string, uid: string) => {
    const lobby = getLobby(code);
    if (!lobby) return;
    
    lobby.players = lobby.players.filter(p => p.uid !== uid);
    
    // If host leaves, assign new host or delete?
    if (lobby.players.length === 0) {
      localStorage.removeItem(LOBBY_PREFIX + code);
      // Dispatch event for deletion
      window.dispatchEvent(new StorageEvent('storage', {
        key: LOBBY_PREFIX + code,
        newValue: null
      }));
      return;
    }

    if (lobby.hostId === uid) {
      lobby.hostId = lobby.players[0].uid;
      lobby.players[0].isHost = true;
    }

    saveLobby(lobby);
  }
};

function getLobby(code: string): Lobby | null {
  const data = localStorage.getItem(LOBBY_PREFIX + code);
  return data ? JSON.parse(data) : null;
}

function saveLobby(lobby: Lobby) {
  const key = LOBBY_PREFIX + lobby.code;
  const val = JSON.stringify(lobby);
  localStorage.setItem(key, val);
  
  // Dispatch a custom event because 'storage' event only fires on OTHER tabs, 
  // not the one making the change. We want reactive UI in the current tab too.
  // But for the current tab, the Context usually handles state. 
  // We'll rely on the Context to call saveLobby, and then update its own state.
  // However, to sync other tabs (e.g. host vs player), we rely on native 'storage' event.
}
