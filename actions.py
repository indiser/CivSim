"""Action parser mapping agent JSON actions to world mutations."""
import random

from world import Nation, WorldState, clamp_relation

ATTACK = "attack"
TRADE = "trade"
ALLIANCE = "alliance"
BETRAY = "betray"
DEVELOP = "develop"
SPY = "spy"
DECLARE_WAR = "declare_war"
NOTHING = "nothing"
RESEARCH = "research"
INVEST = "invest"
RECRUIT = "recruit"
INDUSTRIALIZE = "industrialize"
TRADE_RESOURCE = "trade_resource"

TARGETED_ACTIONS = {ATTACK, TRADE, ALLIANCE, BETRAY, SPY, DECLARE_WAR, TRADE_RESOURCE}


def _shift_relations(a: Nation, b: Nation, delta: int) -> None:
    """Shift mutual relations between two nations by delta, clamped to valid range."""
    a.relations[b.name] = clamp_relation(a.relations.get(b.name, 0) + delta)
    b.relations[a.name] = clamp_relation(b.relations.get(a.name, 0) + delta)


def _set_relations(a: Nation, b: Nation, value: int) -> None:
    """Set mutual relations between two nations to an absolute clamped value."""
    a.relations[b.name] = clamp_relation(value)
    b.relations[a.name] = clamp_relation(value)


def _do_nothing(actor: Nation, world: WorldState) -> None:
    """Passive recovery: small happiness and gold gain."""
    actor.happiness += 0.02
    actor.gold += 5
    world.log(actor.name, f"{actor.name} did nothing this turn", NOTHING)


