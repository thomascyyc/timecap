import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, facilitatorToken } = req.body;

  if (!code || !facilitatorToken) {
    return res.status(400).json({ error: 'Session code and facilitator token required' });
  }

  const upperCode = code.toUpperCase();

  try {
    const session = await redis.hgetall(`session:${upperCode}`);
    if (!session || !session.code) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.facilitatorToken !== facilitatorToken) {
      return res.status(403).json({ error: 'Invalid facilitator token' });
    }

    if (session.status === 'revealed') {
      return res.status(200).json({ success: true, alreadyRevealed: true });
    }

    await redis.hset(`session:${upperCode}`, { status: 'revealed', revealedAt: Date.now() });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reveal error:', err);
    return res.status(500).json({ error: 'Failed to trigger reveal' });
  }
}
