import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import type { AgentMetrics } from '../types';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import { Logo, TIER_STYLES } from '../components/ui';

type Series = 'turns' | 'tokens';

function count(value: number) {
  return value.toLocaleString();
}

function compact(value: number) {
  return value.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
}

function noun(value: number, one: string, many: string) {
  return `${count(value)} ${value === 1 ? one : many}`;
}

function percent(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function when(iso: string | null) {
  if (!iso) return '';
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
  const date = new Date(hasZone ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function dayLabel(date: string, style: 'short' | 'long') {
  const [y, m, d] = date.split('-').map(Number);
  const local = new Date(y, m - 1, d);
  return style === 'long'
    ? local.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    : local.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function Card({ title, aside, children, className = '' }: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-white border border-sand-200 rounded-2xl p-4 sm:p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-date-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="bg-white border border-sand-200 rounded-2xl px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-date-400">{label}</p>
      <p className="font-display text-3xl font-semibold text-date-900 mt-1">{value}</p>
      {detail && <p className="text-xs text-date-500 mt-1">{detail}</p>}
    </div>
  );
}

interface Segment {
  label: string;
  value: number;
  bar: string;
  dot: string;
}

function SplitBar({ segments, empty }: { segments: Segment[]; empty: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className="mt-4">
      <div
        className="flex h-3 rounded-full overflow-hidden bg-sand-100"
        role="img"
        aria-label={total ? segments.map((s) => `${s.label} ${s.value}`).join(', ') : empty}
      >
        {segments.map((s) =>
          s.value > 0 ? (
            <div key={s.label} className={`${s.bar} h-full`} style={{ width: `${(s.value / total) * 100}%` }} />
          ) : null
        )}
      </div>
      {total === 0 ? (
        <p className="text-xs text-date-500 mt-3">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 text-date-700">
                <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
                {s.label}
              </span>
              <span className="text-date-500 tabular-nums">
                {count(s.value)} <span className="text-date-400">· {percent(s.value, total)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DailyChart({ days, series }: { days: AgentMetrics['daily']; series: Series }) {
  const values = days.map((d) => d[series]);
  const peak = Math.max(...values, 0);
  const total = values.reduce((sum, v) => sum + v, 0);
  const unit = series === 'turns' ? 'turns' : 'tokens';

  if (total === 0) {
    return (
      <div className="mt-4 h-44 rounded-xl border border-dashed border-sand-300 flex items-center justify-center">
        <p className="text-sm text-date-500">No turns in the last 14 days.</p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div
        className="relative h-44 flex items-end gap-1 sm:gap-1.5 border-b border-sand-200"
        role="img"
        aria-label={`${count(total)} ${unit} in the last 14 days, peak ${count(peak)} in one day`}
      >
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-sand-200" />
        <span className="absolute -top-2 right-0 bg-white pl-1.5 text-[10px] text-date-400 tabular-nums">
          {compact(peak)}
        </span>
        {days.map((d, index) => {
          const value = d[series];
          const height = peak > 0 ? Math.max((value / peak) * 100, value > 0 ? 3 : 0) : 0;
          const today = index === days.length - 1;
          return (
            <div key={d.date} className="group relative flex-1 h-full flex items-end">
              <div
                className={`w-full rounded-t-md transition ${
                  today ? 'bg-saffron-500' : 'bg-saffron-200 group-hover:bg-saffron-500'
                }`}
                style={{ height: `${height}%` }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 whitespace-nowrap rounded-lg bg-date-900 text-sand-50 px-2.5 py-1.5 text-[11px] shadow-lg">
                <span className="font-semibold">{dayLabel(d.date, 'long')}</span>
                <br />
                {noun(d.turns, 'turn', 'turns')} · {noun(d.tokens, 'token', 'tokens')}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[11px] text-date-400">
        <span>{dayLabel(days[0].date, 'short')}</span>
        <span>{dayLabel(days[Math.floor(days.length / 2)].date, 'short')}</span>
        <span className="text-saffron-700 font-medium">Today</span>
      </div>
    </div>
  );
}

export default function Admin() {
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [series, setSeries] = useState<Series>('turns');

  const load = useCallback(() => {
    setLoading(true);
    api.metrics()
      .then((data) => {
        setMetrics(data);
        setError('');
        setUpdatedAt(new Date());
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const usageNote = metrics && metrics.turns > 0 && metrics.turns_with_usage < metrics.turns
    ? `Usage reported on ${count(metrics.turns_with_usage)} of ${count(metrics.turns)} turns.`
    : '';
  const tierTotal = metrics
    ? metrics.memories.tiers.hard_constraint + metrics.memories.tiers.soft_preference + metrics.memories.tiers.ephemeral
    : 0;
  const busiest = metrics?.models[0]?.tokens || 0;
  const recentPeak = Math.max(...(metrics?.recent.map((r) => r.tokens) || [0]), 0);

  return (
    <div className="min-h-[100dvh] bg-sand-50 text-date-900">
      <div className="sadu-band" />
      <header className="border-b border-sand-200 bg-sand-50/90">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo className="h-8 w-7" />
            <span className="font-display text-lg font-semibold tracking-tight">Mu'azib</span>
          </Link>
          <Link to="/app" className="text-sm font-medium text-date-600 hover:text-saffron-700">
            Open the host
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-saffron-700">
              <Activity className="w-5 h-5" />
              <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-date-900">Agent metrics</h1>
            </div>
            <p className="text-date-600 mt-2 max-w-xl leading-relaxed">
              Guests served, tokens spent, memories kept, and orders confirmed. Reset demo clears the chats and leaves these numbers in place.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {updatedAt && (
              <span className="text-xs text-date-400">
                Updated {updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 h-8 rounded-full border border-sand-200 bg-white px-3 text-xs font-medium text-date-700 hover:border-saffron-200 hover:text-saffron-700 transition cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>

        {error && <p className="mt-6 text-sm text-terracotta-700">{error}</p>}

        {!metrics && !error && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-8">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-white border border-sand-200 animate-pulse" />
            ))}
          </div>
        )}

        {metrics && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-8">
              <Stat label="Guests served" value={count(metrics.guests)} detail="Anyone the host has answered" />
              <Stat label="Visits" value={count(metrics.visits)} detail="Conversations with a reply" />
              <Stat label="Turns" value={count(metrics.turns)} detail="Replies from the host" />
              <Stat
                label="Tokens"
                value={compact(metrics.total_tokens)}
                detail={`About ${count(metrics.avg_tokens_per_turn)} per turn`}
              />
            </div>

            <Card
              title="Last 14 days"
              className="mt-3"
              aside={
                <div className="flex rounded-full bg-sand-100 p-0.5 text-xs font-medium" role="tablist" aria-label="Chart series">
                  {(['turns', 'tokens'] as Series[]).map((s) => (
                    <button
                      key={s}
                      role="tab"
                      aria-selected={series === s}
                      onClick={() => setSeries(s)}
                      className={`rounded-full px-3 py-1 capitalize cursor-pointer transition ${
                        series === s ? 'bg-white text-date-900 shadow-sm' : 'text-date-500 hover:text-date-800'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              }
            >
              <DailyChart days={metrics.daily} series={series} />
            </Card>

            <div className="grid md:grid-cols-3 gap-3 mt-3">
              <Card title="Where the tokens go">
                <p className="font-display text-2xl font-semibold mt-2">{count(metrics.total_tokens)}</p>
                <SplitBar
                  empty="No token usage recorded yet."
                  segments={[
                    { label: 'Prompt', value: metrics.prompt_tokens, bar: 'bg-saffron-500', dot: 'bg-saffron-500' },
                    { label: 'Completion', value: metrics.completion_tokens, bar: 'bg-date-700', dot: 'bg-date-700' }
                  ]}
                />
                {usageNote && <p className="text-[11px] text-date-400 mt-3">{usageNote}</p>}
              </Card>

              <Card title="What it remembered">
                <p className="font-display text-2xl font-semibold mt-2">{count(tierTotal)}</p>
                <SplitBar
                  empty="No memories written yet."
                  segments={[
                    { label: TIER_STYLES.hard_constraint.label, value: metrics.memories.tiers.hard_constraint, bar: 'bg-terracotta-500', dot: 'bg-terracotta-500' },
                    { label: TIER_STYLES.soft_preference.label, value: metrics.memories.tiers.soft_preference, bar: 'bg-palm-500', dot: 'bg-palm-500' },
                    { label: TIER_STYLES.ephemeral.label, value: metrics.memories.tiers.ephemeral, bar: 'bg-plum-500', dot: 'bg-plum-500' }
                  ]}
                />
                <p className="text-[11px] text-date-400 mt-3">
                  {count(metrics.memories.created)} new · {count(metrics.memories.updated)} changed · {count(metrics.memories.revoked)} revoked
                </p>
              </Card>

              <Card title="Orders">
                <p className="font-display text-2xl font-semibold mt-2">
                  {count(metrics.orders.confirmed)}
                  <span className="text-sm font-sans font-normal text-date-500"> confirmed</span>
                </p>
                <SplitBar
                  empty="No orders yet."
                  segments={[
                    { label: 'Dishes served', value: metrics.orders.dishes_accepted, bar: 'bg-palm-500', dot: 'bg-palm-500' },
                    { label: 'Dishes refused as unsafe', value: metrics.orders.dishes_refused, bar: 'bg-terracotta-500', dot: 'bg-terracotta-500' }
                  ]}
                />
                {metrics.orders.refused > 0 && (
                  <p className="text-[11px] text-date-400 mt-3">
                    {noun(metrics.orders.refused, 'confirm had', 'confirms had')} nothing safe to save.
                  </p>
                )}
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-3 mt-3 items-start">
              <Card title="Models">
                {metrics.models.length === 0 ? (
                  <p className="text-sm text-date-500 mt-3">No turns recorded yet.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {metrics.models.map((row) => (
                      <li key={row.model}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-mono text-xs text-date-800 break-all">{row.model}</span>
                          <span className="text-xs text-date-500 shrink-0 tabular-nums">
                            {noun(row.turns, 'turn', 'turns')} · {compact(row.tokens)} tokens
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-sand-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-saffron-500"
                            style={{ width: `${busiest > 0 ? Math.max((row.tokens / busiest) * 100, 2) : 0}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Recent turns">
                {metrics.recent.length === 0 ? (
                  <p className="text-sm text-date-500 mt-3">The next conversation will show up here.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-sand-100">
                    {metrics.recent.map((row, index) => (
                      <li key={`${row.created_at}-${index}`} className="flex items-center justify-between gap-3 py-2">
                        <span className="text-sm text-date-900 min-w-0 truncate">
                          {row.guest}
                          <span className="text-date-400"> · </span>
                          <span className="text-xs text-date-500">{when(row.created_at)}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="w-16 h-1.5 rounded-full bg-sand-100 overflow-hidden">
                            <span
                              className="block h-full rounded-full bg-saffron-200"
                              style={{ width: `${recentPeak > 0 ? (row.tokens / recentPeak) * 100 : 0}%` }}
                            />
                          </span>
                          <span className="text-xs text-date-500 tabular-nums w-14 text-right">{count(row.tokens)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
