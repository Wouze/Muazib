import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Ban,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Ear,
  Heart,
  ShieldAlert,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import type { MenuItem } from '../types';
import { api } from '../lib/api';
import { EVAL_SCENARIOS, PERSONAS } from '../lib/content';
import { Link } from '../lib/router';
import { Avatar, Logo, TIER_STYLES } from '../components/ui';
import DishCard from '../components/DishCard';

const CATEGORIES = ['All', 'Starters', 'Mains', 'Sides', 'Desserts & Drinks'];

function Nav() {
  return (
    <header className="sticky top-0 z-40 bg-sand-50/85 backdrop-blur border-b border-sand-200/70">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo size="sm" className="h-9 w-8" />
          <span className="font-display text-xl font-semibold tracking-tight">Mu&apos;azib</span>
          <span className="font-arabic text-base text-saffron-600">مُعَزِّب</span>
        </a>
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-date-600">
          <a href="#how" className="hover:text-date-900 transition">How it works</a>
          <a href="#guests" className="hover:text-date-900 transition">Guests</a>
          <a href="#menu" className="hover:text-date-900 transition">Menu</a>
          <a href="#tested" className="hover:text-date-900 transition">Tested</a>
        </nav>
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 rounded-full bg-date-900 hover:bg-date-800 text-sand-50 text-sm font-semibold px-4 py-2 transition"
        >
          Open the host <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </header>
  );
}

