import Stripe from "stripe";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { plan, origin, email, embedded } = await req.json();

    const priceId = plan === "monthly"
      ? (process.env.STRIPE_PRICE_MONTHLY_USD || process.env.STRIPE_PRICE_MONTHLY)
      : (process.env.STRIPE_PRICE_SINGLE_USD || process.env.STRIPE_PRICE_SINGLE);

    if (!priceId) {
      return new Response(JSON.stringify({ error: "Price not configured" }), { status: 500 });
    }

    const baseUrl = origin || "https://atsresumechecker.io";
    const pubKey = process.env.STRIPE_PUBLISHABLE_KEY;

    // Create ONE session only — either embedded or redirect, not both
    if (embedded && pubKey) {
      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: priceId, quantity: 1 }],
        mode: plan === "monthly" ? "subscription" : "payment",
        ui_mode: "embedded",
        return_url: `${baseUrl}/?paid=true&session_id={CHECKOUT_SESSION_ID}`,
        ...(email ? { customer_email: email } : {}),
      });

      return new Response(JSON.stringify({
        clientSecret: session.client_secret,
        publishableKey: pubKey
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Redirect mode
    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: priceId, quantity: 1 }],
      mode: plan === "monthly" ? "subscription" : "payment",
      success_url: `${baseUrl}/?paid=true`,
      cancel_url: `${baseUrl}/?canceled=true`,
      ...(email ? { customer_email: email } : {}),
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
