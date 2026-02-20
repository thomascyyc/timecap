import { Redis } from '@upstash/redis';
import { randomUUID } from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST to run migration' });
  }

  // Safety check — only run once
  const alreadyRun = await redis.exists('capsules:legacy');
  if (alreadyRun) {
    return res.status(200).json({ message: 'Migration already completed' });
  }

  const oldCapsules = await redis.zrange('capsules', 0, -1);
  if (!oldCapsules || oldCapsules.length === 0) {
    return res.status(200).json({ message: 'No capsules to migrate', migrated: 0 });
  }

  let migrated = 0;
  let errors = 0;
  const userMap = new Map(); // contact → uid

  for (const raw of oldCapsules) {
    try {
      const capsule = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const contact = capsule.contact;
      const method = capsule.method || 'email';

      if (!contact) {
        errors++;
        continue;
      }

      // Find or create user by contact
      let uid = userMap.get(contact);
      if (!uid) {
        // Check if user already exists by email
        if (method === 'email') {
          uid = await redis.get(`user:email:${contact.toLowerCase()}`);
        }

        if (!uid) {
          uid = randomUUID();
          const userData = {
            email: method === 'email' ? contact.toLowerCase() : '',
            createdAt: capsule.createdAt || Date.now(),
            notifyEmail: method === 'email' ? 'true' : 'false',
            notifySms: method === 'sms' ? 'true' : 'false',
            notifyPush: 'false',
            phone: method === 'sms' ? contact : '',
          };
          await redis.hset(`user:${uid}`, userData);
          if (method === 'email') {
            await redis.set(`user:email:${contact.toLowerCase()}`, uid);
          }
        }

        userMap.set(contact, uid);
      }

      // Create capsule in new format
      const capsuleId = capsule.id || randomUUID();
      const answers = capsule.answers || (capsule.belief ? [capsule.belief] : []);
      const deliverAt = capsule.deliverAt || Date.now();

      await redis.hset(`capsule:${capsuleId}`, {
        uid,
        answers: JSON.stringify(answers),
        deliverAt: String(deliverAt),
        interval: capsule.interval || 'unknown',
        createdAt: String(capsule.createdAt || Date.now()),
        status: deliverAt <= Date.now() ? 'delivered' : 'pending',
        returnAnswers: '',
      });

      await redis.zadd(`user:${uid}:capsules`, {
        score: capsule.createdAt || Date.now(),
        member: capsuleId,
      });

      if (deliverAt > Date.now()) {
        await redis.zadd('capsules:due', { score: deliverAt, member: capsuleId });
      }

      migrated++;
    } catch (err) {
      console.error('Migration error for capsule:', err);
      errors++;
    }
  }

  // Rename old sorted set to legacy
  await redis.rename('capsules', 'capsules:legacy');

  return res.status(200).json({ migrated, errors, users: userMap.size });
}
