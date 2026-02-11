import {
    collection,
    doc,
    getDocs,
    getDoc,
    writeBatch,
    deleteDoc,
    addDoc,
    setDoc,
    query,
    serverTimestamp,
    orderBy
} from 'firebase/firestore';
import {
    ref,
    uploadString,
    getDownloadURL,
    deleteObject
} from 'firebase/storage';
import { db, storage } from './firebase';
import { PrevisaoEvent, PrevisaoScore } from './types';

// Helper to upload a base64 image and get its URL
async function uploadBase64Image(base64: string, path: string): Promise<string> {
    // If it's already a URL (http or gs), don't re-upload
    if (base64.startsWith('http') || base64.startsWith('gs://')) {
        return base64;
    }
    // If it's not a valid base64 string, return it as is (might be a placeholder)
    if (!base64.startsWith('data:image')) {
        return base64;
    }
    
    const storageRef = ref(storage, path);
    const snapshot = await uploadString(storageRef, base64, 'data_url');
    return await getDownloadURL(snapshot.ref);
}

export const mockStore = {
  getEvents: async (): Promise<PrevisaoEvent[]> => {
    try {
        const q = query(collection(db, 'events'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const events: PrevisaoEvent[] = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const event: PrevisaoEvent = {
                id: doc.id,
                ...data,
                // Handle both server timestamp and local number
                createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : data.createdAt
            } as PrevisaoEvent;
            events.push(event);
        });
        return events;
    } catch (error) {
        console.error("Error fetching events from Firestore: ", error);
        return [];
    }
  },

  getEventById: async (id: string): Promise<PrevisaoEvent | undefined> => {
    try {
        const docRef = doc(db, 'events', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
             const event: PrevisaoEvent = {
                id: docSnap.id,
                ...data,
                createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : data.createdAt
            } as PrevisaoEvent;
            return event;
        }
        return undefined;
    } catch(error) {
        console.error("Error fetching event by ID: ", error);
        return undefined;
    }
  },

  addEvent: async (eventData: Omit<PrevisaoEvent, 'id' | 'createdAt'>): Promise<PrevisaoEvent> => {
    const eventId = `evt-${Date.now()}`;
    // Create a deep copy to avoid mutating the original object from the component state
    const finalEventData = JSON.parse(JSON.stringify(eventData));

    // Upload images to storage
    for (let i = 0; i < finalEventData.layers.length; i++) {
        const layer = finalEventData.layers[i];
        if (layer.imageUrl && layer.imageUrl.startsWith('data:image')) {
            const path = `events/${eventId}/layers/${layer.id}_${layer.time}.jpg`;
            layer.imageUrl = await uploadBase64Image(layer.imageUrl, path);
        }
    }
    if (finalEventData.reportMapUrl && finalEventData.reportMapUrl.startsWith('data:image')) {
        const path = `events/${eventId}/reportMap.jpg`;
        finalEventData.reportMapUrl = await uploadBase64Image(finalEventData.reportMapUrl, path);
    }
    
    const docData = {
        ...finalEventData,
        createdAt: serverTimestamp()
    };

    const docRef = doc(db, 'events', eventId);
    await setDoc(docRef, docData);
    
    return { ...docData, id: eventId, createdAt: Date.now() } as PrevisaoEvent;
  },

  updateEvent: async (event: PrevisaoEvent): Promise<PrevisaoEvent> => {
    // Create a deep copy to avoid mutating the original object
    const finalEventData = JSON.parse(JSON.stringify(event));
    delete finalEventData.id; // Don't save ID inside the document
    delete finalEventData.createdAt; // Use server timestamp for updates too

    // Upload NEW images to storage
    for (let i = 0; i < finalEventData.layers.length; i++) {
        const layer = finalEventData.layers[i];
        if (layer.imageUrl && layer.imageUrl.startsWith('data:image')) {
            const path = `events/${event.id}/layers/${layer.id}_${layer.time}.jpg`;
            layer.imageUrl = await uploadBase64Image(layer.imageUrl, path);
        }
    }
    if (finalEventData.reportMapUrl && finalEventData.reportMapUrl.startsWith('data:image')) {
        const path = `events/${event.id}/reportMap.jpg`;
        finalEventData.reportMapUrl = await uploadBase64Image(finalEventData.reportMapUrl, path);
    }

    const docData = {
        ...finalEventData,
        createdAt: serverTimestamp() // Update timestamp on every modification
    };

    const docRef = doc(db, 'events', event.id);
    await setDoc(docRef, docData, { merge: true });

    return event;
  },

  deleteEvent: async (id: string) => {
    // Note: This does not delete associated images from Storage. 
    // This would require a more complex backend setup (e.g., Cloud Function).
    await deleteDoc(doc(db, 'events', id));
  },

  getScores: async (): Promise<PrevisaoScore[]> => {
    try {
        const q = query(collection(db, 'scores'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const scores: PrevisaoScore[] = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            scores.push({
                 id: doc.id,
                 ...data,
                 createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : data.createdAt
            } as PrevisaoScore);
        });
        return scores;
    } catch (error) {
        console.error("Error fetching scores from Firestore: ", error);
        return [];
    }
  },

  addScore: async (scoreData: Omit<PrevisaoScore, 'id' | 'createdAt'>): Promise<PrevisaoScore> => {
    const finalScoreData = {
        ...scoreData,
        createdAt: serverTimestamp()
    }
    const docRef = await addDoc(collection(db, "scores"), finalScoreData);
    return { ...scoreData, id: docRef.id, createdAt: Date.now() } as PrevisaoScore;
  },

  clearScores: async () => {
    const scoresRef = collection(db, "scores");
    const querySnapshot = await getDocs(scoresRef);
    
    if (querySnapshot.empty) return;

    const batch = writeBatch(db);
    querySnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });
    
    await batch.commit();
  }
};
