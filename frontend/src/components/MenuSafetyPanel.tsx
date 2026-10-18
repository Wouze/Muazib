import { Ban, CheckCircle2, Filter } from 'lucide-react';
import type { ConstraintSummary, MenuMatrix } from '../types';
import { humanize, splitName } from '../lib/format';
import { SectionHeader } from './ui';

function activeRules(summary: ConstraintSummary) {
  const rules: { label: string; tone: string }[] = [];
  const hard = 'bg-terracotta-50 text-terracotta-700 ring-terracotta-200';
  const soft = 'bg-palm-50 text-palm-700 ring-palm-200';
  (summary.allergies || []).forEach((a) => rules.push({ label: `No ${humanize(a)}`, tone: hard }));
  if (summary.require_vegan) rules.push({ label: 'Vegan', tone: hard });
  else if (summary.require_vegetarian) rules.push({ label: 'Vegetarian', tone: hard });
  if (summary.max_price != null) rules.push({ label: `Up to $${Number(summary.max_price).toFixed(2)}`, tone: hard });
  if (summary.preferred_spice) rules.push({ label: `Prefers ${summary.preferred_spice} spice`, tone: soft });
  (summary.liked_terms || []).forEach((t) => rules.push({ label: `Likes ${humanize(t)}`, tone: soft }));
  (summary.disliked_terms || []).forEach((t) => rules.push({ label: `Avoids ${humanize(t)}`, tone: soft }));
  return rules;
}

export default function MenuSafetyPanel({ matrix }: { matrix: MenuMatrix }) {
  const rules = activeRules(matrix.active_constraints_summary || {});

  return (
    <div className="space-y-3">
      <section className="rounded-2xl bg-sand-100 p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-date-700 mb-2">
          <Filter className="w-3.5 h-3.5 text-saffron-600" /> Rules applied to the menu
        </div>
        {rules.length === 0 ? (
          <p className="text-xs text-date-500">None yet. Every dish is open to this guest.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {rules.map((r, i) => (
              <span key={i} className={`text-xs rounded-full px-2.5 py-1 ring-1 ${r.tone}`}>
                {r.label}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-palm-50 p-3">
        <SectionHeader
          icon={<CheckCircle2 className="w-4 h-4" />}
          tone="text-palm-700"
          title="Safe & ranked"
          subtitle="Passes every hard rule, sorted by how well it fits."
          count={matrix.safe_recommendations.length}
        />
        {matrix.safe_recommendations.length === 0 ? (
          <p className="text-xs text-date-700">No dish passes the current rules. Relaxing the budget usually helps.</p>
        ) : (
          <div className="space-y-2">
            {matrix.safe_recommendations.map((item, idx) => {
              const { en, ar } = splitName(item.name);
              const score = item.compatibility_score ?? 0;
              return (
                <div key={item.id} className="bg-white border border-palm-100 rounded-xl px-3.5 py-3">
                  <div className="flex items-start gap-3">
                    <span className="h-6 w-6 shrink-0 rounded-full bg-palm-100 text-palm-700 text-xs font-semibold flex items-center justify-center tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-date-900 leading-snug">{en}</div>
                          {ar && <div className="font-arabic text-xs text-date-500 mt-0.5">{ar}</div>}
                        </div>
                        <span className="font-display text-sm font-semibold text-saffron-700 shrink-0">${item.price.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2" title="Fit score out of 150">
                        <div className="flex-1 h-1.5 rounded-full bg-sand-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-palm-500 to-palm-600"
                            style={{ width: `${Math.min(100, (score / 150) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-mono font-medium text-palm-700 tabular-nums w-7 text-right">{score}</span>
                      </div>
                      {item.match_notes && item.match_notes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {item.match_notes.map((note, i) => (
                            <span key={i} className="text-[11px] rounded-full bg-palm-50 text-palm-700 px-2 py-0.5">
                              {note}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-terracotta-50 p-3">
        <SectionHeader
          icon={<Ban className="w-4 h-4" />}
          tone="text-terracotta-700"
          title="Blocked by the safety filter"
          subtitle="Removed in code before the model sees its options."
          count={matrix.excluded_items.length}
        />
        {matrix.excluded_items.length === 0 ? (
          <p className="text-xs text-date-700">Nothing blocked. Every dish is compatible with this guest.</p>
        ) : (
          <div className="space-y-2">
            {matrix.excluded_items.map((item) => (
              <div key={item.id} className="bg-white border border-terracotta-100 rounded-xl px-3.5 py-3">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="text-sm font-semibold text-date-900">{splitName(item.name).en}</span>
                  <span className="text-sm font-medium text-date-600">${item.price.toFixed(2)}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {item.rejection_reasons?.map((r, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full bg-white ring-1 ring-terracotta-200 text-terracotta-700 px-2 py-0.5"
                    >
                      <Ban className="w-3 h-3" /> {r}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
