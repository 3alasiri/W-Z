"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };
const SUGGEST = ["ما الأصناف التي ستنفد هذا الأسبوع؟", "كم ربحت هذا الشهر وما أكثر الأصناف ربحًا؟", "ما المنتجات المعرضة للتلف وكيف أتصرف؟",
  "من العملاء الذين توقفوا عن الشراء؟", "متى أحتاج مندوبًا إضافيًا؟", "اقترح باقات عروض من المنتجات التي تُشترى معًا"];

export default function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text.trim() }];
    setMsgs([...next, { role: "assistant", content: "" }]); setQ(""); setBusy(true);
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }) });
      if (!res.ok || !res.body) { const t = await res.text(); setMsgs([...next, { role: "assistant", content: t || "تعذّر الحصول على إجابة." }]); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let acc = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; acc += dec.decode(value, { stream: true }); setMsgs([...next, { role: "assistant", content: acc }]); }
    } catch { setMsgs([...next, { role: "assistant", content: "انقطع الاتصال. حاول مرة أخرى." }]); }
    finally { setBusy(false); }
  }

  return (<>
    <div className="head"><div><h1>المساعد الذكي</h1><div className="sub">اسأل عن متجرك بالعربية. يجيب من بيانات المبيعات والمخزون والعملاء والحسابات الحالية.</div></div>
      {msgs.length > 0 && <button className="btn ghost sm" disabled={busy} onClick={() => setMsgs([])}>محادثة جديدة</button>}</div>
    <div className="card list" style={{ minHeight: 360 }}>
      {msgs.length === 0 && <div className="chips">{SUGGEST.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>}
      {msgs.map((m, i) => (
        <div key={i} style={{ alignSelf: m.role === "user" ? "flex-start" : "flex-end", maxWidth: "85%", whiteSpace: "pre-wrap", lineHeight: 1.8, padding: "10px 14px", borderRadius: 12,
          background: m.role === "user" ? "var(--brand)" : "var(--brand-soft)", color: m.role === "user" ? "var(--brand-ink)" : "var(--ink)" }}>
          {m.content || (busy && i === msgs.length - 1 ? "يحلل بيانات متجرك..." : "")}</div>))}
      <div ref={end} />
    </div>
    <form className="scan" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب سؤالك عن المتجر" aria-label="سؤالك" style={{ fontFamily: "inherit", letterSpacing: 0 }} />
      <button className="btn" disabled={busy || !q.trim()}>إرسال</button>
    </form>
  </>);
}
