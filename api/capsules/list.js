import { Redis } from '@upstash/redis';
import { parseUser } from '../_lib/auth.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = parseUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const status = req.query.status || 'all';

  try {
    // Get all capsule IDs for this user (sorted by createdAt desc)
    const capsuleIds = await redis.zrange(`user:${user.uid}:capsules`, 0, -1, { rev: true });

    if (!capsuleIds || capsuleIds.length === 0) {
      return res.status(200).json({ capsules: [] });
    }

    // Pipeline HGETALL for each capsule
    const pipeline = redis.pipeline();
    for (const id of capsuleIds) {
      pipeline.hgetall(`capsule:${id}`);
    }
    const results = await pipeline.exec();

    const capsules = [];
    for (let i = 0; i < capsuleIds.length; i++) {
      const data = results[i];
      if (!data) continue;

      const capsule = {
        id: capsuleIds[i],
        answers: data.answers ? JSON.parse(data.answers) : [],
        deliverAt: Number(data.deliverAt),
        interval: data.interval,
        createdAt: Number(data.createdAt),
        status: data.status || 'pending',
        returnAnswers: data.returnAnswers ? JSON.parse(data.returnAnswers) : [],
      };

      if (status === 'all' || capsule.status === status) {
        capsules.push(capsule);
      }
    }

    return res.status(200).json({ capsules });
  } catch (err) {
    console.error('Failed to list capsules:', err);
    return res.status(500).json({ error: 'Failed to fetch capsules' });
  }
}
