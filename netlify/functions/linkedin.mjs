export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  try {
    const { url } = await req.json();
    if (!url || !url.includes("linkedin.com/in/")) {
      return new Response(JSON.stringify({ error: "Please provide a valid LinkedIn profile URL" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    let profileUrl = url.trim();
    if (!profileUrl.startsWith("http")) profileUrl = "https://" + profileUrl;
    profileUrl = profileUrl.split("?")[0].replace(/\/+$/, "");

    const response = await fetch(profileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache"
      },
      redirect: "follow"
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ success: false, hint: "LinkedIn returned " + response.status + ". Profile may be private or blocked." }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const html = await response.text();
    const profile = {};

    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        try {
          const jsonStr = match.replace(/<script type="application\/ld\+json">/i, "").replace(/<\/script>/i, "");
          const data = JSON.parse(jsonStr);
          if (data["@type"] === "Person" || (Array.isArray(data["@type"]) && data["@type"].includes("Person"))) {
            profile.name = data.name || "";
            profile.jobTitle = data.jobTitle || "";
            profile.description = data.description || "";
            if (data.worksFor) profile.company = typeof data.worksFor === "string" ? data.worksFor : data.worksFor.name || "";
            if (data.alumniOf) profile.education = (Array.isArray(data.alumniOf) ? data.alumniOf : [data.alumniOf]).map(a => typeof a === "string" ? a : a.name || "").filter(Boolean);
            if (data.knowsAbout) profile.skills = Array.isArray(data.knowsAbout) ? data.knowsAbout : [data.knowsAbout];
          }
        } catch (e) {}
      }
    }

    const ogTitle = (html.match(/<meta property="og:title" content="([^"]*?)"/i) || [])[1] || "";
    const ogDesc = (html.match(/<meta property="og:description" content="([^"]*?)"/i) || [])[1] || "";
    const metaDesc = (html.match(/<meta name="description" content="([^"]*?)"/i) || [])[1] || "";

    if (!profile.name && ogTitle) profile.name = ogTitle.split(" - ")[0].split(" | ")[0].trim();
    if (!profile.description && ogDesc) profile.description = ogDesc;
    if (!profile.description && metaDesc) profile.description = metaDesc;

    let cleanHtml = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
    const noisePatterns = /sign in|sign up|join now|log in|cookie|privacy|terms of service|skip to|navigation|linkedin corporation/i;
    const meaningfulChunks = cleanHtml.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 30 && !noisePatterns.test(s)).slice(0, 50);
    profile.extractedText = meaningfulChunks.join(". ");

    let summary = "";
    if (profile.name) summary += "Name: " + profile.name + "\n";
    if (profile.jobTitle) summary += "Title: " + profile.jobTitle + "\n";
    if (profile.company) summary += "Company: " + profile.company + "\n";
    if (profile.description) summary += "\nSummary: " + profile.description + "\n";
    if (profile.education && profile.education.length) summary += "\nEducation: " + profile.education.join(", ") + "\n";
    if (profile.skills && profile.skills.length) summary += "\nSkills: " + profile.skills.join(", ") + "\n";
    if (profile.extractedText) summary += "\nExtracted Content:\n" + profile.extractedText + "\n";

    const success = !!(profile.name || profile.description || profile.extractedText);
    return new Response(JSON.stringify({
      success,
      summary: summary.trim() || "Could not extract profile data.",
      hint: success ? "Data extracted. Review and edit as needed." : "LinkedIn blocked this request. Try pasting your profile info manually."
    }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Scrape failed: " + err.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
};

export const config = { path: "/api/linkedin" };
