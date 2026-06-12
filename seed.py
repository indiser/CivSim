"""Initial world setup for CivSim."""
from world import Nation, WorldState
import random

TRAITS = [
    "paranoid",
    "honorable",
    "opportunistic",
    "vengeful",
    "expansionist",
    "isolationist",
    "charismatic",
    "cautious",
    "aggressive",
    "pragmatic"
]



def init_world() -> WorldState:
    """Create the starting WorldState with the 5 seed nations and neutral relations."""
    nations = [
        Nation(
            name="Ironmark", ideology="militarist", gold=80, army=20, population=40,
            territory=6, goals=["dominate all nations", "destroy weakest neighbor first"],
        ),
        Nation(
            name="Aurentum", ideology="mercantile", gold=200, army=5, population=60,
            territory=4, goals=["accumulate 500 gold", "control all trade routes"],
        ),
        Nation(
            name="Solenne", ideology="theocratic", gold=100, army=8, population=55,
            territory=5, goals=["convert all nations", "eliminate heathens"],
        ),
        Nation(
            name="Valdris", ideology="democratic", gold=120, army=12, population=50,
            territory=5, goals=["build a 5-nation alliance", "achieve lasting peace"],
        ),
        Nation(
            name="Kethara", ideology="authoritarian", gold=90, army=15, population=45,
            territory=5, goals=["survive by any means", "secretly ally then betray"],
        ),
    ]

    world = WorldState(nations={n.name: n for n in nations})

    for nation in world.nations.values():
        nation.relations = {other: 0 for other in world.nations if other != nation.name}
    
    for nation in nations:
        nation.traits = random.sample(TRAITS, 2)

    for nation in world.nations.values():
        nation.trust = {
            other: 50
            for other in world.nations
            if other != nation.name
        }

    return world
