import { useEffect, useState } from 'react';
import type { BotTeamState } from './useBotTeamActivity';
import '../styles/bot-team.css';
export const BOT_CHARACTERS = ['Captain', 'Pixel', 'Bolt', 'Nova', 'Scout'] as const;
export type BotCharacter = typeof BOT_CHARACTERS[number];
const descriptions: Record<BotTeamState, string> = { idle: 'avatar', thinking: 'preparing a reply', working: 'running a local task', celebrating: 'completed' };
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  return reduced;
}
function AvatarImage({ sources, name }: { sources: { url: string; format: string }[]; name: string }) {
  const [index, setIndex] = useState(0), source = sources[index];
  return source ? <img data-bot-format={source.format} src={source.url} alt="" draggable={false} onError={() => setIndex(value => value + 1)} /> : <span data-bot-format="initials" className="bot-team-initials">{name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase()}</span>;
}
export function BotTeamAvatar({ name, character, src, state = 'idle', size = 36, label }: { name: string; character?: BotCharacter | null; src?: string | null; state?: BotTeamState; size?: number; label?: string }) {
  const reduced = useReducedMotion();
  const custom = src && (src.startsWith('/api/local/files/') || src.startsWith('/assets/')) ? src : null;
  const selected = character && BOT_CHARACTERS.includes(character) ? character : null;
  const imageState = reduced ? 'idle' : state;
  const base = selected ? `/assets/bot-team/${selected}/${selected}` : '';
  const sources = custom ? [{ url: custom, format: 'custom' }] : !selected ? [] : imageState === 'idle' ? [{ url: `${base}_profile.png`, format: 'png' }] : [{ url: `${base}_${imageState}.webp`, format: 'webp' }, { url: `${base}_${imageState}.gif`, format: 'gif' }, { url: `${base}_profile.png`, format: 'png' }];
  return <span className={`bot-team-avatar${custom ? ' bot-team-avatar--custom' : ''}`} role="img" aria-label={label || `${name}: ${descriptions[state]}`} data-bot-character={custom ? 'custom' : selected || 'initials'} data-bot-state={state} data-bot-motion={reduced ? 'reduced' : 'full'} style={{ width: size, height: size, fontSize: Math.max(11, size / 3) }}><AvatarImage key={sources.map(source => source.url).join('|')} sources={sources} name={name} /></span>;
}
