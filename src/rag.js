import 'dotenv/config';
import { loadJSON, cosine } from './utils.js';
import { PromptTemplate } from "@langchain/core/prompts";
import { formatContexts, formatExamples } from "./formatters.js";

const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const GEN_MODEL = process.env.GEN_MODEL || 'llama3.2:3b';
const TOP_K = parseInt(process.env.TOP_K || '5', 10);
const SIM_THRESHOLD = Number(process.env.SIM_THRESHOLD || '0.10');

async function embed(text, embModel) {
const res = await fetch(`${OLLAMA}/api/embeddings`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ model: embModel, prompt: text })
});
if (!res.ok) throw new Error(`Embedding failed: ${res.status} ${res.statusText}`);
const json = await res.json();
return json.embedding;
}



const userExamples = [
    {
      question: "How do I create a spinning effect for my sprite?",
      answer: `Make the sprite rotate by repeatedly changing its direction (or using "turn" blocks) — here's a simple, testable script.

Assuming your sprite is “Sprite1” and rotationStyle is "all around", use one of these options:

Events > when green flag clicked
Control > forever
Motion > turn clockwise (15) degrees
Or for smoother rotation:

Events > when green flag clicked
Control > forever
Motion > turn clockwise (5) degrees
Control > wait (0.05) seconds
Or rotate a fixed amount then stop:

Events > when green flag clicked
Control > repeat (36)
Motion > turn clockwise (10) degrees
Control > wait (0.05) seconds
Try it! If you want easing, continuous smooth speed, or anti-clockwise spin, say which and I’ll show the exact blocks.`

    },
    {
      question: "What do I do to make my sprite move diagonally",
      answer: `Move the sprite by changing both x and y together — that makes diagonal motion.

Assuming your sprite is “Sprite1” and rotationStyle is "all around", try one of these:

To move continuously down-right:

Events > when green flag clicked
Control > forever
Motion > change x by (5)
Motion > change y by (-5)
Control > wait (0.02) seconds
To move a set distance diagonally (then stop):

Events > when green flag clicked
Control > repeat (20)
Motion > change x by (5)
Motion > change y by (-5)
Control > wait (0.02) seconds
To move diagonally using direction and move:

Events > when green flag clicked
Motion > point in direction (45) (45 = up-right; 135 = up-left; -45 or 315 = down-right)
Control > forever
Motion > move (5) steps
Control > wait (0.02) seconds
Try one and tweak the numbers (x/y change, steps, or wait) for speed and direction. You’ve got this!`
    }
  ];

function topKByCosine(index, queryVec, k, threshold) {
    const scored = index.chunks.map(c => ({ ...c, score: cosine(queryVec, c.embedding) }))
    .sort((a, b) => b.score - a.score);
    const filtered = scored.filter(s => s.score >= threshold);
    return (filtered.length ? filtered : scored).slice(0, k);
    }

    
      export async function buildPrompt(a, b, c) {
        // Support BOTH styles:
        //   buildPrompt(question, contexts, examples)
        //   buildPrompt({ question, contexts, examples })
        let question = '', contexts = [], examples = [];
        if (a && typeof a === 'object' && (a.question !== undefined || a.contexts !== undefined || a.examples !== undefined)) {
          ({ question = '', contexts = [], examples = [] } = a);
        } else {
          question = a ?? '';
          contexts = b ?? [];
          examples = c ?? [];
        }
      
        const template = `
      You are an expert teaching assistant for Snap (a block-based programming language similar to Scratch).
      Your task is to answer only using the provided context, which may include manuals, examples, or excerpts from Snap documentation.
      
      --- CONTEXT (Manual/Notes) ---
      {context}
      --- EXAMPLES (Answer Style) ---
      {formattedExamples}
      --- USER QUESTION ---
      {question}
      --- REQUIREMENTS ---
      Answer concisely and factually, using only information explicitly present in the provided context.
      If the answer cannot be found in the context, reply exactly: "this is beyond my scope."
      Do not invent, guess, or expand beyond the given material.
      Use the examples as answer structure, not context material.
      Structure answers in clear sentences or short, numbered steps if instructional.
      Avoid unnecessary explanations.
      Instead of entire answer, take out the last line of the answer and ask the student how that step can be accomplished.
      But add a line of encouragement for the student at the end.
      Now generate the answer:
      `;
      
        const prompt = new PromptTemplate({
          template,
          inputVariables: ["context", "formattedExamples", "question"],
        });
      
        return prompt.format({
          context: formatContexts(contexts),            // always a string
          formattedExamples: formatExamples(examples),  // always a string
          question: String(question ?? ''),
        });
      }

      
   
    /*
    function buildPrompt(question, contexts) {
    const header = [
    'You are a helpful assistant that answers **only** using the context provided.',
    'If the answer is not explicitly supported by the context, reply exactly: "this is beyond my scope."',
    'Be concise and factual. Do not invent information.'
    ].join('\n');
    
    const contextBlock = contexts.map((c, i) => `<<chunk ${i + 1} (score=${c.score.toFixed(2)})>>\n${c.text}`).join('\n\n');
    
    return `${header}\n\nContext:\n${contextBlock}\n\nQuestion: ${question}\nAnswer:`;
    }*/
    
    export async function answerQuestion(question) {
    const index = await loadJSON('data/index.json');
    if (!index || !index.chunks?.length) {
    return { text: 'this is beyond my scope.' };
    }

    const qVec = await embed(question, index.embModel);
const hits = topKByCosine(index, qVec, TOP_K, SIM_THRESHOLD) || [];

// extra guardrail: if best similarity is very low, short-circuit
if (!hits.length || hits[0].score < SIM_THRESHOLD) {
return { text: 'this is beyond my scope.' };
}


const examples = userExamples || [];     // [] is fine

const prompt = await buildPrompt({
  question: question ?? '',
  contexts: hits,
  examples
});



const res = await fetch(`${OLLAMA}/api/generate`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
    model: GEN_MODEL,
    prompt: prompt,       // make sure this is the string from buildPrompt.format()
    stream: false,
    options: {
      temperature: 0.2,
      stop: ['\n---', '\n# Example', '\n--- REQUIREMENTS ---']
    }
  })
});
if (!res.ok) {
    // fail closed
    return { text: 'this is beyond my scope.' };
    }
    
    const json = await res.json();
    // normalize final text (ollama returns { response, done, ... })
    const out = (json.response || '').trim();
    
    // final guard: if LLM ignored instructions, enforce policy
    const safe = out && !/^\s*I\s+don\'t\s+have|^\s*As\s+an\s+AI|^\s*I\'m\s+not\s+sure/i.test(out)
    ? out
    : 'this is beyond my scope.';
    console.log(safe);
    // lightweight heuristic: if it mentions "based on my knowledge" or lacks context cues and top score barely passes threshold, still allow but it's okay.
    return { text: safe };
    }