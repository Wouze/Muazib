import type { AgentMetrics, AppConfig, ChatMessage, ConfirmResult, Conversation, MemoryRecord, MenuItem, MenuMatrix, OrderView, StreamEvent, User } from '../types';

const OFFLINE = 'Could not reach the server. Check your connection and try again.';

async function errorFrom(res: Response) {
  let detail = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
  } catch {
    // Non-JSON error body; keep the status message.
  }
  return new Error(detail);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error(OFFLINE);
  }
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

function post(body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

const enc = encodeURIComponent;

type ChatBody = { user_id: string; conversation_id: string; message: string; model_override?: string };

async function chatStream(body: ChatBody, onEvent: (event: StreamEvent) => void, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch('/api/chat/stream', { ...post(body), signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error(OFFLINE);
  }
  if (!res.ok || !res.body) throw await errorFrom(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const data = buffer
        .slice(0, sep)
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      buffer = buffer.slice(sep + 2);
      if (data) onEvent(JSON.parse(data));
    }
  }
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  menu: () => request<MenuItem[]>('/api/menu'),
  users: () => request<User[]>('/api/users'),
  createUser: (name: string) =>
    request<User & { conversation_id: string }>('/api/users', post({ name })),
  conversations: (userId: string) => request<Conversation[]>(`/api/users/${enc(userId)}/conversations`),
  createConversation: (userId: string) => request<Conversation>('/api/conversations', post({ user_id: userId })),
  messages: (convId: string) => request<ChatMessage[]>(`/api/conversations/${enc(convId)}/messages`),
  order: (convId: string) => request<OrderView>(`/api/conversations/${enc(convId)}/order`),
  confirmOrder: (convId: string, itemIds: string[]) =>
    request<ConfirmResult>(`/api/conversations/${enc(convId)}/order`, post({ item_ids: itemIds })),
  memories: (userId: string, convId: string) =>
    request<{ active: MemoryRecord[]; audit_trail: MemoryRecord[] }>(
      `/api/users/${enc(userId)}/memories?conversation_id=${enc(convId)}`
    ),
  menuMatrix: (userId: string, convId: string) =>
    request<MenuMatrix>(`/api/users/${enc(userId)}/menu-matrix?conversation_id=${enc(convId)}`),
  chatStream,
  resetDemo: () => request<{ status: string }>('/api/reset-demo', post()),
  metrics: () =>
    request<AgentMetrics>(`/api/admin/metrics?tz_offset_minutes=${-new Date().getTimezoneOffset()}`)
};
