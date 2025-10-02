import 'dotenv/config';
import express from 'express';
import { answerQuestion } from './rag.js';
import { registerSnapXmlAnswerRoute } from './snap/xmlAnswerRoute.js';



const app = express();
app.use(express.json({ limit: '1mb' }));

registerSnapXmlAnswerRoute(app);

app.get('/', (_req, res) => {
res.json({ ok: true, service: 'rag-ollama-node', routes: ['POST /ask'] });
});

app.post('/ask', async (req, res) => {
try {
const question = String(req.body?.question || '').trim();
if (!question) return res.status(400).json({ error: 'Missing question' });

const result = await answerQuestion(question);
res.json({ answer: result.text });
} catch (e) {
console.error(e);
res.status(500).json({ answer: 'this is beyond my scope.' });
}
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
console.log(`RAG server listening on http://localhost:${PORT}`);
});