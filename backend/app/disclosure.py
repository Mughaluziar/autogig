"""AI disclosure for messages that leave the product.

A reply drafted by the AI is shown to the user in an editable box; when they copy it to send it on a marketplace, a short line
saying it was drafted with AI assistance and reviewed by the sender is added. The wording can be changed in Settings (setting
`aiDisclosure`) but it must still say that AI was involved, and it cannot be switched off. Nothing here claims a message is
entirely human-written, and nothing is sent by Autopilot: the user pastes it themselves."""
import re

from . import repo, seed

DEFAULT = "Drafted with AI assistance and reviewed by the sender."
_SAYS_AI = re.compile(r"\bAI\b|artificial intelligence|machine[- ]generated|automated", re.I)


def valid(text: object) -> bool:
    return isinstance(text, str) and 3 <= len(text.strip()) <= 200 and bool(_SAYS_AI.search(text))


async def line_for(user_id: str) -> str:
    settings = await repo.get_settings_doc(user_id, seed.SETTINGS)
    value = settings.get("aiDisclosure")
    return value.strip() if valid(value) else DEFAULT


def append(text: str, line: str) -> str:
    text = text.rstrip()
    return text if line in text else f"{text}\n\n{line}"
