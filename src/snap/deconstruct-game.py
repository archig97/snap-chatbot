#!/usr/bin/env python3
# snap_doc_report.py — human-friendly Snap! report (sprites, events, steps, blocks)

import sys
import xml.etree.ElementTree as ET
from collections import defaultdict, Counter
import json

# ---------- Friendly names for common Snap block opcodes ----------
FRIENDLY = {
    # Events (hats)
    "whenGreenFlag": "when green flag clicked",
    "whenClicked": "when this sprite clicked",
    "receiveKey": "when key pressed",
    "receiveMessage": "when I receive",
    "whenIReceive": "when I receive",
    "whenSceneStarts": "when backdrop switches to",
    "whenStopped": "when stop pressed",
    # Motion / Pen / Looks / Control / Operators / Data (sampled)
    "gotoXY": "go to x:%1 y:%2",
    "setHeading": "point in direction %1°",
    "turn": "turn %1°",
    "forward": "move %1 steps",
    "changeYPosition": "change y by %1",
    "down": "pen down",
    "up": "pen up",
    "setSize": "set pen size to %1",
    "setHue": "set pen hue to %1",
    "changeHue": "change pen hue by %1",
    "clear": "clear",
    "doSayFor": 'say "%1" for %2 secs',
    "doAsk": 'ask "%1"',
    "getLastAnswer": "answer",
    "doSetVar": "set %1 to %2",
    "doChangeVar": "change %1 by %2",
    "doDeclareVariables": "declare variables",
    "doIf": "if %1 then …",
    "doIfElse": "if %1 then … else …",
    "doRepeat": "repeat %1 …",
    "doUntil": "repeat until %1 …",
    "doForever": "forever …",
    "doWarp": "warp (atomic) …",
    "reportRandom": "random(%1, %2)",
    "reportQuotient": "%1 / %2",
    "reportJoinWords": "join(%1)",
    "reportTextSplit": "split(%1 by %2)",
    "reportNewList": "[]",
    "reportListItem": "item %1 of %2",
    "reportCONS": "cons(%1, %2)",
    "reportCDR": "rest(%1)",
    # Meta (first-class blocks)
    "reifyScript": "<script>",
    "reifyReporter": "<reporter>",
    "evaluate": "evaluate(%1)",
    "doRun": "run %1",
    "doCallCC": "call/cc %1",
}

STRUCTURAL = {"doForever", "doRepeat", "doUntil", "doIf", "doIfElse", "doWarp"}

def text(el):
    if isinstance(el, str):
        return el
    return (el.text or "").strip() if el is not None else ""

def list_inputs(block, depth=0, max_depth=2):
    """Return printable inputs (literals, vars, nested reporters) safely."""
    args = []
    # get literal or option values
    for l in block.findall("l"):
        opt = l.find("option")
        args.append(text(opt) if opt is not None else text(l))
    # get variable names
    for v in block.findall("block[@var]"):
        args.append(v.attrib.get("var", ""))
    # nested reporters but prevent deep recursion
    if depth < max_depth:
        for nested in block.findall("block"):
            if nested is block:
                continue
            if "s" in nested.attrib:
                args.append(pretty_block(nested, depth=depth + 1))
    return args


def fmt_template(op, args):
    """Render FRIENDLY template with %1, %2 … placeholders, fallback to raw op."""
    template = FRIENDLY.get(op)
    if not template:
        # raw fallback like: s="custom block name %s %n"
        return op + (" " + " ".join(repr(a) for a in args) if args else "")
    out = template
    for i, a in enumerate(args, start=1):
        out = out.replace(f"%{i}", str(a))
    return out

def pretty_block(block, depth=0):
    op = block.attrib.get("s", "")
    args = list_inputs(block, depth=depth)
    return fmt_template(op, args)

def hat_info(first_block):
    """Normalize hats to (kind, detail)."""
    if first_block is None or first_block.tag != "block":
        return (None, None)
    op = first_block.attrib.get("s", "")
    if op in ("receiveMessage", "whenIReceive"):
        return ("when I receive", text(first_block.find("l")) or "?")
    if op == "receiveKey":
        opt = first_block.find(".//l/option")
        key = text(opt) if opt is not None else text(first_block.find("l"))
        return ("when key pressed", key or "?")
    if op == "whenSceneStarts":
        return ("when backdrop switches to", text(first_block.find("l")) or "?")
    label = FRIENDLY.get(op)
    if label:
        return (label, "")
    return (None, None)

