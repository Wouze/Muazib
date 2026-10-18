import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  CalendarPlus,
  Check,
  ChevronDown,
  Database,
  Activity,
  Home,
  KeyRound,
  MessageCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  UserPlus,
  X
} from 'lucide-react';
import type { ChatMessage, Conversation, MemoryRecord, MenuItem, MenuMatrix, PreviousOrder, RefusedLine, User, VisitOrderReceipt } from '../types';
import { api } from '../lib/api';
import { DEFAULT_MODEL, scenariosFor } from '../lib/content';
import { displayName, formatTime, humanize, splitName } from '../lib/format';
import { Link } from '../lib/router';
import { Avatar, EmptyNote, Logo, Modal, Toast, useDismiss } from '../components/ui';
import DishCard from '../components/DishCard';
import Markdown from '../components/Markdown';
import MemoryPanel from '../components/MemoryPanel';
import MenuSafetyPanel from '../components/MenuSafetyPanel';

const EMPTY_MATRIX: MenuMatrix = { safe_recommendations: [], excluded_items: [], active_constraints_summary: {} };

const EVENT_STYLES: Record<string, string> = {
  created: 'bg-palm-50 text-palm-700 ring-palm-200',
  updated: 'bg-saffron-50 text-saffron-700 ring-saffron-200',
  revoked: 'bg-terracotta-50 text-terracotta-700 ring-terracotta-200'
};

const EVENT_LABELS: Record<string, string> = {
  created: 'Learned',
  updated: 'Updated',
  revoked: 'Removed'
};

function guestFromUrl() {
  return new URLSearchParams(window.location.search).get('guest');
}

function setGuestInUrl(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('guest', id);
  window.history.replaceState({}, '', url.pathname + url.search);
}

