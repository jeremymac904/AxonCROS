import { useEffect, useRef, useState } from 'react';
import { nativeRequest, type NativeEvent } from '../lib/axon-native';
import { errorText } from '../lib/axon';
type VoiceState = 'idle' | 'connecting' | 'recording' | 'transcribing' | 'thinking' | 'speaking' | 'muted' | 'ready' | 'error';
export function useAxonVoice({ onDictation, onTurn, onCancelTurn, language = 'en-US', voice, rate = 1 }: { onDictation: (text: string) => void; onTurn: (text: string) => Promise<string | null>; onCancelTurn?: () => void; language?: string; voice?: string; rate?: number }) {
  const [state, setState] = useState<VoiceState>('idle');
  const [mode, setMode] = useState<'dictation' | 'call' | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<{ id: string; mode: 'dictation' | 'call'; muted: boolean; phase: VoiceState } | null>(null);
  const callbacks = useRef({ onDictation, onTurn, onCancelTurn, language, voice, rate }); callbacks.current = { onDictation, onTurn, onCancelTurn, language, voice, rate };
  const phase = (next: VoiceState) => { if (session.current) session.current.phase = next; setState(next); };
  const capture = async () => {
    const current = session.current; if (!current || current.muted) return;
    const captureId = crypto.randomUUID(); current.id = captureId; phase('connecting');
    try { await nativeRequest('startDictation', { sessionId: captureId, language: callbacks.current.language }); }
    catch (cause) {
      // A muted, ended or replaced capture may reject after the UI has moved on.
      // Its native cancellation is expected and must not end the current call.
      if (session.current !== current || current.id !== captureId || current.muted) return;
      throw cause;
    }
    if (session.current === current && current.id === captureId && !current.muted && current.phase === 'connecting') phase('recording');
  };
  const end = () => {
    const current = session.current; session.current = null; setMode(null); setState('idle'); setMuted(false);
    if (current?.phase === 'thinking') callbacks.current.onCancelTurn?.();
    if (current) void nativeRequest('cancelDictation', { sessionId: current.id }).catch(() => {});
    void nativeRequest('stopSpeaking').catch(() => {});
  };
  const start = async (nextMode: 'dictation' | 'call') => {
    if (session.current) { setError('End the current microphone session before starting another.'); return; }
    setError(null); setMode(nextMode); setMuted(false);
    session.current = { id: crypto.randomUUID(), mode: nextMode, muted: false, phase: 'connecting' };
    try { await capture(); } catch (cause) { end(); setError(errorText(cause)); }
  };
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<NativeEvent>).detail;
      const current = session.current;
      if (!current || detail.sessionId !== current.id || (detail.type === 'dictation' && current.muted)) return;
      if (detail.state === 'error') { end(); setError(detail.message || 'Voice stopped. Check microphone and speech permissions in macOS Settings.'); return; }
      if (detail.type === 'speech') {
        if (detail.state === 'cancelled') { phase(current.muted ? 'muted' : 'ready'); return; }
        if (detail.state === 'complete') {
          if (current.muted) phase('muted');
          else void capture().catch(cause => { end(); setError(errorText(cause)); });
        }
        return;
      }
      if (detail.state === 'recording' || detail.state === 'transcribing') { phase(detail.state); return; }
      if (detail.state !== 'complete' || !['recording', 'transcribing', 'connecting'].includes(current.phase)) return;
      const text = detail.text?.trim();
      if (current.mode === 'dictation') { session.current = null; setMode(null); setState('ready'); if (text) callbacks.current.onDictation(text); return; }
      if (!text) { phase(current.muted ? 'muted' : 'ready'); return; }
      phase('thinking');
      void callbacks.current.onTurn(text).then(async reply => {
        if (session.current !== current) return;
        if (!reply) { phase('ready'); return; }
        current.id = crypto.randomUUID(); phase('speaking');
        await nativeRequest('speak', { sessionId: current.id, text: reply, voice: callbacks.current.voice, rate: Math.max(0.1, Math.min(0.6, 0.4 * callbacks.current.rate)) });
      }).catch(cause => { if (session.current === current) { end(); setError(errorText(cause)); } });
    };
    window.addEventListener('axoncros:native', receive);
    return () => { window.removeEventListener('axoncros:native', receive); const current = session.current; session.current = null; if (current) { void nativeRequest('cancelDictation', { sessionId: current.id }).catch(() => {}); void nativeRequest('stopSpeaking').catch(() => {}); } };
  }, []);
  const stop = async () => { const current = session.current; if (!current) return; const captureId = current.id; try { phase('transcribing'); await nativeRequest('stopDictation', { sessionId: captureId }); } catch (cause) { if (session.current === current && current.id === captureId) { end(); setError(errorText(cause)); } } };
  const listen = async () => { const current = session.current; if (!current) return; const pending = capture(), captureId = current.id; try { await pending; } catch (cause) { if (session.current === current && current.id === captureId) { end(); setError(errorText(cause)); } } };
  const mute = async () => {
    const current = session.current; if (!current || current.mode !== 'call') return;
    current.muted = !current.muted; setMuted(current.muted);
    if (current.muted) {
      const captureId = current.id;
      if (current.phase !== 'thinking' && current.phase !== 'speaking') {
        // Retire this capture before awaiting the native cancellation reply.
        current.id = crypto.randomUUID(); phase('muted');
      }
      await nativeRequest('cancelDictation', { sessionId: captureId }).catch(() => {});
    } else if (!['thinking', 'speaking'].includes(current.phase)) await capture().catch(cause => { end(); setError(errorText(cause)); });
  };
  return { state, mode, active: !!mode, muted, error, clearError: () => setError(null), start, stop, end, mute, listen };
}
