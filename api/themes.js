import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Embedded valence lexicon — positive > 0, negative < 0
const VALENCE = {
  good: 2, great: 3, excellent: 3, amazing: 3, wonderful: 3, love: 3, happy: 3,
  hope: 2, hopeful: 2, confident: 2, clear: 1, better: 1, best: 2, strong: 2,
  growth: 2, progress: 2, success: 2, trust: 2, connection: 2, joy: 3, peace: 2,
  safe: 1, sure: 1, positive: 2, opportunity: 2, possibility: 2, open: 1, ready: 1,
  bad: -2, terrible: -3, awful: -3, hate: -3, fear: -2, afraid: -2, worried: -2,
  worry: -2, anxious: -2, anxiety: -3, uncertain: -1, unsure: -1, lost: -2,
  confused: -2, stuck: -2, fail: -2, failure: -2, wrong: -2, broken: -2,
  doubt: -1, struggle: -2, difficult: -1, hard: -1, problem: -1, risk: -1,
  change: 0, need: 0, want: 1, think: 0, know: 0, believe: 1, feel: 0,
};

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','can','i','me','my',
  'we','us','our','you','your','it','its','this','that','these','those',
  'what','which','who','when','where','how','why','not','no','so','if',
  'about','up','out','as','by','from','into','through','more','very','just',
  'also','there','their','they','them','then','than','he','she','him','her',
  'am','now','some','all','one','two','any','each','most','other','own','same',
]);

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function extractKeywords(texts, topN = 8) {
  const freq = {};
  for (const text of texts) {
    const words = tokenize(text);
    const seen = new Set();
    for (const word of words) {
      if (!seen.has(word)) {
        freq[word] = (freq[word] || 0) + 1;
        seen.add(word);
      }
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

function scoreSentiment(texts) {
  let positive = 0, negative = 0, neutral = 0;
  for (const text of texts) {
    const words = tokenize(text);
    let score = 0;
    let scored = 0;
    for (const word of words) {
      if (word in VALENCE) {
        score += VALENCE[word];
        scored++;
      }
    }
    if (scored === 0 || score === 0) neutral++;
    else if (score > 0) positive++;
    else negative++;
  }
  const total = positive + negative + neutral || 1;
  return {
    positive: Math.round((positive / total) * 100),
    neutral: Math.round((neutral / total) * 100),
    negative: Math.round((negative / total) * 100),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, token } = req.query;
  if (!code || !token) {
    return res.status(400).json({ error: 'Session code and facilitator token required' });
  }

  const upperCode = code.toUpperCase();

  try {
    const session = await redis.hgetall(`session:${upperCode}`);
    if (!session || !session.code) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.facilitatorToken !== token) {
      return res.status(403).json({ error: 'Invalid facilitator token' });
    }

    const rawResponses = await redis.lrange(`session:${upperCode}:responses`, 0, -1);
    if (!rawResponses || rawResponses.length === 0) {
      return res.status(200).json({
        count: 0,
        sentiment: { positive: 0, neutral: 100, negative: 0 },
        themes: { q1: [], q2: [], q3: [] },
        responses: [],
      });
    }

    const responses = rawResponses.map((r) => {
      try { return typeof r === 'string' ? JSON.parse(r) : r; }
      catch { return null; }
    }).filter(Boolean);

    const q1texts = responses.map((r) => r.answers[0]).filter(Boolean);
    const q2texts = responses.map((r) => r.answers[1]).filter(Boolean);
    const q3texts = responses.map((r) => r.answers[2]).filter(Boolean);
    const allTexts = [...q1texts, ...q2texts, ...q3texts];

    return res.status(200).json({
      count: responses.length,
      sentiment: scoreSentiment(allTexts),
      themes: {
        q1: extractKeywords(q1texts),
        q2: extractKeywords(q2texts),
        q3: extractKeywords(q3texts),
      },
      // Individual responses for facilitator view
      responses: responses.map((r) => ({
        id: r.id,
        name: r.name || 'Anonymous',
        answers: r.answers,
        sealedAt: r.sealedAt,
      })),
    });
  } catch (err) {
    console.error('Themes error:', err);
    return res.status(500).json({ error: 'Failed to compute themes' });
  }
}
