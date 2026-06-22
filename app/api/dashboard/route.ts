import { NextResponse } from 'next/server';
import { executeTool } from '@/lib/mcp-client';

export async function GET() {
  const today = new Date().toISOString().split('T')[0];

  const [readiness, hrv, sleep, bodyBattery, steps] = await Promise.allSettled([
    executeTool('nicolas__get_training_readiness', { date: today }),
    executeTool('nicolas__get_hrv', { date: today }),
    executeTool('nicolas__get_sleep_data', { date: today }),
    executeTool('nicolas__get_body_battery', { date: today }),
    executeTool('nicolas__get_steps', { date: today }),
  ]);

  return NextResponse.json({
    readiness: readiness.status === 'fulfilled' ? readiness.value : null,
    hrv: hrv.status === 'fulfilled' ? hrv.value : null,
    sleep: sleep.status === 'fulfilled' ? sleep.value : null,
    bodyBattery: bodyBattery.status === 'fulfilled' ? bodyBattery.value : null,
    steps: steps.status === 'fulfilled' ? steps.value : null,
  });
}
