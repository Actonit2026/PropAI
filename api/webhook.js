import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLAN_CREDITS = { starter: 10, pro: 50, unlimited: -1, unlimited_annual: -1 };

async function kvSet(key, value) {
  await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
}

async function kvGet(key) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sig = req.headers["stripe-signature"];
  let rawBody = "";
  await new Promise((resolve) => {
    req.on("data", chunk => { rawBody += chunk; });
    req.on("end", resolve);
  });

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const email = session.customer_details?.email;
    const plan = session.metadata?.plan;

    if (email && plan) {
      const credits = PLAN_CREDITS[plan] ?? 10;
      const existing = (await kvGet(`user:${email}`)) || { credits: 0, plan: null };
      const newCredits = credits === -1 ? -1 : existing.credits + credits;

      await kvSet(`user:${email}`, {
        plan,
        credits: newCredits,
        purchasedAt: new Date().toISOString(),
        subscriptionId: session.subscription || null
      });

      console.log(`Granted ${credits === -1 ? "unlimited" : credits} credits to ${email} for plan ${plan}`);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    console.log("Subscription cancelled:", sub.id);
  }

  res.status(200).json({ received: true });
}
