# Mu'azib (مُعَزِّب) — Stateful AI Ordering Host for Dar Najd Kitchen

In traditional Najdi hospitality, a **Mu'azib (مُعَزِّب)** is an attentive host who remembers every returning guest's dietary needs, spice tolerance, and favorite dishes across visits without forcing them to fill out a rigid questionnaire.

**Mu'azib** is a stateful conversational restaurant ordering agent built for **Dar Najd Kitchen (مطبخ دار نجد)**. Beyond fulfilling all Part 1 Baseline capabilities, this project invests its **Part 2 Engineering Challenge** into solving **The Conversational Memory & Dietary Safety Problem**: combining a **3-Tier Relational Memory State Machine** with a **Deterministic Menu Safety Guardrail**.

---

## 1. Architecture Overview

```text
+-----------------------------------------------------------------------------------+
|                React + Tailwind "Hospitality Command Center" UI                   |
|  [Guest & Session Switcher]  [Grounded Dish Cards]  [Live Memory & Matrix Panes]  |
+-----------------------------------------+-----------------------------------------+
                                          | REST API (/api/chat, /api/users, ...)
                                          v
+-----------------------------------------------------------------------------------+
|                        FastAPI Orchestrator & Agent Loop                          |
|                                                                                   |
|  1. Pre-Turn Context Injection (Active Permanent + Current Session Memories)      |
|  2. OpenRouter Tool-Calling Loop (Configurable LLM: GPT-4o-mini / Claude / etc.)  |
|     ├── Tool: upsert_guest_memory()  ──> Versioned Conflict Resolution & Lineage  |
|     ├── Tool: revoke_guest_memory()  ──> Explicit State Revocation                |
|     └── Tool: get_curated_menu_recommendations() ──> Deterministic Safety Filter  |
+-----------------------------------------+-----------------------------------------+
                                          |
                   +----------------------+----------------------+
                   v                                             v
+-------------------------------------+       +-------------------------------------+
|   PostgreSQL / SQLite State Store   |       |    Dar Najd Kitchen (menu.json)     |
|  - users (Strict Multi-User Isol.)  |       |  - 16 Authentic Najdi Dishes        |
|  - conversations (Visit Sessions)   |       |  - Explicit Ingredients & Allergens |
|  - user_memories (Tiered & Audited) |       |  - Overlapping Reasoning Clusters   |
+-------------------------------------+       +-------------------------------------+

```

---

## 2. Part 1: Baseline Capabilities Checklist

* **Natural Preference Discovery (2.1):** Extracts allergies, diets, spice preferences, liked/disliked ingredients, and budget caps organically during conversation via structured tool calling.
* **Strictly Grounded Menu Recommendations (2.2):** Every recommendation is verified against `data/menu.json` (16 dishes across 4 categories: *Starters, Mains, Sides, Desserts & Drinks*). Dish cards render prices, ingredients, and allergen badges directly from the source of truth—making hallucinated prices or ingredients impossible.
* **Cross-Session Long-Term Memory (2.3):** Clicking **"+ New Visit"** opens a fresh conversation thread while retaining the guest's persistent memory profile.
* **Evolving Preferences (2.4):** Updating a preference (e.g., changing spice tolerance from `high` to `mild`, or adding a newly discovered `tree_nuts` allergy) automatically marks the outdated record as `superseded` and links it via `superseded_by_id`.
* **Returning Users & Isolation (2.5):** Pre-seeded with 3 distinct personas (*Tariq*, *Noura*, *Salman*) plus a **"+ New Guest"** creator. All queries are strictly scoped by `user_id`.
* **Usable Deployed Interface (2.6):** Split-screen web interface featuring 1-click reviewer scenario prompts, a **Live Memory Inspector**, and a real-time **Menu Safety Matrix**.

---

## 3. Part 2 Deep Dive: Tiered Memory State Machine & Deterministic Safety Guardrail

### 3.1 Problem Identification

Naive LLM memory implementations (such as append-only text logs or vector RAG over past chat transcripts) fail in food-ordering applications in three critical ways:

1. **Scope Contamination (Permanent vs. Ephemeral):** If a vegan user says *"I'm ordering a meat dish for my friend tonight"* or *"I only have $15 today"*, naive memory permanently overwrites their identity profile.
2. **Allergen & Negation Blindness:** Semantic vector search struggles with negation (*"I am allergic to tree nuts"* has high cosine similarity to *"I love tree nuts"*). Relying purely on LLM prompting to filter 16+ multi-ingredient dishes risks dangerous allergen leaks (e.g., recommending *Vegan Almond-Milk Jareesh* to a vegan guest who just reported a tree-nut allergy).
3. **Contradiction Accumulation:** When preferences evolve over months, append-only memory feeds both the old and new preferences into the prompt, causing non-deterministic recommendations.

### 3.2 Prioritization

In conversational commerce—and specifically food ordering—**trust and personalization accuracy** are the highest-leverage engineering problems. A user will forgive a basic UI, but they will never forgive an assistant that recommends a dish containing their allergen or forgets a preference correction two turns later.

### 3.3 Scoping & Trade-offs (What We Built vs. What We Deliberately Excluded)

