import { Redis } from '@upstash/redis';
import { parseUser } from '../_lib/auth.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = parseUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint is required' });
  }

  try {
    const existing = await redis.lrange(`user:${user.uid}:push`, 0, -1);
    for (const raw of existing) {
      const sub = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (sub.endpoint === endpoint) {
        await redis.lrem(`user:${user.uid}:push`, 1, typeof raw === 'string' ? raw : JSON.stringify(raw));
        break;
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Push unsubscribe error:', err);
    return res.status(500).json({ error: 'Failed to remove subscription' });
  }
}
