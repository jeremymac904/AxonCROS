import { WhatsAppChatMode } from './AxonWhatsApp';
import { ConnectedAgentModes } from './ConnectedAgentModes';
import { agentDraftKey, hasAgentMode } from '../lib/mcp';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, Copy, Download, FileText, FolderOpen, Goal, Lightbulb, Menu, MessageCircle, Mic, MicOff, MoreHorizontal, Phone, Plug, Plus, Search, Settings, ShieldCheck, Square, Upload, Users, Waves, X } from 'lucide-react';
import { nativeRequest } from '../lib/axon-native';
import { insertDictation } from '../lib/dictation';
import { Markdown } from './Markdown';
import { LocalResearchViewer, ReplyResearch, type ResearchSelection, type ResearchSource } from './LocalResearch';
import { api, ApiError, errorText, fileSize, uploadFile, type Agent, type LocalFile } from '../lib/axon';
import { AxonAvatar, AxonModal } from './AxonPrimitives';
import { BotTeamAvatar } from './BotTeamAvatar';
import { useBotTeamActivity, type BotActivityToken } from './useBotTeamActivity';
import { AxonFilePreview } from './AxonFilePreview';
import { AxonInspector } from './AxonInspector';
import { WorkspacePages } from './AxonWorkspacePages';
import { useAxonVoice } from './useAxonVoice';
import { GoogleAgentMode, GoogleActionActivity, useGoogleAgentWorker, type AgentModeChat } from './GoogleAgentMode';
import '../styles/axon.css';

interface LocalUser { id: string; name: string; email: string }
interface Profile { id: string; name: string; label: string; about: string; draft: boolean }
interface Chat extends AgentModeChat { id: string; profileId: string; title: string; kind?: 'main' | 'side'; latestPreview?: string; createdAt: number; updatedAt: number }
interface Message { id: string; role: 'user' | 'assistant'; text: string; createdAt: number; sources?: ResearchSource[]; citationWarning?: string | null; researchNotice?: string | null; attachments?: LocalFile[] }
interface Gateway { status: 'ready' | 'unavailable'; model: string; message: string }
interface Pending { text: string; attachmentIds: string[]; requestId: string; terminal?: 'failed' | 'interrupted' }
interface UploadItem { localId: string; requestId?: string; file?: File; record?: LocalFile; name: string; size: number; state: 'uploading' | 'ready' | 'error'; error?: string }
const chatsPath = (profileId: string) => `/local/chats?profileId=${encodeURIComponent(profileId)}`;
const preferredProfile = () => { try { return localStorage.getItem('bot-hq-local-text-profile') || 'general'; } catch { return 'general'; } };
const safeRoute = () => window.location.hash.slice(1) || '/chat';
const isChatRoute = (route: string) => route === '/chat' || route.startsWith('/chat/');
function assertProfile(chat: Chat, id: string) { if (chat.profileId !== id) throw new Error('This conversation belongs to a different assistant. Reload its chat list.'); }
function sameAttempt(attempt: Pending | undefined, text: string, ids: string[]) { return !!attempt && attempt.text === text && JSON.stringify(attempt.attachmentIds ?? []) === JSON.stringify(ids); }
const navItems = [
  ['/chat', MessageCircle, 'Chat'], ['/search', Search, 'Search'], ['/feed', FileText, 'Feed'], ['/ideas', Lightbulb, 'Ideas'], ['/goals', Goal, 'Goals'], ['/contacts', Users, 'Contacts'], ['/library/spaces', FolderOpen, 'Spaces'], ['/pipeline', ShieldCheck, 'Pipeline'],
] as const;

