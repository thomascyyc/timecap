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

function formatAnswers(capsule) {
  // Handle both old (belief) and new (answers) format
  const answers = capsule.answers || (capsule.belief ? [capsule.belief] : []);
  return answers.map((a, i) => {
    const q = QUESTIONS[i] || `Question ${i + 1}`;
    return { question: q, answer: a };
  });
}

async function sendEmail(capsule) {
  const pairs = formatAnswers(capsule);

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
    to: capsule.contact,
    subject: `Thoughts you sealed ${capsule.interval} ago`,
    text: `${capsule.interval} ago, you sealed these thoughts:\n\n${textBody}\n\n\u2014TimeCap`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 2rem; color: #333;">
        <p style="color: #888; font-size: 0.9rem; margin-bottom: 1.5rem;">${capsule.interval} ago, you sealed these thoughts:</p>
        ${htmlBody}
        <p style="color: #999; font-size: 0.85rem; margin-top: 2rem;">\u2014TimeCap</p>
      </div>
    `,
  });
}

async function sendSMS(capsule) {
  if (!twilioClient) {
    throw new Error('Twilio not configured');
  }

  const pairs = formatAnswers(capsule);
  const body = pairs
    .map((p) => `"${p.answer}"`)
    .join(' \u2022 ');

  // Normalize phone number — strip spaces, dashes, parens
  const phone = capsule.contact.replace(/[\s\-()]/g, '');

  await twilioClient.messages.create({
    body: `TimeCap: ${capsule.interval} ago, you sealed: ${body}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: phone,
  });
}
