import type { BotCharacter } from '../components/BotTeamAvatar';
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export interface WorkspaceRecord { id: string; kind: string; profileId?: string; title: string; body: string; status: string; data: Record<string, any>; version: number; createdAt: number; updatedAt: number }
export interface LocalFile { id: string; name: string; mime: string; size: number; category: string; previewStatus: string; deliverySupported: boolean; createdAt: number; updatedAt: number; profileId?: string; chatId?: string }
export interface Agent { id: string; name: string; avatarUrl: string | null; avatarCharacter?: BotCharacter | null; soul: string; soulVersion: number; version?: number; updatedAt: number }
export async function api<T>(path: string, method = 'GET', body?: unknown, options: { agentMode?: boolean } = {}): Promise<T> {
  // The agent loop can span several model/action steps. This is a client wait
  // allowance, not permission to retry or extend an individual provider request.
  const timeout = method === 'POST' && path.endsWith('/messages') ? (options.agentMode ? 1_230_000 : 340_000) : 30_000;
  try {
    const response = await fetch(`/api${path}`, { method, credentials: 'include', signal: AbortSignal.timeout(timeout),
      ...(method !== 'GET' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) } : {}) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, result?.error || 'The local request did not finish. Please try again.', result?.code);
    if (!result) throw new Error('The local server returned an unreadable response.');
    return result as T;
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    if (cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name)) throw new Error('The connection timed out. The upstream reply may still finish; nothing was retried automatically. Your draft is preserved. Retry checks the same request.');
    throw new Error('AxonCROS couldn’t reach its local server. Your work is preserved. Reopen the app or try again.');
  }
}
export async function uploadFile(file: File, scope: { profileId?: string; chatId?: string; requestId?: string } = {}, signal?: AbortSignal): Promise<LocalFile> {
  const body = new FormData(); body.append('file', file);
  if (scope.profileId) body.append('profileId', scope.profileId);
  if (scope.chatId) body.append('chatId', scope.chatId);
  body.append('requestId', scope.requestId ?? crypto.randomUUID());
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
  const recovery = scope.requestId ? 'Retry checks the same upload; nothing was retried automatically.' : 'The file may already be in Library. Check there before choosing it again.';
  try {
    const response = await fetch('/api/local/files', { method: 'POST', credentials: 'include', body, signal: controller.signal });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, result?.error || 'Upload failed. Try again.', result?.code);
    if (!result?.file?.id) throw new Error('The upload response could not be read. ' + recovery);
    return result.file;
  } catch (cause) {
    if (signal?.aborted || cause instanceof ApiError) throw cause;
    if (timedOut) throw new Error('Upload timed out after 60 seconds. ' + recovery);
    if (cause instanceof Error && cause.message.startsWith('The upload response')) throw cause;
    throw new Error('The upload connection ended before confirmation. ' + recovery);
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
export const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'The request did not finish. Please try again.';
export const displayDate = (value: number | string | undefined) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not recorded';
export const fileSize = (size: number) => size < 1024 ? `${size} B` : size < 1048576 ? `${Math.round(size / 1024)} KB` : `${(size / 1048576).toFixed(1)} MB`;
