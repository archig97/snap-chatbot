import xml.etree.ElementTree as ET

def parse_block(block):
    """Recursively parse a Snap! block and return a readable description."""
    if block.tag == "block":
        name = block.attrib.get("s", "")
        parts = [name]
        for arg in block.findall("l"):  # Literals like numbers or text
            parts.append(arg.text or "")
        for sub in block.findall("block"):  # Nested blocks
            parts.append(parse_block(sub))
        return " ".join(parts).strip()
    elif block.tag == "script":
        steps = []
        for sub in block:
            steps.append(parse_block(sub))
        return " → ".join(steps)
    return ""

def extract_game_steps(xml_path):
    """Extract all game steps (scripts) from a Snap! XML project."""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    game_steps = []

    # Find all scripts inside sprites and stage
    for script in root.findall(".//script"):
        step = parse_block(script)
        if step:
            game_steps.append(step)

    return game_steps

if __name__ == "__main__":
    xml_file = "Game10.xml"  # Change if needed
    steps = extract_game_steps(xml_file)

    print("\n=== Game Steps Extracted ===\n")
    for i, step in enumerate(steps, 1):
        print(f"{i}. {step}")