function HeroConversation() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 bg-gradient-to-br from-saffron-100/70 via-transparent to-terracotta-100/50 rounded-[2.5rem] blur-2xl" />
      <div className="relative bg-white border border-sand-300 rounded-3xl shadow-[0_20px_40px_-8px_rgba(37,26,18,0.45)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-sand-200">
          <div className="flex items-center gap-2.5">
            <Avatar name="Tariq" index={0} size="sm" />
            <span className="text-sm font-semibold">Tariq</span>
            <span className="text-xs text-date-500">· Visit 2</span>
          </div>
          <span className="text-[11px] font-medium text-date-400 uppercase tracking-wider">Example</span>
        </div>
        <div className="p-5 space-y-4 dot-texture">
          <div className="flex justify-end">
            <div className="max-w-[85%] bg-date-800 text-sand-50 rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed">
              I just found out I have a severe tree nut allergy. Keep it under $16 today. What should I order?
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Logo size="sm" framed />
            <div className="flex-1 min-w-0 bg-white border border-sand-200 rounded-2xl rounded-tl-md px-4 py-3 text-sm leading-relaxed">
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2.5 py-1 ring-1 bg-palm-50 text-palm-700 ring-palm-200">
                  <Sparkles className="w-3 h-3" /> <b>Learned</b> tree nuts · hard rule
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2.5 py-1 ring-1 bg-plum-50 text-plum-700 ring-plum-200">
                  <Sparkles className="w-3 h-3" /> <b>Learned</b> max $16 · this visit
                </span>
              </div>
              <p className="text-date-800">
                Noted, Tariq. I’ve kept everything vegan and nut-free. The <b>Pumpkin Kabsa</b> and the <b>Vegetable Matazeez</b> both fit.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  { name: 'Pumpkin Kabsa', price: '14.50' },
                  { name: 'Vegetable Matazeez', price: '15.00' }
                ].map((d) => (
                  <div key={d.name} className="rounded-xl bg-sand-50 border border-sand-200 px-3 py-2">
                    <div className="text-xs font-semibold leading-snug">{d.name}</div>
                    <div className="font-display text-sm font-semibold text-saffron-700">${d.price}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-terracotta-50 px-3 py-2 text-[11px] font-medium text-terracotta-700">
                <Ban className="w-3.5 h-3.5 shrink-0" /> Almond-Milk Jareesh blocked: contains tree nuts
              </div>
            </div>
          </div>
        </div>
        <Link
          to="/app?guest=guest_tariq&scenario=1"
          className="flex items-center justify-between gap-3 border-t border-sand-200 bg-sand-50 px-5 py-3 text-sm font-semibold text-date-900 hover:bg-saffron-50 hover:text-saffron-700 transition"
        >
          Try this as Tariq
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

function MenuSection() {
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [category, setCategory] = useState('All');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .menu()
      .then((m) => !cancelled && setMenu(m))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const matched = (menu || []).filter((d) => category === 'All' || d.category === category);
  const visible = showAll ? matched : matched.slice(0, 6);

  return (
    <section id="menu" className="scroll-mt-20 py-20 sm:py-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-8">
          <div className="max-w-xl">
            <p className="text-sm font-semibold text-saffron-700 mb-2">The menu</p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
              {menu ? menu.length : 16} dishes from Dar Najd Kitchen
            </h2>
            <p className="text-date-600 mt-3 leading-relaxed">
              Every dish lists its ingredients, allergens, spice, and price. Mu’azib checks all of them against the guest before it suggests anything.
            </p>
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setCategory(c);
                  setShowAll(false);
                }}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition cursor-pointer ${
                  category === c ? 'bg-date-900 text-sand-50' : 'bg-white border border-sand-200 text-date-600 hover:border-saffron-200'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {failed ? (
          <p className="text-sm text-date-500 border border-dashed border-sand-300 rounded-2xl p-6 text-center">
            The menu couldn’t be loaded right now.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {menu
                ? visible.map((d) => <DishCard key={d.id} dish={d} variant="menu" />)
                : Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-44 rounded-2xl bg-sand-100 animate-pulse" />)}
            </div>
            {menu && matched.length > 6 && (
              <div className="mt-6 text-center">
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="rounded-full border border-sand-200 bg-white hover:border-saffron-200 px-5 py-2.5 text-sm font-semibold text-date-800 transition cursor-pointer"
                >
                  {showAll ? 'Show fewer dishes' : `Show all ${matched.length} dishes`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div id="top" className="min-h-screen bg-sand-50 text-date-900">
      <div className="sadu-band" />
      <Nav />

      {/* HERO */}
      <section className="relative overflow-hidden bg-sand-200/80 border-b border-sand-300">
        <div className="absolute inset-0 dot-texture opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-20 sm:pt-20 sm:pb-28 grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white border border-sand-200 px-3 py-1 text-xs font-medium text-date-600 shadow-[0_1px_2px_rgba(37,26,18,0.05)]">
              <span className="h-1.5 w-1.5 rounded-full bg-palm-500" /> AI host of Dar Najd Kitchen
            </span>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05] mt-5 text-date-900">
              The host who <span className="text-saffron-700 italic">remembers</span> every guest.
            </h1>
            <p className="text-lg text-date-800 leading-relaxed mt-5 max-w-lg">
              Mu’azib remembers allergies, tastes, and budgets from one visit to the next. A check written in code removes unsafe dishes before the AI picks what to suggest.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-8">
              <Link
                to="/app"
                className="inline-flex items-center gap-2 rounded-full bg-saffron-600 hover:bg-saffron-700 text-white font-semibold px-6 py-3 shadow-[0_10px_30px_-12px_rgba(185,122,16,0.7)] transition"
              >
                Start a conversation <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-full bg-white border border-sand-200 hover:border-saffron-200 font-semibold text-date-800 px-6 py-3 transition"
              >
                How memory works
              </a>
            </div>
            <p className="font-arabic text-date-700 mt-8 text-sm">
              <span className="text-saffron-600">مُعَزِّب</span> · the one who hosts and honours his guests
            </p>
          </div>
          <HeroConversation />
        </div>
      </section>


      {/* HOW IT WORKS */}
      <section id="how" className="scroll-mt-20 py-20 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-saffron-700 mb-2">How it works</p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Listen, remember, then serve safely.</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mt-10">
            {[
              {
                icon: <Ear className="w-5 h-5" />,
                title: 'Listens',
                body: 'When a guest mentions an allergy, a craving, or a change of mind, the model saves it with a tool call. It keeps the guest’s exact words as evidence.'
              },
              {
                icon: <BrainCircuit className="w-5 h-5" />,
                title: 'Remembers',
                body: 'Each memory is stored in one of three tiers. When a guest changes their mind, the old record is marked as replaced and kept in the history.'
              },
              {
                icon: <ShieldCheck className="w-5 h-5" />,
                title: 'Serves safely',
                body: 'Before the model chooses anything, a function written in code removes every dish with a flagged allergen, the wrong diet, or a price over budget.'
              }
            ].map((step, i) => (
              <div key={step.title} className="bg-white border border-sand-200 rounded-3xl p-6">
                <div className="flex items-center justify-between">
                  <span className="h-11 w-11 rounded-2xl bg-saffron-50 ring-1 ring-saffron-200 text-saffron-700 flex items-center justify-center">
                    {step.icon}
                  </span>
                  <span className="font-display text-4xl font-semibold text-sand-300">0{i + 1}</span>
                </div>
                <h3 className="font-display text-xl font-semibold mt-5">{step.title}</h3>
                <p className="text-sm text-date-600 leading-relaxed mt-2">{step.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 grid lg:grid-cols-[1fr_1.4fr] gap-8 items-start">
            <div>
              <h3 className="font-display text-2xl font-semibold">Three kinds of memory</h3>
              <p className="text-date-600 leading-relaxed mt-3">
                Not every remark should be remembered forever. A friend’s order tonight shouldn’t change a vegan guest’s profile, and an allergy should never be treated as a mere preference.
              </p>
            </div>
            <div className="space-y-3">
              {[
                {
                  tier: 'hard_constraint' as const,
                  icon: <ShieldAlert className="w-4 h-4" />,
                  what: 'Allergies and strict diets',
                  example: '“I have a severe tree nut allergy.”',
                  effect: 'Dishes that break it are removed in code, every time.'
                },
                {
                  tier: 'soft_preference' as const,
                  icon: <Heart className="w-4 h-4" />,
                  what: 'Tastes, spice, and dislikes',
                  example: '“I can only handle mild spice now.”',
                  effect: 'Changes the ranking. The previous record moves to history.'
                },
                {
                  tier: 'ephemeral' as const,
                  icon: <Clock className="w-4 h-4" />,
                  what: 'Context for this visit only',
                  example: '“My friend wants a rich meat dish tonight.”',
                  effect: 'Only applies to this visit. Never saved to the profile.'
                }
              ].map((t) => (
                <div key={t.tier} className={`bg-white border border-sand-200 border-l-4 ${TIER_STYLES[t.tier].accent} rounded-2xl p-5`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={TIER_STYLES[t.tier].title}>{t.icon}</span>
                    <span className="font-semibold">{t.what}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ring-1 ${TIER_STYLES[t.tier].badge}`}>
                      {TIER_STYLES[t.tier].label}
                    </span>
                  </div>
                  <p className="text-sm text-date-500 italic mt-2">{t.example}</p>
                  <p className="text-sm text-date-700 mt-1">{t.effect}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* GUESTS */}
      <section id="guests" className="scroll-mt-20 py-20 sm:py-24 bg-white border-y border-sand-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-saffron-700 mb-2">Try it</p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Pick a guest and start talking.</h2>
            <p className="text-date-600 mt-3 leading-relaxed">
              Two guests come with history from an earlier visit. The third is brand new. Each guest’s memory is kept separate.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-4 mt-10">
            {PERSONAS.map((p, i) => (
              <Link
                key={p.id}
                to={`/app?guest=${p.id}`}
                className="group flex flex-col bg-sand-50 border border-sand-200 rounded-3xl p-6 hover:border-saffron-200 hover:shadow-[0_20px_50px_-30px_rgba(37,26,18,0.4)] transition"
              >
                <div className="flex items-center gap-3">
                  <Avatar name={p.name} index={i} size="lg" />
                  <div>
                    <h3 className="font-display text-xl font-semibold">{p.name}</h3>
                    <p className="text-xs text-date-500">{p.role}</p>
                  </div>
                </div>
                <p className="text-sm text-date-600 leading-relaxed mt-4">{p.blurb}</p>
                <div className="mt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-date-400 mb-2">Remembers</p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.remembers.length === 0 ? (
                      <span className="text-xs rounded-full px-2.5 py-1 border border-dashed border-sand-300 text-date-500">Nothing yet</span>
                    ) : (
                      p.remembers.map((r) => (
                        <span key={r.label} className={`text-xs rounded-full px-2.5 py-1 ring-1 ${TIER_STYLES[r.tier].badge}`}>
                          {r.label}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="mt-5 rounded-2xl bg-white border border-sand-200 px-4 py-3 text-sm text-date-700">
                  <span className="font-semibold text-saffron-700">Try: </span>
                  {p.tryThis}
                </div>
                <span className="mt-auto pt-5 self-start inline-flex items-center gap-1.5 text-sm font-semibold text-date-900 group-hover:text-saffron-700">
                  Chat as {p.name} <ArrowRight className="w-4 h-4" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <MenuSection />

      {/* TESTED */}
      <section id="tested" className="scroll-mt-20 py-20 sm:py-24 bg-white border-y border-sand-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-[1fr_1.4fr] gap-10 items-start">
          <div>
            <p className="text-sm font-semibold text-saffron-700 mb-2">Tested</p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Every memory rule has a test.</h2>
            <p className="text-date-600 mt-3 leading-relaxed">
              Six automated scenarios run against the real memory engine and safety filter. All six pass.
            </p>
            <div className="flex flex-wrap gap-2 mt-6">
              {['FastAPI', 'SQLAlchemy', 'PostgreSQL', 'OpenRouter tool calling', 'React', 'Tailwind'].map((t) => (
                <span key={t} className="text-xs font-medium rounded-full bg-sand-50 border border-sand-200 px-3 py-1 text-date-600">
                  {t}
                </span>
              ))}
            </div>
          </div>
          <ol className="grid sm:grid-cols-2 gap-3">
            {EVAL_SCENARIOS.map((s) => (
              <li key={s.title} className="flex items-start gap-3 bg-sand-50 border border-sand-200 rounded-2xl p-4">
                <CheckCircle2 className="w-5 h-5 text-palm-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">{s.title}</p>
                  <p className="text-xs text-date-500 mt-1 leading-relaxed">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-[2rem] bg-date-900 text-sand-50 px-6 sm:px-12 py-14 text-center">
            <div className="absolute inset-x-0 top-0 sadu-band" />
            <Logo size="lg" className="h-24 w-20 mx-auto" />
            <p className="font-arabic text-saffron-200 text-xl mt-5">حيّاك الله</p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Your table is ready.</h2>
            <p className="text-sand-200/80 mt-3 max-w-md mx-auto">
              Open the host, choose a guest, and see what it remembers as you talk.
            </p>
            <Link
              to="/app"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-saffron-500 hover:bg-saffron-600 text-date-900 font-semibold px-6 py-3 transition"
            >
              Open Mu’azib <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-sand-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-date-500">
          <div className="flex items-center gap-2">
            <Logo size="sm" />
            <span>
              Mu’azib · AI host of <span className="font-medium text-date-700">Dar Najd Kitchen</span>
            </span>
          </div>
          <span className="flex items-center gap-4">
            <Link to="/admin" className="hover:text-date-800">Agent metrics</Link>
            <span>A demo of tiered memory for an AI agent.</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
