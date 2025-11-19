// snapDecoder.js
import 'dotenv/config';
import fs from 'node:fs/promises';

const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const GEN_MODEL = process.env.GEN_MODEL || 'llama3.2:3b';

/**
 * Prompt template for decoding a Snap! project XML.
 */
const SNAP_DECODER_PROMPT = ({
  xml,
}) => `
You are an expert Snap! (https://snap.berkeley.edu) programmer and project analyst.

I will give you the full project XML exported from Snap!. Your job is to decipher the project and explain what it does in clear, human-readable language.

Follow this structure :

Number of sprites and their names.
Blocks and  scripts for each sprite.
what movement each sprite is making and till when, if there is a condition.

Here is the Snap! project XML:

[SNAP_XML_START]
${xml}
[SNAP_XML_END]
`;

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
        temperature: 0.2,
        num_predict: 512,
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
 * Main function: read XML file, build prompt, ask LLM, print explanation.
 */
export async function decodeSnapProject(xmlPath) {
  const xml = await fs.readFile(xmlPath, 'utf8');
  const prompt = SNAP_DECODER_PROMPT({ xml });

  console.log(`Using Ollama at: ${OLLAMA}`);
  console.log(`Model: ${GEN_MODEL}`);
  console.log(`Decoding Snap project from: ${xmlPath}\n`);

  const explanation = await callOllama(prompt);

  console.log('================= DECODED SNAP PROJECT =================\n');
  console.log(explanation);
  console.log('\n========================================================\n');

  return explanation;
}

// CLI entrypoint: `node snapDecoder.js project1.xml`
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const [, , xmlPath] = process.argv;

    if (!xmlPath) {
      console.error('Usage: node snapDecoder.js path/to/project.xml');
      process.exit(1);
    }

    try {
      await decodeSnapProject(xmlPath);
    } catch (err) {
      console.error('Error while decoding Snap project:', err.message);
      process.exit(1);
    }
  })();
}
