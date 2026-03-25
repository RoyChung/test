#!/usr/bin/env python3
"""Generate random presentation order for groups A–H using a seed."""

import random

GROUPS = list("ABCDEFGH")

def get_order(seed: int) -> list[str]:
    """Return shuffled order for given seed."""
    rng = random.Random(seed)
    order = GROUPS.copy()
    rng.shuffle(order)
    return order

if __name__ == "__main__":
    import sys
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 42
    order = get_order(seed)
    print(f"Seed: {seed}")
    print("Presentation order:", " → ".join(order))
    for i, g in enumerate(order, 1):
        print(f"  {i}. Group {g}")
