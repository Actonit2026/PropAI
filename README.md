# PropAI

Freelance proposal generator that writes in your own voice. Paste a writing
sample, paste a job description, get a job-winning proposal in ~60 seconds.

This is the clean rebuild: marketing tab and dead code removed, only the code
that the live product actually runs.

## Stack

- Static HTML frontend (no framework, no build step)
- Vercel serverless / edge functions in `/api`
- Supabase for auth + proposal storage (loaded via CDN on the frontend)
- Upstash KV (Vercel KV) for free-tier rate limiting, keyed by IP
- Stripe for payments
- Anthropic API for generation

## Files

| Path                     | Purpose                                              |
|--------------------------|------------------------------------------------------|
| `index.html`             | Landing page + free generator (3 free / IP)          |
| `dashboard.html`         | Logged-in dashboard: generate, history, settings     |
| `login.html`             | Sign up / log in / request password reset            |
| `reset-password.html`    | Set a new password from a recovery link              |
| `api/generate.js`        | Edge function. Generates proposals/follow-ups/revisions. Free tier rate-limited via KV; paid path uses Sonnet |
| `api/checkout.js`        | Creates a Stripe Checkout session                    |
| `api/webhook.js`         | Stripe webhook: grants credits on payment            |
| `api/health.js`          | Health check at `/api/health`                        |
| `scripts/check-api.mjs`  | Pre-deploy guard: fails the build if any `api/*.js` is broken. Runs on `vercel-build` |

## Environment variables (set in Vercel)

```
ANTHROPIC_API_KEY            Anthropic API key
KV_REST_API_URL              Upstash / Vercel KV REST URL
KV_REST_API_TOKEN            Upstash / Vercel KV REST token
STRIPE_SECRET_KEY            Stripe secret key
STRIPE_WEBHOOK_SECRET        Stripe webhook signing secret
STRIPE_STARTER_PRICE         Stripe price ID - Starter (one-time)
STRIPE_PRO_PRICE             Stripe price ID - Pro (one-time)
STRIPE_UNLIMITED_PRICE       Stripe price ID - Unlimited (monthly sub)
STRIPE_UNLIMITED_ANNUAL_PRICE  Stripe price ID - Unlimited (annual sub)
SITE_URL                     Public site URL, e.g. https://www.getpropai.com
```

The Supabase URL and publishable key are intentionally inline in the HTML
(public anon key — safe to expose; protected by Row Level Security).

## Pricing

- Starter: €9 — 10 credits (never expire)
- Pro: €24 — 50 credits
- Unlimited: €35/month or €299/year
- Free trial: 3 proposals, no login required
