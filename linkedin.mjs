// Netlify function: attempts to fetch a public LinkedIn profile
// and extract structured data from JSON-LD, meta tags, and page content.
//
// DISCLAIMER: This may violate LinkedIn's TOS. It will break
// periodically as LinkedIn changes their page structure.
// Use at your own risk.

export default async (req) => {
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
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { url } = await req.json();

    if (!url || !url.includes("linkedin.com/in/")) {
      return Response.json(
        { error: "Please provide a valid LinkedIn profile URL (linkedin.com/in/username)" },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Normalize the URL
    let profileUrl = url.trim();
    if (!profileUrl.startsWith("http")) profileUrl = "https://" + profileUrl;
    // Remove trailing slashes and query params
    profileUrl = profileUrl.split("?")[0].replace(/\/+$/, "");

    // Fetch with browser-like headers
    const response = await fetch(profileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return Response.json(
        { error: `LinkedIn returned ${response.status}. Profile may be private or LinkedIn is blocking the request.` },
        { status: 502, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const html = await response.text();
    const profile = {};

    // 1. Extract JSON-LD structured data (most reliable when present)
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        try {
          const jsonStr = match.replace(/<script type="application\/ld\+json">/i, "").replace(/<\/script>/i, "");
          const data = JSON.parse(jsonStr);
          if (data["@type"] === "Person" || data["@type"]?.includes("Person")) {
            profile.jsonLd = data;
            profile.name = data.name || "";
            profile.jobTitle = data.jobTitle || "";
            profile.description = data.description || "";
            profile.url = data.url || profileUrl;
            if (data.worksFor) {
              profile.company = typeof data.worksFor === "string" ? data.worksFor : data.worksFor.name || "";
            }
            if (data.alumniOf) {
              profile.education = Array.isArray(data.alumniOf)
                ? data.alumniOf.map(a => typeof a === "string" ? a : a.name || "").filter(Boolean)
                : [typeof data.alumniOf === "string" ? data.alumniOf : data.alumniOf.name || ""];
            }
            if (data.knowsAbout) {
              profile.skills = Array.isArray(data.knowsAbout) ? data.knowsAbout : [data.knowsAbout];
            }
          }
        } catch (e) { /* JSON parse failed, skip */ }
      }
    }

    // 2. Extract Open Graph / meta tag data
    const ogTitle = html.match(/<meta property="og:title" content="([^"]*?)"/i)?.[1] || "";
    const ogDesc = html.match(/<meta property="og:description" content="([^"]*?)"/i)?.[1] || "";
    const metaDesc = html.match(/<meta name="description" content="([^"]*?)"/i)?.[1] || "";
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "";

    if (!profile.name && ogTitle) profile.name = ogTitle.split(" - ")[0].split(" | ")[0].trim();
    if (!profile.description && ogDesc) profile.description = ogDesc;
    if (!profile.description && metaDesc) profile.description = metaDesc;
    profile.pageTitle = title.replace(/\s+/g, " ").trim();

    // 3. Try to extract visible text sections
    // Remove scripts and styles first
    let cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    // Extract meaningful text chunks (sentences > 30 chars that aren't UI noise)
    const noisePatterns = /sign in|sign up|join now|log in|cookie|privacy|terms of service|skip to|navigation|linkedin corporation/i;
    const meaningfulChunks = cleanHtml
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 30 && !noisePatterns.test(s))
      .slice(0, 50); // Cap at 50 chunks

    profile.extractedText = meaningfulChunks.join(". ");

    // 4. Compile into a formatted text summary
    let summary = "";
    if (profile.name) summary += `Name: ${profile.name}\n`;
    if (profile.jobTitle) summary += `Title: ${profile.jobTitle}\n`;
    if (profile.company) summary += `Company: ${profile.company}\n`;
    if (profile.description) summary += `\nSummary: ${profile.description}\n`;
    if (profile.education?.length) summary += `\nEducation: ${profile.education.join(", ")}\n`;
    if (profile.skills?.length) summary += `\nSkills: ${profile.skills.join(", ")}\n`;
    if (profile.extractedText) summary += `\nExtracted Profile Content:\n${profile.extractedText}\n`;

    const success = !!(profile.name || profile.description || profile.extractedText);

    return Response.json({
      success,
      summary: summary.trim() || "Could not extract profile data. LinkedIn may be blocking the request. Try the 'Save as PDF' method instead.",
      profile,
      hint: success
        ? "Data extracted. Review and edit as needed — some content may be incomplete."
        : "LinkedIn blocked this request. Go to your LinkedIn profile → More button → Save to PDF → upload that PDF to the file upload zone instead."
    }, {
      headers: { "Access-Control-Allow-Origin": "*" }
    });

  } catch (err) {
    return Response.json(
      { error: `Scrape failed: ${err.message}` },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
};

export const config = {
  path: "/api/linkedin",
};
