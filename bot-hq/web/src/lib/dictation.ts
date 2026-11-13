/** Insert a final transcript at the captured selection without joining words. */
export function insertDictation(base: string, selectionStart: number, selectionEnd: number, transcript: string): { text: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, base.length));
  const end = Math.max(start, Math.min(selectionEnd, base.length));
  const spoken = transcript.trim();
  if (!spoken) return { text: base, cursor: start };
  const before = base.slice(0, start), after = base.slice(end);
  const leading = /\S$/.test(before) && !/[([{“‘]$/.test(before) && !/^[,.;:!?%\])}’]/.test(spoken) ? ' ' : '';
  const trailing = /^\S/.test(after) && !/^[,.;:!?%\])}’]/.test(after) && !/[([{“‘]$/.test(spoken) ? ' ' : '';
  return { text: before + leading + spoken + trailing + after, cursor: before.length + leading.length + spoken.length };
}
