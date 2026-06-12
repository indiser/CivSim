"""Player-injectable event cards for CivSim."""
from world import EVENT_ACTOR, Nation, WorldState, clamp_relation

VOLCANO = "volcano"
FAMINE = "famine"
GOLD_RUSH = "gold_rush"
PLAGUE = "plague"
COUP = "coup"
MIRACLE = "miracle"
REBELLION = "rebellion"
ASSASSINATION = "assassination"
REFUGEE_CRISIS = "refugee_crisis"

KNOWN_CARDS = {VOLCANO, FAMINE, GOLD_RUSH, PLAGUE, COUP, MIRACLE}

STAT_KEYS = ("gold", "army", "population", "territory", "happiness")


def _snapshot(nation: Nation) -> dict:
    """Capture a nation's numeric stats for delta reporting."""
    return {k: getattr(nation, k) for k in STAT_KEYS}

def _apply_rebellion(target, world):
    target.army -= 5
    target.happiness -= 0.3

    if target.happiness < 0.20:
        target.territory -= 1

    return (
        f"Rebellion erupted in {target.name}!"
    )

def _apply_assassination(target, world):
    target.happiness -= 0.2

    for other in world.nations.values():
        if other.name != target.name:
            target.relations[other.name] -= 10

    return (
        f"Political assassination in {target.name}!"
    )

def _apply_refugee_crisis(target, world):
    target.population += 10
    target.gold -= 20
    target.happiness -= 0.15

    return (
        f"Refugee crisis in {target.name}!"
    )

def _apply_volcano(target: Nation, world: WorldState) -> str:
    """A volcano devastates the target nation's army and population."""
    target.army -= 5
    target.population -= 10
    target.happiness -= 0.2
    return f"Volcano erupted in {target.name}! Army -5, Population -10, Happiness -0.2."


def _apply_famine(target: Nation, world: WorldState) -> str:
    """A famine starves the target nation."""
    target.population -= 15
    target.happiness -= 0.3
    target.gold -= 20
    return f"Famine struck {target.name}! Population -15, Happiness -0.3, Gold -20."


def _apply_gold_rush(target: Nation, world: WorldState) -> str:
    """A gold rush enriches the target nation."""
    target.gold += 80
    return f"Gold rush in {target.name}! Gold +80."


def _apply_plague(target: Nation, world: WorldState) -> str:
    """A plague ravages the target and spreads to every nation."""
    target.population -= 20
    target.army -= 3
    target.happiness -= 0.25
    for nation in world.nations.values():
        nation.population -= 5
    return f"Plague erupted in {target.name} and spread across the world! All nations lose population."


def _apply_coup(target: Nation, world: WorldState) -> str:
    """A coup destabilises the target nation and sours its relations."""
    target.army -= 8
    target.happiness -= 0.4
    for other in world.nations.values():
        if other.name == target.name:
            continue
        target.relations[other.name] = clamp_relation(target.relations.get(other.name, 0) - 20)
        other.relations[target.name] = clamp_relation(other.relations.get(target.name, 0) - 20)
    return f"Coup attempt in {target.name}! Army -8, Happiness -0.4, relations with all nations -20."


def _apply_miracle(target: Nation, world: WorldState) -> str:
    """A miracle blesses the target nation and improves its relations."""
    target.happiness += 0.5
    target.population += 10
    for other in world.nations.values():
        if other.name == target.name:
            continue
        target.relations[other.name] = clamp_relation(target.relations.get(other.name, 0) + 10)
        other.relations[target.name] = clamp_relation(other.relations.get(target.name, 0) + 10)
    return f"A miracle blessed {target.name}! Happiness +0.5, Population +10, relations with all nations +10."


_CARD_HANDLERS = {
    VOLCANO: _apply_volcano,
    FAMINE: _apply_famine,
    GOLD_RUSH: _apply_gold_rush,
    PLAGUE: _apply_plague,
    COUP: _apply_coup,
    MIRACLE: _apply_miracle,
    REBELLION: _apply_rebellion,
    ASSASSINATION: _apply_assassination,
    REFUGEE_CRISIS: _apply_refugee_crisis,
}


# def apply_event_card(card_type: str, target_name: str, world: WorldState) -> str:
#     """Apply an event card to a target nation, clamp values, log and broadcast to memories."""
#     target = world.nations[target_name]
#     description = _CARD_HANDLERS[card_type](target, world)

#     for nation in world.nations.values():
#         nation.clamp()

#     world.log(EVENT_ACTOR, description, card_type)

#     memory_line = f"Turn {world.turn}: EVENT — {card_type} hit {target_name}"
#     for nation in world.nations.values():
#         nation.remember(memory_line)

#     return description

def apply_event_card(card_type: str, target_name: str, world: WorldState) -> str:
    """Apply an event card, report actual (clamped) stat changes, and check eliminations."""
    target = world.nations[target_name]
    before = _snapshot(target)

    base = _CARD_HANDLERS[card_type](target, world)

    for nation in world.nations.values():
        nation.clamp()

    # Build the description from what actually changed after clamping
    after = _snapshot(target)
    deltas = []
    for key in STAT_KEYS:
        d = round(after[key] - before[key], 2)
        if d:
            deltas.append(f"{key.capitalize()} {'+' if d > 0 else ''}{d}")
    description = f"{base} ({', '.join(deltas) if deltas else 'no effect'})"

    # Elimination check — events can finish off a nation too
    for nation in world.nations.values():
        if not nation.eliminated and (
            (nation.gold <= 0 and nation.army <= 0) or nation.population <= 0
        ):
            nation.eliminated = True
            world.log(nation.name, f"{nation.name} has been eliminated!", "elimination")

    world.log(EVENT_ACTOR, description, card_type)

    memory_line = f"Turn {world.turn}: EVENT — {card_type} hit {target_name}"
    for nation in world.nations.values():
        nation.remember(memory_line)

    return description

