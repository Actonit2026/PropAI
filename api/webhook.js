import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  "https://xogedcqykxdzmllmptks.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {

      // Payment completed — grant Plus
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription") break;
        const email = session.customer_details?.email || session.customer_email;
        if (email) {
          await setUserPlan(email, "plus", 100);
        }
        break;
      }

      // Subscription renewed — ensure Plus stays active
      case "invoice.paid": {
        const invoice = event.data.object;
        if (invoice.billing_reason === "subscription_cycle") {
          const customer = await stripe.customers.retrieve(invoice.customer);
          const email = customer.email;
          if (email) await setUserPlan(email, "plus", 100);
        }
        break;
      }

      // Subscription cancelled — revert to free
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const email = customer.email;
        if (email) await setUserPlan(email, "free", 50);
        break;
      }
    }
  } catch (err) {
    console.error("Webhook handler error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }

  res.status(200).json({ received: true });
}

async function setUserPlan(email, plan, proposals) {
  // Find user by email
  const { data: users, error: lookupErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .limit(1);

  if (lookupErr || !users?.length) {
    // Try auth.users as fallback
    const { data: authData } = await supabase.auth.admin.listUsers();
    const authUser = authData?.users?.find(u => u.email === email);
    if (!authUser) { console.error("No user found for email:", email); return; }

    await supabase.from("profiles").upsert({
      id: authUser.id,
      email,
      plan,
      credits: proposals
    });
    return;
  }

  await supabase.from("profiles").update({
    plan,
    credits: proposals
  }).eq("id", users[0].id);
}

// Read raw body for Stripe signature verification (Next.js)
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export const config = { api: { bodyParser: false } };
