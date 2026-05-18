import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Domain used for Stripe success/cancel redirects.
// Set SITE_URL in Vercel env vars; falls back to the production domain.
const DOMAIN = process.env.SITE_URL || "https://www.getpropai.com";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { plan, email } = req.body;

  const planConfig = {
    plus:             { price: process.env.STRIPE_PLUS_PRICE || "price_12345", mode: "payment", credits: 100 }
  };

  const config = planConfig[plan];
  if (!config) {
    return res.status(400).json({ error: "Invalid plan" });
  }

  try {
    const sessionParams = {
      payment_method_types: ["card"],
      line_items: [{ price: config.price, quantity: 1 }],
      mode: config.mode,
      success_url: `${DOMAIN}/?success=1&plan=${plan}`,
      cancel_url: `${DOMAIN}/`,
      metadata: { plan, credits: String(config.credits) },
      allow_promotion_codes: true
    };

    if (email) sessionParams.customer_email = email;

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err.message);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
}
