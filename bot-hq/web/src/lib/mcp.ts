export type McpPolicy = 'disabled' | 'review' | 'delegated';
export interface McpTool { name: string; title?: string; description?: string; inputSchema: Record<string, unknown>; schemaHash: string; policy: McpPolicy; blocked: boolean; blockReason: string | null; forceReview: boolean }
export interface McpConnection { id: string; name: string; origin: string; status: 'not-configured' | 'configured' | 'discovered' | 'needs-attention'; configured: boolean; discoveredAt: number | null; revision: string | null; quotaConfirmed: boolean; notice: string; tools: McpTool[] }
// The full connection URL can contain a bearer credential. Render an origin only.
export function mcpOrigin(value: string): string { try { const url = new URL(value); return url.protocol === 'https:' ? url.origin : 'Origin unavailable'; } catch { return 'Origin unavailable'; } }
export function agentDraftKey(chat: { id: string; agentMode?: boolean; mcpMode?: boolean; messagesMode?: boolean }): string { return `${chat.messagesMode ? 'messages:' : ''}${chat.mcpMode ? (chat.agentMode ? 'agent+mcp:' : 'mcp:') : chat.agentMode ? 'agent:' : ''}${chat.id}`; }
export function hasAgentMode(chat?: { agentMode?: boolean; mcpMode?: boolean; messagesMode?: boolean }): boolean { return !!(chat?.agentMode || chat?.mcpMode || chat?.messagesMode); }
