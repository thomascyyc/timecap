import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
import twilio from 'twilio';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const resend = new Resend(process.env.RESEND_API_KEY);

const twilioClient = process.env.TWILIO_ACCOUNT_SID
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

export default async function handler(req, res) {
  const now = Date.now();
  let delivered = 0;
  let errors = 0;

  try {
    // Get all capsules with deliverAt <= now
    const dueCapsules = await redis.zrangebyscore('capsules', 0, now);

    if (!dueCapsules || dueCapsules.length === 0) {
      return res.status(200).json({ delivered: 0, errors: 0, message: 'No capsules due' });
    }

    for (const raw of dueCapsules) {
      let capsule;
      try {
        capsule = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        console.error('Failed to parse capsule:', raw);
        errors++;
        continue;
      }

      try {
        if (capsule.method === 'email') {
          await sendEmail(capsule);
        } else if (capsule.method === 'sms') {
          await sendSMS(capsule);
        }

        // Remove from sorted set and delete individual key
        await redis.zrem('capsules', typeof raw === 'string' ? raw : JSON.stringify(raw));
        await redis.del(`capsule:${capsule.id}`);
        delivered++;
      } catch (err) {
        console.error(`Failed to deliver capsule ${capsule.id}:`, err);
        errors++;
      }
    }
  } catch (err) {
    console.error('Delivery cron error:', err);
    return res.status(500).json({ error: 'Delivery check failed' });
  }

  return res.status(200).json({ delivered, errors });
}

async function sendEmail(capsule) {
  await resend.emails.send({
    from: 'TimeCap <onboarding@resend.dev>',
    to: capsule.contact,
    subject: `A belief you sealed ${capsule.interval} ago`,
    text: `${capsule.interval} ago, you sealed this belief:\n\n"${capsule.belief}"\n\n—TimeCap`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 2rem; color: #333;">
        <p style="color: #888; font-size: 0.9rem;">${capsule.interval} ago, you sealed this belief:</p>
        <blockquote style="font-size: 1.2rem; font-style: italic; color: #222; border-left: 2px solid #c8b89a; padding-left: 1rem; margin: 1.5rem 0;">
          ${capsule.belief}
        </blockquote>
        <p style="color: #999; font-size: 0.85rem; margin-top: 2rem;">—TimeCap</p>
      </div>
    `,
  });
}

async function sendSMS(capsule) {
  if (!twilioClient) {
    throw new Error('Twilio not configured');
  }

  // Normalize phone number — strip spaces, dashes, parens
  const phone = capsule.contact.replace(/[\s\-()]/g, '');

  await twilioClient.messages.create({
    body: `TimeCap: ${capsule.interval} ago, you sealed this belief: "${capsule.belief}"`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: phone,
  });
}