def _do_attack(actor: Nation, target: Nation, world: WorldState) -> None:
    """Resolve combat between actor and target, transferring territory on victory."""
    attack_power = (
        actor.army *
        (1 + actor.technology * 0.05)
    ) * random.uniform(0.8, 1.2)

    defense_power = (
        target.army *
        (1 + target.technology * 0.05)
    ) * random.uniform(0.8, 1.2)

    power = attack_power - defense_power
    target.trust[actor.name] -= 15
    world.stats["attacks"][actor.name] = (
        world.stats["attacks"].get(actor.name, 0) + 1
    )
    
    if power > 15:
        seized = max(2, target.territory // 2)
        actor.army -= 1
        target.army -= 8
        target.territory -= seized
        actor.territory += seized
        world.log(
            actor.name,
            f"{actor.name} crushed {target.name} and seized {seized} territory",
            ATTACK
        )
        world.stats["territory_gained"][actor.name] = (
            world.stats["territory_gained"].get(actor.name, 0)
            + seized
        )
    elif power > 0:
        seized = max(1, target.territory // 3)
        target.territory -= seized
        actor.territory += seized
        actor.army -= 2
        target.army -= 4
        world.log(actor.name, f"{actor.name} attacked {target.name} and seized {seized} territory", ATTACK)
        world.stats["territory_gained"][actor.name] = (
            world.stats["territory_gained"].get(actor.name, 0)
            + seized
        )
    else:
        actor.army -= 5
        world.log(actor.name, f"{actor.name} attacked {target.name} but was repelled", ATTACK)
    target.grudges[actor.name] = (
        target.grudges.get(actor.name, 0) + 3
    )

    if target.trust[actor.name] < 15:
        if actor.name not in target.rivals:
            target.rivals.append(actor.name)
    
    _shift_relations(actor, target, -30)


def _do_trade(actor: Nation, target: Nation, world: WorldState) -> None:
    """Transfer gold from actor to target with a value multiplier and improve relations."""
    profit = random.randint(15, 35)
    actor.gold += profit
    target.gold += profit
    _shift_relations(actor, target, 15)
    world.stats["trades"][actor.name] = (
        world.stats["trades"].get(actor.name, 0) + 1
    )
    world.log(actor.name, f"{actor.name} traded with {target.name}", TRADE)


def _do_alliance(actor: Nation, target: Nation, world: WorldState) -> None:
    """Propose an alliance, boosting mutual relations."""
    actor.relations[target.name] = clamp_relation(actor.relations.get(target.name, 0) + 40)
    target.relations[actor.name] = clamp_relation(target.relations.get(actor.name, 0) + 40)
    actor.gold += 10
    target.gold += 10
    actor.happiness += 0.03
    target.happiness += 0.03
    actor.trust[target.name] += 5
    target.trust[actor.name] += 5
    world.stats["alliances"][actor.name] = (
        world.stats["alliances"].get(actor.name, 0) + 1
    )
    if target.name in actor.wars:
        actor.wars.remove(target.name)
    if actor.name in target.wars:
        target.wars.remove(actor.name)
    if target.name not in actor.alliances:
        actor.alliances.append(target.name)
    if actor.name not in target.alliances:
        target.alliances.append(actor.name)
    world.log(actor.name, f"{actor.name} proposed alliance with {target.name}", ALLIANCE)


def _do_betray(actor: Nation, target: Nation, world: WorldState) -> None:
    """Collapse relations to -80 and hurt the target's happiness."""
    _set_relations(actor, target, -80)
    target.happiness -= 0.05  # loses 5 happiness points on the 0.0-1.0 scale
    target.grudges[actor.name] = (
        target.grudges.get(actor.name, 0) + 5
    )
    actor.trust[target.name] -= 25
    target.trust[actor.name] -= 40
    world.stats["betrayals"][actor.name] = (
        world.stats["betrayals"].get(actor.name, 0) + 1
    )
    if target.name in actor.alliances:
        actor.alliances.remove(target.name)
    if actor.name in target.alliances:
        target.alliances.remove(actor.name)
    if target.trust[actor.name] < 15:
        if actor.name not in target.rivals:
            target.rivals.append(actor.name)
    world.log(actor.name, f"{actor.name} BETRAYED {target.name}! Relations collapsed.", BETRAY)


def _do_develop(actor: Nation, world: WorldState) -> None:
    """Spend gold on domestic development for population and happiness gains."""
    if actor.gold < 15:
        world.log(actor.name, f"{actor.name} lacked gold for development", DEVELOP)
        return
    actor.gold -= 20
    actor.population += 5
    actor.happiness += 0.05
    actor.army += 1
    world.stats["developments"][actor.name] = (
        world.stats["developments"].get(actor.name, 0)
        + 1
    )
    world.log(actor.name, f"{actor.name} invested in domestic development", DEVELOP)


def _do_spy(actor: Nation, target: Nation, world: WorldState) -> None:
    """Attempt espionage: 60% learn target stats, 40% get caught and lose relations."""
    if random.random() < 0.6:
        intel = (
            f"Spy report on {target.name}: gold={target.gold}, army={target.army}, "
            f"population={target.population}, happiness={target.happiness:.2f}, "
            f"territory={target.territory}"
        )
        actor.remember(intel)
        world.stats["spies"][actor.name] = (
        world.stats["spies"].get(actor.name, 0)
        + 1
    )
        world.log(actor.name, f"{actor.name} successfully spied on {target.name}", SPY)
    else:
        _shift_relations(actor, target, -20)
        target.grudges[actor.name] = (
            target.grudges.get(actor.name, 0) + 2
        )
        target.trust[actor.name] -= 10
        if target.trust[actor.name] < 15:
            if actor.name not in target.rivals:
                target.rivals.append(actor.name)
        world.log(actor.name, f"{actor.name}'s spy was caught in {target.name}", SPY)


def _do_declare_war(actor: Nation, target: Nation, world: WorldState) -> None:
    """Declare war: relations bottom out, actor mobilises army at a gold cost."""
    _set_relations(actor, target, -100)
    actor.army += 3
    actor.gold -= 20
    if target.name not in actor.wars:
        actor.wars.append(target.name)
    if actor.name not in target.wars:
        target.wars.append(actor.name)
    if target.name in actor.alliances:
        actor.alliances.remove(target.name)
    if actor.name in target.alliances:
        target.alliances.remove(actor.name)
    world.stats["wars_declared"][actor.name] = (
        world.stats["wars_declared"].get(actor.name, 0)
        + 1
    )
    for ally_name in target.alliances:
        if ally_name == actor.name:
            continue

        ally = world.nations.get(ally_name)

        if ally and not ally.eliminated:

            if actor.name not in ally.wars:
                ally.wars.append(actor.name)

            if ally.name not in actor.wars:
                actor.wars.append(ally.name)

            world.log(
                ally.name,
                f"{ally.name} joined the war to defend {target.name}",
                "coalition_war"
            )
    world.log(actor.name, f"{actor.name} declared war on {target.name}!", DECLARE_WAR)


def _join_allied_wars(
        attacker: Nation,
        defender: Nation,
    ):
        for ally in defender.alliances:
            if ally == attacker.name:
                continue

            yield ally
        
def apply_action(action: dict, actor: Nation, world: WorldState) -> None:
    """Apply a parsed agent action to the world, then update memories and check eliminations."""
    verb = action.get("action", NOTHING)
    target_name = action.get("target")
    target = world.nations.get(target_name) if target_name else None

    if verb in TARGETED_ACTIONS and (target is None or target is actor or target.eliminated):
        verb = NOTHING  # invalid target downgrades to a passive turn

    if verb == ATTACK:
        _do_attack(actor, target, world)
    elif verb == TRADE:
        _do_trade(actor, target, world)
    elif verb == ALLIANCE:
        _do_alliance(actor, target, world)
    elif verb == BETRAY:
        _do_betray(actor, target, world)
    elif verb == DEVELOP:
        _do_develop(actor, world)
    elif verb == SPY:
        _do_spy(actor, target, world)
    elif verb == DECLARE_WAR:
        _do_declare_war(actor, target, world)
    elif verb == RESEARCH:
        _do_research(actor, world)
    elif verb == INVEST:
        _do_invest(actor, world)
    elif verb == RECRUIT:
        _do_recruit(actor, world)
    elif verb == INDUSTRIALIZE:
        _do_industrialize(actor, world)
    elif verb == TRADE_RESOURCE:
        _do_trade_resource(
            actor,
            target,
            world
        )
    else:
        _do_nothing(actor, world)

    # Memory update (FIFO, max 10)
    message = (
        action.get("public_message")
        or action.get("message")
        or ""
    )
    if message:
        actor.remember(message)
        if target is not None and verb in TARGETED_ACTIONS:
            target.remember(message)

    # Clamp all mutated values
    actor.clamp()
    if target is not None:
        target.clamp()

    # Elimination check
    for nation in (actor, target):
        if (
            nation is not None
            and not nation.eliminated
            and ((nation.gold <= 0 and nation.army <= 0) or nation.population <= 0)
        ):
            nation.eliminated = True
            world.log(nation.name, f"{nation.name} has been eliminated!", "elimination")

def _do_research(actor: Nation, world: WorldState):

    if actor.gold < 25 or actor.iron < 10:
        world.log(
            actor.name,
            f"{actor.name} lacked funds for research",
            RESEARCH
        )
        return

    actor.gold -= 25
    actor.iron -= 10
    actor.technology += 1

    world.log(
        actor.name,
        f"{actor.name} advanced its technology",
        RESEARCH
    )

def _do_invest(actor, world):

    if actor.gold < 30:
        return

    actor.gold -= 30
    actor.economy_level += 1

    world.log(
        actor.name,
        f"{actor.name} expanded its economy",
        INVEST
    )

def _do_recruit(actor: Nation, world: WorldState):

    if (
        actor.gold < 20
        or actor.production < 5
    ):
        return

    

    actor.gold -= 20
    actor.population -= 5
    actor.production -= 5
    actor.army += 4

    world.log(
        actor.name,
        f"{actor.name} recruited new soldiers",
        RECRUIT
    )

def _do_industrialize(actor, world):

    if actor.gold < 40:
        return

    actor.gold -= 40
    actor.production += 10

    world.log(
        actor.name,
        f"{actor.name} expanded industrial production",
        INDUSTRIALIZE
    )

def _do_trade_resource(
    actor: Nation,
    target: Nation,
    world: WorldState,
):
    if actor.food < 10 and actor.iron < 10:
        return

    if actor.iron > actor.food:

        actor.iron -= 10
        target.iron += 10

        actor.gold += 20
        target.gold += 5

        resource = "iron"

    else:

        actor.food -= 10
        target.food += 10

        actor.gold += 20
        target.gold += 5

        resource = "food"

    actor.trade_routes[target.name] = resource

    world.log(
        actor.name,
        f"{actor.name} exported {resource} to {target.name}",
        TRADE_RESOURCE
    )