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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Capsule ID required' });
  }

  try {
    const raw = await redis.get(`capsule:${id}`);
    if (!raw) {
      return res.status(404).json({ error: 'Capsule not found' });
    }

    const capsule = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (capsule.method === 'email') {
      await sendEmail(capsule);
    } else if (capsule.method === 'sms') {
      await sendSMS(capsule);
    }

    // Clean up from Redis
    await redis.zrem('capsules', JSON.stringify(capsule));
    await redis.del(`capsule:${id}`);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Immediate delivery error:', err);
    return res.status(500).json({ error: 'Delivery failed' });
  }
}

function formatAnswers(capsule) {
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

  const phone = capsule.contact.replace(/[\s\-()]/g, '');

  await twilioClient.messages.create({
    body: `TimeCap: ${capsule.interval} ago, you sealed: ${body}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: phone,
  });
}
