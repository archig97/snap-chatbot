// src/snap/xmlAnswerRoute.js
// Requires: npm i fast-xml-parser
import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';

/** Default XML path, can override via body.xmlPath or env SNAP_XML */
const DEFAULT_XML = path.resolve(process.env.SNAP_XML || 'data/Project1.xml');

/* ---------- Block spec → natural language mappings ---------- */
const SIMPLE_SPECS = {
  'move %n steps': (a) => `move ${a[0]} steps`,
  'turn %clockwise %n degrees': (a) => `turn clockwise ${a[0]} degrees`,
  'turn %counterclockwise %n degrees': (a) => `turn counter-clockwise ${a[0]} degrees`,
  'go to x: %n y: %n': (a) => `go to x=${a[0]}, y=${a[1]}`,
  'glide %n secs to x: %n y: %n': (a) => `glide ${a[0]} secs to x=${a[1]}, y=${a[2]}`,
  'wait %n secs': (a) => `wait ${a[0]} seconds`,
  'say %s': (a) => `say "${a[0]}"`,
  'think %s': (a) => `think "${a[0]}"`,
  'change x by %n': (a) => `change x by ${a[0]}`,
  'change y by %n': (a) => `change y by ${a[0]}`,
  'set x to %n': (a) => `set x to ${a[0]}`,
  'set y to %n': (a) => `set y to ${a[0]}`,
  'point in direction %dir': (a) => `point in direction ${a[0]}`,
  'point towards %dst': (a) => `point towards ${a[0]}`,
};

const CONTROL_SPECS = {
  'doRepeat %n %c': (a, children) => ({ type: 'repeat', text: `repeat ${a[0]} times`, children }),
  'doIf %b %c': (a, children) => ({ type: 'if', text: `if (${a[0]})`, children }),
  'doIfElse %b %c %c': (a, [thenChildren, elseChildren]) =>
    ({ type: 'ifelse', text: `if (${a[0]})`, thenChildren, elseChildren }),
  'doForever %c': (_a, children) => ({ type: 'forever', text: 'forever', children }),
  'doUntil %b %c': (a, children) => ({ type: 'until', text: `repeat until (${a[0]})`, children }),
};

const SELECTOR_SPECS = {
    // Motion
    'forward': (a) => `move ${a[0]} steps`,
    'turn': (a) => `turn ${a[0]} degrees`,
    'gotoX:y:': (a) => `go to x=${a[0]}, y=${a[1]}`,
    'glide:toX:y:elapsed:from:': (a) => `glide ${a[0]} secs to x=${a[1]}, y=${a[2]}`,
  
    // (add more as you encounter them)
    // 'turnRight:': (a) => `turn clockwise ${a[0]} degrees`,
    // 'turnLeft:': (a) => `turn counter-clockwise ${a[0]} degrees`,
  };

/* ----------------------- Helpers ----------------------- */
function normChildren(c) { if (!c) return []; return Array.isArray(c) ? c : [c]; }

function argValue(node) {
  if (node == null) return '';
  if (['string', 'number', 'boolean'].includes(typeof node)) return node;
  if (node.l != null) return Array.isArray(node.l) ? node.l.map(argValue) : node.l; // literal
  if (node.bool != null) return node.bool;
  if (node.s != null) return node.s;
  if (node.list != null) return '[list]';
  if (node.block) return describeBlock(node.block); // nested reporter
  return '';
}

function gatherArgs(blockNode) {
  const entries = Object.entries(blockNode)
    .filter(([k]) => !['@_s', 'script', 'list'].includes(k) && !k.startsWith('@_'));
  const args = [];
  for (const [, v] of entries) {
    if (Array.isArray(v)) for (const item of v) args.push(argValue(item));
    else args.push(argValue(v));
  }
  return args.flat();
}

function describeScript(scriptNode) {
  if (!scriptNode) return [];
  const blocks = normChildren(scriptNode.block);
  return blocks.map(describeBlock);
}

