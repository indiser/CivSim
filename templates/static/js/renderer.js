// Pure DOM rendering. Never fetches. Receives data, mutates the page.
// All exported function signatures are preserved exactly.

export const NATION_COLORS = {
  Ironmark: "#c0392b",
  Aurentum: "#f39c12",
  Solenne:  "#8e44ad",
  Valdris:  "#2980b9",
  Kethara:  "#16a085",
};

// Crest symbol per nation
const NATION_CRESTS = {
  Ironmark: "⚔",
  Aurentum: "♛",
  Solenne:  "✦",
  Valdris:  "⚓",
  Kethara:  "✿",
};

// Ideology-to-short-label mapping
const IDEOLOGY_LABELS = {
  militarist:   "Militarist",
  mercantilist: "Mercantile",
  expansionist: "Expansionist",
  isolationist: "Isolationist",
  diplomat:     "Diplomat",
};

const ACTION_STYLES = {
  attack:       { bg: "#7B241C", fg: "#FF8A80" },
  declare_war:  { bg: "#7B241C", fg: "#FF8A80" },
  trade:        { bg: "#1A5276", fg: "#82C4F8" },
  alliance:     { bg: "#1E5631", fg: "#6FCF97" },
  betray:       { bg: "#4A235A", fg: "#CE93D8" },
  spy:          { bg: "#212F3C", fg: "#A29BFE" },
  develop:      { bg: "#0E6655", fg: "#80D8C3" },
  nothing:      { bg: "#161B22", fg: "#7A8099" },
};

// Action → chronicle icon
const ACTION_ICONS = {
  attack:      "⚔",
  declare_war: "⚔",
  trade:       "💰",
  alliance:    "🤝",
  betray:      "🗡",
  spy:         "🕵",
  develop:     "🏛",
  nothing:     "…",
};

// Stat display config
const STAT_DEFS = [
  { key: "army",       sym: "⚔", label: "Army",     color: "#C0392B", max: 1000,   tip: "Military strength — determines combat outcomes." },
  { key: "gold",       sym: "♛", label: "Gold",     color: "#D4AF37", max: 1000,   tip: "Economic resource — funds development and war." },
  { key: "population", sym: "♟", label: "Pop",      color: "#27AE60", max: 100000, tip: "Civilian count — the lifeblood of the nation." },
  { key: "happiness",  sym: "☯", label: "Mood",     color: "#F39C12", max: 1,      tip: "Civil contentment 0–100%. Low happiness breeds unrest." },
  { key: "territory",  sym: "⬡", label: "Territory",color: "#16A085", max: 100,    tip: "Land controlled — seized and lost through war." },
];

// Rarity mapping by action type
const ACTION_RARITY = {
  attack:      "rare",
  declare_war: "legendary",
  betray:      "legendary",
  spy:         "rare",
  alliance:    "uncommon",
  trade:       "uncommon",
  develop:     "common",
  nothing:     "common",
};

// Cache previous stat values for count-up animations
let prevStats = {};

// Currently selected nation name
let selectedNationName = null;

