export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY not set" }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const { email } = await req.json();
    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ active: false, message: "Invalid email" }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const custResponse = await fetch("https://api.stripe.com/v1/customers?email=" + encodeURIComponent(email.trim().toLowerCase()) + "&limit=1", {
      headers: { "Authorization": "Bearer " + stripeKey }
    });
    const custData = await custResponse.json();

    if (!custData.data || !custData.data.length) {
      return new Response(JSON.stringify({ active: false, message: "No account found for this email. Check the email or subscribe below." }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const customerId = custData.data[0].id;

    const subResponse = await fetch("https://api.stripe.com/v1/subscriptions?customer=" + customerId + "&status=active&limit=1", {
      headers: { "Authorization": "Bearer " + stripeKey }
    });
    const subData = await subResponse.json();

    if (subData.data && subData.data.length > 0) {
      return new Response(JSON.stringify({ active: true, message: "Active subscription found. Welcome back!" }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const payResponse = await fetch("https://api.stripe.com/v1/payment_intents?customer=" + customerId + "&created[gte]=" + thirtyDaysAgo + "&limit=5", {
      headers: { "Authorization": "Bearer " + stripeKey }
    });
    const payData = await payResponse.json();

    const hasRecentPayment = payData.data && payData.data.some(p => p.status === "succeeded");
    if (hasRecentPayment) {
      return new Response(JSON.stringify({ active: true, message: "Recent purchase found. Access granted!" }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    return new Response(JSON.stringify({ active: false, message: "No active subscription found for this email. Your subscription may have expired." }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Check failed: " + err.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
};

export const config = { path: "/api/check-subscription" };