| Engineering Decision | What We Built | What We Deliberately Left Out & Why |
| --- | --- | --- |
| **Relational State Machine over `pgvector` RAG** | Normalized `(category, attribute)` composite keys stored in PostgreSQL/SQLite with explicit `status` (`active`, `superseded`, `revoked`) and `superseded_by_id` lineage. | **Excluded Vector Embeddings (`pgvector`) for Preferences:** Vector search introduces latency, embedding costs, and failure modes on negations. A relational state machine is 100% deterministic, explainable, and faster. |
| **3-Tier Memory Hierarchy** | Explicitly classifies memories into `hard_constraint` (allergies/strict diets), `soft_preference` (spice, likes/dislikes), and `ephemeral` (bound only to `conversation_id`). | **Excluded Implicit Unconfirmed Inference:** The agent only mutates hard constraints when explicitly stated by the user, preventing false-positive dietary lockouts. |
| **Hybrid Deterministic + LLM Recommender** | Python guardrail (`evaluate_menu_for_user`) deterministically blocks any dish violating a `hard_constraint` and scores remaining items against `soft_preferences` before LLM synthesis. | **Excluded Full POS Checkout / Payment Flows:** Focused engineering effort on preference reasoning, explainability, and memory state integrity rather than boilerplate e-commerce checkout forms. |

### 3.4 Execution & Validation

Run the automated verification suite to validate all 6 core memory & guardrail scenarios:

```bash
python -m tests.eval_memory
# or via pytest:
pytest tests/eval_memory.py -v

```

| Evaluation Scenario | Validated Behavior | Result |
| --- | --- | --- |
| **1. Cross-Session Persistence** | Memories from `visit_1` automatically filter and rank dishes in `visit_2`. | **PASS ✅** |
| **2. Evolving Preference Lineage** | Updating `spice.level` (`high` ➔ `mild`) marks old row `superseded` and links `superseded_by_id`. | **PASS ✅** |
| **3. Allergen Trap & Precedence** | Adding `allergy.tree_nuts` revokes prior nut likes and blocks *Almond-Milk Jareesh (`main_02`)* while keeping *Vegetable Matazeez (`main_03`)*. | **PASS ✅** |
| **4. Ephemeral Scope Isolation** | Ordering meat for a friend (`tier=ephemeral`) unlocks meat dishes in `visit_1` without corrupting vegan profile in `visit_2`. | **PASS ✅** |
| **5. Multi-User Isolation** | Alice's `gluten` & `dairy` allergies have zero impact on Bob's menu matrix. | **PASS ✅** |
| **6. Explicit Revocation** | Removing a budget constraint immediately restores all 16 menu items. | **PASS ✅** |

---

## 4. Running Locally

### Prerequisites

* Python 3.12+
* Node.js 20+ (if rebuilding frontend assets)
* An OpenRouter API Key (`OPENROUTER_API_KEY`)

### Quick Start

1. **Clone & configure environment:**
```bash
cp .env.example .env
# Add your OPENROUTER_API_KEY to .env
# Leave DATABASE_URL empty for zero-config local SQLite, or provide a PostgreSQL URL

```


2. **Install backend dependencies:**
```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

```


3. **Install frontend dependencies and start the dev server** (proxies `/api` to the backend on port 8000):
```bash
cd frontend && bun install && bun run dev
```

4. In another terminal, start the API:
```bash
uvicorn backend.main:app --reload --port 8000
```

5. Open **`http://localhost:5173`** for the dev UI, or **`http://localhost:8000`** after `bun run build` for the landing page. The host workspace is at `/app` (`/app?guest=guest_noura` opens a specific guest).

### Docker / Coolify Deployment

The image is a two-stage build: Bun 1.3 compiles the frontend, then Python 3.12 serves the API and the built UI on port **8000**. A container health check calls `GET /api/config` every 5 seconds, starting 5 seconds after launch.

Local image check:

```bash
docker build -t muazib-agent .
docker run -p 8000:8000 --env-file .env muazib-agent
```

**Coolify**

1. Create a **Dockerfile** application from this repo. The Dockerfile is at the repository root.
2. Set the exposed port to **8000**.
3. Attach a Coolify **PostgreSQL** database. SQLite inside the container is wiped on every redeploy, so do not use it in production.
4. Set these environment variables. Do not commit a real `.env`.

| Variable | Value |
| --- | --- |
| `OPENROUTER_API_KEY` | Your OpenRouter key |
| `LLM_MODEL` | `deepseek/deepseek-v4.1-flash:nitro` |
| `DATABASE_URL` | `postgresql://USER:PASSWORD@HOST:5432/DBNAME` |
| `MENU_PATH` | `data/menu.json` (optional; this is already the default) |

`backend/config.py` rewrites `postgres://` and `postgresql://` to `postgresql+psycopg2://`, so a Coolify URL works without editing.

5. Deploy, then confirm `https://<your-domain>/api/config` returns `has_api_key: true` and `https://<your-domain>/` loads the command center. The seeded guests are Tariq, Noura, and Salman.

---

## 5. Known Limitations & Future Improvements

* **Entity Synonym Normalization:** While the LLM tool schema normalizes standard allergens (`gluten`, `dairy`, `tree_nuts`, `sesame`, `eggs`), highly niche culinary synonyms in free-text ingredients could benefit from a canonical ingredient ontology table.
* **Group Order Cart Splits:** Currently, `ephemeral` memories allow ordering for a friend within a session; with more time, we would model multi-diner sub-profiles within a single shared table cart.