function esc(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

function statDisplay(stat, value) {
  if (stat === "happiness")  return `${Math.round(value * 100)}%`;
  if (stat === "population") return Math.round(value).toLocaleString();
  return String(Math.round(value));
}

function relationClass(value) {
  if (value > 30)  return "rel-good";
  if (value < -30) return "rel-bad";
  return "rel-neutral";
}

function computePower(n) {
  return Math.round(
    (n.army / 10) * 0.4 +
    (n.gold / 10) * 0.25 +
    (n.population / 1000) * 0.15 +
    (n.happiness * 100) * 0.1 +
    (n.territory || 0) * 0.1
  );
}

function getThreatLevel(army) {
  if (army > 700) return { label: "APEX",  color: "#E74C3C", glow: "rgba(231,76,60,0.5)" };
  if (army > 400) return { label: "HIGH",  color: "#E67E22", glow: "rgba(230,126,34,0.4)" };
  if (army > 200) return { label: "MED",   color: "#F39C12", glow: "rgba(243,156,18,0.35)" };
  return               { label: "LOW",   color: "#5D6D7E", glow: "rgba(93,109,126,0.2)" };
}

// ─────────────────────────────────────────────────────────────────
// RENDER NATIONS — Kingdom profile cards in the left panel
// ─────────────────────────────────────────────────────────────────
export function renderNations(nations) {
  const grid  = document.getElementById("nation-grid");
  const names = Object.keys(nations);

  grid.innerHTML = names.map((name, idx) => {
    const n      = nations[name];
    const color  = NATION_COLORS[name]  || "#7a8099";
    const crest  = NATION_CRESTS[name]  || "✦";
    const power  = computePower(n);
    const threat = getThreatLevel(n.army);

    // Stat bars
    const statBarsHTML = STAT_DEFS.map((s) => {
      const prev      = prevStats[name]?.[s.key];
      const startVal  = prev !== undefined ? prev : n[s.key];
      const startPct  = Math.min(100, (startVal / s.max) * 100);
      const trend     = prev !== undefined
        ? (n[s.key] > prev ? "▲" : n[s.key] < prev ? "▼" : "")
        : "";
      const trendColor = trend === "▲" ? "#27AE60" : trend === "▼" ? "#C0392B" : "transparent";

      return `
        <div class="card-stat-row" data-tip="${esc(s.tip)}">
          <span class="card-stat-sym" style="color:${s.color};">${s.sym}</span>
          <div class="card-stat-bar">
            <div class="card-stat-fill" id="bar-${esc(name)}-${s.key}"
                 style="width:${startPct.toFixed(1)}%;background:linear-gradient(90deg,${s.color}cc,${s.color});"></div>
          </div>
          <span class="card-stat-val count-up" id="stat-${esc(name)}-${s.key}">
            ${statDisplay(s.key, startVal)}
          </span>
          <span style="font-size:7px;color:${trendColor};width:8px;flex-shrink:0;line-height:1;">${trend}</span>
        </div>`;
    }).join("");

    // Relation dots
    const dots = Object.entries(n.relations || {}).map(([other, val]) =>
      `<span class="relation-dot ${relationClass(val)}" data-tip="${esc(other)}: ${esc(val)}"></span>`
    ).join("");

    // Latest memory
    const mem    = (n.memory || []).slice(-1)[0] || "";
    const memPeek = mem
      ? `<span class="memory-peek" title="${esc(mem)}">"${esc(mem.slice(0, 36))}${mem.length > 36 ? "…" : ""}"</span>`
      : "";

    // Eliminated overlay
    const overlay = n.eliminated
      ? `<div class="eliminated-overlay">
           <span style="font-size:20px;opacity:0.6;">☠</span>
           <span>ELIMINATED</span>
         </div>`
      : "";

    return `
      <article class="nation-card noise-panel" id="card-${esc(name)}"
               style="border-left-color:${color};animation-delay:${idx * 55}ms;"
               data-nation="${esc(name)}">
        ${overlay}
        <div class="kingdom-card-header">
          <div class="kingdom-crest-sm" style="color:${color};border-color:${color}45;background:${color}14;">
            ${crest}
          </div>
          <div class="kingdom-card-meta">
            <div class="kingdom-card-name" style="color:${color};">${esc(name)}</div>
            <span class="ideology-badge">${esc(n.ideology || "—")}</span>
          </div>
          <div class="power-score-badge" data-tip="Combined power score">
            <span style="color:var(--text-faint);font-size:6.5px;letter-spacing:.1em;">PWR</span><br>
            <span style="color:${color};font-size:13px;font-weight:900;">${power}</span>
          </div>
        </div>

        <div class="card-stat-bars">${statBarsHTML}</div>

        <div class="card-footer">
          <div class="relations-row">${dots}</div>
          ${memPeek}
          <span style="
            font-family:'Cinzel',serif;font-size:7.5px;font-weight:800;
            color:${threat.color};
            border:1px solid ${threat.color}50;border-radius:4px;
            padding:2px 6px;white-space:nowrap;
            box-shadow:0 0 6px ${threat.glow};
            text-shadow:0 0 8px ${threat.color};
          ">${threat.label}</span>
        </div>
      </article>`;
  }).join("");

  if (window.lucide) window.lucide.createIcons();

  // Animate stat changes
  names.forEach((name) => {
    const n = nations[name];
    STAT_DEFS.forEach((s) => {
      const prev = prevStats[name]?.[s.key];
      if (prev !== undefined && prev !== n[s.key]) {
        animateStatChange(name, s.key, n[s.key]);
        animateStatBar(name, s.key, n[s.key], s.max);
      } else {
        requestAnimationFrame(() => {
          setTimeout(() => animateStatBar(name, s.key, n[s.key], s.max), 80);
        });
      }
    });
  });

  // Update prevStats cache
  prevStats = {};
  names.forEach((name) => {
    prevStats[name] = {};
    STAT_DEFS.forEach((s) => { prevStats[name][s.key] = nations[name][s.key]; });
  });

  // Eliminated count pill
  const eliminated = names.filter((name) => nations[name].eliminated).length;
  const alive      = names.length - eliminated;
  const elimPill   = document.getElementById("elim-pill");
  const aliveEl    = document.getElementById("nations-alive-count");
  if (aliveEl) aliveEl.textContent = alive;

  if (eliminated > 0) {
    elimPill.textContent = `☠ ${eliminated} Fallen`;
    elimPill.classList.remove("hidden");
  } else {
    elimPill.classList.add("hidden");
  }

  updateWorldAge();
  updateStabilityBar(nations);

  // Wire card clicks → selectNation
  grid.querySelectorAll(".nation-card").forEach((card) => {
    card.addEventListener("click", () => {
      const nName = card.dataset.nation;
      if (nName) selectNation(nName, nations);
    });
  });

  // Re-apply selection highlight
  if (selectedNationName) {
    const sel = document.getElementById(`card-${selectedNationName}`);
    if (sel) sel.classList.add("is-selected");
  }

  // Update map territory states
  updateWorldMap(nations);

  // ── 3D World hook ──
  window.civWorld?.updateNations(nations);
}

// ─────────────────────────────────────────────────────────────────
// SELECT NATION — populate Empire Intelligence left panel
// ─────────────────────────────────────────────────────────────────
export function selectNation(name, nations) {
  selectedNationName = name;
  const n      = nations[name];
  const color  = NATION_COLORS[name] || "#7a8099";
  const crest  = NATION_CRESTS[name] || "✦";
  const power  = computePower(n);
  const threat = getThreatLevel(n.army);

  const statRowsHTML = STAT_DEFS.map((s) => {
    const pct = Math.min(100, (n[s.key] / s.max) * 100).toFixed(1);
    return `
      <div class="intel-stat-row">
        <span class="intel-stat-label" style="color:${s.color};">${s.sym} ${s.label}</span>
        <div class="intel-stat-track">
          <div class="intel-stat-fill" style="width:0%;background:linear-gradient(90deg,${s.color}aa,${s.color});"
               id="intel-bar-${esc(name)}-${s.key}"></div>
        </div>
        <span class="intel-stat-val">${statDisplay(s.key, n[s.key])}</span>
      </div>`;
  }).join("");

  // Top memory quote
  const memories = n.memory || [];
  const lastMem  = memories.slice(-1)[0] || "";
  const memHTML  = lastMem
    ? `<div style="
        margin-top:10px;padding:8px 10px;
        background:rgba(212,175,55,0.04);
        border-left:2px solid rgba(212,175,55,0.25);
        border-radius:0 4px 4px 0;">
        <span style="
          font-family:'Cormorant Garamond',serif;
          font-style:italic;font-size:11px;
          color:var(--text-faint);line-height:1.5;">
          "${esc(lastMem.slice(0, 80))}${lastMem.length > 80 ? "…" : ""}"
        </span>
       </div>`
    : "";

  const panel = document.getElementById("selected-nation-display");
  panel.innerHTML = `
    <div class="intel-header">
      <div class="intel-crest" style="
        color:${color};
        border-color:${color}55;
        background:radial-gradient(circle at 30% 30%, ${color}20, ${color}08);
        box-shadow:0 0 16px ${color}30;
      ">${crest}</div>

      <div class="intel-title">
        <div class="intel-name" style="color:${color};">${esc(name)}</div>
        <div class="intel-ideo">${esc(n.ideology || "—")}</div>
      </div>

      <div class="intel-power-score">
        <span style="font-size:6.5px;color:var(--text-faint);letter-spacing:.1em;display:block;">POWER</span>
        <span class="intel-power-num" style="color:${color};text-shadow:0 0 12px ${color}70;">${power}</span>
        <span style="
          display:block;font-size:7px;font-weight:800;
          color:${threat.color};letter-spacing:.1em;
          margin-top:2px;text-shadow:0 0 8px ${threat.color};">
          ${threat.label}
        </span>
      </div>
    </div>

    ${statRowsHTML}
    ${memHTML}

    ${n.eliminated
      ? `<div style="
           font-family:'Cinzel',serif;color:#e74c3c;font-size:10px;
           letter-spacing:.14em;text-align:center;margin-top:10px;
           text-shadow:0 0 14px rgba(231,76,60,0.5);">
           ☠ NATION ELIMINATED
         </div>`
      : ""}
  `;

  // Staggered bar animations
  requestAnimationFrame(() => {
    STAT_DEFS.forEach((s, i) => {
      const bar = document.getElementById(`intel-bar-${name}-${s.key}`);
      if (bar) {
        const pct = Math.min(100, (n[s.key] / s.max) * 100).toFixed(1);
        setTimeout(() => {
          bar.style.transition = "width 650ms cubic-bezier(0.4,0,0.2,1)";
          bar.style.width = `${pct}%`;
        }, i * 60);
      }
    });
  });

  // Highlight card in list
  document.querySelectorAll(".nation-card").forEach((c) => c.classList.remove("is-selected"));
  const card = document.getElementById(`card-${name}`);
  if (card) card.classList.add("is-selected");

  // Highlight territory on map
  document.querySelectorAll(".territory-path").forEach((p) => p.classList.remove("is-selected"));
  const territory = document.getElementById(`territory-${name}`);
  if (territory) territory.classList.add("is-selected");

  // GSAP reveal if available
  if (window.gsap) {
    gsap.fromTo(
      "#selected-nation-display",
      { x: -8, opacity: 0.5 },
      { x: 0,  opacity: 1,   duration: 0.35, ease: "power2.out" }
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// UPDATE WORLD MAP — sync territory visual states
// ─────────────────────────────────────────────────────────────────
export function updateWorldMap(nations) {
  Object.entries(nations).forEach(([name, n]) => {
    const path = document.getElementById(`territory-${name}`);
    if (!path) return;

    path.classList.remove("is-eliminated", "is-selected");
    if (n.eliminated) {
      path.classList.add("is-eliminated");
    } else if (name === selectedNationName) {
      path.classList.add("is-selected");
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// UPDATE WORLD AGE
// ─────────────────────────────────────────────────────────────────
function updateWorldAge() {
  const tc    = document.getElementById("turn-counter");
  const ageEl = document.getElementById("world-age-label");
  if (!tc || !ageEl) return;
  const turn = parseInt(tc.textContent.replace(/\D/g, "")) || 0;
  const ages = [
    [0,   "Dawn"],
    [5,   "Ancient"],
    [15,  "Classical"],
    [30,  "Medieval"],
    [50,  "Renaissance"],
    [75,  "Imperial"],
    [100, "Industrial"],
  ];
  let age = "Dawn";
  for (const [t, label] of ages) {
    if (turn >= t) age = label;
  }
  ageEl.textContent = age;
}

// ─────────────────────────────────────────────────────────────────
// UPDATE STABILITY BAR
// ─────────────────────────────────────────────────────────────────
function updateStabilityBar(nations) {
  const bar = document.getElementById("stability-bar");
  if (!bar) return;
  const alive = Object.values(nations).filter((n) => !n.eliminated);
  if (!alive.length) { bar.style.width = "0%"; return; }
  const avgHappy    = alive.reduce((s, n) => s + (n.happiness || 0), 0) / alive.length;
  const aliveRatio  = alive.length / Object.keys(nations).length;
  const stability   = Math.round((avgHappy * 0.6 + aliveRatio * 0.4) * 100);
  bar.style.width   = `${stability}%`;
}

// ─────────────────────────────────────────────────────────────────
// BUILD EVENT ENTRY — World Chronicle row
// ─────────────────────────────────────────────────────────────────
function buildEventEntry(event) {
  const isPlayerEvent = event.actor === "EVENT";
  const style      = ACTION_STYLES[event.action_type]  || ACTION_STYLES.nothing;
  const icon       = ACTION_ICONS[event.action_type]   || "•";
  const actorColor = isPlayerEvent
    ? "var(--gold-bright)"
    : (NATION_COLORS[event.actor] || "var(--text-primary)");

  const rarity = isPlayerEvent ? "legendary" : (ACTION_RARITY[event.action_type] || "common");

  const intelBlock = event.secret ? `
    <button class="intel-btn" type="button">🔍 Classified Intel</button>
    <div class="intel-reveal">
      <span class="intel-text">${esc(event.secret)}</span>
    </div>` : "";

  const entry = document.createElement("div");
  entry.className = `event-entry rarity-${rarity}`;

  entry.innerHTML = `
    <div class="event-entry-header">
      <span class="rarity-gem ${rarity}"></span>
      <span style="font-size:11px;line-height:1;">${icon}</span>
      <span class="turn-pill">T${esc(event.turn)}</span>
      <span class="event-actor-name" style="color:${actorColor};">
        ${isPlayerEvent ? "⚡ EVENT" : esc(event.actor)}
      </span>
      <span class="action-badge" style="background:${style.bg};color:${style.fg};">
        ${esc(event.action_type)}
      </span>
    </div>
    <p class="event-description" style="color:${isPlayerEvent ? "var(--gold-bright)" : "var(--text-primary)"};">
      ${esc(event.description)}
    </p>
    ${intelBlock}
  `;

  const btn = entry.querySelector(".intel-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      entry.querySelector(".intel-reveal").classList.toggle("open");
    });
  }

  updateChronicleCount();
  return entry;
}

function updateChronicleCount() {
  const el    = document.getElementById("chronicle-count");
  if (!el) return;
  const count = document.getElementById("event-log")?.children.length || 0;
  el.textContent = count > 0 ? `${count} records` : "";
}

function clearEmptyNotice() {
  document.getElementById("event-log-empty")?.remove();
}

// ─────────────────────────────────────────────────────────────────
// PUBLIC RENDER FUNCTIONS (all signatures preserved)
// ─────────────────────────────────────────────────────────────────

export function renderEventLog(events) {
  const log = document.getElementById("event-log");
  log.innerHTML = "";
  if (!events || events.length === 0) {
    log.innerHTML = `<p id="event-log-empty" style="
      font-family:'Cormorant Garamond',serif;
      font-style:italic;font-size:12px;
      color:#3d4a5c;text-align:center;
      padding:32px 20px;line-height:1.8;
      letter-spacing:.04em;">
      The world is quiet.<br>Advance a turn to begin history.
    </p>`;
    return;
  }
  [...events].reverse().forEach((event) => log.appendChild(buildEventEntry(event)));
  updateChronicleCount();
}

export function prependEvent(event) {
  clearEmptyNotice();
  const log   = document.getElementById("event-log");
  const entry = buildEventEntry(event);
  entry.classList.add("slide-in-top");
  log.prepend(entry);
  updateChronicleCount();

  // ── 3D World hook ──
  window.civWorld?.onEvent(event);
}

export function flashNation(nationName, type) {
  const card = document.getElementById(`card-${nationName}`);
  if (!card) return;
  const cls = type === "bonus" ? "stat-flash-bonus" : "stat-flash-hit";
  card.classList.remove("stat-flash-hit", "stat-flash-bonus");
  void card.offsetWidth;
  card.classList.add(cls);
  setTimeout(() => card.classList.remove(cls), 660);

  // Also flash territory on map
  const territory = document.getElementById(`territory-${nationName}`);
  if (territory) {
    territory.style.transition = "filter 150ms ease";
    territory.style.filter =
      type === "bonus"
        ? "brightness(2) drop-shadow(0 0 18px rgba(212,175,55,0.95))"
        : "brightness(1.9) saturate(2) drop-shadow(0 0 18px rgba(192,57,43,0.95))";
    setTimeout(() => {
      territory.style.filter = "";
    }, 660);
  }

  // ── 3D World hook ──
  window.civWorld?.flashNation(nationName, type);
}

export function animateStatChange(nationName, stat, newValue) {
  const el = document.getElementById(`stat-${nationName}-${stat}`);
  if (!el) return;
  const isPct     = stat === "happiness";
  const isPop     = stat === "population";
  const current   = isPct
    ? parseFloat(el.textContent) / 100
    : parseFloat(el.textContent.replace(/,/g, "")) || 0;
  const start     = performance.now();
  const duration  = 480;

  function frame(now) {
    const t     = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = current + (newValue - current) * eased;
    el.textContent = statDisplay(stat, value);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = statDisplay(stat, newValue);
  }
  requestAnimationFrame(frame);
}

function animateStatBar(nationName, stat, newValue, max) {
  const bar = document.getElementById(`bar-${nationName}-${stat}`);
  if (!bar) return;
  const pct = Math.min(100, (newValue / max) * 100).toFixed(1);
  bar.style.width = `${pct}%`;
}

export function setStatus(status) {
  const pill = document.getElementById("status-pill");
  const btn  = document.getElementById("next-turn-btn");
  pill.classList.remove("status-idle", "status-processing", "pulse-amber");
  if (status === "PROCESSING") {
    pill.textContent = "PROCESSING…";
    pill.classList.add("status-processing", "pulse-amber");
    btn?.classList.add("processing");
  } else {
    pill.textContent = status;
    pill.classList.add("status-idle");
    btn?.classList.remove("processing");
  }
}

export function setTurn(turn) {
  const counter = document.getElementById("turn-counter");
  counter.textContent = `TURN ${turn}`;
  updateWorldAge();
  const label = document.getElementById("next-turn-label");
  if (label && !label.classList.contains("pulse-amber")) {
    label.textContent = turn === 0 ? "PLAY" : "NEXT TURN";
  }
}

export function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.getElementById("toast-root").appendChild(toast);
  // Auto-remove after 5 seconds for cleanliness
  setTimeout(() => {
    toast.style.transition = "opacity 300ms ease";
    toast.style.opacity    = "0";
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

export function showModal(config) {
  hideModal();
  const root    = document.getElementById("modal-root");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const footer = config.onConfirm
    ? `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">
         <button class="modal-cancel-btn" data-modal-cancel>Cancel</button>
         <button class="modal-confirm-btn" data-modal-confirm>Confirm</button>
       </div>`
    : `<div style="display:flex;justify-content:flex-end;margin-top:20px;">
         <button class="modal-cancel-btn" data-modal-cancel>Close</button>
       </div>`;

  overlay.innerHTML = `
    <div class="modal-box noise-panel">
      <h3 class="modal-title">${config.title}</h3>
      <div class="modal-body">${config.body}</div>
      ${footer}
    </div>`;

  overlay.addEventListener("click", (e) => { if (e.target === overlay) hideModal(); });
  overlay.querySelector("[data-modal-cancel]")?.addEventListener("click", hideModal);
  overlay.querySelector("[data-modal-confirm]")?.addEventListener("click", () => {
    hideModal();
    config.onConfirm();
  });

  root.appendChild(overlay);
  if (window.lucide) window.lucide.createIcons();
  return overlay;
}

export function hideModal() {
  document.getElementById("modal-root").innerHTML = "";
}

// ─────────────────────────────────────────────────────────────────
// VICTORY BANNER — cinematic game-over proclamation
// ─────────────────────────────────────────────────────────────────
export function showVictory(winner, victoryType) {
  document.getElementById("victory-banner")?.remove();

  const btn = document.getElementById("next-turn-btn");
  if (!winner) { btn.disabled = false; return; }

  btn.disabled = true;

  const color = NATION_COLORS[winner] || "#D4AF37";
  const crest = NATION_CRESTS[winner] || "♛";

  const V_ICONS = {
    domination:  "⚔",
    conquest:    "⚔",
    diplomatic:  "⚑",
    cultural:    "✦",
    economic:    "♛",
    elimination: "☠",
    military:    "⚔",
  };
  const vIcon  = V_ICONS[(victoryType || "").toLowerCase()] || "♛";
  const vLabel = (victoryType || "Victory").toUpperCase();

  const banner = document.createElement("div");
  banner.id = "victory-banner";

  Object.assign(banner.style, {
    position: "fixed", inset: "0", zIndex: "500",
    background: "rgba(3,5,10,0.94)",
    backdropFilter: "blur(12px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    animation: "modalFadeIn 600ms ease-out",
  });

  banner.innerHTML = `
    <div id="victory-box" style="
      position:relative;
      background:linear-gradient(160deg,#141926 0%,#0b0f1a 60%,#0d1220 100%);
      border:1px solid ${color};
      border-radius:12px;
      padding:54px 64px 48px;
      text-align:center;
      max-width:560px;width:90vw;overflow:hidden;
      box-shadow:
        0 0 0 1px ${color}20,
        0 0 60px ${color}40,
        0 0 120px ${color}15,
        0 60px 140px rgba(0,0,0,0.98);
      animation:modalIn 750ms cubic-bezier(0.34,1.56,0.64,1);">

      <!-- Top glow bar -->
      <div style="position:absolute;top:0;left:0;right:0;height:2px;
        background:linear-gradient(90deg,transparent 0%,${color}80 20%,${color} 50%,${color}80 80%,transparent 100%);
        box-shadow:0 0 16px ${color};"></div>

      <!-- Bottom accent -->
      <div style="position:absolute;bottom:0;left:0;right:0;height:1px;
        background:linear-gradient(90deg,transparent 0%,${color}40 50%,transparent 100%);"></div>

      <!-- Corner ornaments -->
      <div style="position:absolute;top:14px;left:14px;width:24px;height:24px;
        border-top:2px solid ${color};border-left:2px solid ${color};opacity:0.7;"></div>
      <div style="position:absolute;top:14px;right:14px;width:24px;height:24px;
        border-top:2px solid ${color};border-right:2px solid ${color};opacity:0.7;"></div>
      <div style="position:absolute;bottom:14px;left:14px;width:24px;height:24px;
        border-bottom:2px solid ${color};border-left:2px solid ${color};opacity:0.7;"></div>
      <div style="position:absolute;bottom:14px;right:14px;width:24px;height:24px;
        border-bottom:2px solid ${color};border-right:2px solid ${color};opacity:0.7;"></div>

      <!-- Inner border -->
      <div style="position:absolute;inset:10px;border:1px solid ${color}14;border-radius:8px;pointer-events:none;"></div>

      <!-- Nation crest -->
      <div style="
        font-size:72px;line-height:1;margin-bottom:20px;color:${color};
        animation:crestPulseLarge 2.2s ease-in-out infinite;display:block;">
        ${crest}
      </div>

      <!-- Victory type chip -->
      <div style="
        display:inline-flex;align-items:center;gap:8px;
        font-family:'Cinzel',serif;font-size:8.5px;font-weight:800;
        letter-spacing:0.3em;text-transform:uppercase;
        color:${color};border:1px solid ${color}60;border-radius:5px;
        padding:5px 18px;margin-bottom:22px;background:${color}0c;">
        ${vIcon} &nbsp;${esc(vLabel)} VICTORY
      </div>

      <!-- Winner name -->
      <h3 style="
        font-family:'Cinzel',serif;font-weight:900;font-size:38px;
        letter-spacing:0.15em;color:${color};
        text-shadow:0 0 28px ${color}99,0 0 70px ${color}40,0 2px 6px rgba(0,0,0,0.9);
        line-height:1.1;margin-bottom:10px;">
        ${esc(winner)}
      </h3>

      <!-- Proclamation -->
      <div style="
        font-family:'Cinzel',serif;font-size:9.5px;letter-spacing:0.24em;
        text-transform:uppercase;color:var(--gold-dim);margin-bottom:6px;">
        Has Conquered the Known World
      </div>

      <!-- Separator -->
      <div style="height:1px;margin:24px 52px;
        background:linear-gradient(90deg,transparent,${color}70,transparent);"></div>

      <!-- Flavour text -->
      <p style="
        font-family:'Cormorant Garamond',serif;font-size:14px;
        color:var(--text-muted);line-height:1.7;margin-bottom:30px;font-style:italic;">
        The chronicles shall remember this age forever.<br>
        Reset the world to forge a new destiny.
      </p>

      <!-- Action buttons -->
      <div style="display:flex;gap:12px;justify-content:center;align-items:center;">
        <button id="victory-reset-btn" style="
          font-family:'Cinzel',serif;font-weight:900;font-size:10px;
          letter-spacing:0.15em;text-transform:uppercase;color:#060809;
          background:linear-gradient(135deg,#FFE566,#F4D03F,#D4AF37);
          border:none;border-radius:7px;padding:13px 26px;cursor:pointer;
          box-shadow:0 2px 18px ${color}55;
          transition:transform 160ms cubic-bezier(0.34,1.56,0.64,1),box-shadow 160ms;">
          ♛ Begin New World
        </button>
        <button id="victory-dismiss-btn" style="
          font-family:'Cinzel',serif;font-weight:700;font-size:9px;
          letter-spacing:0.1em;text-transform:uppercase;
          color:var(--text-muted);background:transparent;
          border:1px solid rgba(36,48,68,0.9);border-radius:7px;
          padding:13px 20px;cursor:pointer;
          transition:color 160ms,border-color 160ms;">
          View Final World
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);

  const resetBtn   = document.getElementById("victory-reset-btn");
  const dismissBtn = document.getElementById("victory-dismiss-btn");

  resetBtn?.addEventListener("mouseenter", () => {
    resetBtn.style.transform = "translateY(-3px) scale(1.02)";
    resetBtn.style.boxShadow = `0 6px 26px ${color}75`;
  });
  resetBtn?.addEventListener("mouseleave", () => {
    resetBtn.style.transform = "";
    resetBtn.style.boxShadow = `0 2px 18px ${color}55`;
  });
  resetBtn?.addEventListener("click", () => {
    banner.remove();
    document.getElementById("reset-btn")?.click();
  });

  dismissBtn?.addEventListener("mouseenter", () => {
    dismissBtn.style.color       = "var(--text-primary)";
    dismissBtn.style.borderColor = "var(--text-muted)";
  });
  dismissBtn?.addEventListener("mouseleave", () => {
    dismissBtn.style.color       = "";
    dismissBtn.style.borderColor = "";
  });
  dismissBtn?.addEventListener("click", () => {
    banner.style.transition = "opacity 350ms ease";
    banner.style.opacity    = "0";
    setTimeout(() => banner.remove(), 350);
    // Button stays locked — game is over until reset
  });

  // GSAP particle burst if available
  if (window.gsap) {
    gsap.fromTo("#victory-box",
      { scale: 0.85, opacity: 0, y: 30 },
      { scale: 1, opacity: 1, y: 0, duration: 0.8, ease: "back.out(1.5)", delay: 0.1 }
    );
  }
}
