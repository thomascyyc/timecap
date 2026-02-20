import { Redis } from '@upstash/redis';
import { parseUser } from '../_lib/auth.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  const user = parseUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Capsule ID required' });
  }

  try {
    const data = await redis.hgetall(`capsule:${id}`);
    if (!data || data.uid !== user.uid) {
      return res.status(404).json({ error: 'Capsule not found' });
    }

    if (req.method === 'GET') {
      return res.status(200).json({
        id,
        answers: data.answers ? JSON.parse(data.answers) : [],
        deliverAt: Number(data.deliverAt),
        interval: data.interval,
        createdAt: Number(data.createdAt),
        status: data.status || 'pending',
        returnAnswers: data.returnAnswers ? JSON.parse(data.returnAnswers) : [],
      });
    }

    if (req.method === 'PATCH') {
      const { returnAnswers } = req.body;

      if (!Array.isArray(returnAnswers)) {
        return res.status(400).json({ error: 'returnAnswers must be an array' });
      }

      await redis.hset(`capsule:${id}`, {
        returnAnswers: JSON.stringify(returnAnswers),
        status: 'returned',
      });

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Capsule endpoint error:', err);
    return res.status(500).json({ error: 'Failed to process capsule' });
  }
}
