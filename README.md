# TimeCap

A belief time capsule. An alien crystal floats in a dark void. Click it, and it fractures apart to reveal a single question: *What do you believe to be true right now that you're not entirely sure of?*

Seal your answer for 5 seconds, 1 week, 1 month, or 1 year. When the time is up, it comes back to you.

**Live:** [timecap-flame.vercel.app](https://timecap-flame.vercel.app)

## How it works

1. Click the crystal — it shatters with a burst of light
2. Type a belief you're uncertain about
3. Choose when it should return: 5 seconds, 1 week, 1 month, or 1 year
4. For 5 seconds: the belief disappears, then re-appears on screen
5. For longer intervals: enter your email or phone number, seal it, and receive it back when the time is up

## Tech

- **Three.js** — irregular convex crystal with custom GLSL shaders (Fresnel rim glow, pulsing interior, per-face color shifting between ice blue, violet, and gold)
- **Vercel Serverless Functions** — `/api/capsules` stores entries, `/api/deliver` sends them when due
- **Upstash Redis** — sorted set storage with score = delivery timestamp
- **Resend** — email delivery
- **Twilio** — SMS delivery
- **localStorage fallback** — full flow works without a backend for local testing and prototyping

No build tools. No frameworks. Three files for the frontend (`index.html`, `main.js`, `style.css`), two serverless functions, one cron job.

## Local development

```
python3 -m http.server 8080
```

Open http://localhost:8080. The crystal, fracture animation, and 5-second reveal all work locally. Longer intervals store in localStorage and show as due on page reload.

To test a due capsule, seal one, then run in the browser console:

```js
let c = JSON.parse(localStorage.getItem('timecap_capsules'));
c[0].deliverAt = Date.now() - 1000;
localStorage.setItem('timecap_capsules', JSON.stringify(c));
location.reload();
```

## Production deployment

1. Deploy to Vercel: `vercel --prod`
2. Add environment variables in Vercel dashboard:

```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
RESEND_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

3. The daily cron job (`/api/deliver`, 8am UTC) sends any capsules that are due

## Project structure

```
timecap/
├── index.html        # Entry point, importmap for Three.js CDN
├── main.js           # Crystal, shaders, fracture, capsule flow
├── style.css         # Dark void aesthetic, warm serif typography
├── api/
│   ├── capsules.js   # POST — store a capsule
│   └── deliver.js    # GET — cron: send due capsules
├── vercel.json       # Cron schedule
└── package.json      # Upstash, Resend, Twilio
```
