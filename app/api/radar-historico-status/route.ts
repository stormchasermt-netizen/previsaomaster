import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const FEEDER_URL = process.env.FEEDER_URL || 'https://radar-ao-vivo2-feeder-303740989273.us-central1.run.app';
    const res = await fetch(`${FEEDER_URL}/historico-status`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ running: false });
    }
    const data = await res.json();
    return NextResponse.json({ running: data.running });
  } catch (err) {
    return NextResponse.json({ running: false });
  }
}
