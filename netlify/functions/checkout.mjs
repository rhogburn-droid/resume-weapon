export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return new Response(
      JSON.stringify({ error: "STRIPE_SECRET_KEY not set in Netlify environment variables." }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  try {
    const { plan, origin, isIndia } = await req.json();

    const priceId = isIndia
      ? (plan === "monthly"
          ? process.env.STRIPE_PRICE_MONTHLY_INR
          : process.env.STRIPE_PRICE_SINGLE_INR)
      : (plan === "monthly"
          ? process.env.STRIPE_PRICE_MONTHLY_USD
          : process.env.STRIPE_PRICE_SINGLE_USD);

    if (!priceId) {
      return new Response(
        JSON.stringify({
          error: `Stripe price ID not configured for plan: ${plan}, region: ${isIndia ? "IN" : "US"}`
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const mode = plan === "monthly" ? "subscription" : "payment";

    const params = new URLSearchParams();
    params.append("mode", mode);
    params.append("success_url", origin + "?paid=true&session_id={CHECKOUT_SESSION_ID}");
    params.append("cancel_url", origin + "?canceled=true");
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("allow_promotion_codes", "true");

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + stripeKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: session.error?.message || "Stripe error" }),
        {
          status: response.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Checkout error: " + err.message }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
};

export const config = {
  path: "/api/checkout",
};
