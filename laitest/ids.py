from __future__ import annotations

import uuid


def new_id(prefix: str) -> str:
    # Human-ish ids help when debugging and copy/pasting in the UI.
    return f"{prefix}_{uuid.uuid4().hex}"

