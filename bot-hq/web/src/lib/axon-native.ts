export interface NativeEvent { type: 'dictation' | 'speech'; sessionId: string; state: 'recording' | 'transcribing' | 'speaking' | 'complete' | 'cancelled' | 'error'; text?: string; message?: string }
export async function nativeRequest(action: string, options: Record<string, unknown> = {}): Promise<any> {
  const host = (window as unknown as { webkit?: { messageHandlers?: { axoncros?: { postMessage: (message: unknown) => Promise<any> } } } }).webkit?.messageHandlers?.axoncros;
  if (!host) throw new Error('This control is available in the AxonCROS Mac app. Open the installed app to use this Mac service.');
  const result = await host.postMessage({ action, ...options });
  // Google actions return failure/uncertainty as durable receipts, not bridge
  // errors. Preserve only the envelope matching this exact dispatched action.
  if (action === 'executeGoogleAction' && typeof options.requestId === 'string' && typeof options.operation === 'string'
      && result?.requestId === options.requestId && result?.operation === options.operation
      && ['completed', 'failed', 'unknown'].includes(result?.status)) return result;
  if (result?.error || result?.ok === false) throw new Error(result.message || result.error || 'The Mac service could not complete this request.');
  return result;
}
