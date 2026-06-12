// Entry point: wires UI events, performs the initial load, starts polling.
// All original fetch/API calls preserved — visual enhancements are purely additive.
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
// PARTICLE SYSTEM — ember wisps + golden motes
// ─────────────────────────────────────────────────────────────────
function initParticles() {
  const canvas = document.getElementById("particle-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let W = window.innerWidth;
  let H = window.innerHeight;
  canvas.width  = W;
  canvas.height = H;

  // Golden motes
  const GOLD_COLORS = [
    "rgba(212,175,55,0.55)",
    "rgba(244,208,63,0.45)",
    "rgba(255,224,102,0.4)",
    "rgba(212,175,55,0.3)",
    "rgba(180,140,40,0.4)",
  ];

  // Ember colors
  const EMBER_COLORS = [
    "rgba(220,80,40,0.6)",
    "rgba(240,120,30,0.5)",
    "rgba(255,100,50,0.55)",
    "rgba(200,60,30,0.45)",
    "rgba(255,160,60,0.4)",
  ];

  // Create mixed particle set: golden motes + embers
  const particles = [
    // Golden motes (lighter, drifting)
    ...Array.from({ length: 40 }, () => ({
      x:       Math.random() * W,
      y:       Math.random() * H,
      size:    Math.random() * 1.4 + 0.3,
      speed:   Math.random() * 0.4 + 0.1,
      dx:      (Math.random() - 0.5) * 0.22,
      color:   GOLD_COLORS[Math.floor(Math.random() * GOLD_COLORS.length)],
      life:    Math.random(),
      maxLife: Math.random() * 0.55 + 0.45,
      type:    "mote",
    })),
    // Embers (slightly larger, rising faster)
    ...Array.from({ length: 20 }, () => ({
      x:       Math.random() * W,
      y:       H + Math.random() * 200,
      size:    Math.random() * 2.2 + 0.6,
      speed:   Math.random() * 0.7 + 0.35,
      dx:      (Math.random() - 0.5) * 0.4,
      color:   EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)],
      life:    Math.random() * 0.3,
      maxLife: Math.random() * 0.5 + 0.4,
      type:    "ember",
      wobble:  Math.random() * Math.PI * 2,
      wobbleSpeed: Math.random() * 0.04 + 0.01,
    })),
  ];

  let frame = 0;

  function tick() {
    ctx.clearRect(0, 0, W, H);
    frame++;

    for (const p of particles) {
      if (p.type === "ember") {
        p.wobble += p.wobbleSpeed;
        p.x += p.dx + Math.sin(p.wobble) * 0.35;
      } else {
        p.x += p.dx;
      }

      p.y    -= p.speed;
      p.life += 0.0022;

      if (p.life > p.maxLife || p.y < -8) {
        p.x       = Math.random() * W;
        p.y       = p.type === "ember" ? H + 10 : Math.random() * H;
        p.life    = 0;
        p.maxLife = Math.random() * 0.55 + 0.4;
        p.speed   = p.type === "ember"
          ? Math.random() * 0.7 + 0.35
          : Math.random() * 0.4 + 0.1;
        p.dx = (Math.random() - 0.5) * (p.type === "ember" ? 0.4 : 0.22);
        if (p.type === "mote") {
          p.color = GOLD_COLORS[Math.floor(Math.random() * GOLD_COLORS.length)];
        } else {
          p.color = EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)];
        }
      }

      const alpha = Math.sin((p.life / p.maxLife) * Math.PI);
      ctx.globalAlpha = alpha * (p.type === "ember" ? 0.65 : 0.5);
      ctx.fillStyle   = p.color;

      if (p.type === "ember" && p.size > 1.4) {
        // Draw ember as a small teardrop-ish shape
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size * 0.5, p.size, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
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
// MAP HOVER TOOLTIP
// ─────────────────────────────────────────────────────────────────
function initMapTooltip() {
  const svg     = document.getElementById("world-map-svg");
  const tooltip = document.getElementById("map-tooltip");
  if (!svg || !tooltip) return;

  svg.querySelectorAll(".territory-path").forEach((path) => {
    path.addEventListener("mouseenter", (e) => {
      const name = path.dataset.nation;
      if (!name || !latestNations[name]) return;

      const n = latestNations[name];
      const color = NATION_COLORS[name] || "#7a8099";

      if (n.eliminated) {
        tooltip.innerHTML = `
          <div class="map-tooltip-name" style="color:rgba(192,57,43,0.7);">☠ ${name}</div>
          <div class="map-tooltip-stat"><span>Status</span><span style="color:#e74c3c;">Eliminated</span></div>`;
      } else {
        tooltip.innerHTML = `
          <div class="map-tooltip-name" style="color:${color};">${name}</div>
          <div class="map-tooltip-stat"><span>⚔ Army</span><span>${Math.round(n.army)}</span></div>
          <div class="map-tooltip-stat"><span>♛ Gold</span><span>${Math.round(n.gold)}</span></div>
          <div class="map-tooltip-stat"><span>♟ Pop</span><span>${Math.round(n.population).toLocaleString()}</span></div>
          <div class="map-tooltip-stat"><span>☯ Mood</span><span>${Math.round(n.happiness * 100)}%</span></div>`;
      }
      tooltip.classList.add("active");
    });

    path.addEventListener("mousemove", (e) => {
      const container = document.getElementById("world-map-container");
      const rect = container.getBoundingClientRect();
      let x = e.clientX - rect.left + 14;
      let y = e.clientY - rect.top  - 10;
      // Prevent going off the right edge
      if (x + 160 > rect.width)  x = e.clientX - rect.left - 160;
      if (y + 120 > rect.height) y = e.clientY - rect.top  - 120;
      tooltip.style.left = `${x}px`;
      tooltip.style.top  = `${y}px`;
    });

    path.addEventListener("mouseleave", () => {
      tooltip.classList.remove("active");
    });
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

      // GSAP camera-punch on territory click
      if (window.gsap) {
        gsap.fromTo(
          "#world-map-svg",
          { scale: 1 },
          { scale: 1.02, duration: 0.18, ease: "power2.out",
            onComplete: () => gsap.to("#world-map-svg", { scale: 1, duration: 0.35, ease: "power2.inOut" }) }
        );
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// SCREEN EDGE FLASH — war / alliance visual cue
// ─────────────────────────────────────────────────────────────────
function triggerWarFlash() {
  const el = document.createElement("div");
  el.className = "war-edge-flash";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 820);
}

function triggerAllianceFlash() {
  const el = document.createElement("div");
  el.className = "alliance-edge-flash";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 720);
}

// ─────────────────────────────────────────────────────────────────
// TURN TRANSITION CINEMATIC
// ─────────────────────────────────────────────────────────────────
function triggerTurnTransition() {
  const overlay = document.createElement("div");
  overlay.className = "turn-flash-overlay";
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 960);

  // GSAP banner turn counter punch if available
  if (window.gsap) {
    gsap.fromTo(
      "#turn-counter",
      { scale: 1.3, opacity: 0.6 },
      { scale: 1, opacity: 1, duration: 0.55, ease: "back.out(2)" }
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// ENTRANCE ANIMATION — panels slide in on load
// ─────────────────────────────────────────────────────────────────
function triggerEntranceAnimation() {
  if (!window.gsap) return;
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.fromTo(
    "#empire-banner",
    { y: -30, opacity: 0 },
    { y: 0,   opacity: 1, duration: 0.7 }
  )
  .fromTo(
    "#empire-intelligence",
    { x: -40, opacity: 0 },
    { x: 0,   opacity: 1, duration: 0.65 },
    "-=0.3"
  )
  .fromTo(
    "#chronicle-panel",
    { x: 40, opacity: 0 },
    { x: 0,  opacity: 1, duration: 0.65 },
    "-=0.55"
  )
  .fromTo(
    "#world-map-container",
    { scale: 0.97, opacity: 0 },
    { scale: 1,    opacity: 1, duration: 0.7 },
    "-=0.5"
  )
  .fromTo(
    "#command-bar",
    { y: 30, opacity: 0 },
    { y: 0,  opacity: 1, duration: 0.55 },
    "-=0.45"
  );
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

    let hadWar = false;
    let hadAlliance = false;

    result.actions.forEach((a) => {
      const actionType = a.action || "nothing";

      // Detect dramatic events for screen flash
      if (actionType === "declare_war" || actionType === "attack") hadWar = true;
      if (actionType === "alliance") hadAlliance = true;

      prependEvent({
        turn:        result.turn,
        actor:       a.nation,
        action_type: actionType,
        description: a.public || "(no announcement)",
        secret:      a.secret || "",
      });
    });

    // Trigger turn transition first, then event-specific effects
    triggerTurnTransition();

    // Small delay so the flash doesn't overlap with the turn flash
    if (hadWar) {
      setTimeout(triggerWarFlash, 350);
      // Flash war territories
      result.actions
        .filter(a => a.action === "declare_war" || a.action === "attack")
        .forEach(a => {
          const territory = document.getElementById(`territory-${a.target || a.nation}`);
          if (territory) {
            territory.classList.remove("war-flash");
            void territory.offsetWidth; // reflow
            territory.classList.add("war-flash");
            setTimeout(() => territory.classList.remove("war-flash"), 650);
          }
        });
    }

    if (hadAlliance && !hadWar) {
      setTimeout(triggerAllianceFlash, 350);
    }

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
    : `<p style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:13px;color:var(--text-muted);">
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
  // 1. Entrance animations (before data loads, panel slides in)
  triggerEntranceAnimation();

  // 2. Ambient particles
  initParticles();

  // 3. Initial world state
  try {
    await refreshState();
  } catch (e) {
    showToast(`Error: ${e.message}`, "error");
  }

  // 4. Map click handlers (after DOM + initial render)
  initWorldMap();

  // 5. Map hover tooltips
  initMapTooltip();

  // 6. Turn controls
  document.getElementById("next-turn-btn").addEventListener("click", handleNextTurn);
  document.getElementById("reset-btn").addEventListener("click", handleReset);

  // 7. Event card injections
  document.querySelectorAll("#event-card-panel .event-card").forEach((cardBtn) => {
    cardBtn.addEventListener("click", () => {
      openTargetSelector(cardBtn.dataset.card, cardBtn.dataset.label);
    });
  });

  // 8. Auto-poll every 30 seconds
  setInterval(async () => {
    try {
      await refreshState();
    } catch {
      // Silent: polling failures must not spam the user.
    }
  }, POLL_INTERVAL_MS);
});
