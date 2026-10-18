import { Flame, Leaf } from 'lucide-react';
import type { MenuItem } from '../types';
import { humanize, splitName } from '../lib/format';

const SPICE_STYLES: Record<string, string> = {
  none: 'text-date-500',
  mild: 'text-saffron-600',
  medium: 'text-terracotta-500',
  high: 'text-terracotta-700'
};

export default function DishCard({
  dish,
  variant = 'chat',
  onAdd,
  added = false
}: {
  dish: MenuItem;
  variant?: 'chat' | 'menu';
  onAdd?: () => void;
  added?: boolean;
}) {
  const { en, ar } = splitName(dish.name);
  const surface =
    variant === 'menu'
      ? 'bg-white border-sand-200 hover:border-saffron-200 hover:shadow-[0_10px_30px_-18px_rgba(37,26,18,0.35)] p-5'
      : 'bg-sand-50 border-sand-200 hover:border-saffron-200 hover:bg-saffron-50/50 p-3.5';

  return (
    <article className={`${surface} border rounded-2xl flex flex-col gap-2 transition h-full`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className={`font-semibold text-date-900 leading-snug ${variant === 'menu' ? 'text-base' : 'text-sm'}`}>{en}</h4>
          {ar && (
            <p dir="rtl" className="font-arabic text-xs text-date-500 mt-0.5 text-left">
              {ar}
            </p>
          )}
        </div>
        <span className={`font-display font-semibold text-saffron-700 shrink-0 ${variant === 'menu' ? 'text-lg' : 'text-base'}`}>
          ${dish.price.toFixed(2)}
        </span>
      </div>
      <p className={`text-date-600 leading-relaxed ${variant === 'menu' ? 'text-sm line-clamp-3' : 'text-xs line-clamp-2'}`}>
        {dish.description}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] pt-1 mt-auto">
        <span className="rounded-full bg-white border border-sand-200 px-2 py-0.5 text-date-600">{dish.category}</span>
        <span
          className={`rounded-full bg-white border border-sand-200 px-2 py-0.5 flex items-center gap-1 ${SPICE_STYLES[dish.spice_level] || 'text-date-600'}`}
        >
          <Flame className="w-3 h-3" /> {dish.spice_level}
        </span>
        {dish.is_vegan && (
          <span className="rounded-full bg-palm-50 ring-1 ring-palm-200 px-2 py-0.5 text-palm-700 flex items-center gap-1">
            <Leaf className="w-3 h-3" /> Vegan
          </span>
        )}
        {dish.allergens.length > 0 ? (
          <span className="rounded-full bg-terracotta-50 ring-1 ring-terracotta-200 px-2 py-0.5 text-terracotta-700">
            {dish.allergens.map(humanize).join(', ')}
          </span>
        ) : (
          <span className="rounded-full bg-palm-50 ring-1 ring-palm-200 px-2 py-0.5 text-palm-700">Allergen-free</span>
        )}
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          disabled={added}
          className={`mt-1 self-start rounded-full px-3 py-1 text-xs font-semibold transition cursor-pointer disabled:cursor-default ${
            added
              ? 'bg-palm-50 text-palm-700 ring-1 ring-palm-200'
              : 'bg-saffron-600 hover:bg-saffron-700 text-white'
          }`}
        >
          {added ? 'Added' : 'Add'}
        </button>
      )}
    </article>
  );
}
