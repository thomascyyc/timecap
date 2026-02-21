import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'Session code required' });
  }

  try {
    const session = await redis.hgetall(`session:${code.toUpperCase()}`);
    if (!session || !session.code) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const responses = await redis.lrange(`session:${code.toUpperCase()}:responses`, 0, -1);
    const sealedCount = responses.length;

    return res.status(200).json({
      code: session.code,
      status: session.status,
      createdAt: Number(session.createdAt),
      sealedCount,
    });
  } catch (err) {
    console.error('Failed to get session status:', err);
    return res.status(500).json({ error: 'Failed to get session status' });
  }
}
