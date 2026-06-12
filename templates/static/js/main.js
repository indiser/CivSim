// Entry point: wires UI events, performs the initial load, starts polling.
// Purely additive visual enhancements — all original fetch/API calls unchanged.
import { getState, postTurn, postInject, postReset } from "./api.js";
import {
  renderNations, renderEventLog, prependEvent, flashNation,
  setStatus, setTurn, showToast, showModal, hideModal,
  NATION_COLORS, selectNation, updateWorldMap, showVictory,
} from "./renderer.js";

const POLL_INTERVAL_MS = 30000;
const BONUS_CARDS = new Set(["gold_rush", "miracle"]);

let latestNations = {};

// ─────────────────────────────────────────────────────────────────
// AMBIENT PARTICLE SYSTEM
// ─────────────────────────────────────────────────────────────────
function initParticles() {
  const canvas = document.getElementById("particle-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let W = window.innerWidth;
  let H = window.innerHeight;
  canvas.width  = W;
  canvas.height = H;

  const COLORS = [
    "rgba(212,175,55,0.55)",
    "rgba(244,208,63,0.4)",
    "rgba(192,57,43,0.45)",
    "rgba(230,126,34,0.35)",
    "rgba(212,175,55,0.3)",
  ];

  const particles = Array.from({ length: 55 }, () => ({
    x:       Math.random() * W,
    y:       Math.random() * H,
    size:    Math.random() * 1.6 + 0.4,
    speed:   Math.random() * 0.45 + 0.15,
    dx:      (Math.random() - 0.5) * 0.25,
    color:   COLORS[Math.floor(Math.random() * COLORS.length)],
    life:    Math.random(),
    maxLife: Math.random() * 0.55 + 0.45,
  }));

  function tick() {
    ctx.clearRect(0, 0, W, H);

    for (const p of particles) {
      p.y    -= p.speed;
      p.x    += p.dx;
      p.life += 0.0025;

      if (p.life > p.maxLife || p.y < -4) {
        p.x       = Math.random() * W;
        p.y       = H + 8;
        p.life    = 0;
        p.maxLife = Math.random() * 0.55 + 0.45;
        p.color   = COLORS[Math.floor(Math.random() * COLORS.length)];
        p.speed   = Math.random() * 0.45 + 0.15;
        p.dx      = (Math.random() - 0.5) * 0.25;
      }

      const alpha = Math.sin((p.life / p.maxLife) * Math.PI);
      ctx.globalAlpha = alpha * 0.55;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(tick);
  }

  tick();

  window.addEventListener("resize", () => {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width  = W;
    canvas.height = H;
  });
}

// ─────────────────────────────────────────────────────────────────
// WORLD MAP CLICK HANDLERS
// ─────────────────────────────────────────────────────────────────
function initWorldMap() {
  const svg = document.getElementById("world-map-svg");
  if (!svg) return;

  svg.querySelectorAll(".territory-path").forEach((path) => {
    path.addEventListener("click", () => {
      const name = path.dataset.nation;
      if (!name || !latestNations[name] || latestNations[name].eliminated) return;
      selectNation(name, latestNations);
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// TURN TRANSITION CINEMATIC
// ─────────────────────────────────────────────────────────────────
function triggerTurnTransition() {
  const overlay = document.createElement("div");
  overlay.className = "turn-flash-overlay";
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 900);
}

// ─────────────────────────────────────────────────────────────────
// STATE REFRESH
// ─────────────────────────────────────────────────────────────────
async function refreshState() {
  const state = await getState();
  latestNations = state.nations;
  setTurn(state.turn);
  renderNations(state.nations);
  renderEventLog(state.recent_events);
  showVictory(state.winner, state.victory_type);
  return state;
}

// ─────────────────────────────────────────────────────────────────
// NEXT TURN HANDLER
// ─────────────────────────────────────────────────────────────────
async function handleNextTurn() {
  const btn   = document.getElementById("next-turn-btn");
  const label = document.getElementById("next-turn-label");
  btn.disabled = true;
  label.textContent = "⏳ PROCESSING…";
  label.classList.add("pulse-amber");
  setStatus("PROCESSING");

  try {
    const result = await postTurn();
    latestNations = result.world.nations;
    setTurn(result.turn);
    renderNations(result.world.nations);
    result.actions.forEach((a) => {
      prependEvent({
        turn:        result.turn,
        actor:       a.nation,
        action_type: a.action || "nothing",
        description: a.public || "(no announcement)",
        secret:      a.secret || "",
      });
    });
    triggerTurnTransition();
    showToast(`Turn ${result.turn} complete`, "success");
    showVictory(result.world.winner, result.world.victory_type);
  } catch (e) {
    showToast(`Error: ${e.message}`, "error");
  } finally {
    btn.disabled = false;
    label.textContent = "NEXT TURN";
    label.classList.remove("pulse-amber");
    setStatus("IDLE");
  }
}

// ─────────────────────────────────────────────────────────────────
// RESET HANDLER
// ─────────────────────────────────────────────────────────────────
function handleReset() {
  showModal({
    title: "RESET THE WORLD?",
    body: "All history will be erased and the five kingdoms restored to their founding state. This cannot be undone.",
    onConfirm: async () => {
      try {
        await postReset();
        await refreshState();
        showToast("World reset to Turn 0", "info");
      } catch (e) {
        showToast(`Error: ${e.message}`, "error");
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// TARGET SELECTOR MODAL
// ─────────────────────────────────────────────────────────────────
function openTargetSelector(card, cardLabel) {
  const alive = Object.values(latestNations).filter((n) => !n.eliminated);

  const buttons = alive.length
    ? alive.map((n) => `
        <button class="target-btn" data-target="${n.name}"
                style="border-left-color:${NATION_COLORS[n.name] || "#7a8099"};">
          ${n.name}
        </button>`).join("")
    : `<p style="font-style:italic;font-size:12px;color:var(--text-muted);">
         No nations remain to target.
       </p>`;

  const overlay = showModal({
    title: `"${cardLabel}" — SELECT TARGET`,
    body: buttons,
  });

  overlay.querySelectorAll(".target-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.target;
      hideModal();
      try {
        const result = await postInject(card, target);
        flashNation(target, BONUS_CARDS.has(card) ? "bonus" : "hit");
        showToast(result.description || `${cardLabel} struck ${target}`, "info");
        await refreshState();
      } catch (e) {
        showToast(`Error: ${e.message}`, "error");
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // 1. Ambient particles
  initParticles();

  // 2. Initial world state
  try {
    await refreshState();
  } catch (e) {
    showToast(`Error: ${e.message}`, "error");
  }

  // 3. Map click handlers (after DOM + initial render)
  initWorldMap();

  // 4. Turn controls
  document.getElementById("next-turn-btn").addEventListener("click", handleNextTurn);
  document.getElementById("reset-btn").addEventListener("click", handleReset);

  // 5. Event card injections
  document.querySelectorAll("#event-card-panel .event-card").forEach((cardBtn) => {
    cardBtn.addEventListener("click", () => {
      openTargetSelector(cardBtn.dataset.card, cardBtn.dataset.label);
    });
  });

  // 6. Auto-poll every 30 seconds
  setInterval(async () => {
    try {
      await refreshState();
    } catch {
      // Silent: polling failures must not spam the user.
    }
  }, POLL_INTERVAL_MS);
});
