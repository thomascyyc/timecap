import { Redis } from '@upstash/redis';
import { randomUUID } from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { answers, deliverAt, method, contact, interval } = req.body;

  // Validate answers array
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > 3) {
    return res.status(400).json({ error: 'Answers must be an array of 1-3 strings' });
  }

  for (const a of answers) {
    if (typeof a !== 'string' || a.trim().length === 0) {
      return res.status(400).json({ error: 'Each answer must be a non-empty string' });
    }
    if (a.length > 2000) {
      return res.status(400).json({ error: 'Answer text too long (max 2000 characters each)' });
    }
  }

  if (!deliverAt || typeof deliverAt !== 'number') {
    return res.status(400).json({ error: 'Delivery time is required' });
  }

  if (!method || !['email', 'sms'].includes(method)) {
    return res.status(400).json({ error: 'Method must be "email" or "sms"' });
  }

  if (!contact || typeof contact !== 'string') {
    return res.status(400).json({ error: 'Contact info is required' });
  }

  if (method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  if (method === 'sms' && !/^\+?[\d\s\-()]{10,}$/.test(contact)) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  if (!interval || typeof interval !== 'string') {
    return res.status(400).json({ error: 'Interval label is required' });
  }

  const id = randomUUID();
  const capsule = {
    id,
    answers: answers.map((a) => a.trim()),
    method,
    contact,
    deliverAt,
    interval,
    createdAt: Date.now(),
  };

  try {
    // Add to sorted set (score = deliverAt for range queries)
    await redis.zadd('capsules', { score: deliverAt, member: JSON.stringify(capsule) });

    // Also store individually with TTL (interval + 1 day buffer)
    const ttlSeconds = Math.ceil((deliverAt - Date.now()) / 1000) + 86400;
    await redis.set(`capsule:${id}`, JSON.stringify(capsule), { ex: ttlSeconds });

    return res.status(200).json({ success: true, id });
  } catch (err) {
    console.error('Failed to store capsule:', err);
    return res.status(500).json({ error: 'Failed to seal thoughts. Please try again.' });
  }
}
