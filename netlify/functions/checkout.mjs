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
      return new Response(JSON.stringify({ error: "Price not configured. Check env vars." }), { status: 500 });
    }

    const baseUrl = origin || "https://atsresumechecker.io";
    const pubKey = process.env.STRIPE_PUBLISHABLE_KEY;

    // Always create a redirect session as fallback
    const redirectParams = {
      line_items: [{ price: priceId, quantity: 1 }],
      mode: plan === "monthly" ? "subscription" : "payment",
      success_url: `${baseUrl}/?paid=true`,
      cancel_url: `${baseUrl}/?canceled=true`,
    };
    if (email) redirectParams.customer_email = email;

    // Try embedded mode first
    if (embedded && pubKey) {
      try {
        const embedParams = {
          line_items: [{ price: priceId, quantity: 1 }],
          mode: plan === "monthly" ? "subscription" : "payment",
          ui_mode: "embedded",
          return_url: `${baseUrl}/?paid=true&session_id={CHECKOUT_SESSION_ID}`,
        };
        if (email) embedParams.customer_email = email;

        const session = await stripe.checkout.sessions.create(embedParams);

        return new Response(JSON.stringify({
          clientSecret: session.client_secret,
          publishableKey: pubKey,
          mode: "embedded"
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } catch (embedErr) {
        // Embedded failed — fall through to redirect
        console.log("Embedded checkout failed:", embedErr.message);
      }
    }

    // Redirect mode (default or fallback)
    const session = await stripe.checkout.sessions.create(redirectParams);

    return new Response(JSON.stringify({ url: session.url, mode: "redirect" }), {
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
