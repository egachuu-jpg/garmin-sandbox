import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';

export type ToolCall = {
  id: string;
  name: string;
  status: 'pending' | 'done' | 'error';
};

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCall[];
  streaming?: boolean;
};

const TOOL_LABELS: Record<string, string> = {
  get_hrv: 'HRV data',
  get_sleep_data: 'Sleep data',
  get_body_battery: 'Body battery',
  get_training_readiness: 'Training readiness',
  get_training_status: 'Training status',
  get_activities_by_date: 'Activities',
  get_last_activity: 'Last activity',
  get_resting_heart_rate: 'Resting HR',
  get_stress: 'Stress data',
  get_gear: 'Gear list',
  get_gear_stats: 'Gear mileage',
  schedule_workout: 'Scheduling workout',
  upload_workout: 'Uploading workout',
  schedule_week: 'Scheduling week',
  get_vo2max: 'VO2max',
  get_race_predictions: 'Race predictions',
};

function toolLabel(fullName: string): string {
  const shortName = fullName.split('__').pop() ?? fullName;
  return TOOL_LABELS[shortName] ?? shortName.replace(/_/g, ' ');
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[85%] space-y-2', isUser ? 'flex flex-col items-end' : 'flex flex-col items-start')}>

        {/* Tool call chips */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.toolCalls.map(tc => (
              <span
                key={tc.id}
                className={cn(
                  'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium',
                  tc.status === 'pending' && 'bg-yellow-950/60 border-yellow-800/50 text-yellow-400',
                  tc.status === 'done'    && 'bg-emerald-950/60 border-emerald-800/50 text-emerald-400',
                  tc.status === 'error'   && 'bg-red-950/60 border-red-800/50 text-red-400'
                )}
              >
                <span className={tc.status === 'pending' ? 'animate-spin inline-block' : ''}>
                  {tc.status === 'pending' ? '⟳' : tc.status === 'done' ? '✓' : '✗'}
                </span>
                {toolLabel(tc.name)}
              </span>
            ))}
          </div>
        )}

        {/* Bubble */}
        {(message.text || message.streaming) && (
          <div
            className={cn(
              'px-4 py-3 rounded-2xl text-sm leading-relaxed',
              isUser
                ? 'bg-primary text-white rounded-tr-sm whitespace-pre-wrap'
                : 'bg-surface-card border border-surface-border text-gray-100 rounded-tl-sm'
            )}
          >
            {isUser ? message.text : message.text && <Markdown>{message.text}</Markdown>}

            {/* Loading dots when no text yet */}
            {message.streaming && !message.text && (
              <span className="inline-flex gap-1 items-center h-4">
                {[0, 150, 300].map(delay => (
                  <span
                    key={delay}
                    className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
            )}

            {/* Cursor while streaming */}
            {message.streaming && message.text && (
              <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
