import Stripe from "stripe";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { plan, origin, email, embedded } = await req.json();

    const priceId = plan === "monthly"
      ? process.env.STRIPE_PRICE_MONTHLY
      : process.env.STRIPE_PRICE_SINGLE;

    if (!priceId) {
      return new Response(JSON.stringify({ error: "Price not configured" }), { status: 500 });
    }

    const sessionParams = {
      line_items: [{ price: priceId, quantity: 1 }],
      mode: plan === "monthly" ? "subscription" : "payment",
    };

    if (email) {
      sessionParams.customer_email = email;
    }

    // Embedded mode — render checkout on page
    if (embedded) {
      sessionParams.ui_mode = "embedded";
      sessionParams.return_url = `${origin || "https://atsresumechecker.io"}/?paid=true`;
      sessionParams.automatic_tax = { enabled: false };

      const session = await stripe.checkout.sessions.create(sessionParams);

      return new Response(JSON.stringify({
        clientSecret: session.client_secret,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Redirect mode (fallback)
    sessionParams.success_url = `${origin || "https://atsresumechecker.io"}/?paid=true`;
    sessionParams.cancel_url = `${origin || "https://atsresumechecker.io"}/?canceled=true`;

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

