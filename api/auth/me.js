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

  try {
    const data = await redis.hgetall(`user:${user.uid}`);
    if (!data) {
      return res.status(401).json({ error: 'User not found' });
    }

    return res.status(200).json({
      uid: user.uid,
      email: data.email,
      notifyEmail: data.notifyEmail === 'true',
      notifySms: data.notifySms === 'true',
      notifyPush: data.notifyPush === 'true',
      phone: data.phone || '',
    });
  } catch (err) {
    console.error('Me endpoint error:', err);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
}
