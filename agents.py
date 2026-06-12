"""LLM agent calls and prompt construction for CivSim nations."""
import json
import os
import httpx
from dotenv import load_dotenv
from world import Nation, WorldState
import asyncio

load_dotenv()
# VLLM_URL = "http://localhost:8000/v1/chat/completions"
VLLM_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.3-70b-versatile"
OPENROUTER_API_KEY = os.environ.get("GROQ_API_KEY", "")
TIMEOUT = 30
MAX_TOKENS = 250
TEMPERATURE = 0.5

VICTORY_RULES = """
VICTORY CONDITIONS:

1. Domination Victory
   - Be the last surviving nation.

2. Conquest Victory
   - Control at least 15 territory.

3. Economic Victory
   - Reach 1000 gold.

4. Diplomatic Victory
   - Maintain relations >= 100 with every surviving nation.

You should actively pursue whichever victory path best suits your ideology and current situation.
"""

# PERSONAS: dict[str, str] = {
#     "militarist": "You are a warmongering military empire. Strength is the only language you respect. Diplomacy is delay tactics.",
#     "mercantile": "You are a ruthless trade empire. Every relationship is a transaction. Money is power.",
#     "theocratic": "You are a divine theocracy. Non-believers are threats. Conversion or elimination.",
#     "democratic": "You are a peaceful democracy. You build alliances. War is the last resort, but you are not naive.",
#     "authoritarian": "You are a calculating autocracy. Loyalty is a tool. Betrayal is acceptable when the timing is right.",
# }

PERSONAS: dict[str, str] = {
"militarist": """
You are the ruler of a highly militarized empire.
Your primary objective is to expand your influence, territory, and strategic dominance. You respect strength, competence, and resolve. Weak nations are opportunities, while powerful rivals are threats that must be contained or defeated.
You favor military solutions but are not reckless. You may build alliances, negotiate treaties, or engage in trade if doing so strengthens your future military position.
You constantly evaluate:
* Relative military strength
* Strategic opportunities
* Vulnerable neighbors
* Potential rivals
You admire decisive action and despise weakness, indecision, and dependence.
Act with ambition, confidence, and strategic aggression.
""",
"mercantile": """
You are the ruler of a wealthy commercial empire.
Your primary objective is economic supremacy. Wealth, trade networks, market access, and resource control matter more than ideology or military glory.
Every relationship is evaluated through cost-benefit analysis. Allies are business partners. Enemies are economic obstacles.
You prefer:
* Trade agreements
* Resource acquisition
* Diplomatic stability
* Profitable partnerships
You will support wars, alliances, or espionage if they increase your prosperity or weaken economic competitors.
You are pragmatic, calculating, and profit-driven.
Act as a master strategist of commerce and influence.
""",
"theocratic": """
You are the ruler of a sacred theocratic state.
Your society believes it possesses divine truth and a sacred mission. Preserving the faith and expanding its influence are your highest duties.
You judge nations based on their alignment with your values and beliefs. Nations that reject your worldview are viewed with suspicion, while those who support it are natural partners.
You prefer:
* Religious influence
* Cultural unity
* Moral authority
* Ideological expansion
However, you are not blindly fanatical. You may tolerate rivals temporarily if it serves a greater divine purpose.
You act with conviction, certainty, and unwavering faith in your mission.
""",
"democratic": """
You are the leader of a representative democracy.
Your primary objective is the long-term prosperity, security, and happiness of your people.
You prefer diplomacy, cooperation, and alliances because stability benefits everyone. However, you understand that peaceful societies must be capable of defending themselves.
You value:
* International cooperation
* Economic growth
* Public welfare
* Strategic partnerships
You are willing to use military force when necessary, particularly against aggressive or destabilizing powers.
You seek peace, but not at the cost of survival.
Act with caution, integrity, and strategic realism.
""",
"authoritarian": """
You are the ruler of a centralized authoritarian state.
Your primary objective is maintaining power, stability, and national influence.
You view politics as a game of leverage, information, and control. Loyalty is valuable, but usefulness is often more important.
You are highly adaptive:
* Cooperate when beneficial
* Manipulate when necessary
* Betray only when the rewards outweigh the risks
You are willing to use diplomacy, trade, espionage, intimidation, or war depending on what best serves your interests.
You trust few nations and always consider hidden motives.
Act as a cold, patient, and calculating strategist.
"""
}


VALID_ACTIONS = {
    "attack",
    "trade",
    "alliance",
    "betray",
    "develop",
    "spy",
    "declare_war",
    "research",
    "invest",
    "recruit",
    "industrialize",
    "trade_resource",
    "nothing"
}

# ACTION_SCHEMA = """{
#   "action": "<one of: attack | trade | alliance | betray | develop | spy | declare_war | nothing>",
#   "target": "<nation name | null>",
#   "message": "<1-2 sentences. Your nation's public announcement this turn.>",
#   "internal_thought": "<1 sentence. Your secret real motive. Never shown publicly.>"
# }"""

ACTION_SCHEMA = """
{
"action": "<attack | trade | alliance | betray | develop | spy | declare_war | research | invest | recruit | industrialize | trade_resource | nothing>",

"target": "<nation name | null>",

"public_message": "<1-3 sentence public statement>",

"internal_thought": "<classified reasoning>",

"strategic_goal": "<primary objective>",

"priority_score": "<1-10>",

"confidence": "<0-100>",

"threat_assessment": {
"highest_threat": "<nation name | null>",
"threat_level": "<low | medium | high | existential>"
},

"relations_assessment": {
"best_ally": "<nation name | null>",
"worst_enemy": "<nation name | null>"
},

"expected_outcome": "<predicted result>",

"fallback_plan": "<what to do if the plan fails>",

"justification": "<why this action is strategically optimal>"
}
"""



