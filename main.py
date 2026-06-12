"""FastAPI app and route definitions for CivSim."""
from dataclasses import asdict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from engine import run_turn, check_victory
from events import KNOWN_CARDS, apply_event_card
from seed import init_world
from world import serialize_world

app = FastAPI(title="CivSim", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Initialise world on startup — the single mutable game object
game = init_world()


class InjectRequest(BaseModel):
    """Request body for injecting an event card."""

    card: str
    target: str


@app.get("/state")
def get_state() -> dict:
    """Return the full serialised world state."""
    return serialize_world(game)


@app.post("/turn")
async def post_turn() -> dict:
    """Run one full turn and return per-nation results plus the new world state."""
    actions = await run_turn(game)
    return {"turn": game.turn, "actions": actions, "world": serialize_world(game)}


@app.post("/inject")
def post_inject(body: InjectRequest):
    """Inject a player event card targeting a nation."""
    if game.nations[body.target].eliminated:
        return JSONResponse(status_code=400, content={"error": "nation eliminated"})
    if body.card not in KNOWN_CARDS:
        return JSONResponse(status_code=400, content={"error": "unknown card type"})
    if body.target not in game.nations:
        return JSONResponse(status_code=400, content={"error": "unknown nation"})
    description = apply_event_card(body.card, body.target, game)
    check_victory(game)
    return {"ok": True, "description": description}


@app.get("/history")
def get_history() -> list[dict]:
    """Return all global events, newest first."""
    return [asdict(event) for event in reversed(game.global_events)]


@app.post("/reset")
def post_reset() -> dict:
    """Re-initialise the world from seed."""
    global game
    game = init_world()
    return {"ok": True, "message": "World reset to turn 0"}


@app.get("/nation/{name}")
def get_nation(name: str):
    """Return full detail for a single nation, or 404 if unknown."""
    nation = game.nations.get(name)
    if nation is None:
        return JSONResponse(status_code=404, content={"error": "unknown nation"})
    return asdict(nation)
