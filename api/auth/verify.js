import { Redis } from '@upstash/redis';
import { randomUUID } from 'crypto';
import { signToken, setAuthCookie } from '../_lib/auth.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send('Missing token');
  }

  try {
    const raw = await redis.get(`magic:${token}`);
    if (!raw) {
      return res.status(400).send('Invalid or expired link. Please request a new one.');
    }

    const { email } = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Delete token (single-use)
    await redis.del(`magic:${token}`);

    // Look up or create user
    let uid = await redis.get(`user:email:${email}`);

    if (!uid) {
      uid = randomUUID();
      await redis.set(`user:email:${email}`, uid);
      await redis.hset(`user:${uid}`, {
        email,
        createdAt: Date.now(),
        notifyEmail: 'true',
        notifySms: 'false',
        notifyPush: 'false',
        phone: '',
      });
    }

    // Sign JWT and set cookie
    const jwt = signToken(uid, email);
    setAuthCookie(res, jwt);

    // Redirect to home
    res.writeHead(302, { Location: '/' });
    res.end();
  } catch (err) {
    console.error('Verify error:', err);
    return res.status(500).send('Something went wrong. Please try again.');
  }
}