function describeBlock(blockNode) {
    if (!blockNode) return null;
    const spec = blockNode['@_s'] ?? blockNode.s;   // spec string if present
    const args = gatherArgs(blockNode);
  
    // control blocks handled above...
    if (CONTROL_SPECS[spec]) {
      const scripts = normScripts(blockNode.script);
      const childrenArrays = scripts.map(s => describeScript(s));
      return CONTROL_SPECS[spec](args, childrenArrays.length === 1 ? childrenArrays[0] : childrenArrays);
    }
  
    // 1) try human-friendly spec (“move %n steps”, etc.)
    if (SIMPLE_SPECS[spec]) {
      return { type: 'step', text: SIMPLE_SPECS[spec](args) };
    }
  
    // 2) try selector fallback (“forward”, “turn”, etc.)
    if (SELECTOR_SPECS[spec]) {
      return { type: 'step', text: SELECTOR_SPECS[spec](args) };
    }
  
    // 3) generic fallback
    const prettyArgs = args.filter(a => a !== '').join(', ');
    const base = spec ? spec.replace(/%[a-z]+/gi, '').trim() : '[unknown]';
    return { type: 'step', text: prettyArgs ? `${base} (${prettyArgs})` : base };
}

function flatten(nodes, indent = 0) {
  const out = [];
  for (const n of nodes) {
    if (!n) continue;
    if (n.type === 'step') out.push(`${'  '.repeat(indent)}• ${n.text}`);
    else if (n.type === 'repeat' || n.type === 'forever' || n.type === 'until') {
      out.push(`${'  '.repeat(indent)}• ${n.text}`);
      out.push(...flatten(n.children || [], indent + 1));
    } else if (n.type === 'if') {
      out.push(`${'  '.repeat(indent)}• ${n.text}`);
      out.push(...flatten(n.children || [], indent + 1));
    } else if (n.type === 'ifelse') {
      out.push(`${'  '.repeat(indent)}• ${n.text}`);
      out.push(...flatten(n.thenChildren || [], indent + 1));
      out.push(`${'  '.repeat(indent)}• else`);
      out.push(...flatten(n.elseChildren || [], indent + 1));
    }
  }
  return out;
}

function asArr(x) { return Array.isArray(x) ? x : (x ? [x] : []); }

async function describeSnapProject(xmlPath = DEFAULT_XML) {

    console.log('Parsing Snap XML from:', xmlPath);
    const xml = await fs.promises.readFile(xmlPath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: false, attributeNamePrefix: '@_' });
    const dom = parser.parse(xml);
  
    // Snap files can look like either:
    // A) project -> scenes -> scene -> sprites -> sprite
    // B) project -> stage -> sprites -> sprite
    // (and sometimes multiple scenes)
  
    let spriteNodes = [];
  
    // Try A) scenes
    const scenes = asArr(dom.project?.scenes?.scene);
    for (const sc of scenes) {
      spriteNodes.push(...asArr(sc?.sprites?.sprite));
    }
  
    // Try B) stage
    const stageSprites = asArr(dom.project?.stage?.sprites?.sprite);
    spriteNodes.push(...stageSprites);
  
    const result = {};
    for (const sp of spriteNodes) {
      if (!sp) continue;
      const name = sp['@_name'] || 'Sprite';
      const scripts = asArr(sp.scripts?.script);
      const described = scripts.map(s => describeScript(s)).flat();
      result[name] = flatten(described);
    }
    return result;
}

/* ----------------------- Route registration ----------------------- */
export function registerSnapXmlAnswerRoute(app) {
  app.post('/answer', async (req, res) => {
    try {
      const xmlPath = req.body?.xmlPath || DEFAULT_XML;
      const sprites = await describeSnapProject(xmlPath);
      res.json({ ok: true, sprites });
    } catch (err) {
      console.error('Snap XML parse error:', err);
      res.status(500).json({ ok: false, error: 'Failed to parse Snap XML' });
    }
  });
}
