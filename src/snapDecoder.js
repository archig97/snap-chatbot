// snapDecoder.js
import 'dotenv/config';
import fs from 'node:fs/promises';

const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const GEN_MODEL = process.env.GEN_MODEL || 'llama3.1:8b';

//will keep out the image and sound for now to save tokens.
function sanitizeSnapXml(xml) {
  // Thumbnail and pentrails
  xml = xml.replace(/<thumbnail>[\s\S]*?<\/thumbnail>/gi, '<thumbnail>[REMOVED_IMAGE]</thumbnail>');
  xml = xml.replace(/<pentrails>[\s\S]*?<\/pentrails>/gi, '<pentrails>[REMOVED_PEN_TRAILS]</pentrails>');

  // Costumes and sounds content (keep structure)
  xml = xml.replace(/<costumes>[\s\S]*?<\/costumes>/gi, '<costumes>[REMOVED_COSTUMES_CONTENT]</costumes>');
  xml = xml.replace(/<sounds>[\s\S]*?<\/sounds>/gi, '<sounds>[REMOVED_SOUNDS_CONTENT]</sounds>');

  return xml;
}

//EXTRACT SPRITE METADAT FROM XML ITSELF
function extractSpriteMetadata(xml) {
  const sprites = [];
  const spriteTagRegex = /<sprite\b([^>]+)>/g;
  let match;

  while ((match = spriteTagRegex.exec(xml)) !== null) {
    const attrs = match[1];

    const getAttr = (name) => {
      const r = new RegExp(`${name}="([^"]*)"`);
      const m = r.exec(attrs);
      return m ? m[1] : null;
    };

    sprites.push({
      name: getAttr('name'),
      idx: getAttr('idx'),
      id: getAttr('id'),
      rawAttrs: attrs,
    });
  }

  return {
    count: sprites.length,
    sprites,
  };
}

/**
 * Prompt template that:
 * - Explicitly passes the sprite list (ground truth) into the model.
 * - Forbids talking about Scratch / GameMaker.
 * - Forces the model to describe ALL sprites.
 */
const SNAP_DECODER_PROMPT = ({ xml, spriteInfo }) => {
  const { count, sprites } = spriteInfo;

  const spriteSummaryLines = sprites.length
    ? sprites
        .map(
          (s, i) =>
            `- Sprite ${i + 1}: name="${s.name}", idx="${s.idx}", id="${s.id}"`
        )
        .join('\n')
    : '- (no <sprite> tags found in the XML)';

  return `
You are an expert Snap! (https://snap.berkeley.edu) programmer and project analyst.

CRITICAL:
- This is a Snap! project, NOT Scratch, NOT GameMaker Studio, NOT Unity, NOT Godot.
- If you mention Scratch or GameMaker Studio in your answer, you are wrong and must correct yourself.
- The XML format is Snap's export format. Treat it ONLY as Snap.

The XML has already been pre-scanned in JavaScript.
Here is the authoritative sprite metadata, extracted directly from the <sprite> tags:

Sprite scan (GROUND TRUTH, do not contradict this):
- Total <sprite> tags found: ${count}
${spriteSummaryLines}

You MUST describe ALL of these sprites in your answer. If your answer ignores any of them, your answer is incomplete.

Your job is to precisely decipher the project and explain what it does in clear, human-readable language, with a strong focus on ALL sprites and ALL scripts.

Follow THIS STRUCTURE:

========================================
1. SPRITE COUNT + NAMES
========================================
- Confirm the total number of sprites (it MUST match ${count}).
- List every sprite by name and idx as given in the sprite scan above.

========================================
2. HIGH-LEVEL OVERVIEW
========================================
Project Overview:
- Project name (from <project> "name" attribute)
- Snap! version (from "app"/"version" attributes, if present)
- Short summary of what the project does overall.

Stage:
- Stage size (width × height)
- Background color or costume (if visible)
- Any obvious global settings (tempo, volume, etc.).

========================================
3. PER-SPRITE DETAILS
========================================
For EACH sprite from the sprite scan, in order:

Sprite: <sprite name> (idx=<idx>)
- Initial position: (x=<x>, y=<y>)
- Heading: <heading>
- Draggable: <true/false>
- Costume(s): list all costume names for this sprite.
- Number of scripts: <number>

Scripts:
For each script belonging to THIS sprite:
- Script #k:
  - Location in editor (x, y) from the <script> tag, if present.
  - Blocks in order, EXACTLY as in the XML. For example:
    - forward (10)
    - turn (15)
    - changeXPosition (10)
    - changeYPosition (10)
    - bounceOffEdge
  - Note any event “hat” blocks (e.g., when green flag clicked, when key pressed, etc.).
  - If there is NO hat block at the top, add: “This script does not run automatically; it only runs when manually clicked in the editor.”

If a sprite has ZERO scripts, explicitly say:
- “This sprite has no scripts.”

========================================
4. MOVEMENT AND BEHAVIOR
========================================
Movement and Behavior:
- For each sprite, describe its movement and behavior in plain English, based strictly on the blocks you saw.
- If movement is one-shot (no loop), say that clearly.
- If there are conditions or edge-bounce, explain what happens (e.g., “moves 10 steps, then 15 degrees, then shifts by (10,10) and bounces off edges once”).

========================================
5. FINAL PROJECT SUMMARY
========================================
Final Summary:
- Summarize how all sprites together behave when their scripts are run.
- Do NOT mention Scratch, GameMaker, or any other engine.
- Do NOT invent blocks or scripts that are not present.

STRICT RULES:
- Base everything ONLY on the XML you see.
- You MUST describe all ${count} sprites listed in the sprite scan.
- Do NOT describe this as GameMaker Studio, Scratch, or any other engine.
- Do NOT dump or rewrite XML; you must interpret it.
- Do NOT ignore any <sprite> tag.

Here is the Snap! project XML:

[SNAP_XML_START]
${xml}
[SNAP_XML_END]
`;
};

/**
 * Call local Ollama /api/generate with a single prompt.
 */
async function callOllama(prompt) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEN_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 1024,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama request failed: ${res.status} ${res.statusText} ${text}`);
  }

  const json = await res.json();
  return (json.response || '').trim();
}

/**
 * Main: read XML, extract sprites, build prompt, call LLM, print explanation.
 */
async function runSnapDecoder(xmlPath) {
  let xml = await fs.readFile(xmlPath, 'utf8');

  // Optional but recommended: remove base64 blobs
  const sanitizedXml = sanitizeSnapXml(xml);

  const spriteInfo = extractSpriteMetadata(xml); // use full XML so regex sees real <sprite> tags

  console.log(`Using Ollama at: ${OLLAMA}`);
  console.log(`Model: ${GEN_MODEL}`);
  console.log(`Sprites detected in XML (JS side):`, spriteInfo);
  console.log(`Decoding Snap project from: ${xmlPath}\n`);

  const prompt = SNAP_DECODER_PROMPT({ xml: sanitizedXml, spriteInfo });
  const explanation = await callOllama(prompt);

  console.log('================= DECODED SNAP PROJECT =================\n');
  console.log(explanation);
  console.log('\n========================================================\n');

  return explanation;
}

// CLI entrypoint: node snapDecoder.js path/to/project.xml
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const [, , xmlPath] = process.argv;

    if (!xmlPath) {
      console.error('Usage: node snapDecoder.js path/to/project.xml');
      process.exit(1);
    }

    try {
      await runSnapDecoder(xmlPath);
    } catch (err) {
      console.error('Error while decoding Snap project:', err.message);
      process.exit(1);
    }
  })();
}
