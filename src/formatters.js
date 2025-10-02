function sanitize(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }
  
  function truncate(text, max = 2000) {
    const s = String(text || '');
    return s.length <= max ? s : s.slice(0, max) + ' …';
  }
  
  export function formatContexts(chunks = []) {
    if (!Array.isArray(chunks) || chunks.length === 0) return '(no context found)';
    const joined = chunks.map((c, i) =>
      `#${i + 1}\n${sanitize(c?.text)}`
    ).join('\n\n');
    return truncate(joined, 2000);
  }
  
  export function formatExamples(examples = []) {
    // allow either string or array
    if (typeof examples === 'string') return truncate(sanitize(examples), 800);
    if (!Array.isArray(examples) || examples.length === 0) return 'None.';
    const joined = examples.map((ex, i) => {
      const q = sanitize(ex?.question);
      const a = sanitize(ex?.answer);
      if (!q || !a) return '';
      return `Example ${i + 1}\nQ: ${q}\nA: ${a}`;
    }).filter(Boolean).join('\n\n');
    return truncate(joined || 'None.', 800);
  }
  