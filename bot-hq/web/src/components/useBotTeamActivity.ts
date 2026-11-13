import { useCallback, useLayoutEffect, useRef, useState } from 'react';
export type BotTeamState = 'idle' | 'thinking' | 'working' | 'celebrating';
export interface BotActivityToken { scope: string; sequence: number }
/** Each completion belongs to one activity and one conversation/profile. */
export function useBotTeamActivity(scope: string) {
  const current = useRef(scope); current.current = scope;
  const sequence = useRef(0), timer = useRef<ReturnType<typeof setTimeout>>();
  const [value, setValue] = useState<{ scope: string; state: BotTeamState }>({ scope, state: 'idle' });
  const clearTimer = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = undefined; }, []);
  useLayoutEffect(() => { sequence.current++; clearTimer(); setValue({ scope, state: 'idle' }); return () => { sequence.current++; clearTimer(); }; }, [scope, clearTimer]);
  const begin = useCallback((state: 'thinking' | 'working'): BotActivityToken => {
    clearTimer(); const token = { scope: current.current, sequence: ++sequence.current };
    setValue({ scope: token.scope, state }); return token;
  }, [clearTimer]);
  const finish = useCallback((token: BotActivityToken | null | undefined, success = false) => {
    if (!token || token.scope !== current.current || token.sequence !== sequence.current) return;
    clearTimer(); setValue({ scope: token.scope, state: success ? 'celebrating' : 'idle' });
    // Invalidate the completed token immediately: duplicate callbacks cannot extend success.
    const done = ++sequence.current;
    if (success) timer.current = setTimeout(() => { if (current.current === token.scope && sequence.current === done) setValue({ scope: token.scope, state: 'idle' }); timer.current = undefined; }, 3200);
  }, [clearTimer]);
  const reset = useCallback(() => { ++sequence.current; clearTimer(); setValue({ scope: current.current, state: 'idle' }); }, [clearTimer]);
  return { state: value.scope === scope ? value.state : 'idle' as BotTeamState, begin, finish, reset };
}
