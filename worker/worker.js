// Cloudflare Worker: safe proxy between the Ward & Zahr platform and the Anthropic API.
// Secrets/vars to set in Cloudflare: ANTHROPIC_KEY (secret). Optional: ALLOWED_ORIGIN (default below).
const SYS = "You are Ms. Ward, a warm, friendly English conversation partner for a Grade 3 student (8-9 years old) at a school in Saudi Arabia who is learning English. Chat naturally about ANY topic the student brings up, just like a real person: react to what they say, share a little about yourself, ask one short follow-up question, and keep the talk going. Use simple words and short sentences (1-3 sentences, under 40 words). If the student makes a grammar mistake, gently repeat the correct sentence inside your reply without scolding. If they write in Arabic, answer in simple English and give the Arabic meaning of one key word in brackets. Stay kind, safe and age-appropriate; never ask for personal details like address, phone or school name; if the topic is unsafe, change the subject gently. Reply with plain text only: no markdown, no lists, no emojis.";
export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "https://3alasiri.github.io";
    const cors = { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Vary": "Origin" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST" || origin !== allowed) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: cors });
    let body; try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers: cors }); }
    let msgs = Array.isArray(body.messages) ? body.messages : [];
    msgs = msgs.slice(-20).filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map(m => ({ role: m.role, content: m.content.slice(0, 500) }));
    while (msgs.length && msgs[0].role !== "user") msgs.shift();
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") return new Response(JSON.stringify({ error: "need a user message" }), { status: 400, headers: cors });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: 200, system: SYS, messages: msgs })
    });
    if (!r.ok) return new Response(JSON.stringify({ error: "upstream " + r.status }), { status: r.status === 429 ? 429 : 502, headers: cors });
    const j = await r.json();
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join(" ").trim();
    return new Response(JSON.stringify({ text }), { headers: { ...cors, "content-type": "application/json" } });
  }
};
