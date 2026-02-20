import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
import twilio from 'twilio';
import webpush from 'web-push';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const resend = new Resend(process.env.RESEND_API_KEY);

const twilioClient = process.env.TWILIO_ACCOUNT_SID
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:noreply@timecap.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

const QUESTIONS = [
  'What do you believe to be true right now?',
  'What are you most uncertain about?',
  'What would have to happen for that uncertainty to resolve?',
];

export default async function handler(req, res) {
  const now = Date.now();
  let delivered = 0;
  let errors = 0;

  try {
    // Get all due capsule IDs from the sorted set
    const dueCapsuleIds = await redis.zrangebyscore('capsules:due', 0, now);

    if (!dueCapsuleIds || dueCapsuleIds.length === 0) {
      return res.status(200).json({ delivered: 0, errors: 0, message: 'No capsules due' });
    }

    for (const capsuleId of dueCapsuleIds) {
      try {
        // Get capsule data
        const capsule = await redis.hgetall(`capsule:${capsuleId}`);
        if (!capsule) {
          await redis.zrem('capsules:due', capsuleId);
          continue;
        }

        // Get user data for contact info and preferences
        const userData = await redis.hgetall(`user:${capsule.uid}`);
        if (!userData) {
          console.error(`User ${capsule.uid} not found for capsule ${capsuleId}`);
          errors++;
          continue;
        }

        const answers = capsule.answers ? JSON.parse(capsule.answers) : [];
        const interval = capsule.interval;
        const capsuleData = { id: capsuleId, answers, interval };

        // Deliver via user's enabled channels
        if (userData.notifyEmail === 'true' && userData.email) {
          try {
            await sendEmail(userData.email, capsuleData);
          } catch (err) {
            console.error(`Email delivery failed for capsule ${capsuleId}:`, err);
          }
        }

        if (userData.notifySms === 'true' && userData.phone) {
          try {
            await sendSMS(userData.phone, capsuleData);
          } catch (err) {
            console.error(`SMS delivery failed for capsule ${capsuleId}:`, err);
          }
        }

        if (userData.notifyPush === 'true') {
          try {
            await sendPush(capsule.uid, capsuleData);
          } catch (err) {
            console.error(`Push delivery failed for capsule ${capsuleId}:`, err);
          }
        }

        // Update capsule status (don't delete — keep for history)
        await redis.hset(`capsule:${capsuleId}`, { status: 'delivered' });
        await redis.zrem('capsules:due', capsuleId);
        delivered++;
      } catch (err) {
        console.error(`Failed to deliver capsule ${capsuleId}:`, err);
        errors++;
      }
    }
  } catch (err) {
    console.error('Delivery cron error:', err);
    return res.status(500).json({ error: 'Delivery check failed' });
  }

  return res.status(200).json({ delivered, errors });
}

function formatAnswers(capsuleData) {
  return capsuleData.answers.map((a, i) => {
    const q = QUESTIONS[i] || `Question ${i + 1}`;
    return { question: q, answer: a };
  });
}

async function sendEmail(email, capsuleData) {
  const pairs = formatAnswers(capsuleData);

  const textBody = pairs
    .map((p) => `${p.question}\n"${p.answer}"`)
    .join('\n\n');

  const htmlBody = pairs
    .map(
      (p) => `
      <p style="color: #888; font-size: 0.85rem; margin-bottom: 0.25rem;">${p.question}</p>
      <blockquote style="font-size: 1.1rem; font-style: italic; color: #222; border-left: 2px solid #c8b89a; padding-left: 1rem; margin: 0 0 1.5rem 0;">
        ${p.answer}
      </blockquote>`
    )
    .join('');

  await resend.emails.send({
    from: 'TimeCap <onboarding@resend.dev>',
    to: email,
    subject: `Thoughts you sealed ${capsuleData.interval} ago`,
    text: `${capsuleData.interval} ago, you sealed these thoughts:\n\n${textBody}\n\n\u2014TimeCap`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 2rem; color: #333;">
        <p style="color: #888; font-size: 0.9rem; margin-bottom: 1.5rem;">${capsuleData.interval} ago, you sealed these thoughts:</p>
        ${htmlBody}
        <p style="color: #999; font-size: 0.85rem; margin-top: 2rem;">\u2014TimeCap</p>
      </div>
    `,
  });
}

async function sendSMS(phone, capsuleData) {
  if (!twilioClient) {
    throw new Error('Twilio not configured');
  }

  const pairs = formatAnswers(capsuleData);
  const body = pairs
    .map((p) => `"${p.answer}"`)
    .join(' \u2022 ');

  const normalizedPhone = phone.replace(/[\s\-()]/g, '');

  await twilioClient.messages.create({
    body: `TimeCap: ${capsuleData.interval} ago, you sealed: ${body}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: normalizedPhone,
  });
}

async function sendPush(uid, capsuleData) {
  const subscriptions = await redis.lrange(`user:${uid}:push`, 0, -1);
  if (!subscriptions || subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title: 'TimeCap',
    body: `Your thoughts from ${capsuleData.interval} ago have returned.`,
    capsuleId: capsuleData.id,
  });

  for (const raw of subscriptions) {
    const sub = typeof raw === 'string' ? JSON.parse(raw) : raw;
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expired — remove it
        await redis.lrem(`user:${uid}:push`, 1, typeof raw === 'string' ? raw : JSON.stringify(raw));
      }
    }
  }
}
