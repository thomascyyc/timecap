import { Redis } from '@upstash/redis';
import { randomUUID } from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const SESSION_TTL = 60 * 60 * 24; // 24 hours

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, participantToken, name, answers } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Session code required' });
  }

  if (!Array.isArray(answers) || answers.length !== 3) {
    return res.status(400).json({ error: 'Exactly 3 answers required' });
  }

  for (const a of answers) {
    if (typeof a !== 'string' || a.trim().length === 0) {
      return res.status(400).json({ error: 'Each answer must be a non-empty string' });
    }
    if (a.length > 2000) {
      return res.status(400).json({ error: 'Answer too long (max 2000 characters)' });
    }
  }

  const upperCode = code.toUpperCase();

  try {
    const session = await redis.hgetall(`session:${upperCode}`);
    if (!session || !session.code) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (session.status !== 'open') {
      return res.status(409).json({ error: 'Session is no longer accepting responses' });
    }

    const responseId = randomUUID();
    const response = {
      id: responseId,
      sessionCode: upperCode,
      participantToken: participantToken || randomUUID(),
      name: typeof name === 'string' ? name.trim().slice(0, 50) : '',
      answers: answers.map((a) => a.trim()),
      sealedAt: Date.now(),
    };

    await redis.rpush(`session:${upperCode}:responses`, JSON.stringify(response));
    await redis.expire(`session:${upperCode}:responses`, SESSION_TTL);

    return res.status(200).json({ success: true, id: responseId });
  } catch (err) {
    console.error('Workshop seal error:', err);
    return res.status(500).json({ error: 'Failed to seal response' });
  }
}
