"""Turn orchestrator: runs every nation's agent sequentially."""
from actions import apply_action
from agents import get_nation_action
from world import WorldState

GOLD_VICTORY = 1000
TERRITORY_VICTORY = 15
DIPLOMATIC_THRESHOLD = 100
TECH_VICTORY = 20

def check_victory(world: WorldState) -> None:
    """Check all victory conditions and set world.winner/victory_type on the first match."""
    if world.winner:
        return
    alive = [n for n in world.nations.values() if not n.eliminated]

    # Domination: last nation standing
    if len(alive) == 1:
        _declare(world, alive[0].name, "domination")
        return

    for nation in alive:
        # Conquest: territory threshold
        if nation.territory >= TERRITORY_VICTORY:
            _declare(world, nation.name, "conquest")
            return
        if nation.technology >= TECH_VICTORY:
            _declare(
                world,
                nation.name,
                "technological"
            )
            return
        # Economic: gold threshold
        if nation.gold >= GOLD_VICTORY:
            _declare(world, nation.name, "economic")
            return
        # Diplomatic: high relations with every other living nation
        others = [o for o in alive if o.name != nation.name]
        if others and all(nation.relations.get(o.name, 0) >= DIPLOMATIC_THRESHOLD for o in others):
            _declare(world, nation.name, "diplomatic")
            return


def _declare(world: WorldState, name: str, victory_type: str) -> None:
    """Record a winner and log the victory event."""
    world.winner = name
    world.victory_type = victory_type
    world.log(name, f"{name} has achieved a {victory_type.upper()} victory! The simulation has ended.", "victory")


async def run_turn(world: WorldState) -> list[dict]:
    """Run one full turn: each living nation acts in sequence and sees earlier actions."""
    if world.winner:
        return []
    world.turn += 1
    results: list[dict] = []

    alive_nations = [
        n for n in world.nations.values()
        if not n.eliminated
    ]

    for nation in alive_nations:
        nation.gold += (
            nation.population // 10
            + nation.territory * 2
            + nation.economy_level * 5
        )
        nation.gold += (
            len(nation.trade_routes) * 5
        )
        nation.food += (
            nation.population // 5
        )
        nation.iron += (
            nation.territory
        )
        nation.production += (
            nation.territory // 2
        )
        army_upkeep = nation.army // 2
        nation.food -= army_upkeep
        if nation.food < 0:
            nation.army = max(
                0,
                nation.army - 3
            )
            nation.happiness -= 0.05
        capacity = nation.territory * 20
        if nation.population < capacity:
            nation.population += max(
                1,
                nation.territory // 3
            )
        if nation.happiness < 0.30:
            nation.gold -= 10
        if nation.happiness < 0.15:
            nation.army -= 2
        if nation.happiness > 0.80:
            nation.gold += 10
        
    
    planned_actions = []
    for nation in alive_nations:
        action = await get_nation_action(
            nation,
            world
        )

        planned_actions.append(
            (nation, action)
        )
    
    for nation, action in planned_actions:
        apply_action(
            action,
            nation,
            world
        )

        results.append({
            "nation": nation.name,
            "ideology": nation.ideology,
            "action": action.get("action"),
            "target": action.get("target"),
            "public": action.get(
                "public_message",
                action.get("message", "")
            ),
            "secret": action.get("internal_thought", ""),
            "error": action.get("error"),
        })
    check_victory(world)
    return results
