import { Redis } from '@upstash/redis';
import { parseUser } from '../_lib/auth.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = parseUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { notifyEmail, notifySms, notifyPush, phone } = req.body;
  const updates = {};

  if (typeof notifyEmail === 'boolean') updates.notifyEmail = String(notifyEmail);
  if (typeof notifySms === 'boolean') updates.notifySms = String(notifySms);
  if (typeof notifyPush === 'boolean') updates.notifyPush = String(notifyPush);
  if (typeof phone === 'string') updates.phone = phone.trim();

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    await redis.hset(`user:${user.uid}`, updates);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Preferences update error:', err);
    return res.status(500).json({ error: 'Failed to update preferences' });
  }
}
