import type { Tier } from '../types';

export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash:nitro';

export interface Scenario {
  label: string;
  hint: string;
  prompt: string;
}

const SCENARIOS: Record<string, Scenario[]> = {
  guest_tariq: [
    {
      label: 'Cross-session memory',
      hint: 'See what Mu’azib already knows from his first visit.',
      prompt: 'Salam! I am back for dinner. Based on what you already know about me, what Jareesh or main dish do you recommend?'
    },
    {
      label: 'Add a tree nut allergy',
      hint: 'A new hard rule that blocks the Almond-Milk Jareesh.',
      prompt: 'Actually, I recently discovered I have a severe tree nut allergy. Also keep dishes under $16 today. What should I order now?'
    },
    {
      label: 'Order for a meat-eating friend',
      hint: 'Temporary context that won’t touch his vegan profile.',
      prompt: 'My friend is joining me tonight and wants a rich traditional meat dish. Recommend something for him without changing my personal vegan profile!'
    }
  ],
  guest_noura: [
    {
      label: 'Returning spice & dairy profile',
      hint: 'Fiery dishes, and nothing with dairy.',
      prompt: 'Hi! What fiery dishes do you recommend for me tonight?'
    },
    {
      label: 'Spice: high → mild',
      hint: 'An evolving preference, with the old one kept as history.',
      prompt: 'My doctor told me to stop eating spicy food—I can only handle mild or no spice now. What main and starter fit me best?'
    },
    {
      label: 'Add a cilantro dislike',
      hint: 'A soft dislike that lowers dishes with cilantro.',
      prompt: 'By the way, I really dislike cilantro. What sides or mains should I get?'
    }
  ],
  default: [
    {
      label: 'Natural preference discovery',
      hint: 'An allergy, favourite dishes, and a budget in one message.',
      prompt: 'Hello! It is my first time at Dar Najd Kitchen. I love traditional wheat dishes and lamb, but I am allergic to dairy and want something under $20.'
    },
    {
      label: 'Evolve budget & spice',
      hint: 'Update two preferences at once.',
      prompt: 'Actually, let us bump my budget up to $27 and make it medium or high spice—I love smoky flavors!'
    },
    {
      label: 'Dairy-free dessert & coffee',
      hint: 'Finish the meal within the same rules.',
      prompt: 'What traditional Najdi drink or dessert can I have that is completely dairy-free?'
    }
  ]
};

export function scenariosFor(userId: string): Scenario[] {
  return SCENARIOS[userId] || SCENARIOS.default;
}

export interface Persona {
  id: string;
  name: string;
  role: string;
  blurb: string;
  remembers: { label: string; tier: Tier }[];
  tryThis: string;
}

export const PERSONAS: Persona[] = [
  {
    id: 'guest_tariq',
    name: 'Tariq',
    role: 'Returning guest',
    blurb: 'A strict vegan who comes back for traditional jareesh.',
    remembers: [
      { label: 'Vegan', tier: 'hard_constraint' },
      { label: 'Loves jareesh', tier: 'soft_preference' }
    ],
    tryThis: 'Tell Mu’azib you just found out you’re allergic to tree nuts.'
  },
  {
    id: 'guest_noura',
    name: 'Noura',
    role: 'VIP regular',
    blurb: 'A severe dairy allergy and a taste for real Shaqra heat.',
    remembers: [
      { label: 'Dairy allergy', tier: 'hard_constraint' },
      { label: 'High spice', tier: 'soft_preference' }
    ],
    tryThis: 'Say your doctor wants you on mild food from now on.'
  },
  {
    id: 'guest_salman',
    name: 'Salman',
    role: 'First visit',
    blurb: 'No history yet. Mu’azib learns about him as you talk.',
    remembers: [],
    tryThis: 'Introduce yourself with an allergy, a craving, and a budget.'
  }
];

export const EVAL_SCENARIOS = [
  { title: 'Cross-session persistence', detail: 'Visit #1 memories filter and rank dishes in visit #2.' },
  { title: 'Preference evolution', detail: 'Spice high → mild supersedes the old record and links it.' },
  { title: 'Allergen precedence', detail: 'A tree nut allergy revokes nut likes and blocks Almond-Milk Jareesh.' },
  { title: 'Ephemeral isolation', detail: 'A meat order for a friend never reaches the vegan profile.' },
  { title: 'Multi-user isolation', detail: 'One guest’s allergies never affect another guest’s menu.' },
  { title: 'Explicit revocation', detail: 'Removing a budget brings all 16 dishes back.' }
];
