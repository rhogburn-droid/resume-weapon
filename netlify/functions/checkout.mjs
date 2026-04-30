import Stripe from "stripe";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { plan, origin, email, embedded, priceVariant } = await req.json();

    let priceId;
    if (plan === "monthly") {
      priceId = process.env.STRIPE_PRICE_MONTHLY_USD || process.env.STRIPE_PRICE_MONTHLY;
    } else if (priceVariant === "b_499" && process.env.STRIPE_PRICE_SINGLE_499) {
      // A/B test: $4.99 variant
      priceId = process.env.STRIPE_PRICE_SINGLE_499;
    } else {
      // Default: $2.99
      priceId = process.env.STRIPE_PRICE_SINGLE_USD || process.env.STRIPE_PRICE_SINGLE;
    }

    if (!priceId) {
      return new Response(JSON.stringify({ error: "Price not configured" }), { status: 500 });
    }

    const baseUrl = origin || "https://atsresumechecker.io";
    const pubKey = process.env.STRIPE_PUBLISHABLE_KEY;

    const sessionParams = {
      line_items: [{ price: priceId, quantity: 1 }],
      mode: plan === "monthly" ? "subscription" : "payment",
      ...(email ? { customer_email: email } : {}),
    };

    // Embedded mode
    if (embedded && pubKey) {
      sessionParams.ui_mode = "embedded";
      sessionParams.return_url = `${baseUrl}/?paid=true&session_id={CHECKOUT_SESSION_ID}`;

      const session = await stripe.checkout.sessions.create(sessionParams);

      return new Response(JSON.stringify({
        clientSecret: session.client_secret,
        publishableKey: pubKey
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Redirect mode
    sessionParams.success_url = `${baseUrl}/?paid=true`;
    sessionParams.cancel_url = `${baseUrl}/?canceled=true`;

    const session = await stripe.checkout.sessions.create(sessionParams);

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
