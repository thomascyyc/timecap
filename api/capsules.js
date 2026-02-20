import { Redis } from '@upstash/redis';
import { randomUUID } from 'crypto';
import { parseUser } from './_lib/auth.js';

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

  const { answers, deliverAt, interval } = req.body;

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

  if (!interval || typeof interval !== 'string') {
    return res.status(400).json({ error: 'Interval label is required' });
  }

  const id = randomUUID();

  try {
    // Store capsule as Redis hash
    await redis.hset(`capsule:${id}`, {
      uid: user.uid,
      answers: JSON.stringify(answers.map((a) => a.trim())),
      deliverAt: String(deliverAt),
      interval,
      createdAt: String(Date.now()),
      status: 'pending',
      returnAnswers: '',
    });

    // Add to user's capsule set (score = createdAt for ordering)
    await redis.zadd(`user:${user.uid}:capsules`, { score: Date.now(), member: id });

    // Add to global due set (score = deliverAt for cron queries)
    await redis.zadd('capsules:due', { score: deliverAt, member: id });

    return res.status(200).json({ success: true, id });
  } catch (err) {
    console.error('Failed to store capsule:', err);
    return res.status(500).json({ error: 'Failed to seal thoughts. Please try again.' });
  }
}
