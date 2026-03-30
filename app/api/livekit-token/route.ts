import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';

/**
 * Gera token JWT LiveKit para transmissão ou visualização.
 * POST /api/livekit-token
 * Body: { roomName, participantName, participantIdentity? }
 */
export async function POST(req: NextRequest) {
  const wsUrl = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!wsUrl || !apiKey || !apiSecret) {
    console.error('[livekit-token] LIVEKIT_URL, LIVEKIT_API_KEY ou LIVEKIT_API_SECRET ausentes');
    return NextResponse.json(
      { error: 'Servidor mal configurado: defina LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET em .env.local' },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { roomName, participantName, participantIdentity } = body;

    if (!roomName || typeof roomName !== 'string') {
      return NextResponse.json({ error: 'roomName é obrigatório' }, { status: 400 });
    }
    if (!participantName || typeof participantName !== 'string') {
      return NextResponse.json({ error: 'participantName é obrigatório' }, { status: 400 });
    }

    const identity =
      typeof participantIdentity === 'string' && participantIdentity.length > 0
        ? participantIdentity
        : `user-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: participantName,
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return NextResponse.json({ token, url: wsUrl });
  } catch (err) {
    console.error('[livekit-token]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Falha ao gerar token de transmissão' },
      { status: 500 }
    );
  }
}
