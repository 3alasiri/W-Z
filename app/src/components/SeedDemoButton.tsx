"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

const STEPS = 16;

export default function SeedDemoButton({ storeId }: { storeId: string }) {
  const r = useRouter();
  const [step, setStep] = useState(-1);
  const [msg, setMsg] = useState("");
  async function run() {
    setMsg(""); let sales = 0;
    const sb = supabaseBrowser();
    for (let i = 0; i < STEPS; i++) {
      setStep(i);
      const { data, error } = await sb.rpc("seed_demo_step", { p_store: storeId, p_step: i });
      if (error) { setStep(-1); return setMsg(`توقفت التعبئة عند الخطوة ${i + 1}: ${error.message}`); }
      if (i > 0 && i < STEPS - 1) sales += Number(data);
    }
    setStep(-1);
    setMsg(`أُضيف 30 منتجًا بصورها الرسمية ومورّدان و8 عملاء و${sales.toLocaleString("ar-SA")} فاتورة لآخر 6 أسابيع.`); r.refresh();
  }
  const busy = step >= 0;
  return (
    <div className="list">
      <button className="btn" disabled={busy} onClick={run}>
        {busy ? `جارٍ التعبئة... ${Math.round((step / STEPS) * 100).toLocaleString("ar-SA")}٪` : "تعبئة المتجر ببيانات تجريبية"}</button>
      {busy && <div style={{ height: 6, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}><div style={{ height: "100%", width: `${(step / STEPS) * 100}%`, background: "var(--brand)" }} /></div>}
      {msg && <span className="muted">{msg}</span>}
    </div>
  );
}
