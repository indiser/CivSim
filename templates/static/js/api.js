// All network calls to the Flask proxy. Pure transport layer — no DOM here.
const BASE = "/api";

async function request(path, options = {}) {
  // Shared fetch wrapper: throws on non-2xx, returns parsed JSON.
  const response = await fetch(`${BASE}${path}`, options);
  if (!response.ok) throw new Error(response.statusText || `HTTP ${response.status}`);
  return response.json();
}

export async function getState() {
  return request("/state");
}

export async function postTurn() {
  return request("/turn", { method: "POST" });
}

export async function postInject(card, target) {
  return request("/inject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card, target }),
  });
}

export async function postReset() {
  return request("/reset", { method: "POST" });
}

export async function getHistory() {
  return request("/history");
}
