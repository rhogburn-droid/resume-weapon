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
      headers: { "Content-Type": "application/json" },
    });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not set in Netlify environment variables." }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
  try {
    const body = await req.json();
    const payload = {
      model: body.model || "claude-sonnet-4-20250514",
      max_tokens: Math.min(body.max_tokens || 4000, 8000),
      messages: body.messages || [],
      stream: true,
    };
    if (body.system) payload.system = body.system;

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const errData = await upstream.json().catch(() => ({ error: "Upstream error " + upstream.status }));
      return new Response(JSON.stringify(errData), {
        status: upstream.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Read the streamed SSE response, accumulate the text, and return a single
    // JSON object in the same shape the frontend already expects.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let stopReason = null;
    let usage = null;
    let model = payload.model;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "[DONE]") continue;
        try {
          const evt = JSON.parse(dataStr);
          if (evt.type === "content_block_delta" && evt.delta && evt.delta.text) {
            fullText += evt.delta.text;
          } else if (evt.type === "message_delta") {
            if (evt.delta && evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
            if (evt.usage) usage = evt.usage;
          } else if (evt.type === "message_start" && evt.message) {
            model = evt.message.model || model;
          } else if (evt.type === "error") {
            return new Response(JSON.stringify({ error: evt.error || "stream error" }), {
              status: 500,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
          }
        } catch (e) {
          // ignore parse errors on keep-alive lines
        }
      }
    }

    const result = {
      content: [{ type: "text", text: fullText }],
      stop_reason: stopReason,
      model: model,
      usage: usage,
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Server error: " + err.message }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
};
export const config = {
  path: "/api/generate",
};
