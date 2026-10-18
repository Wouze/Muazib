import React from 'react';
import { Clock, Heart, History, Receipt, ShieldAlert, Utensils } from 'lucide-react';
import type { MemoryRecord, PreviousOrder, VisitOrderReceipt } from '../types';
import { humanize, splitName } from '../lib/format';
import { SectionHeader, TIER_STYLES } from './ui';

function MemoryCard({ m, showQuote, fresh }: { m: MemoryRecord; showQuote?: boolean; fresh?: boolean }) {
  const style = TIER_STYLES[m.tier];
  return (
    <div className={`bg-white border border-sand-200 rounded-xl px-3.5 py-3 shadow-[0_1px_2px_rgba(37,26,18,0.05)] ${fresh ? 'fresh-glow' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-date-500">{m.category}</div>
          <div className="text-sm font-semibold text-date-900 mt-0.5 leading-snug">{humanize(m.attribute)}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {fresh && (
            <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-saffron-500 text-white px-2 py-0.5">New</span>
          )}
          <span className={`font-mono text-xs font-semibold rounded-full px-2.5 py-1 ring-1 ${style.badge}`}>{m.value}</span>
        </div>
      </div>
      {showQuote && m.source_quote && <p className="text-sm text-date-800 mt-2 leading-snug">&ldquo;{m.source_quote}&rdquo;</p>}
      {m.reason && <p className="text-xs text-date-600 mt-1.5">{m.reason}</p>}
    </div>
  );
}

function TierSection({
  wash,
  children
}: {
  wash: string;
  children: React.ReactNode;
}) {
  return <section className={`rounded-2xl p-3 ${wash}`}>{children}</section>;
}

export default function MemoryPanel({
  active,
  auditTrail,
  freshIds,
  previousOrder,
  table,
  onChangeTable
}: {
  active: MemoryRecord[];
  auditTrail: MemoryRecord[];
  freshIds: Set<number>;
  previousOrder?: PreviousOrder | null;
  table?: VisitOrderReceipt | null;
  onChangeTable?: () => void;
}) {
  const hard = active.filter((m) => m.tier === 'hard_constraint');
  const soft = active.filter((m) => m.tier === 'soft_preference');
  const ephemeral = active.filter((m) => m.tier === 'ephemeral');
  const history = auditTrail.filter((m) => m.status !== 'active');

  return (
    <div className="space-y-3">
      {table && table.items.length > 0 && (
        <TierSection wash="bg-saffron-50">
          <SectionHeader
            icon={<Utensils className="w-4 h-4" />}
            tone="text-saffron-700"
            title="On the table"
            subtitle="What this visit is having."
            count={table.items.length}
          />
          <div className="space-y-2">
            {table.items.map((item) => (
              <div key={item.id} className="bg-white border border-saffron-100 rounded-xl px-3.5 py-3 flex items-start justify-between gap-3">
                <div className="text-sm font-semibold text-date-900 leading-snug">{splitName(item.name).en}</div>
                <span className="font-display font-semibold text-saffron-700 shrink-0">${item.price.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className="text-sm text-date-800">
              Total <span className="font-display font-semibold text-saffron-700">${table.total_price.toFixed(2)}</span>
            </span>
            {onChangeTable && (
              <button
                type="button"
                onClick={onChangeTable}
                className="text-xs font-semibold text-saffron-700 hover:underline cursor-pointer"
              >
                Change
              </button>
            )}
          </div>
          {table.refused.length > 0 && (
            <ul className="mt-2 space-y-1">
              {table.refused.map((item) => (
                <li key={item.id} className="text-xs text-terracotta-700">
                  {splitName(item.name).en} stayed off. {item.reasons.join(' ')}
                </li>
              ))}
            </ul>
          )}
        </TierSection>
      )}

      {previousOrder && previousOrder.items.length > 0 && (
        <TierSection wash="bg-sand-100">
          <SectionHeader
            icon={<Receipt className="w-4 h-4" />}
            tone="text-saffron-700"
            title="Last visit"
            subtitle={previousOrder.title || 'Rechecked against this visit.'}
            count={previousOrder.items.length}
          />
          {previousOrder.for_company && (
            <p className="text-xs text-date-600 -mt-1">For someone else at that table, not for this guest.</p>
          )}
          <div className="space-y-2">
            {previousOrder.items.map((item) => {
              const { en } = splitName(item.name);
              return (
                <div
                  key={item.id}
                  className={`bg-white rounded-xl px-3.5 py-3 ${
                    item.still_safe ? 'border border-palm-100' : 'border border-terracotta-100'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-semibold text-date-900 leading-snug">{en}</div>
                    <span className="font-display font-semibold text-saffron-700 shrink-0">${item.price.toFixed(2)}</span>
                  </div>
                  {item.still_safe ? (
                    <p className="text-xs text-palm-700 mt-1">Still safe</p>
                  ) : (
                    <p className="text-xs text-terracotta-700 mt-1">Blocked now. {item.reasons.join(' ')}</p>
                  )}
                </div>
              );
            })}
          </div>
        </TierSection>
      )}

      <TierSection wash="bg-terracotta-50">
        <SectionHeader
          icon={<ShieldAlert className="w-4 h-4" />}
          tone="text-terracotta-700"
          title="Hard rules"
          subtitle="Allergies and strict diets. Dishes that break them are never offered."
          count={hard.length}
        />
        {hard.length === 0 ? (
          <p className="text-xs text-date-700">No allergies or strict dietary rules recorded.</p>
        ) : (
          <div className="space-y-2">
            {hard.map((m) => (
              <MemoryCard key={m.id} m={m} showQuote fresh={freshIds.has(m.id)} />
            ))}
          </div>
        )}
      </TierSection>

      <TierSection wash="bg-palm-50">
        <SectionHeader
          icon={<Heart className="w-4 h-4" />}
          tone="text-palm-700"
          title="Preferences"
          subtitle="Tastes and dislikes that shape the ranking."
          count={soft.length}
        />
        {soft.length === 0 ? (
          <p className="text-xs text-date-700">No preferences learned yet.</p>
        ) : (
          <div className="space-y-2">
            {soft.map((m) => (
              <MemoryCard key={m.id} m={m} fresh={freshIds.has(m.id)} />
            ))}
          </div>
        )}
      </TierSection>

      <TierSection wash="bg-plum-50">
        <SectionHeader
          icon={<Clock className="w-4 h-4" />}
          tone="text-plum-700"
          title="This visit only"
          subtitle="Temporary context. Forgotten when a new visit starts."
          count={ephemeral.length}
        />
        {ephemeral.length === 0 ? (
          <p className="text-xs text-date-700">Nothing temporary yet. A friend’s order or a one-time budget lands here.</p>
        ) : (
          <div className="space-y-2">
            {ephemeral.map((m) => (
              <MemoryCard key={m.id} m={m} fresh={freshIds.has(m.id)} />
            ))}
          </div>
        )}
      </TierSection>

      <TierSection wash="bg-sand-100">
        <SectionHeader
          icon={<History className="w-4 h-4" />}
          tone="text-saffron-700"
          title="Change history"
          subtitle="Replaced and revoked records, with what replaced them."
          count={history.length}
        />
        {history.length === 0 ? (
          <p className="text-xs text-date-700">When a guest changes their mind (for example spice high → mild), the old record appears here.</p>
        ) : (
          <ol className="relative ml-1.5 border-l-2 border-sand-300 space-y-3">
            {history.map((m) => (
              <li key={m.id} className="pl-4 relative">
                <span
                  className={`absolute -left-[7px] top-1.5 h-3 w-3 rounded-full ring-4 ring-sand-100 ${
                    m.status === 'revoked' ? 'bg-terracotta-500' : 'bg-saffron-500'
                  }`}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-date-700 line-through decoration-date-400">
                    {m.category}.{humanize(m.attribute)} = {m.value}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ring-1 ${
                      m.status === 'revoked'
                        ? 'bg-terracotta-50 text-terracotta-700 ring-terracotta-200'
                        : 'bg-saffron-50 text-saffron-700 ring-saffron-200'
                    }`}
                  >
                    {m.status}
                    {m.superseded_by_id ? ` → #${m.superseded_by_id}` : ''}
                  </span>
                </div>
                {m.reason && <p className="text-xs text-date-500 mt-0.5">{m.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </TierSection>
    </div>
  );
}
