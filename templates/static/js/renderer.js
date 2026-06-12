// Pure DOM rendering. Never fetches. Receives data, mutates the page.

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

const ACTION_STYLES = {
  attack:       { bg: "#c0392b", fg: "#fff" },
  declare_war:  { bg: "#c0392b", fg: "#fff" },
  trade:        { bg: "#2980b9", fg: "#fff" },
  alliance:     { bg: "#27ae60", fg: "#fff" },
  betray:       { bg: "#8e44ad", fg: "#fff" },
  spy:          { bg: "#2c3e50", fg: "#a29bfe" },
  develop:      { bg: "#16a085", fg: "#fff" },
  nothing:      { bg: "#1e2433", fg: "#7a8099" },
};

// Stat display config
const STAT_DEFS = [
  { key: "army",       sym: "⚔", label: "Army",       color: "#c0392b", max: 1000,  tip: "Military strength — determines combat outcomes." },
  { key: "gold",       sym: "♛", label: "Gold",       color: "#D4AF37", max: 1000,  tip: "Economic resource — funds development and war." },
  { key: "population", sym: "♟", label: "Population", color: "#27ae60", max: 100000,tip: "Civilian count — the lifeblood of the nation." },
  { key: "happiness",  sym: "☯", label: "Happiness",  color: "#f39c12", max: 1,     tip: "Civil contentment 0–100%. Low happiness breeds unrest." },
  { key: "territory",  sym: "⬡", label: "Territory",  color: "#16a085", max: 100,   tip: "Land controlled — seized and lost through war." },
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
  return stat === "happiness" ? `${Math.round(value * 100)}%` : String(Math.round(value));
}