function scenarioFromUrl() {
  const raw = new URLSearchParams(window.location.search).get('scenario');
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export default function Workspace() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [fullMenu, setFullMenu] = useState<MenuItem[]>([]);
  const [activeMemories, setActiveMemories] = useState<MemoryRecord[]>([]);
  const [auditTrail, setAuditTrail] = useState<MemoryRecord[]>([]);
  const [menuMatrix, setMenuMatrix] = useState<MenuMatrix>(EMPTY_MATRIX);

  const [bootError, setBootError] = useState('');
  const [bootAttempt, setBootAttempt] = useState(0);
  const [threadLoading, setThreadLoading] = useState(true);
  const [guestsVersion, setGuestsVersion] = useState(0);

  const [rightTab, setRightTab] = useState<'memory' | 'matrix'>('memory');
  const [mobilePane, setMobilePane] = useState<'chat' | 'insights'>('chat');
  const [inputMsg, setInputMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<{ text: string; steps: string[] } | null>(null);
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL);
  const [modelName, setModelName] = useState(DEFAULT_MODEL);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [trayIds, setTrayIds] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<VisitOrderReceipt | null>(null);
  const [previousOrder, setPreviousOrder] = useState<PreviousOrder | null>(null);
  const [orderNotice, setOrderNotice] = useState<RefusedLine[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [editingTray, setEditingTray] = useState(false);

  const [guestMenuOpen, setGuestMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showNewGuest, setShowNewGuest] = useState(false);
  const [newGuestName, setNewGuestName] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [suggestedScenario, setSuggestedScenario] = useState<number | null>(scenarioFromUrl);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const suggestedRef = useRef<HTMLButtonElement>(null);
  const activeConvRef = useRef('');
  activeConvRef.current = selectedConvId;
  const abortRef = useRef<AbortController | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => () => abortRef.current?.abort(), []);

  function stopReply() {
    abortRef.current?.abort();
  }

  const notify = useCallback((text: string, tone: 'info' | 'error' = 'info') => setToast({ text, tone }), []);
  const closeGuestMenu = useCallback(() => setGuestMenuOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const guestMenuRef = useDismiss<HTMLDivElement>(guestMenuOpen, closeGuestMenu);
  const settingsRef = useDismiss<HTMLDivElement>(settingsOpen, closeSettings);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (freshIds.size === 0) return;
    const t = window.setTimeout(() => setFreshIds(new Set()), 6000);
    return () => window.clearTimeout(t);
  }, [freshIds]);

  // Boot: config, menu, guests.
  useEffect(() => {
    let cancelled = false;
    setBootError('');
    Promise.all([api.config(), api.menu(), api.users()])
      .then(([cfg, menu, guests]) => {
        if (cancelled) return;
        const model = cfg.default_model || DEFAULT_MODEL;
        setDefaultModel(model);
        setModelName(model);
        setHasApiKey(cfg.has_api_key);
        setFullMenu(menu);
        setUsers(guests);
        const wanted = guestFromUrl();
        const initial = guests.find((g) => g.id === wanted)?.id || guests[0]?.id || '';
        setSelectedUserId(initial);
        if (initial) setGuestInUrl(initial);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setBootError(err.message);
          setThreadLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  // Guest changed (or reset): load their visits and open the latest.
  useEffect(() => {
    if (!selectedUserId) return;
    let cancelled = false;
    api
      .conversations(selectedUserId)
      .then((data) => {
        if (cancelled) return;
        setConversations(data);
        setSelectedConvId(data[0]?.id || '');
        if (data.length === 0) setThreadLoading(false);
      })
      .catch((err: Error) => !cancelled && notify(err.message, 'error'));
    return () => {
      cancelled = true;
    };
  }, [selectedUserId, guestsVersion, notify]);

  // Visit changed: load its messages and the guest's memory for that visit.
  useEffect(() => {
    if (!selectedUserId || !selectedConvId) return;
    let cancelled = false;
    setThreadLoading(true);
    Promise.all([
      api.messages(selectedConvId),
      api.memories(selectedUserId, selectedConvId),
      api.menuMatrix(selectedUserId, selectedConvId),
      api.order(selectedConvId)
    ])
      .then(([msgs, mem, matrix, orderView]) => {
        if (cancelled) return;
        setMessages(msgs);
        setActiveMemories(mem.active || []);
        setAuditTrail(mem.audit_trail || []);
        setMenuMatrix(matrix);
        setReceipt(orderView.order);
        setPreviousOrder(orderView.previous);
        setTrayIds(orderView.order?.items.map((item) => item.id) ?? []);
        setOrderNotice([]);
        setEditingTray(false);
      })
      .catch((err: Error) => !cancelled && notify(err.message, 'error'))
      .finally(() => !cancelled && setThreadLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedUserId, selectedConvId, notify]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el || messages.length === 0 || !stickToBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: draft ? 'auto' : 'smooth' });
  }, [messages, draft, mobilePane]);

  useEffect(() => {
    const card = suggestedRef.current;
    const scroller = chatScrollRef.current;
    if (!card || !scroller || threadLoading || messages.length === 0) return;
    const overflow = card.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
    if (overflow > 0) scroller.scrollTo({ top: scroller.scrollTop + overflow + 16, behavior: 'smooth' });
  }, [suggestedScenario, threadLoading, messages.length]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [inputMsg]);

  function clearThread() {
    setMessages([]);
    setActiveMemories([]);
    setAuditTrail([]);
    setMenuMatrix(EMPTY_MATRIX);
    setFreshIds(new Set());
    setReceipt(null);
    setPreviousOrder(null);
    setTrayIds([]);
    setOrderNotice([]);
    setEditingTray(false);
  }

  async function refreshOrder(convId: string, syncTray = false) {
    const view = await api.order(convId);
    if (activeConvRef.current !== convId) return;
    setReceipt(view.order);
    setPreviousOrder(view.previous);
    if (syncTray) setTrayIds(view.order?.items.map((item) => item.id) ?? []);
  }

  function selectGuest(id: string) {
    setGuestMenuOpen(false);
    if (id === selectedUserId) return;
    stopReply();
    setThreadLoading(true);
    setConversations([]);
    setSelectedConvId('');
    clearThread();
    setSelectedUserId(id);
    setSuggestedScenario(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('scenario');
    url.searchParams.set('guest', id);
    window.history.replaceState({}, '', url.pathname + url.search);
  }

  async function refreshTelemetry(userId: string, convId: string, previous?: MemoryRecord[]) {
    const [mem, matrix] = await Promise.all([api.memories(userId, convId), api.menuMatrix(userId, convId)]);
    if (activeConvRef.current !== convId) return;
    const active = mem.active || [];
    setActiveMemories(active);
    setAuditTrail(mem.audit_trail || []);
    setMenuMatrix(matrix);
    if (previous) {
      const before = new Set(previous.map((m) => m.id));
      const added = active.filter((m) => !before.has(m.id)).map((m) => m.id);
      if (added.length > 0) setFreshIds(new Set(added));
    }
  }

  async function handleStartNewVisit() {
    if (!selectedUserId) return;
    stopReply();
    try {
      const conv = await api.createConversation(selectedUserId);
      setConversations((prev) => [conv, ...prev]);
      clearThread();
      setSelectedConvId(conv.id);
      notify('New visit started. Long-term memory carries over; this-visit notes do not.');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  }

  async function handleCreateGuest(e: React.FormEvent) {
    e.preventDefault();
    const name = newGuestName.trim();
    if (!name) return;
    try {
      const created = await api.createUser(name);
      setUsers((prev) => [...prev, created]);
      setNewGuestName('');
      setShowNewGuest(false);
      selectGuest(created.id);
      notify(`${displayName(created.name)} added with an empty memory.`);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  }

  async function handleResetDemo() {
    setResetting(true);
    stopReply();
    activeConvRef.current = '';
    setInputMsg('');
    setDraft(null);
    clearThread();
    setSelectedConvId('');
    try {
      await api.resetDemo();
      const guests = await api.users();
      setUsers(guests);
      setShowResetConfirm(false);
      setSettingsOpen(false);
      const keep = guests.some((g) => g.id === selectedUserId);
      if (keep) {
        setThreadLoading(true);
        setGuestsVersion((v) => v + 1);
      } else if (guests[0]) {
        selectGuest(guests[0].id);
      }
      notify('Demo data restored to its starting state.');
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setResetting(false);
    }
  }

  async function sendMessage(textToSend?: string) {
    const content = (textToSend ?? inputMsg).trim();
    if (!content || loading || !selectedUserId || !selectedConvId) return;
    const convId = selectedConvId;
    const userId = selectedUserId;
    const previous = activeMemories;

    setMessages((prev) => [
      ...prev,
      { id: Date.now(), role: 'user', content, recommended_item_ids: [], memory_events: [], created_at: new Date().toISOString() }
    ]);
    if (textToSend === undefined) setInputMsg('');
    setMobilePane('chat');
    setLoading(true);
    stickToBottomRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    let text = '';
    let steps: string[] = [];
    let finished = false;
    let failure = '';
    setDraft({ text, steps });

    const assistantNote = (extra: Partial<ChatMessage>): ChatMessage => ({
      id: Date.now() + 1,
      role: 'assistant',
      content: text,
      recommended_item_ids: [],
      memory_events: [],
      created_at: new Date().toISOString(),
      ...extra
    });

    try {
      await api.chatStream(
        { user_id: userId, conversation_id: convId, message: content, model_override: modelName.trim() || undefined },
        (event) => {
          if (activeConvRef.current !== convId) return;
          if (event.type === 'delta') {
            text += event.text;
            setDraft({ text, steps });
          } else if (event.type === 'discard') {
            text = '';
            setDraft({ text, steps });
          } else if (event.type === 'step') {
            steps = [...steps, event.label];
            setDraft({ text, steps });
            if (event.kind === 'memory') refreshTelemetry(userId, convId, previous).catch(() => {});
            if (event.kind === 'memory' || event.kind === 'order') refreshOrder(convId).catch(() => {});
          } else if (event.type === 'done') {
            finished = true;
            setMessages((prev) => [...prev, event.message]);
            if (event.order?.status === 'confirmed') {
              setOrderNotice([]);
              setTrayIds(event.order.accepted.map((item) => item.id));
              refreshOrder(convId, true).catch(() => {});
            } else if (event.order?.status === 'refused_all') {
              setOrderNotice(event.order.refused);
            }
          } else if (event.type === 'error') {
            failure = event.detail;
          }
        },
        controller.signal
      );
      if (!finished && !failure) failure = 'The reply was cut off before it finished.';
    } catch (err) {
      if ((err as Error).name !== 'AbortError') failure = (err as Error).message;
    }

    abortRef.current = null;
    setDraft(null);
    setLoading(false);
    if (activeConvRef.current !== convId) return;

    if (failure) {
      setMessages((prev) => [...prev, assistantNote({ content: failure, failed: true, retryText: content })]);
    } else if (!finished && text.trim()) {
      setMessages((prev) => [...prev, assistantNote({ stopped: true })]);
    }
    refreshTelemetry(userId, convId, previous).catch(() => {});
    refreshOrder(convId).catch(() => {});
  }

  async function confirmTray() {
    if (!selectedConvId || trayIds.length === 0 || confirming) return;
    const convId = selectedConvId;
    setConfirming(true);
    try {
      const result = await api.confirmOrder(convId, trayIds);
      if (activeConvRef.current !== convId) return;
      if (result.status === 'confirmed') {
        setOrderNotice([]);
        setEditingTray(false);
        setTrayIds(result.accepted.map((item) => item.id));
        if (result.message) {
          stickToBottomRef.current = true;
          const thanks = result.message as ChatMessage;
          setMessages((prev) => (prev.some((m) => m.id === thanks.id) ? prev : [...prev, thanks]));
        }
        await refreshOrder(convId, true);
      } else {
        setOrderNotice(result.refused);
      }
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setConfirming(false);
    }
  }

  function retry(failed: ChatMessage) {
    if (!failed.retryText) return;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === failed.id);
      // Drop the failed reply and the user message that triggered it; sendMessage re-adds the latter.
      return idx > 0 ? [...prev.slice(0, idx - 1), ...prev.slice(idx + 1)] : prev.filter((m) => m.id !== failed.id);
    });
    sendMessage(failed.retryText);
  }

  const menuById = Object.fromEntries(fullMenu.map((item) => [item.id, item]));
  const scenarios = scenariosFor(selectedUserId);
  const userIndex = users.findIndex((u) => u.id === selectedUserId);
  const selectedUser = users[userIndex];
  const visitNumber = conversations.length - conversations.findIndex((c) => c.id === selectedConvId);
  const totalItems = menuMatrix.safe_recommendations.length + menuMatrix.excluded_items.length;
  const hasFresh = freshIds.size > 0;
  const customModel = modelName.trim() !== defaultModel;

  return (
    <div className="flex flex-col h-[100dvh] bg-sand-50 text-date-900 overflow-hidden">
      <div className="sadu-band shrink-0" />

      {/* HEADER */}
      <header className="shrink-0 bg-white/85 backdrop-blur border-b border-sand-200 px-3 sm:px-4 py-1.5 flex items-center justify-between gap-3 z-30">
        <Link to="/" className="flex items-center gap-2 min-w-0 group" title="Back to home">
          <Logo className="h-8 w-7" />
          <span className="font-display text-lg font-semibold tracking-tight text-date-900 leading-none group-hover:text-saffron-700 transition">
            Mu&apos;azib
          </span>
          <span className="hidden sm:inline font-arabic text-base text-saffron-600 leading-none">مُعَزِّب</span>
        </Link>

        <div className="flex items-center gap-2">
          {/* Guest picker */}
          <div className="relative" ref={guestMenuRef}>
            <button
              onClick={() => setGuestMenuOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={guestMenuOpen}
              className="h-8 flex items-center gap-2 rounded-full border border-sand-200 bg-white hover:border-saffron-200 pl-1 pr-2.5 shadow-[0_1px_2px_rgba(37,26,18,0.05)] transition cursor-pointer"
            >
              {selectedUser ? <Avatar name={selectedUser.name} index={userIndex} size="sm" /> : <span className="h-6 w-6 rounded-full bg-sand-100" />}
              <span className="text-sm font-medium text-date-900 max-w-[110px] sm:max-w-[180px] truncate">
                {selectedUser ? displayName(selectedUser.name) : 'Loading…'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-date-400" />
            </button>
            {guestMenuOpen && (
              <div
                role="listbox"
                className="absolute right-0 mt-2 w-72 z-40 bg-white border border-sand-200 rounded-2xl shadow-xl p-1.5 msg-in"
              >
                <p className="px-3 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-date-400">Guests</p>
                <div className="max-h-72 overflow-y-auto">
                  {users.map((u, i) => (
                    <button
                      key={u.id}
                      role="option"
                      aria-selected={u.id === selectedUserId}
                      onClick={() => selectGuest(u.id)}
                      className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition cursor-pointer ${
                        u.id === selectedUserId ? 'bg-saffron-50' : 'hover:bg-sand-50'
                      }`}
                    >
                      <Avatar name={u.name} index={i} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-date-900 truncate">{displayName(u.name)}</span>
                        <span className="block text-xs text-date-500 truncate">{u.avatar_role}</span>
                      </span>
                      {u.id === selectedUserId && <Check className="w-4 h-4 text-saffron-600" />}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => {
                    setGuestMenuOpen(false);
                    setShowNewGuest(true);
                  }}
                  className="mt-1 w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm font-medium text-saffron-700 hover:bg-saffron-50 border-t border-sand-100 transition cursor-pointer"
                >
                  <span className="h-9 w-9 rounded-full border border-dashed border-saffron-200 flex items-center justify-center">
                    <UserPlus className="w-4 h-4" />
                  </span>
                  Add a new guest
                </button>
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setSettingsOpen((o) => !o)}
              aria-label="Settings"
              aria-expanded={settingsOpen}
              className="relative h-8 w-8 rounded-full border border-sand-200 bg-white hover:border-saffron-200 text-date-600 hover:text-saffron-700 flex items-center justify-center shadow-[0_1px_2px_rgba(37,26,18,0.05)] transition cursor-pointer"
            >
              <Settings2 className="w-4 h-4" />
              {customModel && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-saffron-500" />}
            </button>
            {settingsOpen && (
              <div className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] z-40 bg-white border border-sand-200 rounded-2xl shadow-xl p-4 msg-in">
                <label htmlFor="model" className="text-xs font-semibold text-date-700">
                  Language model
                </label>
                <p className="text-xs text-date-500 mt-0.5 mb-2">Any OpenRouter model ID. Applies to your next message.</p>
                <input
                  id="model"
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  spellCheck={false}
                  className="w-full bg-sand-50 border border-sand-200 rounded-xl px-3 py-2 font-mono text-xs text-date-900 focus:outline-none focus:border-saffron-500 focus:ring-4 focus:ring-saffron-100"
                />
                {customModel && (
                  <button
                    onClick={() => setModelName(defaultModel)}
                    className="mt-2 text-xs font-medium text-saffron-700 hover:underline cursor-pointer"
                  >
                    Use default ({defaultModel})
                  </button>
                )}
                <div className="my-4 border-t border-sand-100" />
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-terracotta-700 hover:bg-terracotta-50 transition cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" /> Reset demo data
                </button>
                <Link
                  to="/admin"
                  className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-date-700 hover:bg-sand-50 transition"
                >
                  <Activity className="w-4 h-4" /> Agent metrics
                </Link>
                <Link
                  to="/"
                  className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-date-700 hover:bg-sand-50 transition"
                >
                  <Home className="w-4 h-4" /> Back to home
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {!hasApiKey && (
        <div className="shrink-0 bg-saffron-50 border-b border-saffron-200 px-4 py-2 text-xs text-saffron-700 flex items-center justify-center gap-2 text-center">
          <KeyRound className="w-4 h-4 shrink-0" />
          <span>
            <strong className="font-semibold">OPENROUTER_API_KEY</strong> isn’t set, so live chat is off. Memory and menu safety still work.
          </span>
        </div>
      )}

      {bootError && (
        <div className="shrink-0 bg-terracotta-50 border-b border-terracotta-200 px-4 py-2.5 text-sm text-terracotta-700 flex items-center justify-center gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{bootError}</span>
          <button
            onClick={() => setBootAttempt((n) => n + 1)}
            className="rounded-full bg-white ring-1 ring-terracotta-200 px-3 py-1 text-xs font-semibold hover:bg-terracotta-100 cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}

      {/* Mobile pane switch */}
      <div className="lg:hidden shrink-0 px-3 pt-3">
        <div className="grid grid-cols-2 gap-1 bg-sand-100 rounded-xl p-1">
          {(
            [
              { id: 'chat', label: 'Chat', icon: <MessageCircle className="w-4 h-4" /> },
              { id: 'insights', label: 'Memory & menu', icon: <Database className="w-4 h-4" /> }
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              onClick={() => setMobilePane(p.id)}
              className={`relative flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition cursor-pointer ${
                mobilePane === p.id ? 'bg-white text-date-900 shadow-[0_1px_3px_rgba(37,26,18,0.1)]' : 'text-date-500'
              }`}
            >
              {p.icon}
              {p.label}
              {p.id === 'insights' && hasFresh && mobilePane !== 'insights' && (
                <span className="absolute top-1.5 right-3 h-2 w-2 rounded-full bg-saffron-500 animate-pulse" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* WORKSPACE */}
      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 p-2.5 sm:p-3">
        {/* CHAT */}
        <section
          className={`${mobilePane === 'chat' ? 'flex' : 'hidden'} lg:flex lg:col-span-7 min-h-0 flex-col bg-white border border-sand-200 rounded-2xl shadow-[0_1px_3px_rgba(37,26,18,0.06)] overflow-hidden`}
        >
          {/* Guest status — one line. The name already lives in the header. */}
          <div className="px-3 py-1.5 border-b border-sand-200 flex items-center justify-between gap-3">
            <p className="text-xs text-date-500 truncate min-w-0">
              {selectedUser ? (
                <>
                  <span className="font-medium text-date-700">{selectedUser.avatar_role}</span>
                  {conversations.length > 0 && visitNumber > 0 && ` · Visit ${visitNumber} of ${conversations.length}`}
                  {` · ${activeMemories.length} ${activeMemories.length === 1 ? 'memory' : 'memories'}`}
                </>
              ) : (
                '\u00a0'
              )}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              {conversations.length > 1 && (
                <div className="relative flex items-center">
                  <select
                    value={selectedConvId}
                    onChange={(e) => {
                      stopReply();
                      clearThread();
                      setSelectedConvId(e.target.value);
                    }}
                    aria-label="Visit"
                    className="appearance-none h-8 rounded-full border border-sand-200 bg-white pl-3 pr-7 text-xs font-medium text-date-700 focus:outline-none focus:border-saffron-500 cursor-pointer max-w-[130px] sm:max-w-[160px] truncate"
                  >
                    {conversations.map((c, i) => (
                      <option key={c.id} value={c.id}>
                        Visit {conversations.length - i}
                        {i === 0 ? ' (latest)' : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-date-400 absolute right-2.5 pointer-events-none" />
                </div>
              )}
              <button
                onClick={handleStartNewVisit}
                disabled={!selectedUserId || loading}
                title="Start a new visit to test cross-session memory"
                aria-label="New visit"
                className="h-8 rounded-full bg-palm-600 hover:bg-palm-700 disabled:opacity-50 text-white text-xs font-semibold px-2.5 sm:px-3 flex items-center gap-1.5 transition cursor-pointer disabled:cursor-not-allowed"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New visit</span>
              </button>
            </div>
          </div>

          {/* Thread */}
          <div
            ref={chatScrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className={`flex-1 min-h-0 bg-sand-100 dot-texture px-3 sm:px-4 ${
              messages.length === 0 && !threadLoading ? 'overflow-hidden py-3' : 'overflow-y-auto py-5 space-y-5'
            }`}
          >
            {threadLoading ? (
              <div className="space-y-5" aria-label="Loading conversation">
                <div className="flex justify-end">
                  <div className="h-12 w-2/3 rounded-2xl bg-sand-200/70 animate-pulse" />
                </div>
                <div className="flex items-start gap-3">
                  <span className="h-9 w-9 rounded-2xl bg-sand-200/70 animate-pulse" />
                  <div className="h-28 w-3/4 rounded-2xl bg-sand-200/70 animate-pulse" />
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full min-h-0 flex flex-col items-center justify-center text-center max-w-xl mx-auto gap-2 msg-in">
                <Logo size="lg" className="h-12 w-10 shrink-0" />
                <div>
                  <p className="font-arabic text-saffron-600 text-base">أهلاً وسهلاً</p>
                  <h2 className="font-display text-xl font-semibold text-date-900">
                    Welcome{selectedUser ? `, ${displayName(selectedUser.name).split(' ')[0]}` : ''}
                  </h2>
                </div>
                <p className="text-sm text-date-600 leading-snug max-w-md">
                  {suggestedScenario !== null
                    ? 'The highlighted scenario is the one from the example. Send it, then watch the memory panel and the blocked dishes.'
                    : activeMemories.length > 0
                      ? 'Mu’azib remembers this guest from earlier visits. Ask for a recommendation, or change something and watch the memory panel update.'
                      : 'This guest has no history yet. Mention an allergy, a craving, or a budget and Mu’azib will remember it.'}
                </p>

                <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-left">
                  {scenarios.map((s, idx) => (
                    <button
                      key={s.label}
                      ref={idx === suggestedScenario ? suggestedRef : undefined}
                      disabled={loading || !selectedConvId}
                      onClick={() => sendMessage(s.prompt)}
                      className={`group text-left bg-white border hover:border-saffron-200 hover:shadow-[0_8px_24px_-14px_rgba(37,26,18,0.35)] rounded-2xl p-2.5 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                        idx === suggestedScenario ? 'border-saffron-500 ring-2 ring-saffron-200' : 'border-sand-200'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-date-900">
                        <span className="h-5 w-5 rounded-full bg-saffron-100 text-saffron-700 text-[11px] font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        {s.label}
                      </span>
                      <span className="block text-xs text-date-500 mt-1.5 leading-relaxed">{s.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, idx) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex flex-col items-end msg-in">
                    <div className="max-w-[85%] sm:max-w-[80%] bg-date-800 text-sand-50 rounded-2xl rounded-br-md px-4 py-3 text-sm leading-relaxed shadow-sm whitespace-pre-wrap">
                      {m.content}
                    </div>
                    <span className="text-[11px] text-date-400 mt-1 mr-1">{formatTime(m.created_at)}</span>
                  </div>
                ) : (
                  <div key={m.id} className="flex items-start gap-2.5 sm:gap-3 msg-in">
                    <Logo size="sm" framed />
                    <div className="max-w-[90%] min-w-0 flex flex-col">
                      {m.failed ? (
                        <div className="bg-terracotta-50 border border-terracotta-200 rounded-2xl rounded-tl-md px-4 py-3 text-sm text-terracotta-700">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <div>
                              <p className="font-semibold">That reply didn’t come through.</p>
                              <p className="text-xs mt-0.5 text-terracotta-600 break-words">{m.content}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => retry(m)}
                            disabled={loading}
                            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white ring-1 ring-terracotta-200 px-3 py-1 text-xs font-semibold hover:bg-terracotta-100 transition cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Try again
                          </button>
                        </div>
                      ) : (
                        <div className="bg-white border border-sand-200 rounded-2xl rounded-tl-md px-4 py-3.5 text-sm leading-relaxed text-date-800 shadow-[0_1px_3px_rgba(37,26,18,0.06)]">
                          {m.memory_events && m.memory_events.length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-1.5">
                              {m.memory_events.map((ev, i) => (
                                <button
                                  key={i}
                                  onClick={() => {
                                    setRightTab('memory');
                                    setMobilePane('insights');
                                  }}
                                  title="Open guest memory"
                                  className={`inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-1 ring-1 cursor-pointer hover:brightness-95 ${
                                    EVENT_STYLES[ev.action] || 'bg-sand-100 text-date-600 ring-sand-200'
                                  }`}
                                >
                                  <Sparkles className="w-3 h-3" />
                                  <span className="font-semibold">{EVENT_LABELS[ev.action] || ev.action}</span>
                                  <span>{humanize(ev.attribute)}</span>
                                  <span className="font-mono">
                                    {ev.previous_value ? `${ev.previous_value} → ${ev.new_value}` : ev.new_value || ev.value}
                                  </span>
                                  {ev.tier === 'ephemeral' && <span className="text-plum-600">· this visit</span>}
                                </button>
                              ))}
                            </div>
                          )}
                          <Markdown>{m.content}</Markdown>
                          {m.recommended_item_ids && m.recommended_item_ids.length > 0 && (
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              {m.recommended_item_ids.map((itemId) => {
                                const dish = menuById[itemId];
                                return dish ? (
                                  <DishCard
                                    key={itemId}
                                    dish={dish}
                                    added={trayIds.includes(itemId)}
                                    onAdd={
                                      idx === messages.length - 1 && !loading
                                        ? () => {
                                            setEditingTray(true);
                                            setTrayIds((ids) => (ids.includes(itemId) ? ids : [...ids, itemId]));
                                          }
                                        : undefined
                                    }
                                  />
                                ) : null;
                              })}
                            </div>
                          )}
                        </div>
                      )}
                      <span className="text-[11px] text-date-400 mt-1 ml-1">
                        {formatTime(m.created_at)}
                        {m.stopped && ' · Stopped, not saved'}
                      </span>
                      {idx === messages.length - 1 && !loading && m.follow_ups && m.follow_ups.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.follow_ups.map((f) => (
                            <button
                              key={f}
                              onClick={() => sendMessage(f)}
                              className="text-xs font-medium rounded-full border border-saffron-200 bg-saffron-50 hover:bg-saffron-100 text-saffron-700 px-3 py-1.5 transition cursor-pointer msg-in"
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              )
            )}

            {draft && (
              <div className="flex items-start gap-2.5 sm:gap-3 msg-in" aria-live="polite">
                <Logo size="sm" framed />
                <div className="max-w-[90%] min-w-0 bg-white border border-sand-200 rounded-2xl rounded-tl-md px-4 py-3 text-sm leading-relaxed text-date-800 shadow-[0_1px_3px_rgba(37,26,18,0.06)]">
                  {draft.steps.length > 0 && (
                    <ul className={`space-y-1 ${draft.text ? 'mb-3 pb-3 border-b border-sand-100' : 'mb-2.5'}`}>
                      {draft.steps.map((s, i) => (
                        <li key={i} className="flex items-center gap-1.5 text-xs text-date-500 msg-in">
                          <Check className="w-3.5 h-3.5 text-palm-600 shrink-0" /> {s}
                        </li>
                      ))}
                    </ul>
                  )}
                  {draft.text ? (
                    <Markdown>{draft.text}</Markdown>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1">
                        <span className="h-2 w-2 rounded-full bg-saffron-500 animate-bounce [animation-delay:-0.3s]" />
                        <span className="h-2 w-2 rounded-full bg-saffron-500 animate-bounce [animation-delay:-0.15s]" />
                        <span className="h-2 w-2 rounded-full bg-saffron-500 animate-bounce" />
                      </div>
                      <span className="text-xs text-date-500">
                        {draft.steps.length === 0 ? 'Thinking…' : 'Putting your recommendation together…'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-sand-200 bg-white">
            {((trayIds.length > 0 && (editingTray || trayIds.join('\0') !== (receipt?.items.map((item) => item.id).join('\0') ?? ''))) || orderNotice.length > 0) && (
              <div className="px-3 pt-2.5">
                {trayIds.length > 0 && (
                  <div className="rounded-2xl bg-sand-50 border border-sand-200 px-3 py-2.5">
                    <ul className="space-y-1.5">
                      {trayIds.map((id) => {
                        const dish = menuById[id];
                        if (!dish) return null;
                        return (
                          <li key={id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate text-date-900">{splitName(dish.name).en}</span>
                            <span className="flex items-center gap-2 shrink-0">
                              <span className="font-display text-saffron-700">${dish.price.toFixed(2)}</span>
                              <button
                                type="button"
                                aria-label={`Remove ${splitName(dish.name).en}`}
                                onClick={() => setTrayIds((ids) => ids.filter((itemId) => itemId !== id))}
                                className="h-6 w-6 rounded-full text-date-500 hover:bg-sand-200 hover:text-date-900 flex items-center justify-center cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-2 pt-2 border-t border-sand-200 flex items-center justify-between gap-3">
                      <span className="text-sm text-date-700">
                        Total{' '}
                        <span className="font-display font-semibold text-saffron-700">
                          $
                          {trayIds
                            .reduce((sum, id) => sum + (menuById[id]?.price || 0), 0)
                            .toFixed(2)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={confirmTray}
                        disabled={confirming || loading || !selectedConvId}
                        className="rounded-full bg-saffron-600 hover:bg-saffron-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 cursor-pointer disabled:cursor-not-allowed"
                      >
                        {confirming ? 'Confirming…' : 'Confirm this visit'}
                      </button>
                    </div>
                  </div>
                )}
                {orderNotice.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {orderNotice.map((item) => (
                      <li key={item.id} className="text-xs text-terracotta-700">
                        {splitName(item.name).en} was not added. {item.reasons.join(' ')}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="p-3"
            >
              <div className="flex items-end gap-2 bg-sand-50 border border-sand-200 rounded-2xl pl-4 pr-1.5 py-1.5 focus-within:border-saffron-500 focus-within:ring-4 focus-within:ring-saffron-100 transition">
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={inputMsg}
                  onChange={(e) => setInputMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  disabled={!selectedConvId}
                  aria-label="Message"
                  placeholder="Cravings, allergies, budget, or a change of mind…"
                  className="flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed text-date-900 placeholder:text-date-400 focus:outline-none max-h-40"
                />
                {loading ? (
                  <button
                    type="button"
                    onClick={stopReply}
                    aria-label="Stop reply"
                    title="Stop reply"
                    className="h-9 w-9 shrink-0 rounded-xl bg-date-800 hover:bg-date-900 text-sand-50 flex items-center justify-center transition cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!inputMsg.trim() || !selectedConvId}
                    aria-label="Send"
                    className="h-9 w-9 shrink-0 rounded-xl bg-saffron-600 hover:bg-saffron-700 disabled:bg-sand-300 text-white flex items-center justify-center transition cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                )}
              </div>
              <p className="hidden sm:block text-[11px] text-date-400 mt-1.5 px-1">
                Enter to send · Shift + Enter for a new line
              </p>
            </form>
          </div>
        </section>

        {/* INSIGHTS */}
        <section
          className={`${mobilePane === 'insights' ? 'flex' : 'hidden'} lg:flex lg:col-span-5 min-h-0 flex-col bg-white border border-sand-200 rounded-2xl shadow-[0_1px_3px_rgba(37,26,18,0.06)] overflow-hidden`}
        >
          <div className="p-2 border-b border-sand-200">
            <div className="grid grid-cols-2 gap-1 bg-sand-100 rounded-xl p-1">
              {(
                [
                  { id: 'memory', label: 'Guest memory', icon: <Database className="w-4 h-4" />, count: `${activeMemories.length}` },
                  {
                    id: 'matrix',
                    label: 'Menu safety',
                    icon: <ShieldCheck className="w-4 h-4" />,
                    count: totalItems ? `${menuMatrix.safe_recommendations.length}/${totalItems}` : '–'
                  }
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setRightTab(tab.id)}
                  className={`relative flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition cursor-pointer ${
                    rightTab === tab.id ? 'bg-white text-date-900 shadow-[0_1px_3px_rgba(37,26,18,0.12)]' : 'text-date-700 hover:text-date-900'
                  }`}
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.id === 'memory' ? 'Memory' : 'Menu'}</span>
                  <span
                    className={`text-[11px] rounded-full px-1.5 py-0.5 tabular-nums ${
                      rightTab === tab.id ? 'bg-saffron-100 text-saffron-700' : 'bg-sand-200 text-date-600'
                    }`}
                  >
                    {tab.count}
                  </span>
                  {tab.id === 'memory' && hasFresh && rightTab !== 'memory' && (
                    <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-saffron-500 animate-pulse" />
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {threadLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-sand-100 animate-pulse" />
                ))}
              </div>
            ) : !selectedConvId ? (
              <EmptyNote>Pick a guest to see what Mu’azib remembers.</EmptyNote>
            ) : rightTab === 'memory' ? (
              <MemoryPanel
                active={activeMemories}
                auditTrail={auditTrail}
                freshIds={freshIds}
                previousOrder={previousOrder}
                table={receipt}
                onChangeTable={() => setEditingTray(true)}
              />
            ) : (
              <MenuSafetyPanel matrix={menuMatrix} />
            )}
          </div>
        </section>
      </main>

      {showNewGuest && (
        <Modal onClose={() => setShowNewGuest(false)} labelledBy="new-guest-title">
          <form onSubmit={handleCreateGuest}>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-saffron-50 ring-1 ring-saffron-200 text-saffron-600 flex items-center justify-center">
                <Plus className="w-5 h-5" />
              </div>
              <div>
                <h3 id="new-guest-title" className="font-display text-lg font-semibold text-date-900">
                  New guest
                </h3>
                <p className="text-xs text-date-500">Every guest gets their own separate memory.</p>
              </div>
            </div>
            <input
              type="text"
              autoFocus
              required
              maxLength={80}
              value={newGuestName}
              onChange={(e) => setNewGuestName(e.target.value)}
              placeholder="e.g. Faisal"
              className="w-full bg-sand-50 border border-sand-200 rounded-xl px-3.5 py-2.5 text-sm text-date-900 placeholder:text-date-400 focus:outline-none focus:border-saffron-500 focus:ring-4 focus:ring-saffron-100"
            />
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowNewGuest(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-date-600 hover:bg-sand-100 cursor-pointer"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl text-sm font-semibold bg-saffron-600 hover:bg-saffron-700 text-white cursor-pointer">
                Add guest
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showResetConfirm && (
        <Modal onClose={() => !resetting && setShowResetConfirm(false)} labelledBy="reset-title">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-full bg-terracotta-50 ring-1 ring-terracotta-200 text-terracotta-600 flex items-center justify-center">
              <RotateCcw className="w-5 h-5" />
            </div>
            <h3 id="reset-title" className="font-display text-lg font-semibold text-date-900">
              Reset demo data?
            </h3>
          </div>
          <p className="text-sm text-date-600 leading-relaxed">
            Chats, orders, visits, and memories go back to the start. Tariq, Noura, and Salman stay. Guests you added are removed.
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={() => setShowResetConfirm(false)}
              disabled={resetting}
              className="px-4 py-2 rounded-xl text-sm font-medium text-date-600 hover:bg-sand-100 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleResetDemo}
              disabled={resetting}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-terracotta-600 hover:bg-terracotta-700 text-white cursor-pointer disabled:opacity-60"
            >
              {resetting ? 'Resetting…' : 'Reset'}
            </button>
          </div>
        </Modal>
      )}

      {toast && <Toast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
