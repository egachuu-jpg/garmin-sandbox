import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { COACH_MODEL } from '@/lib/agent';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });

// Single-shot explanation for a tapped home-screen tile — deliberately
// separate from the /api/chat agentic loop: no conversation, no persistence,
// no tools. The athlete taps a number and gets a short story about it inline,
// without leaving the home screen.
const METRIC_LABELS: Record<string, string> = {
  readiness: 'Training Readiness score',
  hrv: 'HRV (heart rate variability)',
  sleep: 'Sleep Score',
  battery: 'Body Battery',
  restingHr: 'Resting Heart Rate',
};

type DashboardSnapshot = {
  readiness: number | null;
  hrv: number | null;
  sleepScore: number | null;
  bodyBattery: number | null;
  restingHr: number | null;
};

export async function POST(req: Request) {
  const { metric, dashboard } = (await req.json()) as { metric?: string; dashboard?: DashboardSnapshot };

  const label = metric ? METRIC_LABELS[metric] : undefined;
  if (!label || !dashboard) {
    return NextResponse.json({ error: 'unknown metric' }, { status: 400 });
  }

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? 'no data' : String(v));

  const prompt = `You are this runner's coach. Marathon goals: 3:50 A-goal (8:45/mi) at the Mankato Marathon (Oct 17, 2026), sub-4:00 as the B-goal floor. Managing right SI joint dysfunction, so recovery signals matter a lot.

Today's snapshot:
- Training Readiness: ${fmt(dashboard.readiness)}
- HRV: ${fmt(dashboard.hrv)} ms
- Sleep Score: ${fmt(dashboard.sleepScore)}
- Body Battery: ${fmt(dashboard.bodyBattery)}%
- Resting HR: ${fmt(dashboard.restingHr)} bpm

The athlete just tapped on ${label}. In 2-3 short, concrete sentences, tell the story of what that number means for them today — pull in the other metrics only if they change the read. Don't just restate the number back as a list. If it's "no data", say so plainly and don't speculate.`;

  try {
    const msg = await anthropic.messages.create({
      model: COACH_MODEL,
      max_tokens: 220,
      messages: [{ role: 'user', content: prompt }],
    });

    const insight = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    return NextResponse.json({ insight });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
