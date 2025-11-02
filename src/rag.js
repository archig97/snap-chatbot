import 'dotenv/config';
import { loadJSON, cosine } from './utils.js';
import { PromptTemplate } from "@langchain/core/prompts";
import { formatContexts, formatExamples } from "./formatters.js";

const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const GEN_MODEL = process.env.GEN_MODEL || 'llama3.2:3b';
const TOP_K = parseInt(process.env.TOP_K || '3', 10);
const SIM_THRESHOLD = Number(process.env.SIM_THRESHOLD || '0.20');

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
      answer: `To make a sprite spin, think about **changing its direction continuously** or **turning by a small angle repeatedly**. The key idea is to run a loop that updates rotation over time.

\`\`\`snap-outline
Event - when green flag clicked
Control - [loop continuously OR repeat N times]
  Motion - [turn clockwise or anticlockwise by a small angle]
  Control - [wait briefly for smoothness]
\`\`\`

- Adjust the angle to control how fast it spins.  
- Use a repeat block instead of forever if you want a fixed number of rotations.  
- If you need easing or special patterns, think about **where you can vary the angle or timing inside the loop**.

Next hint: Which loop (forever or repeat) best fits the effect you want?`

    },
    {
      question: "What do I do to make my sprite move diagonally",
      answer: `Diagonal movement happens when you **change the sprite’s x and y positions at the same time**, or **point it diagonally and move**.

\`\`\`snap-outline
Event - when green flag clicked
Control - [loop continuously OR repeat N times]
  Motion - [change x by some amount]
  Motion - [change y by some amount]
  Control - [wait briefly to control speed]
\`\`\`

Alternatively, you can:
- **Point the sprite in a diagonal direction** (e.g., 45° for up-right)  
- **Use a loop to move forward** repeatedly.

Think about:
- The **ratio between x and y changes** to control the diagonal slope.  
- Choosing between a **forever loop** (continuous motion) or **repeat loop** (finite distance).

Next hint: Which approach — “manual x/y changes” or “point & move” — fits your goal better?`
    }
  ];

  const LOW_SOLUTION_SNAP = `
--- SOLUTION MODE: LOW (Snap) ---
Provide brief guidance only. Focus on concepts, block choices, and small hints.
Do NOT provide full scripts or full solutions.

Use **Snap block outline**:

- If Snap outline: wrap in \`\`\`snap-outline\`\`\` and list the exact blocks and wiring (e.g., When green flag clicked → set [var] to…, repeat until…, if…, change x by…, call custom block [Foo]).
- Keep any pseudocode/outline to a few lines (≤ 5).
- No complete implementations.
- End with one line: **Next hint:** <one gentle nudge for the very next step>.
`;

const OUTPUT_STYLE_STEPS_THEN_HINT = `
--- OUTPUT FORMAT (STRICT) ---
Return text in **exactly** this structure:

1. <first step>
2. <second step>
3. <third step>              // up to 5 steps total, omit extras

<blank line>
Next hint: <one short nudge for the very next step>

Rules:
- Use a **numbered list** (1., 2., 3., …) for steps — each on its own line.
- Keep steps high-level (low-solution). No full scripts or exact numbers.
- Always include exactly one "Next hint:" line.
- Do not add any headings or extra text before or after this format.
`;

const REQUIREMENT_BEGINNER = `

You are teaching a beginner in Snap. Be specific, friendly, and concrete.

Answer concisely and factually, using only information explicitly present in the provided context.
If the answer cannot be found in the context, reply exactly: "this is beyond my scope."
Do not invent, guess, or expand beyond the given material.
Use the examples as answer structure, not context material.

Structure the answer using section headers (not numbers), exactly like this format:

Prerequisite:
Start with any setup or prerequisite (e.g., “Make sure your sprite is selected and visible on the stage.”).

Condition (only if the query has the word "when"): 
Include this section *only if* the question or context clearly mentions or implies a trigger, event, or sensing condition  
(e.g., touching an edge, pressing a key, clicking a sprite, or detecting something).  
Describe what event causes the action, and where to find related blocks in plain English  
(e.g., “Look under the Sensing section to check when something happens,” or “Use a Control loop to keep checking.”).  
If no such condition applies, omit this section entirely.

Steps: 
Give 2–4 short, high-level steps that combine setup, action, and response.  
If needed, include sub-points as bullets for clarity.  
Keep the actions in general English (“move,” “turn,” “check,” “wait briefly”) rather than full Snap block names.

Improvement (optional): 
Add one optional improvement idea, such as refining motion, adjusting speed, or adding smoother transitions.

All doubts will not have all these steps - if the question does not require requisites or event sections, just keep it blank - need not put a filler.

Put a blank line here. (but do not mention in actual answer)
Next hint: Ask one short guiding question that helps the student discover the next step (e.g., “Which category has the loop that repeats an action forever?” or “What happens if you keep changing both x and y?”).
But the Next Hint should be directly related or the next step to question asked.

Avoid unnecessary explanations or entire implementations.
Avoid naming specific Snap block text unless it helps the student find where it is (e.g., saying “find a block labeled forever under Control” is fine, but do not give the entire script).`;

const REQUIREMENT_INTERMEDIATE = `
Answer concisely and factually, using only information explicitly present in the provided context.  
If the answer cannot be found in the context, reply exactly: "this is beyond my scope."  
Do not invent, guess, or expand beyond the given material.  
Use the examples as answer structure, not context material.

Assume the learner is already familiar with basic Snap concepts such as sprites, loops, and event blocks.

Structure your response in short, numbered steps or concise paragraphs:

1. Outline how to approach it using general block categories (e.g., Motion, Control, Looks), but do not provide a full implementation or exact numeric parameters.
2. Highlight any key relationships or logic (for example, how repeated position changes create motion, or how angles affect direction).
3. Include one “tuning” or “optimization” idea — something the learner can experiment with, such as adjusting timing, angles, or repetition for smoother behavior.

Avoid naming exact blocks unless necessary for clarity. Instead, describe actions (e.g., “adjust the sprite’s direction gradually” or “use a loop from the Control category to repeat small movements”).  
Avoid giving full scripts or solutions.
Add a blank line here.

At the end:
- Ask one **Next hint:** question that encourages the learner to extend or refine the solution (e.g., “Next hint: How could you make this motion faster or smoother?”).  
- Ask one **Reflect:** question that prompts deeper reasoning (e.g., “Reflect: Why does repeating small rotations lead to a circular path?”).

Keep the tone exploratory and supportive, guiding the learner to reason about *why* things work, not just *how* to do them.
`;

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

      {lowSolution}

      {outputStyle}

      {requirement}
      `;
      
        const prompt = new PromptTemplate({
          template,
          inputVariables: ["context", "formattedExamples", "question", "lowSolution", "outputStyle","requirement"],
        });
      
        return prompt.format({
          context: formatContexts(contexts),            
          formattedExamples: formatExamples(examples), 
          lowSolution : LOW_SOLUTION_SNAP,
          outputStyle : OUTPUT_STYLE_STEPS_THEN_HINT,
          requirement : REQUIREMENT_BEGINNER ,
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
  examples,
  lowSolution: LOW_SOLUTION_SNAP,
  outputStyle: OUTPUT_STYLE_STEPS_THEN_HINT,
  requirement: REQUIREMENT_BEGINNER 
});



const res = await fetch(`${OLLAMA}/api/generate`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
    model: GEN_MODEL,
    prompt: prompt,       // make sure this is the string from buildPrompt.format()
    stream: false,
    options: {
      num_predict: 220,
      temperature: 0.1,
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