FALLBACK_MESSAGE = "Our council is silent this turn."


def _build_system_prompt(nation: Nation) -> str:
    """Compose the system prompt from the ideology persona and the strict JSON schema."""
    return (
        f"{PERSONAS[nation.ideology]}\n\n"
        f"You control the nation {nation.name} in a geopolitical simulation.\n"
        f"Respond with ONLY valid JSON matching this exact schema, "
        f"with no markdown fences and no preamble:\n{ACTION_SCHEMA}"
    )


def _build_user_message(nation: Nation, world: WorldState) -> str:
    """Compose the user message with turn, stats, goals, relations, memory and this turn's events."""
    turn_events = [e.description for e in world.global_events if e.turn == world.turn]
    return (
        f"Turn: {world.turn}\n"
        f"{VICTORY_RULES}\n\n"
        f"Your stats: "
        f"gold={nation.gold}, "
        f"food={nation.food}, "
        f"iron={nation.iron}, "
        f"army={nation.army}, "
        f"technology={nation.technology}, "
        f"economy={nation.economy_level}, "
        f"population={nation.population}, "
        f"happiness={nation.happiness:.2f}, "
        f"territory={nation.territory}\n"
        f"Your goals: {nation.goals}\n"
        f"Your personality traits: {nation.traits}\n"
        f"Your relations: {nation.relations}\n"
        f"Known grudges: {nation.grudges}\n"
        f"Trust levels: {nation.trust}\n"
        f"Known rivals: {nation.rivals}\n"
        f"Current alliances: {nation.alliances}\n"
        f"Current wars: {nation.wars}\n"
        f"Your recent memories: {nation.memory[-5:]}\n"
        f"Events so far this turn: {turn_events}\n"
        f"GLOBAL INTELLIGENCE:\n{_world_summary(world)}\n\n"
        f"""
            Before choosing an action:

            1. Assess your position.
            2. Identify your greatest threat.
            3. Identify your greatest opportunity.
            4. Consider your ideology.
            5. Consider the victory conditions.
            6. Select the action most likely to increase your chance of winning.

            Avoid random actions.
            Avoid passive behavior.
            Only choose 'nothing' if it is strategically justified.

            Return valid JSON only.
        """
    )


def _strip_fences(text: str) -> str:
    """Remove accidental markdown code fences from a model response."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
    if text.endswith("```"):
        text = text[: -3]
    return text.strip()


async def get_nation_action(nation: Nation, world: WorldState) -> dict:
    """Ask the LLM for this nation's action; never raises, falls back to 'nothing' on any error."""
    try:
        payload = {
            "model": MODEL,
            "max_tokens": MAX_TOKENS,
            "temperature": TEMPERATURE,
            "messages": [
                {"role": "system", "content": _build_system_prompt(nation)},
                {"role": "user", "content": _build_user_message(nation, world)},
            ],
        }
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            for attempt in range(3):
                response = await client.post(VLLM_URL, json=payload, headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"})
                if response.status_code == 429:
                    await asyncio.sleep(5 * (attempt + 1))
                    continue
                response.raise_for_status()
                break
            else:
                response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        parsed = json.loads(_strip_fences(content))
        return validate_action(parsed)
    except httpx.HTTPStatusError as exc:
        return {
            "action": "nothing", "target": None,
            "message": FALLBACK_MESSAGE,
            "internal_thought": "something went wrong",
            "error": f"{exc} | body: {exc.response.text}",
        }
    except Exception as exc:  # noqa: BLE001 - a failed agent must not crash the turn
        return {
            "action": "nothing",
            "target": None,
            "message": FALLBACK_MESSAGE,
            "internal_thought": "something went wrong",
            "error": str(exc),
        }

# def _world_summary(world: WorldState) -> str:
#     alive = [n for n in world.nations.values() if not n.eliminated]

#     richest = sorted(alive, key=lambda n: n.gold, reverse=True)
#     strongest = sorted(alive, key=lambda n: n.army, reverse=True)
#     largest = sorted(alive, key=lambda n: n.territory, reverse=True)

#     return (
#         f"Richest Nation: {richest[0].name}\n"
#         f"Strongest Army: {strongest[0].name}\n"
#         f"Largest Territory: {largest[0].name}\n"
#     )

def _world_summary(world):
    lines = []

    for nation in world.nations.values():
        if nation.eliminated:
            continue

        lines.append(
            f"{nation.name}: "
            f"gold={nation.gold}, "
            f"food={nation.food}, "
            f"iron={nation.iron}, "
            f"army={nation.army}, "
            f"population={nation.population}, "
            f"territory={nation.territory}, "
            f"tech={nation.technology}, "
            f"economy={nation.economy_level}, "
            f"alliances={len(nation.alliances)}, "
            f"wars={len(nation.wars)}"
        )

    return "\n".join(lines)


def validate_action(action: dict) -> dict:
    if action.get("action") not in VALID_ACTIONS:
        action["action"] = "nothing"

    action.setdefault("target", None)
    action.setdefault("public_message", FALLBACK_MESSAGE)
    action.setdefault("internal_thought", "No reasoning provided.")

    return action