"""World state dataclasses and serialisation for CivSim."""
from dataclasses import dataclass, field, asdict
from typing import Literal

Ideology = Literal["democratic", "authoritarian", "theocratic", "mercantile", "militarist"]

# Shared bounds / limits
MAX_MEMORY = 10
RELATION_MIN = -100
RELATION_MAX = 100
HAPPINESS_MIN = 0.0
HAPPINESS_MAX = 1.0
RECENT_EVENTS_LIMIT = 30

EVENT_ACTOR = "EVENT"


def clamp_int(value: int, low: int = 0, high: int | None = None) -> int:
    """Clamp an integer between low and an optional high bound."""
    value = max(low, value)
    if high is not None:
        value = min(high, value)
    return value


def clamp_relation(value: int) -> int:
    """Clamp a relation score to the -100..100 range."""
    return clamp_int(value, RELATION_MIN, RELATION_MAX)


def clamp_happiness(value: float) -> float:
    """Clamp a happiness value to the 0.0..1.0 range."""
    return max(HAPPINESS_MIN, min(HAPPINESS_MAX, value))


@dataclass
class Nation:
    """A single AI-controlled nation and all of its mutable state."""

    name: str
    ideology: Ideology
    gold: int = 100
    army: int = 10
    population: int = 50
    happiness: float = 0.7
    territory: int = 5
    technology: int = 0
    relations: dict[str, int] = field(default_factory=dict)
    memory: list[str] = field(default_factory=list)
    goals: list[str] = field(default_factory=list)
    eliminated: bool = False
    traits: list[str] = field(default_factory=list)
    grudges: dict[str, int] = field(default_factory=dict)
    wars: list[str] = field(default_factory=list)
    alliances: list[str] = field(default_factory=list)
    trust: dict[str, int] = field(default_factory=dict)
    rivals: list[str] = field(default_factory=list)
    economy_level: int = 0
    food: int = 100
    iron: int = 50
    production: int = 0
    trade_routes: dict[str, str] = field(default_factory=dict)

    def clamp(self) -> None:
        """Clamp all numeric fields to their valid ranges."""
        self.gold = clamp_int(self.gold)
        self.army = clamp_int(self.army)
        self.population = clamp_int(self.population)
        self.territory = clamp_int(self.territory)
        self.happiness = clamp_happiness(self.happiness)
        self.food = clamp_int(self.food)
        self.iron = clamp_int(self.iron)
        self.technology = clamp_int(self.technology)
        self.economy_level = clamp_int(self.economy_level)
        self.production = clamp_int(self.production)
        for other in self.relations:
            self.relations[other] = clamp_relation(self.relations[other])

    def remember(self, entry: str) -> None:
        """Append an entry to memory, evicting the oldest item past the cap (FIFO)."""
        self.memory.append(entry)
        while len(self.memory) > MAX_MEMORY:
            self.memory.pop(0)


@dataclass
class WorldEvent:
    """A single logged event in the global history."""

    turn: int
    actor: str
    description: str
    action_type: str


@dataclass
class WorldState:
    """The full simulation state shared by all nations."""

    turn: int = 0
    nations: dict[str, Nation] = field(default_factory=dict)
    global_events: list[WorldEvent] = field(default_factory=list)
    winner: str | None = None
    victory_type: str | None = None
    stats: dict = field(default_factory=lambda: {
        "attacks": {},
        "alliances": {},
        "betrayals": {},
        "trades": {},
        "wars_declared": {},
        "territory_gained": {},
        "spies": {},
        "developments": {}
    })

    def log(self, actor: str, description: str, action_type: str) -> None:
        """Append a WorldEvent for the current turn to the global history."""
        self.global_events.append(
            WorldEvent(turn=self.turn, actor=actor, description=description, action_type=action_type)
        )


def serialize_world(world: WorldState) -> dict:
    """Convert WorldState to a plain JSON-safe dict with the last 30 global events."""
    return {
        "turn": world.turn,
        "nations": {name: asdict(nation) for name, nation in world.nations.items()},
        "recent_events": [asdict(event) for event in world.global_events[-RECENT_EVENTS_LIMIT:]],
        "winner": world.winner,
        "victory_type": world.victory_type,
    }