def script_structurals(script_el):
    kinds = []
    for b in script_el.iter("block"):
        op = b.attrib.get("s", "")
        if op in STRUCTURAL:
            kinds.append(FRIENDLY.get(op, op))
    # de-dupe but preserve order
    seen, res = set(), []
    for k in kinds:
        if k not in seen:
            seen.add(k); res.append(k)
    return res

def pull_custom_block_defs(root):
    defs = []
    for bd in root.findall(".//block-definition"):
        name = bd.attrib.get("s", "").strip()
        kind = bd.attrib.get("type", "")
        cat = bd.attrib.get("category", "")
        # parameters are embedded via %s/%n/%b etc inside name string; keep raw for now
        defs.append({"name": name, "type": kind, "category": cat})
    return defs

def pull_variables(stage_or_sprite):
    # Snap saves variables several ways; this catches the common project-level variables block
    names = []
    for v in stage_or_sprite.findall(".//variables/variable"):
        nm = v.attrib.get("name")
        if nm:
            names.append(nm)
    return sorted(set(names))

def parse(xml_path):
    tree = ET.parse(xml_path)
    root = tree.getroot()
    stage_el = root.find(".//stage")
    stage_vars = pull_variables(stage_el) if stage_el is not None else []

    report = {
        "project": root.attrib.get("name") or "(untitled)",
        "variables": pull_variables(root),
        "custom_blocks": pull_custom_block_defs(root),
       "stage": {"events": [], "variables": stage_vars},
        "sprites": [],
    }

    # stage events
    stage = root.find(".//stage")
    if stage is not None:
        for script in stage.findall(".//scripts/script"):
            first = script.find("./block")
            hat, detail = hat_info(first)
            if hat:
                report["stage"]["events"].append({
                    "hat": hat,
                    "detail": detail,
                    "structural": script_structurals(script),
                })

    # sprites
    for spr in root.findall(".//sprites/sprite"):
        sp_name = spr.attrib.get("name", "(unnamed)")
        events = []
        for script in spr.findall(".//scripts/script"):
            first = script.find("./block")
            hat, detail = hat_info(first)
            if not hat:
                continue
            events.append({
                "hat": hat,
                "detail": detail,
                "structural": script_structurals(script),
                # Optional: peek a couple of first non-hat commands for context
                "first_steps": [pretty_block(b) for b in script.findall("./block")[1:3]],
            })
        report["sprites"].append({
            "name": sp_name,
            "variables": pull_variables(spr),
            "events": events
        })
    return report

# ---------- Renderers ----------
def to_markdown(rep):
    lines = []
    lines.append(f"# Snap! Project: {rep['project']}")
    if rep["variables"]:
        lines.append(f"\n**Project variables:** {', '.join(rep['variables'])}")
    if rep["custom_blocks"]:
        lines.append("\n**Custom blocks defined:**")
        for d in rep["custom_blocks"]:
            lines.append(f"- `{d['name']}`  _(type: {d['type']}, category: {d['category']})_")

    # Stage
    lines.append("\n## Stage")
    if rep["stage"]["events"]:
        for ev in rep["stage"]["events"]:
            tail = f": {ev['detail']}" if ev["detail"] else ""
            hint = f" _(uses {', '.join(ev['structural'])})_" if ev["structural"] else ""
            lines.append(f"- **{ev['hat']}**{tail}{hint}")
    else:
        lines.append("- (no event hats)")

    # Sprites
    lines.append("\n## Sprites")
    for sp in rep["sprites"]:
        lines.append(f"\n### {sp['name']}")
        if sp["variables"]:
            lines.append(f"- _Sprite variables:_ {', '.join(sp['variables'])}")
        if not sp["events"]:
            lines.append("- (no event hats)")
            continue
        for ev in sp["events"]:
            tail = f": `{ev['detail']}`" if ev["detail"] else ""
            hint = f" _(uses {', '.join(ev['structural'])})_" if ev["structural"] else ""
            steps = f" — first steps: {', '.join(ev['first_steps'])}" if ev.get("first_steps") else ""
            lines.append(f"- **{ev['hat']}**{tail}{hint}{steps}")
    return "\n".join(lines)

def main():
    if len(sys.argv) < 2:
        print("Usage: python snap_doc_report.py <project.xml> [--json]")
        sys.exit(1)
    path = sys.argv[1]
    rep = parse(path)
    if len(sys.argv) > 2 and sys.argv[2] == "--json":
        print(json.dumps(rep, indent=2))
    else:
        print(to_markdown(rep))

if __name__ == "__main__":
    main()
