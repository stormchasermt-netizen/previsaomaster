import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';

/**
 * Gera token de acesso LiveKit para transmissão ou visualização.
 * POST /api/livekit-token
 * Body: { roomName: string, participantName: string, participantIdentity?: string }
 * O participantIdentity pode ser o uid do Firebase para consistência.
 */
export async function POST(req: NextRequest) {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!url || !apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'LiveKit não configurado. Defina LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET em .env.local' },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const { roomName, participantName, participantIdentity } = body;

    if (!roomName || typeof roomName !== 'string') {
      return NextResponse.json({ error: 'roomName é obrigatório' }, { status: 400 });
    }

    const identity = participantIdentity || `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: participantName || 'Participante',
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return NextResponse.json({ token, url });
  } catch (err) {
    console.error('[livekit-token]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro ao gerar token' },
      { status: 500 }
    );
  }
}
