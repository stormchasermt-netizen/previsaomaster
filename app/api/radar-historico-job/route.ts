import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { targetTs12, windowMinutes } = await req.json();

    if (!targetTs12 || typeof windowMinutes !== 'number') {
      return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }

    const CRON_SECRET = process.env.CRON_SECRET || 'MY_SECRET_KEY';
    // Cloud Run URL can be pulled from an env var, or derived from the same base as other services
    const FEEDER_URL = process.env.FEEDER_URL || 'https://radar-ao-vivo2-feeder-303740989273.us-central1.run.app';

    const res = await fetch(`${FEEDER_URL}/historico`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CRON_SECRET}`
      },
      body: JSON.stringify({ targetTs12, windowMinutes })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Feeder error: ${res.status} ${err}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Error starting historical job:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