export function LocalTextApp() {
  const [checked, setChecked] = useState(false), [user, setUser] = useState<LocalUser | null>(null);
  const googleWorker = useGoogleAgentWorker(checked ? user?.id ?? null : null);
  const [profiles, setProfiles] = useState<Profile[]>([]), [agents, setAgents] = useState<Record<string, Agent>>({});
  const [profileId, setProfileId] = useState('general'), [chats, setChats] = useState<Chat[]>([]);
  const botActivity = useBotTeamActivity(`${user?.id || 'locked'}:${profileId}`);
  const [selectedId, setSelectedId] = useState<string | null>(null), [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({}), [uploads, setUploads] = useState<Record<string, UploadItem[]>>({});
  const [preferences, setPreferences] = useState<any>({});
  const [gateway, setGateway] = useState<Gateway | null>(null), [capabilities, setCapabilities] = useState<any>(null);
  const [checkingGateway, setCheckingGateway] = useState(false), [loadingChat, setLoadingChat] = useState(false);
  const [busy, setBusy] = useState(false), [optimistic, setOptimistic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null), [bootError, setBootError] = useState<string | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0), [deleteChat, setDeleteChat] = useState<Chat | null>(null);
  const [googleActivityHint, setGoogleActivityHint] = useState('');
  const [permissionsExpanded, setPermissionsExpanded] = useState(false), [pausingConnections, setPausingConnections] = useState(false);
  const [inspectorBusy, setInspectorBusy] = useState(false);
  const [deleting, setDeleting] = useState(false), [stopping, setStopping] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false), [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 1050);
  const [chooser, setChooser] = useState(false), [chooserQuery, setChooserQuery] = useState('');
  const [chatQuery, setChatQuery] = useState(''), [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false), [highlightMessage, setHighlightMessage] = useState<string | null>(null);
  const [route, setRoute] = useState(safeRoute), [createMenu, setCreateMenu] = useState(false);
  const [researchSelection, setResearchSelection] = useState<ResearchSelection | null>(null);
  const [invite, setInvite] = useState(false), [inviteRecipient, setInviteRecipient] = useState(''), [inviteRole, setInviteRole] = useState('viewer'), [inviteError, setInviteError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<LocalFile | null>(null), [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null), [chatMenu, setChatMenu] = useState(false);
  const stopRequested = useRef(false);
  const activeSend = useRef<{ chatId: string | null; requestId?: string; submitted: boolean; cancelled: boolean; activity?: BotActivityToken } | null>(null);
  const pending = useRef(new Map<string, Pending>()), working = useRef(false), selection = useRef(0), currentProfile = useRef('general');
  const lastSelected = useRef(new Map<string, string>()), uploadControllers = useRef(new Map<string, AbortController>());
  const textarea = useRef<HTMLTextAreaElement>(null), filePicker = useRef<HTMLInputElement>(null), transcript = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null), latestReply = useRef<HTMLElement>(null), dragDepth = useRef(0);
  const dictationCursor = useRef<{ key: string; cursor: number; version: number } | null>(null);
  const dictationInsertion = useRef<{ key: string; text: string; start: number; end: number } | null>(null);
  const profile = profiles.find(item => item.id === profileId), agent = agents[profileId];
  const agentName = agent?.name || profile?.name || 'Assistant';
  const selected = chats.find(chat => chat.id === selectedId), draftKey = selectedId ? (selected ? agentDraftKey(selected) : selectedId) : `new:${profileId}`;
  const draft = drafts[draftKey] ?? '', queue = uploads[draftKey] ?? [];
  const attachmentIds = queue.filter(item => item.state === 'ready' && item.record?.deliverySupported).map(item => item.record!.id);
  const unresolvedUploads = queue.some(item => item.state !== 'ready' || !item.record?.deliverySupported);
  const pendingAttempt = pending.current.get(draftKey), terminalFailure = sameAttempt(pendingAttempt, draft.trim(), attachmentIds) && !!pendingAttempt?.terminal;
  const chatPage = isChatRoute(route);
  const [assistantPreviews, setAssistantPreviews] = useState<Record<string, string>>({});
  const fail = (cause: unknown) => { if (cause instanceof ApiError && cause.status === 401) { setUser(null); setMessages([]); setChats([]); } setError(errorText(cause)); };
  const rememberDraft = (text: string, key = draftKey) => setDrafts(saved => ({ ...saved, [key]: text }));

  const voice = useAxonVoice({
    language: preferences.dictationLanguage || 'en-US', voice: preferences.voiceByProfile?.[profileId]?.voice, rate: preferences.voiceByProfile?.[profileId]?.rate ?? preferences.voiceRate ?? 1,
    onCancelTurn: () => { if (working.current) void stopReply(); },
    onDictation: text => { const place = dictationInsertion.current; if (!place) return; const inserted = insertDictation(place.text, place.start, place.end, text), version = selection.current; dictationCursor.current = { key: place.key, cursor: inserted.cursor, version }; rememberDraft(inserted.text, place.key); dictationInsertion.current = null; },
    onTurn: text => send(false, text),
  });
  useLayoutEffect(() => { const pendingCursor = dictationCursor.current; if (!pendingCursor) return; dictationCursor.current = null; if (pendingCursor.key === draftKey && pendingCursor.version === selection.current) { textarea.current?.focus(); textarea.current?.setSelectionRange(pendingCursor.cursor, pendingCursor.cursor); } }, [draft, draftKey, voice.active]);
  const navigate = (next: string) => { if (!isChatRoute(next)) botActivity.reset(); if (voice.active && !isChatRoute(next)) { voice.end(); dictationInsertion.current = null; } setSidebarOpen(false); setCreateMenu(false); setChatMenu(false); window.location.hash = next; setRoute(next); };
  const checkGateway = async () => { setCheckingGateway(true); try { setGateway(await api<Gateway>('/local/status')); } catch (cause) { if (cause instanceof ApiError && cause.status === 401) setUser(null); else setGateway({ status: 'unavailable', model: '', message: 'The dedicated local gateway could not be reached.' }); } finally { setCheckingGateway(false); } };
  useEffect(() => { const old = document.title; document.title = 'AxonCROS'; const changed = () => setRoute(safeRoute()); window.addEventListener('hashchange', changed); return () => { document.title = old; window.removeEventListener('hashchange', changed); }; }, []);
  useEffect(() => { if (!chatPage && voice.active) voice.end(); if (chatPage && checked && user) void api<any>('/local/settings').then(result => { setPreferences(result.settings); document.documentElement.dataset.appearance = result.settings.appearance || 'light'; }).catch(() => {}); }, [chatPage]);
  useEffect(() => {
    let active = true; setChecked(false); setBootError(null);
    void (async () => {
      try {
        const auth = await api<{ user: LocalUser | null }>('/auth/me'); if (!active) return; setUser(auth.user);
        if (auth.user) {
          try { const saved = JSON.parse(localStorage.getItem(`bot-hq-local-drafts:${auth.user.id}`) || '{}'); setDrafts(saved.drafts || {}); setUploads(saved.uploads || {}); pending.current = new Map(saved.pending || []); } catch { /* Optional local draft recovery. */ }
          const [catalog, identities, caps, prefs] = await Promise.all([api<{ profiles: Profile[] }>('/local/profiles'), api<{ agents: Agent[] }>('/local/agents'), api<any>('/local/capabilities'), api<any>('/local/settings')]);
          if (!active) return;
          if (!catalog.profiles.some(item => item.id === 'general')) throw new Error('Assistant profiles could not be loaded.');
          const preferred = preferredProfile(), initial = catalog.profiles.some(item => item.id === preferred) ? preferred : 'general';
          setPreferences(prefs.settings); document.documentElement.dataset.appearance = prefs.settings.appearance || 'light'; setProfiles(catalog.profiles); setAgents(Object.fromEntries(identities.agents.map(item => [item.id, item]))); setCapabilities(caps); setProfileId(initial); currentProfile.current = initial;
          const result = await api<{ chats: Chat[] }>(chatsPath(initial)); if (!active) return;
          result.chats.forEach(chat => assertProfile(chat, initial)); setChats(result.chats);
          let previous: string | undefined; try { previous = localStorage.getItem(`bot-hq-local-chat:${initial}`) || undefined; } catch {}
          const first = result.chats.find(chat => chat.id === previous) ?? result.chats.find(chat => chat.kind === 'main') ?? result.chats[0];
          if (first) { const conversation = await api<{ chat: Chat; messages: Message[] }>(`/local/chats/${first.id}`); if (!active) return; assertProfile(conversation.chat, initial); setSelectedId(first.id); setMessages(conversation.messages); lastSelected.current.set(initial, first.id); }
          else { setSelectedId(null); setMessages([]); }
          if (active) void checkGateway();
        }
      } catch (cause) { if (active) setBootError(errorText(cause)); }
      finally { if (active) setChecked(true); }
    })();
    return () => { active = false; };
  }, [bootAttempt]);
  useEffect(() => {
    const match = /^\/chat\/([^/?]+)$/.exec(route);
    if (!match || !checked || !user || busy || match[1] === selectedId) return;
    if (voice.active) { setError('End the active call before opening a different conversation.'); return; }
    botActivity.reset(); const version = ++selection.current; setLoadingChat(true); setError(null);
    void (async () => {
      const conversation = await api<{ chat: Chat; messages: Message[] }>(`/local/chats/${encodeURIComponent(match[1])}`);
      if (version !== selection.current) return;
      if (!profiles.some(item => item.id === conversation.chat.profileId)) throw new Error('This assistant is not available in this workspace.');
      const id = conversation.chat.profileId;
      const result = await api<{ chats: Chat[] }>(chatsPath(id));
      if (version !== selection.current) return;
      result.chats.forEach(chat => assertProfile(chat, id)); currentProfile.current = id; setProfileId(id); setChats(result.chats); setSelectedId(conversation.chat.id); setMessages(conversation.messages); setHighlightMessage(null); rememberSelection(id, conversation.chat.id);
      try { localStorage.setItem('bot-hq-local-text-profile', id); } catch {}
    })().catch(cause => { if (version === selection.current) fail(cause); }).finally(() => { if (version === selection.current) setLoadingChat(false); });
    return () => { if (version === selection.current) selection.current++; };
  }, [route, checked, user, busy]);
  useEffect(() => {
    if (!user || !checked) return;
    const storedUploads = Object.fromEntries(Object.entries(uploads).map(([key, list]) => [key, list.map(({ file: _file, ...item }) => ({ ...item, state: item.state === 'uploading' ? 'error' : item.state, error: item.state === 'uploading' ? 'Upload interrupted. Remove this item and choose the file again.' : item.error }))]));
    try { localStorage.setItem(`bot-hq-local-drafts:${user.id}`, JSON.stringify({ drafts, uploads: storedUploads, pending: [...pending.current] })); } catch { /* Browser storage may be unavailable; session state remains intact. */ }
  }, [drafts, uploads, busy, user, checked]);
  useEffect(() => () => { uploadControllers.current.forEach(controller => controller.abort()); }, []);
  useEffect(() => { if (!notice) return; const id = window.setTimeout(() => setNotice(null), 3500); return () => clearTimeout(id); }, [notice]);
  useEffect(() => {
    if (highlightMessage) { document.getElementById(`message-${highlightMessage}`)?.scrollIntoView({ block: 'center' }); return; }
    const latest = messages.at(-1);
    if (!busy && !optimistic && latest?.role === 'assistant' && (latest.sources?.length || latest.researchNotice)) latestReply.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, optimistic, busy, highlightMessage]);
  useEffect(() => { if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`; } }, [draft, busy]);
  useEffect(() => {
    if (!chooser) return; let active = true;
    void Promise.all(profiles.map(async item => { const result = await api<{ chats: Chat[] }>(chatsPath(item.id)); return [item.id, result.chats[0]?.latestPreview || result.chats[0]?.title || 'No conversations yet'] as const; })).then(entries => { if (active) setAssistantPreviews(Object.fromEntries(entries)); }).catch(() => {});
    return () => { active = false; };
  }, [chooser, profiles]);
  const rememberSelection = (id: string, chatId: string) => { lastSelected.current.set(id, chatId); try { localStorage.setItem(`bot-hq-local-chat:${id}`, chatId); } catch {} };
  const refreshChats = async (id: string) => { const version = selection.current; const result = await api<{ chats: Chat[] }>(chatsPath(id)); result.chats.forEach(chat => assertProfile(chat, id)); if (id === currentProfile.current && selection.current === version) setChats(result.chats); };
  const chooseProfile = async (id: string) => {
    if (working.current || inspectorBusy || voice.active || !profiles.some(item => item.id === id)) return;
    setChooser(false); if (id === currentProfile.current) return;
    const version = ++selection.current; currentProfile.current = id; setProfileId(id); try { localStorage.setItem('bot-hq-local-text-profile', id); } catch {}
    navigate('/chat'); setResearchSelection(null); setChatQuery(''); setSearchResults(null); setChats([]); setSelectedId(null); setMessages([]); setLoadingChat(true); setError(null); setHighlightMessage(null); setSidebarOpen(false);
    try {
      const result = await api<{ chats: Chat[] }>(chatsPath(id)); if (version !== selection.current || currentProfile.current !== id) return;
      result.chats.forEach(chat => assertProfile(chat, id)); setChats(result.chats);
      const previous = lastSelected.current.get(id); const chat = result.chats.find(item => item.id === previous) ?? result.chats.find(item => item.kind === 'main') ?? result.chats[0];
      if (chat) { const conversation = await api<{ chat: Chat; messages: Message[] }>(`/local/chats/${chat.id}`); if (version !== selection.current || currentProfile.current !== id) return; assertProfile(conversation.chat, id); setSelectedId(chat.id); setMessages(conversation.messages); rememberSelection(id, chat.id); navigate(`/chat/${chat.id}`); }
    } catch (cause) { if (version === selection.current) fail(cause); }
    finally { if (version === selection.current) setLoadingChat(false); }
  };
  const chooseChat = async (chat: Chat, messageId?: string) => {
    if (working.current || voice.active || chat.profileId !== currentProfile.current) return;
    botActivity.reset(); const id = currentProfile.current, version = ++selection.current;
    rememberSelection(id, chat.id); setSelectedId(chat.id); setMessages([]); setLoadingChat(true); setError(null); setSidebarOpen(false); setHighlightMessage(messageId || null); navigate(`/chat/${chat.id}`);
    try { const result = await api<{ chat: Chat; messages: Message[] }>(`/local/chats/${chat.id}`); if (version === selection.current && id === currentProfile.current) { assertProfile(result.chat, id); setMessages(result.messages); } }
    catch (cause) { if (version === selection.current) fail(cause); }
    finally { if (version === selection.current) setLoadingChat(false); }
  };
  const newChat = async (kind: 'main' | 'side' = 'side') => {
    if (working.current || loadingChat || voice.active) return;
    botActivity.reset(); const id = currentProfile.current; working.current = true; setBusy(true); setError(null);
    try { const { chat } = await api<{ chat: Chat }>('/local/chats', 'POST', { profileId: id, kind }); assertProfile(chat, id); rememberSelection(id, chat.id); ++selection.current; setChats(items => [chat, ...items.filter(item => item.id !== chat.id)]); setSelectedId(chat.id); const conversation = await api<{ chat: Chat; messages: Message[] }>(`/local/chats/${chat.id}`); setMessages(conversation.messages); setSidebarOpen(false); setHighlightMessage(null); navigate(`/chat/${chat.id}`); }
    catch (cause) { fail(cause); } finally { working.current = false; setBusy(false); textarea.current?.focus(); }
  };
  async function send(newAttempt = false, spokenText?: string): Promise<string | null> {
    const text = (spokenText ?? draft).trim(), ids = spokenText === undefined ? attachmentIds : [];
    if ((!text && !ids.length) || working.current || loadingChat || (spokenText === undefined && (voice.active || unresolvedUploads || (terminalFailure && !newAttempt)))) return null;
    botActivity.reset(); working.current = true; setBusy(true); setError(null); setOptimistic(text || 'Attached files'); setHighlightMessage(null);
    const id = currentProfile.current, agentTurn = hasAgentMode(selected); let chatId = selectedId; let sentKey = draftKey;
    const operation = { chatId, submitted: false, cancelled: false, requestId: undefined as string | undefined, activity: undefined as BotActivityToken | undefined }; activeSend.current = operation;
    try {
      if (!chatId) {
        const { chat } = await api<{ chat: Chat }>('/local/chats', 'POST', { profileId: id, kind: chats.some(item => item.kind === 'main') ? 'side' : 'main' }); assertProfile(chat, id);
        if (hasAgentMode(chat)) throw new Error('An existing agent conversation was found. Open it explicitly or create a new side chat before sending; your draft is preserved.');
        rememberSelection(id, chat.id); chatId = chat.id;
        setChats(items => [chat, ...items.filter(item => item.id !== chat.id)]); setSelectedId(chat.id);
        if (spokenText === undefined) { setDrafts(saved => ({ ...saved, [draftKey]: '', [chat.id]: text })); setUploads(saved => ({ ...saved, [draftKey]: [], [chat.id]: saved[draftKey] || [] })); } sentKey = chat.id; operation.chatId = chat.id;
      }
      if (operation.cancelled) { if (spokenText !== undefined) { const key = sentKey; setDrafts(saved => ({ ...saved, [key]: saved[key] ? `${saved[key]}\n\n${text}` : text })); } setError('Cancelled before submission. No reply was requested; your words are preserved as a draft.'); return null; }
      const previous = pending.current.get(sentKey), attempt: Pending = !newAttempt && sameAttempt(previous, text, ids) ? previous! : { text, attachmentIds: ids, requestId: crypto.randomUUID() };
      pending.current.set(sentKey, attempt); operation.requestId = attempt.requestId; operation.submitted = true; operation.activity = botActivity.begin('thinking');
      const result = await api<{ messages: Message[] }>(`/local/chats/${chatId}/messages`, 'POST', { text: attempt.text, attachmentIds: attempt.attachmentIds, requestId: attempt.requestId }, { agentMode: agentTurn });
      botActivity.finish(operation.activity, !operation.cancelled && result.messages.some(message => message.role === 'assistant' && !messages.some(old => old.id === message.id)));
      setMessages(result.messages); pending.current.delete(sentKey); if (operation.cancelled) { setError(null); setNotice('The reply finished before cancellation and was saved.'); }
      if (spokenText === undefined) { const doneKey = sentKey; setDrafts(saved => ({ ...saved, [doneKey]: '' })); setUploads(saved => ({ ...saved, [doneKey]: [] })); }
      void refreshChats(id).catch(() => { if (currentProfile.current === id) setError('Your reply is saved. The conversation list could not refresh.'); });
      return result.messages.filter(message => message.role === 'assistant').at(-1)?.text ?? null;
    } catch (cause) {
      botActivity.finish(operation.activity);
      if (chatId && cause instanceof ApiError && ['failed', 'interrupted'].includes(cause.code ?? '')) { const attempt = pending.current.get(sentKey); if (attempt) attempt.terminal = cause.code as 'failed' | 'interrupted'; }
      if (spokenText !== undefined) { const key = sentKey; setDrafts(saved => ({ ...saved, [key]: saved[key] ? `${saved[key]}\n\n${text}` : text })); }
      fail(cause);
      if (chatId) { try { const conversation = await api<{ chat: Chat; messages: Message[] }>(`/local/chats/${chatId}`); assertProfile(conversation.chat, id); setMessages(conversation.messages); } catch {} }
      return null;
    } finally { if (activeSend.current === operation) activeSend.current = null; working.current = false; setBusy(false); setStopping(false); stopRequested.current = false; setOptimistic(null); textarea.current?.focus(); }
  }
  const stopReply = async () => {
    const operation = activeSend.current; if (!operation || stopRequested.current) return;
    operation.cancelled = true; botActivity.finish(operation.activity); stopRequested.current = true; setStopping(true); voice.end();
    if (selected?.messagesMode) { try { await nativeRequest('cancelMessagesActions'); } catch { setNotice('Messages cancellation could not be confirmed. A dispatched send may still finish.'); } }
    if (selected?.agentMode && googleWorker.available) { try { await nativeRequest('cancelGoogleActions'); } catch { setNotice('Google cancellation could not be confirmed. An action already sent may still finish.'); } }
    if (!operation.chatId || !operation.submitted) { setError('Cancelling before submission…'); return; }
    try { await api(`/local/chats/${operation.chatId}/cancel`, 'POST', { requestId: operation.requestId }); if (activeSend.current === operation) setError('Stopped waiting for this reply. The upstream result may still finish; nothing will retry automatically.'); }
    catch (cause) { if (activeSend.current === operation) { fail(cause); setStopping(false); stopRequested.current = false; } }
  };
  const pauseConnections = async () => {
    if (!selected || pausingConnections) return;
    const target = selected; setPausingConnections(true);
    try {
      if (working.current) await stopReply();
      const modes: [string, Record<string, unknown>][] = [];
      if (target.agentMode) modes.push(['agent', { executionPolicy: target.executionPolicy || 'review-writes' }]);
      if (target.mcpMode) modes.push(['mcp', { connectionIds: [] }]);
      if (target.messagesMode) modes.push(['messages', { executionPolicy: target.messagesExecutionPolicy || 'review-writes' }]);
      if (target.whatsappMode) modes.push(['whatsapp', { executionPolicy: target.whatsappExecutionPolicy || 'review-writes', recipients: target.whatsappRecipients || [] }]);
      for (const [mode, fields] of modes) {
        const result = await api<{ chat: Chat }>(`/local/chats/${target.id}/${mode}-mode`, 'PATCH', { enabled: false, contextConsent: false, ...fields });
        setChats(items => items.map(item => item.id === target.id ? { ...item, ...result.chat } : item));
      }
      await Promise.allSettled([nativeRequest('cancelGoogleActions'), nativeRequest('cancelMessagesActions')]);
      setNotice('Connected actions paused for this chat. Check any already dispatched action receipts.');
    } catch (cause) { fail(cause); } finally { setPausingConnections(false); }
  };
  const addFiles = (files: File[], retryRequestId?: string) => {
    if (!files.length || busy) return;
    const key = draftKey, id = profileId, chatId = selectedId ?? undefined;
    for (const file of files) {
      const localId = crypto.randomUUID(), requestId = retryRequestId ?? localId, controller = new AbortController(); uploadControllers.current.set(localId, controller);
      setUploads(saved => ({ ...saved, [key]: [...(saved[key] || []), { localId, requestId, file, name: file.name, size: file.size, state: 'uploading' }] }));
      void uploadFile(file, { profileId: id, chatId, requestId }, controller.signal).then(record => setUploads(saved => ({ ...saved, [key]: (saved[key] || []).map(item => item.localId === localId ? { ...item, record, state: 'ready', file: undefined } : item) }))).catch(cause => { if (!controller.signal.aborted) setUploads(saved => ({ ...saved, [key]: (saved[key] || []).map(item => item.localId === localId ? { ...item, state: 'error', error: errorText(cause) } : item) })); }).finally(() => uploadControllers.current.delete(localId));
    }
  };
  const removeUpload = (item: UploadItem) => { uploadControllers.current.get(item.localId)?.abort(); setUploads(saved => ({ ...saved, [draftKey]: (saved[draftKey] || []).filter(entry => entry.localId !== item.localId) })); };
  const removeChat = async () => {
    if (!deleteChat || working.current) return; const removing = deleteChat; botActivity.reset(); ++selection.current; working.current = true; setDeleting(true);
    try { await api(`/local/chats/${removing.id}`, 'DELETE'); setChats(items => items.filter(item => item.id !== removing.id)); setDeleteChat(null); pending.current.delete(removing.id); pending.current.delete(`agent:${removing.id}`); if (lastSelected.current.get(removing.profileId) === removing.id) lastSelected.current.delete(removing.profileId); setDrafts(saved => { const next = { ...saved }; delete next[removing.id]; delete next[`agent:${removing.id}`]; return next; }); setUploads(saved => { const next = { ...saved }; delete next[removing.id]; delete next[`agent:${removing.id}`]; return next; }); if (selectedId === removing.id) { setSelectedId(null); setMessages([]); setError(null); navigate('/chat'); } }
    catch (cause) { setDeleteChat(null); fail(cause); } finally { working.current = false; setDeleting(false); }
  };
  const searchChats = async () => { const q = chatQuery.trim(); if (!q) { setSearchResults(null); return; } setSearching(true); setError(null); const version = selection.current; try { const loaded = await Promise.all(chats.map(async chat => ({ chat, ...(await api<{ messages: Message[] }>(`/local/chats/${chat.id}`)) }))); if (version !== selection.current) return; setSearchResults(loaded.flatMap(({ chat, messages: rows }) => rows.filter(message => message.text.toLowerCase().includes(q.toLowerCase())).map(message => ({ chat, message })))); } catch (cause) { fail(cause); } finally { setSearching(false); } };
  const discuss = async (text: string, target?: string) => {
    if (working.current || voice.active) { setError('Finish the current reply or call before opening a discussion.'); return; }
    const id = target && profiles.some(item => item.id === target) ? target : profileId;
    if (id !== currentProfile.current) await chooseProfile(id);
    botActivity.reset(); working.current = true; setBusy(true); setError(null);
    try { const { chat } = await api<{ chat: Chat }>('/local/chats', 'POST', { profileId: id, kind: 'side', title: text.split('\n')[0].slice(0, 90) || 'Workspace discussion' }); assertProfile(chat, id); ++selection.current; currentProfile.current = id; setProfileId(id); setChats(items => [chat, ...items.filter(item => item.profileId === id)]); setSelectedId(chat.id); setMessages([]); rememberSelection(id, chat.id); rememberDraft(text, chat.id); navigate(`/chat/${chat.id}`); }
    catch (cause) { fail(cause); } finally { working.current = false; setBusy(false); }
  };
  const openLinkedChat = (chatId: string, text?: string) => {
    if (working.current || voice.active) { setError('Finish the current reply or call before opening this item conversation.'); return; }
    if (text) setDrafts(saved => saved[chatId]?.trim() ? saved : { ...saved, [chatId]: text });
    navigate(`/chat/${encodeURIComponent(chatId)}`);
  };
  const createAgentConversation = async (): Promise<Chat | null> => {
    if (working.current || voice.active) return null;
    const id = currentProfile.current; working.current = true; setBusy(true);
    try {
      const { chat } = await api<{ chat: Chat }>('/local/chats', 'POST', { profileId: id, kind: 'side', title: 'Connected agent conversation' });
      assertProfile(chat, id); ++selection.current; setChats(items => [chat, ...items.filter(item => item.id !== chat.id)]); setSelectedId(chat.id); setMessages([]); rememberSelection(id, chat.id); navigate(`/chat/${chat.id}`); return chat;
    } finally { working.current = false; setBusy(false); }
  };
  const changeAgentMode = (updated: AgentModeChat) => {
    setChats(items => items.map(chat => chat.id === updated.id ? { ...chat, ...updated } : chat));
    setNotice(hasAgentMode(updated) ? 'Connected action permissions saved for this conversation.' : 'Connected actions paused. An action already sent may still finish.');
  };
  const copyMessage = async (message: Message) => { try { await navigator.clipboard.writeText(message.text); setNotice('Message copied'); } catch { setError('Copy was not available. Select the message text to copy it.'); } };
  const downloadMessage = (message: Message) => { const blob = new Blob([message.text], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `AxonCROS-${message.id}.txt`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); };
  const beginDictation = () => { dictationInsertion.current = { key: draftKey, text: draft, start: textarea.current?.selectionStart ?? draft.length, end: textarea.current?.selectionEnd ?? draft.length }; void voice.start('dictation'); };
  const updateAgent = (updated: Agent) => setAgents(saved => ({ ...saved, [updated.id]: updated }));
  if (!checked) return <div className="axon-boot" role="status"><img src="/assets/axoncros/AxonCROS_Primary_Logo.png" alt="AxonCROS" /><p>Opening your local workspace…</p></div>;
  if (bootError) return <div className="axon-boot" role="alert"><h1>Couldn’t open AxonCROS</h1><p>{bootError}</p><button className="axon-button axon-button--primary" onClick={() => setBootAttempt(value => value + 1)}>Try again</button></div>;
  if (!user) return <div className="axon-boot"><img src="/assets/axoncros/AxonCROS_Primary_Logo.png" alt="AxonCROS" /><h1>Your local workspace is locked</h1><p>Open AxonCROS on this Mac to unlock your workspace.</p><button className="axon-button" onClick={() => setBootAttempt(value => value + 1)}>Check again</button></div>;
  return <div className={`axon-shell${chatPage ? ' axon-shell--chat' : ''}${inspectorOpen && chatPage ? ' axon-shell--inspector' : ''}${sidebarOpen ? ' axon-shell--sidebar-open' : ''}`}>
    <nav className="axon-rail" aria-label="Workspace navigation"><button className="axon-rail-logo" onClick={() => navigate('/chat')} aria-label="AxonCROS home"><img src="/assets/axoncros/AxonCROS_Symbol.png" alt="" /></button><div className="axon-rail-items">{navItems.map(([href, Glyph, label]) => <button key={href} title={label} aria-label={label} aria-current={route.startsWith(href === '/library/spaces' ? '/library' : href) ? 'page' : undefined} onClick={() => navigate(href)}><Glyph size={22} strokeWidth={1.7} /><span>{label}</span></button>)}</div><div className="axon-rail-create"><button title="Create" aria-label="Create" aria-expanded={createMenu} onClick={() => setCreateMenu(value => !value)}><Plus size={24} /></button>{createMenu && <div className="axon-create-menu"><strong>Create</strong><button onClick={() => void newChat('side')}>Side chat</button><button onClick={() => navigate('/goals/existing?create=1')}>Goal</button><button onClick={() => navigate('/library/spaces?create=1')}>Space</button><button onClick={() => navigate('/library/documents?upload=1')}>Upload file</button></div>}</div><div className="axon-rail-foot"><button title="Settings" aria-label="Settings" onClick={() => navigate('/settings/general')}><Settings size={21} /></button><button title={user.name || 'Your profile'} aria-label="Your profile" onClick={() => navigate('/settings/general')}><AxonAvatar name={user.name || 'Local owner'} size={32} /></button></div></nav>
    {chatPage && <>
      {sidebarOpen && <button className="axon-drawer-backdrop" aria-label="Close conversations" onClick={() => setSidebarOpen(false)} />}
      <aside className="axon-context" aria-label="Conversations"><div className="axon-context-brand"><img src="/assets/axoncros/AxonCROS_Primary_Logo.png" alt="AxonCROS" /><span>Personal workspace</span><button className="axon-icon axon-mobile-close" aria-label="Close conversations" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div><button className="axon-agent-selector" onClick={() => setChooser(true)} disabled={busy || inspectorBusy || voice.active}><BotTeamAvatar name={agentName} character={agent?.avatarCharacter} src={agent?.avatarUrl} size={40} /><span><strong>{agentName}</strong><small>{profile?.label || 'Local assistant'}</small></span><ChevronDown size={15} /></button><form className="axon-chat-search" onSubmit={e => { e.preventDefault(); void searchChats(); }}><Search size={16} /><input value={chatQuery} onChange={e => { setChatQuery(e.target.value); if (!e.target.value) setSearchResults(null); }} placeholder="Search chats" aria-label="Search this assistant’s conversations" /><button className="axon-sr-only" type="submit">Search conversations</button></form><div className="axon-context-scroll">{searching && <p className="axon-help" role="status">Searching conversations…</p>}{searchResults ? <><div className="axon-section-heading"><h3>Message matches</h3><button className="axon-icon" aria-label="Clear conversation search" onClick={() => { setSearchResults(null); setChatQuery(''); }}><X size={15} /></button></div>{searchResults.map(({ chat, message }) => <button key={message.id} className="axon-chat-row" disabled={busy || inspectorBusy || voice.active} onClick={() => void chooseChat(chat, message.id)}><strong>{chat.title}</strong><small>{message.text}</small></button>)}{!searchResults.length && <p className="axon-help">No matching messages for this assistant.</p>}</> : <><button className={`axon-main-chat${selected?.kind === 'main' ? ' is-selected' : ''}`} disabled={busy || voice.active || loadingChat} onClick={() => { const main = chats.find(chat => chat.kind === 'main'); if (main) void chooseChat(main); else void newChat('main'); }}><MessageCircle size={20} /><span>Main chat</span></button><div className="axon-section-heading"><h3>Channels</h3><button className="axon-icon" aria-label="Manage messaging channels" onClick={() => navigate('/settings/messaging-channels')}><Plus size={15} /></button></div>{capabilities?.channels?.length ? capabilities.channels.map((channel: any) => <button className="axon-channel-row" key={channel.id} onClick={() => navigate('/settings/messaging-channels')}><MessageCircle size={18} /><span>{channel.name || channel.id}<small>{channel.status}</small></span></button>) : <button className="axon-channel-row" onClick={() => navigate('/settings/messaging-channels')}><MessageCircle size={18} /><span>Messaging channels<small>Review connection status</small></span></button>}<div className="axon-section-heading"><h3>Side chats</h3><button className="axon-icon" aria-label="Create side chat" disabled={busy || voice.active || loadingChat} onClick={() => void newChat('side')}><Plus size={16} /></button></div>{chats.filter(chat => chat.kind !== 'main').map(chat => <button className={`axon-chat-row${chat.id === selectedId ? ' is-selected' : ''}`} key={chat.id} disabled={busy || inspectorBusy || voice.active} onClick={() => void chooseChat(chat)}><strong>{chat.title}</strong><small>{chat.latestPreview || 'Open conversation'}</small></button>)}{!chats.some(chat => chat.kind !== 'main') && <p className="axon-help">Keep separate topics in their own conversation.</p>}</>}</div><div className="axon-owner"><button onClick={() => navigate('/settings/general')}><AxonAvatar name={user.name || 'Local owner'} size={34} /><span><strong>{user.name || 'Local owner'}</strong><small>Profile and preferences</small></span></button><button className="axon-icon axon-connector" title="Connectors" aria-label="Connectors" onClick={() => navigate('/settings/connectors')}><Plug size={18} /></button></div></aside>
    </>}
    <main className="axon-chat-main" hidden={!chatPage} onDragEnter={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); }} onDragLeave={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); } }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); setDragging(false); dragDepth.current = 0; addFiles(Array.from(event.dataTransfer.files)); } }}>
      {dragging && <div className="axon-drop-overlay"><Upload size={34} /><strong>Drop files to attach</strong><span>Files stay with this conversation.</span></div>}
      <header className="axon-chat-header"><button className="axon-icon axon-mobile-toggle" aria-label="Open conversations" onClick={() => setSidebarOpen(true)}><Menu size={21} /></button><button className="axon-header-agent" onClick={() => setChooser(true)} disabled={busy || inspectorBusy || voice.active}><BotTeamAvatar name={agentName} character={agent?.avatarCharacter} src={agent?.avatarUrl} state={botActivity.state} size={40} /><strong>{agentName}</strong><ChevronDown size={14} /></button><div className="axon-header-actions"><button aria-label={voice.mode === 'call' ? 'End call' : 'Call'} className={`axon-button${voice.mode === 'call' ? ' is-active' : ''}`} disabled={busy && !voice.active} onClick={() => voice.mode === 'call' ? voice.end() : void voice.start('call')}><Phone size={16} /><span>{voice.mode === 'call' ? 'End call' : 'Call'}</span></button><button className="axon-button" aria-label="Invite" onClick={() => { setInvite(true); setInviteError(null); }}><Plus size={17} /><span>Invite</span></button><button className="axon-icon" aria-label={inspectorOpen ? 'Close agent inspector' : 'Open agent inspector'} aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(value => !value)}><Users size={19} /></button><div className="axon-header-menu"><button className="axon-icon" aria-label="Conversation actions" aria-expanded={chatMenu} onClick={() => setChatMenu(value => !value)}><MoreHorizontal size={20} /></button>{chatMenu && <div className="axon-create-menu"><button onClick={() => { setResearchSelection({}); setChatMenu(false); }}>Local research</button><button onClick={() => { setInvite(true); setInviteError(null); setChatMenu(false); }}>Invite to conversation</button><button disabled={!selected || busy || voice.active} onClick={() => { setDeleteChat(selected || null); setChatMenu(false); }}>Delete conversation</button><button disabled={checkingGateway} onClick={() => { void checkGateway(); setChatMenu(false); }}>Check gateway</button></div>}</div></div></header>
      <div className="axon-connections-compact"><button aria-expanded={permissionsExpanded} aria-controls="axon-connection-permissions" onClick={() => setPermissionsExpanded(value => !value)}>Connections · {[selected?.agentMode && 'Google', selected?.mcpMode && 'MCP', selected?.messagesMode && 'iMessage', selected?.whatsappMode && 'WhatsApp'].filter(Boolean).join(', ') || 'off'}</button>{hasAgentMode(selected) && <button disabled={pausingConnections} onClick={() => void pauseConnections()}>Pause actions</button>}{googleActivityHint && <button className="axon-compact-activity" onClick={() => { const panel = document.getElementById('google-action-activity'); panel?.scrollIntoView({ block: 'center' }); panel?.focus(); const detail = panel?.querySelector('details'); if (detail) detail.open = true; }}>{googleActivityHint}</button>}</div>
      <div id="axon-connection-permissions" className={`axon-connection-permissions${permissionsExpanded ? ' is-expanded' : ''}`}>
      <GoogleAgentMode chat={selected} ownerId={user.id} model={gateway?.model} account={googleWorker.account} onRefreshAccount={googleWorker.refreshAccount} available={googleWorker.available} disabled={busy || loadingChat || voice.active} workerError={googleWorker.error} activityHint={googleActivityHint} onActivity={() => { const panel = document.getElementById('google-action-activity'); panel?.scrollIntoView({ block: 'center' }); panel?.focus(); const detail = panel?.querySelector('details'); if (detail) detail.open = true; }} onChange={changeAgentMode} onCreate={createAgentConversation} onSetup={() => navigate('/settings/connectors')} onPause={async () => { if (working.current) await stopReply(); else if (googleWorker.available) { try { await nativeRequest('cancelGoogleActions'); } catch { setNotice('An already dispatched Google action may still finish.'); } } }} />
      {gateway?.status === 'unavailable' && <div className="axon-gateway-note" role="status">{gateway.message || 'The configured local model is unavailable. Your saved conversations are still here.'}<button onClick={() => void checkGateway()} disabled={checkingGateway}>Check again</button></div>}
      <ConnectedAgentModes chat={selected} ownerId={user.id} profileId={profileId} model={gateway?.model} disabled={busy || loadingChat || voice.active} onChange={changeAgentMode} onCreate={createAgentConversation} onSetup={() => navigate('/settings/connectors')} onPause={async () => { if (working.current) await stopReply(); }} />
      <WhatsAppChatMode chat={selected} ownerId={user.id} profileId={profileId} model={gateway?.model} disabled={busy || loadingChat || voice.active} onChange={changeAgentMode} onCreate={createAgentConversation} onSetup={() => navigate('/settings/connectors')} onPause={async () => { if (working.current) await stopReply(); }} />
      </div>
      <section ref={transcript} className="axon-transcript local-text-transcript" aria-label="Conversation"><div className="axon-transcript-inner">{loadingChat ? <p className="axon-loading" role="status">Opening conversation…</p> : !messages.length && !optimistic ? <div className="axon-chat-empty"><BotTeamAvatar name={agentName} character={agent?.avatarCharacter} src={agent?.avatarUrl} size={48} /><h1>What would you like to work on?</h1><p>Start a conversation with {agentName}.</p></div> : <>{messages.map(message => <article id={`message-${message.id}`} key={message.id} ref={message.id === messages.at(-1)?.id ? latestReply : undefined} className={`axon-message axon-message--${message.role}${highlightMessage === message.id ? ' is-highlighted' : ''}`} aria-label={message.role === 'user' ? 'Your message' : `${agentName} reply`}><div className="axon-message-heading">{message.role === 'assistant' && <BotTeamAvatar name={agentName} character={agent?.avatarCharacter} src={agent?.avatarUrl} size={28} />}<strong>{message.role === 'user' ? 'You' : agentName}</strong></div><div className="axon-message-body">{message.role === 'assistant' ? <Markdown text={message.text} textOnly /> : <p>{message.text}</p>}</div>{!!message.attachments?.length && <div className="axon-message-files">{message.attachments.map(file => <button key={file.id} onClick={() => setPreviewFile(file)}><FileText size={18} /><span>{file.name}<small>{fileSize(file.size)}</small></span></button>)}</div>}{message.role === 'assistant' && <ReplyResearch sources={message.sources} notice={message.researchNotice} warning={message.citationWarning} onOpen={setResearchSelection} />}<div className="axon-message-actions"><button className="axon-icon" aria-label="Copy message" onClick={() => void copyMessage(message)}><Copy size={15} /></button><button className="axon-icon" aria-label="Download message" onClick={() => downloadMessage(message)}><Download size={15} /></button></div></article>)}{optimistic && <article className="axon-message axon-message--user axon-message--pending"><div className="axon-message-body"><p>{optimistic}</p></div><small>Sending…</small></article>}{busy && optimistic && <div className="axon-thinking" role="status"><span /><span /><span /><p>{hasAgentMode(selected) ? 'Agent turn in progress · model replies may take several minutes' : 'Preparing a reply'}</p></div>}</>}<GoogleActionActivity chatId={selectedId} ownerId={user.id} revision={googleWorker.revision} account={googleWorker.account} enabled={hasAgentMode(selected)} onActivity={setGoogleActivityHint} /><div ref={bottom} /></div></section>
      <div className="axon-compose-area">{voice.active && <div className="axon-voice-session" role="status"><div><span className="axon-voice-dot" /><strong>{voice.mode === 'call' ? `Call with ${agentName}` : 'Dictation'}</strong><span>{voice.state === 'recording' ? 'Listening' : voice.state}{voice.mode === 'call' && <small>On-device voice · turn-based</small>}</span></div><div className="axon-actions">{voice.state === 'recording' && <button className="axon-button" onClick={() => void voice.stop()}><Square size={13} />{voice.mode === 'call' ? 'Finish turn' : 'Stop & transcribe'}</button>}{voice.mode === 'call' && <button className="axon-icon" aria-label={voice.muted ? 'Unmute call' : 'Mute call'} onClick={() => void voice.mute()}>{voice.muted ? <MicOff size={17} /> : <Mic size={17} />}</button>}{voice.mode === 'call' && voice.state === 'ready' && <button className="axon-button" onClick={() => void voice.listen()}>Listen again</button>}<button className="axon-icon" aria-label={voice.mode === 'call' ? 'End call' : 'Cancel dictation'} onClick={voice.end}><X size={18} /></button></div></div>}{(error || voice.error || terminalFailure) && <div className="axon-alert" role="alert"><div>{error || voice.error || 'The previous attempt ended without a saved reply.'}{terminalFailure && <button disabled={busy} onClick={() => void send(true)}>Send as new attempt</button>}</div><button className="axon-icon" aria-label="Dismiss message" onClick={() => { setError(null); voice.clearError(); }}><X size={15} /></button></div>}
        <form className="axon-composer" onSubmit={event => { event.preventDefault(); void send(); }}><input ref={filePicker} hidden type="file" multiple onChange={event => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />{!!queue.length && <div className="axon-upload-queue">{queue.map(item => <div className={`axon-upload-item${item.state === 'error' ? ' is-error' : ''}`} key={item.localId}><FileText size={19} /><div><button type="button" disabled={!item.record} onClick={() => item.record && setPreviewFile(item.record)}>{item.name}</button><small>{item.state === 'uploading' ? 'Uploading…' : item.state === 'error' ? item.error : !item.record?.deliverySupported ? 'Saved to Library · not supported in chat' : `Ready · ${fileSize(item.size)}`}</small>{item.state === 'error' && item.file && <button className="axon-link" type="button" onClick={() => { const file = item.file!; removeUpload(item); addFiles([file], item.requestId ?? item.localId); }}>Retry upload</button>}</div><button type="button" className="axon-icon" aria-label={`Remove ${item.name}`} disabled={busy} onClick={() => removeUpload(item)}><X size={15} /></button></div>)}</div>}<label className="axon-sr-only" htmlFor="axon-message">Message {agentName}</label><textarea id="axon-message" ref={textarea} placeholder={`Message ${agentName}`} rows={1} maxLength={12000} readOnly={voice.mode === 'dictation' && voice.active} value={busy ? '' : draft} disabled={busy || loadingChat} onChange={event => rememberDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }} /><div className="axon-composer-controls"><button className="axon-icon axon-attach" type="button" title="Upload files" aria-label="Upload files" disabled={busy || loadingChat} onClick={() => filePicker.current?.click()}><Plus size={22} /></button><span className="axon-composer-hint">{voice.mode === 'dictation' ? 'Dictation becomes editable text' : queue.length ? `${queue.length} file${queue.length === 1 ? '' : 's'} selected` : hasAgentMode(selected) ? 'Connected agent · this chat’s permissions apply' : 'Text chat · connected actions off'}</span><button className={`axon-icon${voice.mode === 'dictation' ? ' is-active' : ''}`} type="button" title="Dictate into draft" aria-label="Dictate into draft" disabled={busy || loadingChat || voice.active} onClick={beginDictation}><Mic size={21} /></button><button className={`axon-icon axon-waveform${voice.mode === 'call' ? ' is-active' : ''}`} type="button" title="Live voice call" aria-label="Live voice call" disabled={(busy && !voice.active) || voice.mode === 'dictation'} onClick={() => voice.mode === 'call' ? voice.end() : void voice.start('call')}><Waves size={21} /></button>{busy ? <button type="button" className="axon-send" aria-label="Stop reply" disabled={!optimistic || stopping} onClick={() => void stopReply()}><Square size={16} /></button> : (draft.trim() || queue.length > 0) && <button type="submit" className="axon-send" aria-label={sameAttempt(pendingAttempt, draft.trim(), attachmentIds) && error ? 'Check previous request' : 'Send message'} disabled={loadingChat || unresolvedUploads || (!draft.trim() && !attachmentIds.length) || terminalFailure || voice.active}><ArrowUp size={22} /></button>}</div></form><p className="axon-compose-note">{busy ? 'Your draft is preserved while the reply is pending.' : 'Enter to send · Shift + Enter for a new line'}<button onClick={() => { setInspectorOpen(true); }}>{hasAgentMode(selected) ? 'Connected agent workspace' : 'Local draft workspace'}</button></p></div>
    </main>
    {!chatPage && <WorkspacePages route={route} onNavigate={navigate} onDiscuss={(text, id) => void discuss(text, id)} onOpenChat={openLinkedChat} />}
    {chatPage && <AxonInspector whatsappMode={!!selected?.whatsappMode} mcpMode={!!selected?.mcpMode} messagesMode={!!selected?.messagesMode} agentMode={!!selected?.agentMode} executionPolicy={selected?.executionPolicy} replyState={botActivity.state} profileId={profileId} name={agentName} ready={gateway?.status === 'ready'} open={inspectorOpen} onClose={() => setInspectorOpen(false)} onAgent={updateAgent} onNavigate={navigate} onBusyChange={setInspectorBusy} />}
    {notice && <div className="axon-toast" role="status">{notice}</div>}
    {chooser && <AxonModal title="Assistants and conversations" wide onClose={() => setChooser(false)}><label className="axon-search-field"><Search size={18} /><input autoFocus placeholder="Search assistants" aria-label="Search assistants" value={chooserQuery} onChange={event => setChooserQuery(event.target.value)} /></label><div className="axon-chooser-list">{profiles.filter(item => `${agents[item.id]?.name || item.name} ${item.label}`.toLowerCase().includes(chooserQuery.toLowerCase())).map(item => <button key={item.id} disabled={busy || inspectorBusy || voice.active} className={item.id === profileId ? 'is-selected' : ''} onClick={() => void chooseProfile(item.id)}><BotTeamAvatar name={agents[item.id]?.name || item.name} character={agents[item.id]?.avatarCharacter} src={agents[item.id]?.avatarUrl} size={42} /><span><strong>{agents[item.id]?.name || item.name}</strong><small>{assistantPreviews[item.id] || item.label}</small></span>{item.id === profileId && <Check size={18} />}</button>)}</div><p className="axon-help">Five local mortgage assistants keep separate histories. Google actions require explicit permissions in each conversation; no bots are deployed remotely.</p></AxonModal>}
    {deleteChat && <AxonModal title="Delete this conversation?" onClose={() => { if (!deleting) setDeleteChat(null); }}><p>“{deleteChat.title}” and its messages will be removed from this workspace. This cannot be undone.</p><div className="axon-actions"><button className="axon-button" disabled={deleting} onClick={() => setDeleteChat(null)}>Keep conversation</button><button className="axon-button axon-button--danger" disabled={deleting} onClick={() => void removeChat()}>{deleting ? 'Deleting…' : 'Delete conversation'}</button></div></AxonModal>}
    {invite && <AxonModal title="Invite to this conversation" onClose={() => setInvite(false)}><p className="axon-help">Review who would receive access to this conversation. Opening this form sends nothing.</p><label className="axon-field">Recipient<input type="email" placeholder="name@example.com" value={inviteRecipient} onChange={e => setInviteRecipient(e.target.value)} /></label><label className="axon-field">Role<select value={inviteRole} onChange={e => setInviteRole(e.target.value)}><option value="viewer">Viewer</option><option value="collaborator">Collaborator</option></select></label><div className="axon-review-scope"><strong>Access preview</strong><p>{inviteRole === 'viewer' ? 'Read' : 'Read and contribute to'} this conversation with {agentName}. No other assistant histories or account credentials.</p></div><div className="axon-alert">{capabilities?.invites?.dependency || 'No invitation provider is configured. This local owner workspace cannot share access.'}</div>{inviteError && <p className="axon-error-text" role="alert">{inviteError}</p>}<div className="axon-actions"><button className="axon-button" onClick={() => setInvite(false)}>Keep draft & close</button><button className="axon-button axon-button--primary" disabled={!inviteRecipient.trim() || capabilities?.invites?.status !== 'available'} onClick={() => void api('/local/invites', 'POST', { recipient: inviteRecipient, role: inviteRole, chatId: selectedId }).then(() => setInvite(false)).catch(cause => setInviteError(errorText(cause)))}>Send reviewed invitation</button></div></AxonModal>}
    {previewFile && <AxonFilePreview key={previewFile.id} file={previewFile} onClose={() => setPreviewFile(null)} />}
    {researchSelection && <LocalResearchViewer initialSelection={researchSelection} onClose={() => setResearchSelection(null)} />}
  </div>;
}
