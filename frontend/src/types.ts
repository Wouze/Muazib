export type Tier = 'hard_constraint' | 'soft_preference' | 'ephemeral';

export interface AgentMetrics {
  guests: number;
  visits: number;
  turns: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  turns_with_usage: number;
  avg_tokens_per_turn: number;
  daily: { date: string; turns: number; tokens: number }[];
  models: { model: string; turns: number; tokens: number }[];
  memories: { created: number; updated: number; revoked: number; tiers: Record<Tier, number> };
  orders: { confirmed: number; refused: number; dishes_accepted: number; dishes_refused: number };
  recent: { guest: string; model: string; tokens: number; created_at: string | null }[];
}

export interface AppConfig {
  project_name: string;
  default_model: string;
  has_api_key: boolean;
}

export interface User {
  id: string;
  name: string;
  avatar_role: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
}

export interface MemoryEvent {
  action: string;
  category: string;
  attribute: string;
  previous_value?: string | null;
  new_value?: string;
  value?: string;
  tier?: string;
  reason?: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  recommended_item_ids: string[];
  memory_events: MemoryEvent[];
  created_at: string;
  follow_ups?: string[];
  failed?: boolean;
  stopped?: boolean;
  retryText?: string;
}

export interface OrderLine {
  id: string;
  name: string;
  price: number;
}

export interface RefusedLine {
  id: string;
  name: string;
  reasons: string[];
}

export interface VisitOrderReceipt {
  conversation_id: string;
  items: OrderLine[];
  refused: RefusedLine[];
  total_price: number;
  updated_at: string | null;
}

export interface PreviousOrderItem extends OrderLine {
  still_safe: boolean;
  reasons: string[];
}

export interface PreviousOrder {
  conversation_id: string;
  title: string;
  for_company?: boolean;
  items: PreviousOrderItem[];
}

export interface OrderView {
  order: VisitOrderReceipt | null;
  previous: PreviousOrder | null;
}

export interface ConfirmResult {
  status: 'confirmed' | 'refused_all';
  accepted: OrderLine[];
  refused: RefusedLine[];
  total_price: number;
  kept_existing: boolean;
  message?: ChatMessage;
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'discard' }
  | { type: 'step'; kind: 'memory' | 'menu' | 'order'; label: string }
  | { type: 'done'; message: ChatMessage; active_model: string; order?: ConfirmResult | null }
  | { type: 'error'; detail: string };

export interface MemoryRecord {
  id: number;
  category: string;
  attribute: string;
  value: string;
  tier: Tier;
  status: 'active' | 'superseded' | 'revoked';
  source_quote?: string;
  reason?: string;
  superseded_by_id?: number | null;
  updated_at: string;
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  spice_level: string;
  is_vegetarian: boolean;
  is_vegan: boolean;
  ingredients: string[];
  allergens: string[];
  tags: string[];
  description: string;
  is_safe?: boolean;
  rejection_reasons?: string[];
  compatibility_score?: number;
  match_notes?: string[];
}

export interface ConstraintSummary {
  allergies?: string[];
  require_vegan?: boolean;
  require_vegetarian?: boolean;
  max_price?: number | null;
  preferred_spice?: string | null;
  liked_terms?: string[];
  disliked_terms?: string[];
}

export interface MenuMatrix {
  safe_recommendations: MenuItem[];
  excluded_items: MenuItem[];
  active_constraints_summary: ConstraintSummary;
}
