import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const token = randomUUID();

  try {
    // Store magic link token with 15min TTL
    await redis.set(`magic:${token}`, JSON.stringify({ email: normalizedEmail }), { ex: 900 });

    const origin = `https://${req.headers.host}`;
    const verifyUrl = `${origin}/api/auth/verify?token=${token}`;

    await resend.emails.send({
      from: 'TimeCap <onboarding@resend.dev>',
      to: normalizedEmail,
      subject: 'Sign in to TimeCap',
      text: `Click this link to sign in to TimeCap:\n\n${verifyUrl}\n\nThis link expires in 15 minutes.`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 2rem; color: #333;">
          <p style="color: #888; font-size: 0.9rem; margin-bottom: 1.5rem;">Sign in to TimeCap</p>
          <a href="${verifyUrl}" style="display: inline-block; background: #1a1a2e; color: #c8b89a; text-decoration: none; padding: 0.8rem 2rem; font-family: Georgia, serif; font-size: 1rem; border: 1px solid rgba(200, 184, 154, 0.3);">
            Open TimeCap
          </a>
          <p style="color: #999; font-size: 0.8rem; margin-top: 2rem;">This link expires in 15 minutes.</p>
        </div>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Failed to send magic link:', err);
    return res.status(500).json({ error: 'Failed to send magic link. Please try again.' });
  }
}
