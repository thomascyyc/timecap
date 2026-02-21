import { Redis } from '@upstash/redis';
import { randomUUID } from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I or O
const CODE_LENGTH = 6;
const SESSION_TTL = 60 * 60 * 24; // 24 hours

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Generate a unique code (retry if collision)
  let code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateCode();
    const existing = await redis.hget(`session:${candidate}`, 'code');
    if (!existing) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    return res.status(500).json({ error: 'Failed to generate unique session code' });
  }

  const facilitatorToken = randomUUID();
  const session = {
    code,
    facilitatorToken,
    status: 'open',
    createdAt: Date.now(),
  };

  try {
    await redis.hset(`session:${code}`, session);
    await redis.expire(`session:${code}`, SESSION_TTL);
    return res.status(200).json({ code, facilitatorToken });
  } catch (err) {
    console.error('Failed to create session:', err);
    return res.status(500).json({ error: 'Failed to create session' });
  }
}
