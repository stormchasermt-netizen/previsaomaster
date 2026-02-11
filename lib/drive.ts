/**
 * Google Drive storage for events.
 * Uses appDataFolder (hidden per-app folder) - events sync across devices for the same Google account.
 *
 * Requisitos: O usuário deve estar logado com Google e o scope drive.appdata deve estar autorizado.
 */

import type { PrevisaoEvent } from './types';

const FILE_NAME = 'previsao_events.json';

let tokenGetter: (() => Promise<string | null>) | null = null;

export function setDriveTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter;
}

async function getToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  return tokenGetter();
}

async function driveRequest<T>(
  url: string,
  options: RequestInit & { body?: string | Blob } = {}
): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error('Não autenticado');
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`Drive API: ${res.status} ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function findFileId(): Promise<string | null> {
  const q = `name='${FILE_NAME}' and 'appDataFolder' in parents and trashed=false`;
  const data = await driveRequest<{ files: { id: string }[] }>(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(q)}`
  );
  return data.files?.[0]?.id ?? null;
}

async function createFile(content: string): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error('Não autenticado');
  const boundary = '-------previsao' + Date.now();
  const metadata = JSON.stringify({ name: FILE_NAME, mimeType: 'application/json', parents: ['appDataFolder'] });
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    content,
    `--${boundary}--`,
  ].join('\r\n');
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive create: ${res.status}`);
}

async function updateFile(fileId: string, content: string): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error('Não autenticado');
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: content,
    }
  );
  if (!res.ok) throw new Error(`Drive update: ${res.status}`);
}

export async function driveGetEvents(): Promise<PrevisaoEvent[]> {
  const token = await getToken();
  if (!token) return [];
  try {
    const fileId = await findFileId();
    if (!fileId) return [];
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`Drive get: ${res.status}`);
    }
    const text = await res.text();
    const data = JSON.parse(text || '[]');
    return Array.isArray(data) ? data : [];
  } catch (e: any) {
    if (e?.message?.includes('404')) return [];
    console.warn('Drive getEvents failed:', e);
    return [];
  }
}

export async function driveSaveEvents(events: PrevisaoEvent[]): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error('Faça login com Google para sincronizar na nuvem.');
  const content = JSON.stringify(events);
  const fileId = await findFileId();
  if (fileId) {
    await updateFile(fileId, content);
  } else {
    await createFile(content);
  }
}

export function isDriveAvailable(): boolean {
  return !!tokenGetter;
}
