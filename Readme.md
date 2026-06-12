<div align="center">

```
   ██████╗██╗██╗   ██╗███████╗██╗███╗   ███╗
  ██╔════╝██║██║   ██║██╔════╝██║████╗ ████║
  ██║     ██║██║   ██║███████╗██║██╔████╔██║
  ██║     ██║╚██╗ ██╔╝╚════██║██║██║╚██╔╝██║
  ╚██████╗██║ ╚████╔╝ ███████║██║██║ ╚═╝ ██║
   ╚═════╝╚═╝  ╚═══╝  ╚══════╝╚═╝╚═╝     ╚═╝
```

**Ancient Empire Simulator**

*Five AI-controlled civilizations. One world. Infinite emergent diplomacy.*

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Flask](https://img.shields.io/badge/Flask-3.x-black?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![Groq](https://img.shields.io/badge/LLM-Groq%20%2F%20Llama--3.3--70B-F55036?style=flat-square)](https://groq.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

</div>

---

## Overview

CivSim is a **turn-based geopolitical simulation** where five AI-driven civilizations — each with a distinct ideology, personality, and goal set — compete for dominance of a fantasy world. Every turn, each nation calls a large language model to reason about the current world state and decide its action: attack, form alliances, conduct espionage, develop its economy, research technology, or simply consolidate.

The result is a living political simulation where emergent behaviors — betrayals, coalition wars, economic races, secret spy networks — arise naturally from LLM reasoning rather than scripted logic.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Browser (SPA)                        │
│  index.html · main.js · renderer.js · api.js · CSS       │
└──────────────────┬───────────────────────────────────────┘
                   │  HTTP  (port 3000)
┌──────────────────▼───────────────────────────────────────┐
│              Flask Frontend Server  (app.py)             │
│  Jinja2 templates · static file serving · API proxy      │
└──────────────────┬───────────────────────────────────────┘
                   │  HTTP proxy  →  localhost:5000
┌──────────────────▼───────────────────────────────────────┐
│             FastAPI Game Engine  (main.py)               │
│                                                          │
│  /state   GET   → serialize full world state             │
│  /turn    POST  → run one full simulation turn           │
│  /inject  POST  → apply a player event card              │
│  /reset   POST  → re-seed the world                      │
│  /history GET   → full event log                         │
│  /nation  GET   → single-nation detail                   │
└────┬──────────────┬──────────────┬────────────────────────┘
     │              │              │
┌────▼────┐   ┌─────▼──────┐  ┌───▼──────────────────────┐
│engine.py│   │ agents.py  │  │ actions.py / events.py   │
│         │   │            │  │                          │
│Turn     │   │LLM prompt  │  │World mutation layer:     │
│orchestr-│──▶│constructi- │  │attack, trade, alliance,  │
│ation    │   │on + async  │  │betray, spy, develop,     │
│Victory  │   │Groq/vLLM   │  │research, recruit,        │
│check    │   │calls       │  │industrialize, event cards│
└────┬────┘   └────────────┘  └──────────────────────────┘
     │
┌────▼──────────────────────┐
│  world.py  (data layer)   │
│  Nation · WorldState      │
│  WorldEvent dataclasses   │
│  clamp / serialize utils  │
└────────────────────────────┘
```

The design deliberately decouples concerns:

- `world.py` is pure data — zero I/O, fully serializable dataclasses.
- `agents.py` is pure I/O — it constructs prompts and makes async HTTP calls. It never mutates world state.
- `actions.py` is pure mutation — deterministic state transitions, no async, no LLM.
- `engine.py` orchestrates: collect all actions concurrently, then apply them sequentially.
- `events.py` provides player-injectable disruptions that sit outside the agent loop.

---

## Simulation Model

### Nation State

Each nation is a `@dataclass` holding ~20 mutable fields:

| Field | Type | Description |
|---|---|---|
| `gold` | `int` | Economic resource; primary currency |
| `army` | `int` | Military strength; combat multiplier |
| `population` | `int` | Civilian base; caps territory carrying capacity |
| `happiness` | `float [0,1]` | Civil contentment; affects gold/army passively |
| `territory` | `int` | Land controlled; drives income and population cap |
| `technology` | `int` | Combat multiplier (+5% per level) and tech victory |
| `economy_level` | `int` | Passive gold multiplier per turn |
| `food` / `iron` / `production` | `int` | Resource layer for recruitment and research |
| `relations` | `dict[str, int]` | Bilateral relation scores (−100 to +100) |
| `trust` | `dict[str, int]` | Separate trust axis, modified by betrayals and espionage |
| `grudges` | `dict[str, int]` | Grudge accumulation; informs LLM hostility weighting |
| `memory` | `list[str]` | FIFO ring buffer (cap 10); injected into every prompt |
| `alliances` / `wars` / `rivals` | `list[str]` | Coalition tracking |
| `trade_routes` | `dict[str, str]` | Active trade routes with resource type |

All numeric values are clamped after every mutation through `Nation.clamp()`.

### Turn Lifecycle

```
1. Income Phase (engine.py)
   ├─ Gold += (population // 10) + (territory × 2) + (economy_level × 5)
   ├─ Gold += (len(trade_routes) × 5)
   ├─ Food += population // 5
   ├─ Iron += territory
   ├─ Production += territory // 2
   ├─ Army upkeep: food -= army // 2
   │    └─ food < 0 → army -= 3, happiness -= 0.05
   ├─ Population growth: if pop < (territory × 20) → pop += max(1, territory // 3)
   └─ Happiness effects: low → gold penalty; high → gold bonus

2. Decision Phase (agents.py)
   └─ All nations call LLM concurrently (asyncio + httpx)
       └─ Retry up to 3× on HTTP 429 with exponential backoff

3. Resolution Phase (actions.py)
   └─ Actions applied sequentially; each sees prior mutations

4. Victory Check (engine.py)
   └─ Domination · Conquest · Economic · Technological · Diplomatic
```

### Combat Resolution

Attack power uses randomized variance to prevent determinism:

```python
attack_power  = (army × (1 + technology × 0.05)) × uniform(0.8, 1.2)
defense_power = (army × (1 + technology × 0.05)) × uniform(0.8, 1.2)
power_delta   = attack_power - defense_power

power_delta > 15  → decisive victory: seize territory // 2 (min 2)
power_delta > 0   → marginal victory: seize territory // 3 (min 1)
power_delta ≤ 0   → repelled: attacker loses 5 army
```

### Victory Conditions

| Type | Condition |
|---|---|
| **Domination** | Last nation standing |
| **Conquest** | `territory ≥ 15` |
| **Economic** | `gold ≥ 1000` |
| **Technological** | `technology ≥ 20` |
| **Diplomatic** | `relations ≥ 100` with every surviving nation |

---

## The AI Agents

Each nation is driven by a structured LLM prompt composed of two parts:

**System prompt** — ideological persona (5 types: `militarist`, `mercantile`, `theocratic`, `democratic`, `authoritarian`) instilling strategic disposition and decision-making style.

**User message** — full world state snapshot including:
- All own stats (gold, army, food, iron, technology, economy, population, happiness, territory)
- Goals, personality traits, memory (last 5 entries), relations, trust, grudges, alliances, wars, rivals
- Global intelligence on every surviving nation
- All events that have occurred so far this turn
- Victory conditions with explicit thresholds

The agent is required to respond with a structured JSON action:

```json
{
  "action": "attack | trade | alliance | betray | develop | spy | declare_war | research | invest | recruit | industrialize | trade_resource | nothing",
  "target": "<nation name | null>",
  "public_message": "...",
  "internal_thought": "...",
  "strategic_goal": "...",
  "priority_score": "1-10",
  "confidence": "0-100",
  "threat_assessment": { "highest_threat": "...", "threat_level": "low|medium|high|existential" },
  "relations_assessment": { "best_ally": "...", "worst_enemy": "..." },
  "expected_outcome": "...",
  "fallback_plan": "...",
  "justification": "..."
}
```

The agent is never exposed to the raw JSON schema directly — it reasons in natural language and produces structured output. Invalid actions are gracefully downgraded to `nothing` via `validate_action()`. LLM failures never crash a turn.

**Model:** `llama-3.3-70b-versatile` via Groq API (swappable to any OpenAI-compatible endpoint including local vLLM).

---

## The Five Kingdoms

| Nation | Ideology | Starting Profile | Goals |
|---|---|---|---|
| **Ironmark** | Militarist | High army, low gold | Dominate, destroy weakest first |
| **Aurentum** | Mercantile | High gold, low army | Accumulate 500g, control trade routes |
| **Solenne** | Theocratic | Balanced | Convert all nations, eliminate heathens |
| **Valdris** | Democratic | High gold, high population | Build 5-nation alliance, achieve lasting peace |
| **Kethara** | Authoritarian | High army, medium gold | Survive by any means, ally then betray |

Each nation is seeded with 2 randomly selected personality traits from a pool of 10 (`paranoid`, `honorable`, `opportunistic`, `vengeful`, `expansionist`, `isolationist`, `charismatic`, `cautious`, `aggressive`, `pragmatic`). Traits are injected into the LLM prompt to further differentiate behavior.

---

## Player-Injectable Event Cards

Players can inject world events mid-simulation to disrupt the AI's plans:

| Card | Effect |
|---|---|
| 🌋 **Volcano** | Army −5, Population −10, Happiness −0.2 |
| 🌾 **Famine** | Population −15, Happiness −0.3, Gold −20 |
| 💰 **Gold Rush** | Gold +80 |
| ☠ **Plague** | Target: Pop −20, Army −3, Happiness −0.25; **all nations** Pop −5 |
| ⚔ **Coup** | Army −8, Happiness −0.4, all bilateral relations −20 |
| ✨ **Miracle** | Happiness +0.5, Population +10, all bilateral relations +10 |

Events report **actual clamped deltas** post-application (e.g. `"Famine struck Aurentum! (Gold -20, Population -15, Happiness -0.28)"`). Events can also trigger nation eliminations.

---

## Frontend

The UI is a single-page application served via Flask/Jinja2. It communicates with the Flask proxy which forwards to the FastAPI backend.

**Tech stack:**
- Jinja2 component macros (`nation_card.html`, `event_log.html`, `event_cards.html`)
- Vanilla JS ES modules (`main.js`, `api.js`, `renderer.js`)
- Tailwind CSS (utility layer) + hand-crafted CSS design system (`civsim.css`)
- Lucide icons
- Google Fonts: Cinzel (headers), Cormorant Garamond (serif accents), Inter (body)

**UI components:**
- **Empire Intelligence panel** — per-nation stat bars with animated count-up, relation dots (−100→+100 color-coded), memory peek, power score, threat level badge
- **Fantasy SVG world map** — clickable territory paths, capital pulse rings, fog vignette, compass rose, ocean wave patterns
- **World Chronicle panel** — event log with rarity tiers (common/uncommon/rare/legendary), classified intel reveal toggle, action-type color badges
- **Command bar** — Next Turn / Reset controls, 6 injectable event cards with per-card themed styling
- **Ambient particle canvas** — 55 floating gold/ember particles rendered via `requestAnimationFrame`
- **Victory banner** — full-screen cinematic overlay with nation crest, color scheme, and victory type proclamation

---

## Project Structure

```
CivSim/
├── main.py           # FastAPI app — all route definitions
├── app.py            # Flask frontend server + API proxy
├── engine.py         # Turn orchestrator, income phase, victory conditions
├── agents.py         # LLM prompt construction, async Groq calls, action validation
├── actions.py        # All world mutations (13 action types)
├── events.py         # Player event card handlers
├── world.py          # Dataclasses: Nation, WorldState, WorldEvent; serialization
├── seed.py           # World initialization — the 5 seed nations
├── requirements.txt  # Python dependencies
├── .env              # GROQ_API_KEY (not committed)
└── templates/
    ├── index.html                    # Main SPA shell (Jinja2)
    ├── components/
    │   ├── nation_card.html          # Kingdom card skeleton macro
    │   ├── event_log.html            # Chronicle panel macro
    │   └── event_cards.html          # Event injection panel macro
    └── static/
        ├── css/civsim.css            # Full design system
        └── js/
            ├── main.js               # Boot, event wiring, turn/reset handlers
            ├── api.js                # Fetch transport layer
            └── renderer.js           # Pure DOM rendering, animations, victory banner
```

---

## Getting Started

**Prerequisites:** Python 3.11+, a [Groq API key](https://console.groq.com)

### 1. Clone and install

```bash
git clone https://github.com/your-username/civsim.git
cd civsim
python -m venv env
env\Scripts\activate        # Windows
# source env/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

### 2. Configure environment

```bash
# .env
GROQ_API_KEY=gsk_your_key_here
```

### 3. Start the backend (FastAPI)

```bash
uvicorn main:app --port 5000 --reload
```

### 4. Start the frontend (Flask)

```bash
python app.py
```

### 5. Open the simulator

Navigate to `http://localhost:3000` and click **PLAY**.

> **Using a local model?** In `agents.py`, swap `VLLM_URL` to your vLLM endpoint and update `MODEL` to match. The agent layer is OpenAI-API-compatible.

---

## Configuration Reference

All tunable constants live at the top of their respective files:

**`engine.py`** — victory thresholds
```python
GOLD_VICTORY        = 1000
TERRITORY_VICTORY   = 15
TECH_VICTORY        = 20
DIPLOMATIC_THRESHOLD = 100
```

**`agents.py`** — LLM parameters
```python
MODEL        = "llama-3.3-70b-versatile"
TIMEOUT      = 30     # seconds per request
MAX_TOKENS   = 250
TEMPERATURE  = 0.5
```

**`world.py`** — global simulation limits
```python
MAX_MEMORY           = 10    # FIFO memory entries per nation
RELATION_MIN         = -100
RELATION_MAX         = 100
RECENT_EVENTS_LIMIT  = 30    # events returned in /state
```

---

## Extending CivSim

**Add a new action type:**
1. Define the handler in `actions.py` following the `_do_*` pattern
2. Add the string key to `VALID_ACTIONS` in `agents.py`
3. Add a dispatch case in `apply_action()`

**Add a new ideology:**
1. Write a persona string in the `PERSONAS` dict in `agents.py`
2. Add a nation with the new `Ideology` literal in `seed.py`
3. Extend the `Ideology` type alias in `world.py`

**Add a new event card:**
1. Write a handler in `events.py`
2. Add to `_CARD_HANDLERS` and `KNOWN_CARDS`
3. Add a card button in `templates/components/event_cards.html` with matching `data-card` attribute and CSS theme in `civsim.css`

**Swap the LLM backend:**
- Any OpenAI-compatible chat completions endpoint works. Change `VLLM_URL` and `MODEL` in `agents.py`.

---

## License

MIT — use it, fork it, simulate empires with it.

---

<div align="center">
<sub>Built with FastAPI · Flask · Groq · Llama 3.3 · Vanilla JS</sub>
</div>
