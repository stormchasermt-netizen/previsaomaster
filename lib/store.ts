import { PrevisaoEvent, PrevisaoScore } from './types';
import { db } from './db';
import { isDriveAvailable, driveGetEvents, driveSaveEvents } from './drive';

// Initial dummy data if empty (fallback)
const INITIAL_EVENTS: PrevisaoEvent[] = [
  {
    id: 'demo-event-1',
    eventDate: '2016-04-27',
    displayDate: '27 de Abril de 2016',
    monthHint: 'Abril',
    region: 'america_do_sul',
    active: true,
    createdAt: Date.now(),
    bounds: { south: -35, north: -20, west: -65, east: -45 },
    stormReports: [
      { lat: -25.5, lng: -54.5, type: 'tornado' },
      { lat: -26.1, lng: -53.2, type: 'vento' },
      { lat: -24.8, lng: -55.0, type: 'granizo' }
    ],
    layers: [] 
  }
];

async function syncToCloud(events: PrevisaoEvent[]): Promise<void> {
  if (isDriveAvailable()) {
    try {
      await driveSaveEvents(events);
    } catch (e) {
      console.warn('Drive sync failed:', e);
    }
  }
}

export const mockStore = {
  getEvents: async (): Promise<PrevisaoEvent[]> => {
    if (isDriveAvailable()) {
      try {
        const cloudEvents = await driveGetEvents();
        if (cloudEvents.length > 0) {
          await db.replaceEvents(cloudEvents);
          return cloudEvents;
        }
      } catch (e) {
        console.warn('Drive getEvents failed, using local:', e);
      }
    }
    const events = await db.getEvents();
    if (events.length === 0) {
      for (const evt of INITIAL_EVENTS) {
        await db.saveEvent(evt);
      }
      return INITIAL_EVENTS;
    }
    return events;
  },

  getEventById: async (id: string): Promise<PrevisaoEvent | undefined> => {
    const events = await mockStore.getEvents();
    return events.find(e => e.id === id);
  },

  addEvent: async (event: Omit<PrevisaoEvent, 'id' | 'createdAt'>) => {
    const newEvent: PrevisaoEvent = {
      ...event,
      id: `evt-${Date.now()}`,
      createdAt: Date.now(),
    };
    await db.saveEvent(newEvent);
    const allEvents = await db.getEvents();
    await syncToCloud(allEvents);
    return newEvent;
  },

  updateEvent: async (event: PrevisaoEvent) => {
    await db.saveEvent(event);
    const allEvents = await db.getEvents();
    await syncToCloud(allEvents);
    return event;
  },

  deleteEvent: async (id: string) => {
    await db.deleteEvent(id);
    const allEvents = await db.getEvents();
    await syncToCloud(allEvents);
  },

  getScores: async (): Promise<PrevisaoScore[]> => {
    return await db.getScores();
  },

  addScore: async (score: Omit<PrevisaoScore, 'id' | 'createdAt'>) => {
    const newScore: PrevisaoScore = {
      ...score,
      id: `score-${Date.now()}`,
      createdAt: Date.now(),
    };
    await db.saveScore(newScore);
    return newScore;
  },

  clearScores: async () => {
    await db.clearScores();
  }
};