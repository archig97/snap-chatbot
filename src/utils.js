import fs from 'fs';
import path from 'path';

export function cosine(a, b) {
const dot = a.reduce((s, v, i) => s + v * b[i], 0);
const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
return na && nb ? dot / (na * nb) : 0;
}

export function chunkText(text, chunkSize = 1200, chunkOverlap = 200) {
// simple, stable chunker: split by paragraphs, then reflow
const paras = text
.replace(/\r/g, '')
.split(/\n{2,}/)
.map(p => p.trim())
.filter(Boolean);

const chunks = [];
let buf = '';

const push = (s) => {
if (s.trim().length) chunks.push(s.trim());
};

for (const p of paras) {
if ((buf + '\n\n' + p).length <= chunkSize) {
buf = buf ? buf + '\n\n' + p : p;
} else {
// emit buf and start a new one with overlap
push(buf);
const overlapText = buf.slice(Math.max(0, buf.length - chunkOverlap));
buf = overlapText + (overlapText ? '\n\n' : '') + p;
// if still too big, hard-wrap
while (buf.length > chunkSize) {
push(buf.slice(0, chunkSize));
buf = buf.slice(chunkSize - chunkOverlap);
}
}
}
push(buf);
return chunks;
}

export async function saveJSON(filePath, data) {
await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function loadJSON(filePath, fallback = null) {
try {
const s = await fs.promises.readFile(filePath, 'utf8');
return JSON.parse(s);
} catch {
return fallback;
}
}