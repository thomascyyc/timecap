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

  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid push subscription' });
  }

  try {
    // Check for duplicate by endpoint
    const existing = await redis.lrange(`user:${user.uid}:push`, 0, -1);
    const isDuplicate = existing.some((raw) => {
      const sub = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return sub.endpoint === subscription.endpoint;
    });

    if (!isDuplicate) {
      await redis.rpush(`user:${user.uid}:push`, JSON.stringify(subscription));
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Push subscribe error:', err);
    return res.status(500).json({ error: 'Failed to save subscription' });
  }
}