function relationClass(value) {
  if (value > 30) return "rel-good";
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

function getThreatLabel(army) {
  if (army > 700) return { label: "APEX",   color: "#e74c3c" };
  if (army > 400) return { label: "HIGH",   color: "#e67e22" };
  if (army > 200) return { label: "MED",    color: "#f39c12" };
  return                 { label: "LOW",    color: "#7a8099" };
}

// ─────────────────────────────────────────────────────────────────
// RENDER NATIONS — Kingdom profile cards in the left panel
// ─────────────────────────────────────────────────────────────────
export function renderNations(nations) {
  const grid = document.getElementById("nation-grid");
  const names = Object.keys(nations);

  grid.innerHTML = names.map((name) => {
    const n = nations[name];
    const color = NATION_COLORS[name] || "#7a8099";
    const crest = NATION_CRESTS[name] || "✦";
    const power = computePower(n);
    const threat = getThreatLabel(n.army);

    // Stat bars
    const statBarsHTML = STAT_DEFS.map((s) => {
      const prev = prevStats[name]?.[s.key];
      const startValue = prev !== undefined ? prev : n[s.key];
      const startPct = Math.min(100, (startValue / s.max) * 100);
      return `
        <div class="card-stat-row" data-tip="${esc(s.tip)}">
          <span class="card-stat-sym" style="color:${s.color};">${s.sym}</span>
          <div class="card-stat-bar">
            <div class="card-stat-fill" id="bar-${esc(name)}-${s.key}"
                 style="width:${startPct.toFixed(1)}%;background:${s.color};"></div>
          </div>
          <span class="card-stat-val count-up" id="stat-${esc(name)}-${s.key}">
            ${statDisplay(s.key, startValue)}
          </span>
        </div>`;
    }).join("");

    // Relation dots
    const dots = Object.entries(n.relations || {}).map(([other, val]) =>
      `<span class="relation-dot ${relationClass(val)}" data-tip="${esc(other)}: ${esc(val)}"></span>`
    ).join("");

    // Latest memory
    const mem = (n.memory || []).slice(-1)[0] || "";
    const memPeek = mem
      ? `<span class="memory-peek" title="${esc(mem)}">"${esc(mem.slice(0, 40))}${mem.length > 40 ? '…' : ''}"</span>`
      : "";

    // Eliminated overlay
    const overlay = n.eliminated
      ? `<div class="eliminated-overlay">☠ ELIMINATED</div>`
      : "";

    return `
      <article class="nation-card noise-panel" id="card-${esc(name)}"
               style="border-left-color:${color};"
               data-nation="${esc(name)}">
        ${overlay}
        <div class="kingdom-card-header">
          <div class="kingdom-crest-sm" style="color:${color};border-color:${color}40;">${crest}</div>
          <div class="kingdom-card-meta">
            <div class="kingdom-card-name">${esc(name)}</div>
            <span class="ideology-badge">${esc(n.ideology)}</span>
          </div>
          <div class="power-score-badge" data-tip="Combined power score">
            <span style="color:var(--gold-dim);font-size:7px;">PWR</span><br>
            <span style="color:var(--text-gold);font-size:11px;">${power}</span>
          </div>
        </div>
        <div class="card-stat-bars">${statBarsHTML}</div>
        <div class="card-footer">
          <div class="relations-row">${dots}</div>
          ${memPeek}
          <span style="font-family:'Cinzel',serif;font-size:8px;color:${threat.color};
                       border:1px solid ${threat.color}40;border-radius:3px;padding:1px 5px;
                       white-space:nowrap;">${threat.label}</span>
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
        // First-load bar animation: start at 0, animate to real value
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
  const alive = names.length - eliminated;
  const elimPill = document.getElementById("elim-pill");
  const aliveEl = document.getElementById("nations-alive-count");
  if (aliveEl) aliveEl.textContent = alive;

  if (eliminated > 0) {
    elimPill.textContent = `☠ ${eliminated} Fallen`;
    elimPill.classList.remove("hidden");
  } else {
    elimPill.classList.add("hidden");
  }

  // World age based on turn (read from turn counter text)
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
}

// ─────────────────────────────────────────────────────────────────
// SELECT NATION — populate Empire Intelligence left panel
// ─────────────────────────────────────────────────────────────────
export function selectNation(name, nations) {
  selectedNationName = name;
  const n = nations[name];
  const color = NATION_COLORS[name] || "#7a8099";
  const crest = NATION_CRESTS[name] || "✦";
  const power = computePower(n);

  const statRowsHTML = STAT_DEFS.map((s) => {
    const pct = Math.min(100, (n[s.key] / s.max) * 100).toFixed(1);
    return `
      <div class="intel-stat-row">
        <span class="intel-stat-label">${s.label}</span>
        <div class="intel-stat-track">
          <div class="intel-stat-fill" style="width:0%;background:${s.color};"
               id="intel-bar-${esc(name)}-${s.key}"></div>
        </div>
        <span class="intel-stat-val">${statDisplay(s.key, n[s.key])}</span>
      </div>`;
  }).join("");

  const panel = document.getElementById("selected-nation-display");
  panel.innerHTML = `
    <div class="intel-header">
      <div class="intel-crest" style="color:${color};border-color:${color}50;
           background:${color}12;">${crest}</div>
      <div class="intel-title">
        <div class="intel-name" style="color:${color};">${esc(name)}</div>
        <div class="intel-ideo">${esc(n.ideology)}</div>
      </div>
      <div class="intel-power-score">
        <span style="font-size:7px;color:var(--text-faint);letter-spacing:.1em;">POWER</span>
        <span class="intel-power-num" style="color:${color};">${power}</span>
      </div>
    </div>
    ${statRowsHTML}
    ${n.eliminated ? `<div style="font-family:'Cinzel',serif;color:#e74c3c;font-size:10px;
       letter-spacing:.12em;text-align:center;margin-top:6px;">☠ NATION ELIMINATED</div>` : ""}
  `;

  // Animate bars in after a frame
  requestAnimationFrame(() => {
    STAT_DEFS.forEach((s) => {
      const bar = document.getElementById(`intel-bar-${name}-${s.key}`);
      if (bar) {
        const pct = Math.min(100, (n[s.key] / s.max) * 100).toFixed(1);
        bar.style.transition = "width 700ms cubic-bezier(0.4,0,0.2,1)";
        bar.style.width = `${pct}%`;
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
  const tc = document.getElementById("turn-counter");
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
  const avgHappy = alive.reduce((s, n) => s + (n.happiness || 0), 0) / alive.length;
  const aliveRatio = alive.length / Object.keys(nations).length;
  const stability = Math.round((avgHappy * 0.6 + aliveRatio * 0.4) * 100);
  bar.style.width = `${stability}%`;
}

// ─────────────────────────────────────────────────────────────────
// BUILD EVENT ENTRY — World Chronicle row
// ─────────────────────────────────────────────────────────────────
function buildEventEntry(event) {
  const isPlayerEvent = event.actor === "EVENT";
  const style = ACTION_STYLES[event.action_type] || ACTION_STYLES.nothing;
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
      <span class="turn-pill">T${esc(event.turn)}</span>
      <span class="event-actor-name" style="color:${actorColor};">
        ${isPlayerEvent ? "⚡ EVENT" : esc(event.actor)}
      </span>
      <span class="action-badge" style="background:${style.bg};color:${style.fg};">
        ${esc(event.action_type)}
      </span>
    </div>
    <p class="event-description" style="color:${isPlayerEvent ? "var(--gold-bright)" : "var(--text-primary)"};margin-top:3px;">
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

  // Update chronicle count
  updateChronicleCount();

  return entry;
}

function updateChronicleCount() {
  const el = document.getElementById("chronicle-count");
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
      font-family:'Cinzel',serif;font-style:italic;font-size:11px;
      color:#3d4a5c;text-align:center;padding:28px 16px;
      line-height:1.6;letter-spacing:.04em;">
      The world is quiet.<br>Advance a turn to begin history.
    </p>`;
    return;
  }
  [...events].reverse().forEach((event) => log.appendChild(buildEventEntry(event)));
  updateChronicleCount();
}

export function prependEvent(event) {
  clearEmptyNotice();
  const log = document.getElementById("event-log");
  const entry = buildEventEntry(event);
  entry.classList.add("slide-in-top");
  log.prepend(entry);
  updateChronicleCount();
}

export function flashNation(nationName, type) {
  const card = document.getElementById(`card-${nationName}`);
  if (!card) return;
  const cls = type === "bonus" ? "stat-flash-bonus" : "stat-flash-hit";
  card.classList.remove("stat-flash-hit", "stat-flash-bonus");
  void card.offsetWidth;
  card.classList.add(cls);
  setTimeout(() => card.classList.remove(cls), 600);

  // Also flash territory on map
  const territory = document.getElementById(`territory-${nationName}`);
  if (territory) {
    const origOpacity = territory.style.fillOpacity;
    territory.style.transition = "filter 150ms ease";
    territory.style.filter =
      type === "bonus"
        ? "brightness(2) drop-shadow(0 0 14px rgba(212,175,55,0.9))"
        : "brightness(1.8) saturate(2) drop-shadow(0 0 14px rgba(192,57,43,0.9))";
    setTimeout(() => {
      territory.style.filter = "";
    }, 600);
  }
}

export function animateStatChange(nationName, stat, newValue) {
  const el = document.getElementById(`stat-${nationName}-${stat}`);
  if (!el) return;
  const isPct = stat === "happiness";
  const current = isPct
    ? parseFloat(el.textContent) / 100
    : parseFloat(el.textContent) || 0;
  const start = performance.now();
  const duration = 450;

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
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
  // Allow CSS transition to handle the animation
  bar.style.width = `${pct}%`;
}

export function setStatus(status) {
  const pill = document.getElementById("status-pill");
  const btn = document.getElementById("next-turn-btn");
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
  document.getElementById("turn-counter").textContent = `TURN ${turn}`;
  updateWorldAge();
  // Sync button label: PLAY on first turn, NEXT TURN after that
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
  setTimeout(() => toast.remove(), 60000);
}

export function showModal(config) {
  hideModal();
  const root = document.getElementById("modal-root");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const footer = config.onConfirm
    ? `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
         <button class="modal-cancel-btn" data-modal-cancel>Cancel</button>
         <button class="modal-confirm-btn" data-modal-confirm>Confirm</button>
       </div>`
    : `<div style="display:flex;justify-content:flex-end;margin-top:18px;">
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
    background: "rgba(4,8,15,0.92)",
    backdropFilter: "blur(10px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    animation: "modalFadeIn 500ms ease-out",
  });

  banner.innerHTML = `
    <div id="victory-box" style="
      position:relative;
      background:linear-gradient(160deg,#141926 0%,#0b0f19 60%,#0e1420 100%);
      border:1px solid ${color};border-radius:10px;
      padding:52px 60px 44px;text-align:center;
      max-width:540px;width:90vw;overflow:hidden;
      box-shadow:
        0 0 0 1px ${color}28,
        0 0 50px ${color}35,
        0 0 100px ${color}12,
        0 50px 120px rgba(0,0,0,0.95);
      animation:modalIn 700ms cubic-bezier(0.34,1.56,0.64,1);">

      <!-- Top glow bar -->
      <div style="position:absolute;top:0;left:0;right:0;height:2px;
        background:linear-gradient(90deg,transparent 0%,${color} 30%,${color} 70%,transparent 100%);
        box-shadow:0 0 12px ${color}80;"></div>

      <!-- Bottom accent -->
      <div style="position:absolute;bottom:0;left:0;right:0;height:1px;
        background:linear-gradient(90deg,transparent 0%,${color}50 50%,transparent 100%);"></div>

      <!-- Corner ornaments -->
      <div style="position:absolute;top:12px;left:12px;width:22px;height:22px;
        border-top:2px solid ${color};border-left:2px solid ${color};opacity:0.65;"></div>
      <div style="position:absolute;top:12px;right:12px;width:22px;height:22px;
        border-top:2px solid ${color};border-right:2px solid ${color};opacity:0.65;"></div>
      <div style="position:absolute;bottom:12px;left:12px;width:22px;height:22px;
        border-bottom:2px solid ${color};border-left:2px solid ${color};opacity:0.65;"></div>
      <div style="position:absolute;bottom:12px;right:12px;width:22px;height:22px;
        border-bottom:2px solid ${color};border-right:2px solid ${color};opacity:0.65;"></div>

      <!-- Inner border -->
      <div style="position:absolute;inset:8px;border:1px solid ${color}18;
        border-radius:6px;pointer-events:none;"></div>

      <!-- Nation crest -->
      <div style="font-size:64px;line-height:1;margin-bottom:18px;color:${color};
        filter:drop-shadow(0 0 18px ${color}90) drop-shadow(0 0 40px ${color}40);
        animation:crestPulse 2s ease-in-out infinite;display:block;">${crest}</div>

      <!-- Victory type chip -->
      <div style="display:inline-flex;align-items:center;gap:7px;
        font-family:'Cinzel',serif;font-size:9px;font-weight:700;
        letter-spacing:0.28em;text-transform:uppercase;
        color:${color};border:1px solid ${color}55;border-radius:4px;
        padding:4px 16px;margin-bottom:20px;background:${color}0d;">
        ${vIcon} &nbsp;${esc(vLabel)} VICTORY
      </div>

      <!-- Winner name -->
      <h3 style="font-family:'Cinzel',serif;font-weight:900;font-size:34px;
        letter-spacing:0.14em;color:${color};
        text-shadow:0 0 24px ${color}90,0 0 60px ${color}35,0 2px 4px rgba(0,0,0,0.8);
        line-height:1.1;margin-bottom:8px;">${esc(winner)}</h3>

      <!-- Proclamation -->
      <div style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:0.22em;
        text-transform:uppercase;color:var(--gold-dim);margin-bottom:4px;">
        Has Conquered the Known World
      </div>

      <!-- Separator -->
      <div style="height:1px;margin:22px 48px;
        background:linear-gradient(90deg,transparent,${color}70,transparent);"></div>

      <!-- Flavour -->
      <p style="font-family:'Inter',sans-serif;font-size:12.5px;color:var(--text-muted);
        line-height:1.65;margin-bottom:28px;font-style:italic;">
        The chronicles shall remember this age forever.<br>
        Reset the world to forge a new destiny.
      </p>

      <!-- Action buttons -->
      <div style="display:flex;gap:10px;justify-content:center;align-items:center;">
        <button id="victory-reset-btn" style="
          font-family:'Cinzel',serif;font-weight:800;font-size:10px;
          letter-spacing:0.14em;text-transform:uppercase;color:#080a0c;
          background:linear-gradient(135deg,#F4D03F,#D4AF37);
          border:none;border-radius:6px;padding:11px 24px;cursor:pointer;
          box-shadow:0 2px 14px ${color}50;
          transition:transform 150ms,box-shadow 150ms;">♛ Begin New World</button>

        <button id="victory-dismiss-btn" style="
          font-family:'Cinzel',serif;font-weight:600;font-size:9px;
          letter-spacing:0.1em;text-transform:uppercase;
          color:var(--text-muted);background:transparent;
          border:1px solid rgba(42,51,71,0.8);border-radius:6px;
          padding:11px 18px;cursor:pointer;
          transition:color 150ms,border-color 150ms;">View Final World</button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);

  const resetBtn   = document.getElementById("victory-reset-btn");
  const dismissBtn = document.getElementById("victory-dismiss-btn");

  resetBtn?.addEventListener("mouseenter", () => {
    resetBtn.style.transform = "translateY(-2px)";
    resetBtn.style.boxShadow = `0 4px 20px ${color}70`;
  });
  resetBtn?.addEventListener("mouseleave", () => {
    resetBtn.style.transform = "";
    resetBtn.style.boxShadow = `0 2px 14px ${color}50`;
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
    banner.style.transition = "opacity 300ms ease";
    banner.style.opacity    = "0";
    setTimeout(() => banner.remove(), 300);
    // Button stays locked — game is over until reset
  });
}
