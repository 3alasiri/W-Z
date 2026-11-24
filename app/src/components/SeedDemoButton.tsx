"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function SeedDemoButton({ storeId }: { storeId: string }) {
  const r = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  return (
    <div className="list">
      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true); setMsg("");
        const { data, error } = await supabaseBrowser().rpc("seed_demo_data", { p_store: storeId });
        setBusy(false);
        if (error) return setMsg(error.message);
        setMsg(`أُضيف 25 منتجًا و4 موردين و8 عملاء و${Number(data).toLocaleString("ar-SA")} فاتورة لآخر 6 أسابيع.`); r.refresh();
      }}>{busy ? "جارٍ التعبئة... (قد تستغرق نصف دقيقة)" : "تعبئة المتجر ببيانات تجريبية"}</button>
      {msg && <span className="muted">{msg}</span>}
    </div>
  );
}
