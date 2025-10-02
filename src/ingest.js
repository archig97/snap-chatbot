import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chunkText, saveJSON } from './utils.js';

const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMB_MODEL = process.env.EMB_MODEL || 'nomic-embed-text';
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '1200', 10);
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || '200', 10);

const SOURCE_PDF = path.resolve(process.env.SOURCE_PDF || 'data/SnapManual.pdf');
const INDEX_PATH = path.resolve('data/index.json');

async function extractTextWithPdfjs(buffer) {
    // pdfjs requires Uint8Array, not Node Buffer
    
const uint8 = new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

const loadingTask = getDocument({ data: uint8 });
const pdf = await loadingTask.promise;
    let fullText = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map(i => (i.str || '')).join(' ');
      fullText += `\n\n${pageText}`;
    }
    try { await pdf.cleanup(); } catch {}
    return fullText.trim();
  }

async function embed(text) {
const res = await fetch(`${OLLAMA}/api/embeddings`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ model: EMB_MODEL, prompt: text })
});
if (!res.ok) throw new Error(`Embedding failed: ${res.status} ${res.statusText}`);
const json = await res.json();
return json.embedding; // [number]
}

async function main() {
if (!fs.existsSync(SOURCE_PDF)) {
console.error(`
❌ Missing PDF at ${SOURCE_PDF}. Set SOURCE_PDF or place data/source.pdf
`);
process.exit(1);
}

const buf = await fs.promises.readFile(SOURCE_PDF);
const text = await extractTextWithPdfjs(buf);

if (!text || !text.trim()) {
console.error('❌ Extracted empty text from PDF. Check if the PDF is scanned/bitmap-only.');
process.exit(1);
}

const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);
console.log(`Parsed text into ${chunks.length} chunks. Embedding...`);

const vectors = [];
for (let i = 0; i < chunks.length; i++) {
const c = chunks[i];
const v = await embed(c);
//vectors.push({ id: i, text: c, embedding: v });
vectors.push({
  id: i,
  text: cleanText(c),
  page: Math.floor(i / (CHUNK_SIZE / 500)) + 1, // crude page estimate, or capture real page earlier
  section: null,                                // or fill if you parse headings
  source: path.basename(SOURCE_PDF),
  embedding: v
});
if ((i + 1) % 10 === 0) console.log(` embedded ${i + 1}/${chunks.length}`);
}

await saveJSON(INDEX_PATH, { createdAt: new Date().toISOString(), embModel: EMB_MODEL, chunks: vectors });
console.log(`
✅ Wrote index to ${INDEX_PATH}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
    });