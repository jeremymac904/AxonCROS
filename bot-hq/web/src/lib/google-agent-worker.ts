export type GoogleActionState = 'review' | 'queued' | 'running' | 'succeeded' | 'failed' | 'uncertain' | 'cancelled';
export type GoogleExecutionPolicy = 'review-writes' | 'delegated';
export interface GoogleAction {
  id: string; ownerId: string; chatId: string; profileId: string; requestId: string;
  operation: string; args: Record<string, unknown>; state: GoogleActionState;
  executor?: 'native-google' | 'native-messages' | 'server-mcp' | 'server-whatsapp';
  executionPolicy?: GoogleExecutionPolicy; createdAt: number; updatedAt: number;
  result?: Record<string, unknown> | null; error?: string | null;
}
export type DriveFailureCode = 'drive_version_unavailable' | 'drive_version_changed' | 'drive_precondition_failed';
export interface GoogleActionReceipt { status: 'succeeded' | 'failed' | 'uncertain'; result?: Record<string, unknown>; error?: string; errorCode?: DriveFailureCode }
export interface GoogleWorkerIO {
  owner: () => Promise<string | null>;
  pending: () => Promise<GoogleAction[]>;
  claim: (id: string) => Promise<GoogleAction>;
  execute: (action: GoogleAction) => Promise<{ status: string; requestId?: string; operation?: string; result?: Record<string, unknown>; error?: string; errorCode?: string }>;
  complete: (id: string, receipt: GoogleActionReceipt) => Promise<unknown>;
}
export function boundedGoogleResult(result: Record<string, unknown>): Record<string, unknown> {
  const encoded = new TextEncoder().encode(JSON.stringify(result));
  if (encoded.length <= 20_000) return result;
  return { truncated: true, notice: 'The provider completed the action. This saved preview is shortened to fit the local receipt; inspect the provider for the full result.', preview: new TextDecoder().decode(encoded.slice(0, 8_000)) };
}
// Retain a returned provider receipt across view remounts. Retry only saving that
// exact receipt, never a native action. A full app exit leaves the server's
// running action uncertain rather than silently re-executing a possible write.
const receipts = new Map<string, { ownerId: string; receipt: GoogleActionReceipt }>();
export class GoogleAgentWorker {
  private stopped = false;
  private processing = false;
  constructor(readonly ownerId: string, private io: GoogleWorkerIO) {}
  stop() { this.stopped = true; }
  private async ownsSession() { return !this.stopped && await this.io.owner() === this.ownerId && !this.stopped; }
  async tick(): Promise<void> {
    if (this.stopped || this.processing) return;
    this.processing = true;
    try {
      if (!await this.ownsSession()) return;
      for (const [id, saved] of receipts) {
        if (saved.ownerId !== this.ownerId) continue;
        if (!await this.ownsSession()) return;
        await this.io.complete(id, saved.receipt);
        receipts.delete(id);
      }
      const actions = await this.io.pending();
      if (this.stopped) return;
      const queued = actions.find(action => action.state === 'queued' && action.ownerId === this.ownerId && (action.executor === undefined || action.executor === 'native-google' || action.executor === 'native-messages') && action.operation !== 'mcp.call' && action.operation !== 'whatsapp.send');
      if (!queued || !await this.ownsSession()) return;
      const action = await this.io.claim(queued.id);
      if (action.id !== queued.id || action.operation !== queued.operation || action.executor !== queued.executor || action.ownerId !== this.ownerId || action.state !== 'running' || action.executor === 'server-mcp' || action.executor === 'server-whatsapp' || action.operation === 'mcp.call' || action.operation === 'whatsapp.send') throw new Error('The queued action changed owner or state. No native request was made.');
      if (!await this.ownsSession()) return;
      let receipt: GoogleActionReceipt;
      try {
        // Native also compares expectedOwner to its authenticated owner, closing
        // the gap between the last HTTP check and the native request.
        const result = await this.io.execute(action);
        if (result.requestId !== action.id || result.operation !== action.operation) {
          receipt = { status: 'uncertain', error: 'The native receipt did not match this action. Check the provider before requesting it again.' };
        } else if (result.status === 'completed') receipt = { status: 'succeeded', result: boundedGoogleResult(result.result ?? {}) };
        else if (result.status === 'failed') {
          const errorCode = ['drive.update', 'drive.trash'].includes(action.operation) && ['drive_version_unavailable', 'drive_version_changed', 'drive_precondition_failed'].includes(result.errorCode ?? '') ? result.errorCode as DriveFailureCode : undefined;
          receipt = { status: 'failed', error: result.error || 'The provider rejected the action before completion.', ...(errorCode ? { errorCode } : {}) };
        }
        else receipt = { status: 'uncertain', error: result.error || 'The provider did not confirm the result. Check the provider before requesting this action again.' };
      } catch {
        // A bridge rejection is not proof that a remote write did not happen.
        receipt = { status: 'uncertain', error: 'The Mac action returned no confirmed receipt. Check the provider before requesting it again; it will not be repeated automatically.' };
      }
      receipts.set(action.id, { ownerId: this.ownerId, receipt });
      if (!await this.ownsSession()) return;
      await this.io.complete(action.id, receipt);
      receipts.delete(action.id);
    } finally { this.processing = false; }
  }
}
