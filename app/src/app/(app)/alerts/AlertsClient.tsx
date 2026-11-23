"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { num, expiryLabel } from "@/lib/format";

type A = { product_id: string; name: string; kind: string; severity: string; stock: number; expiry_date: string | null; batch_id: string | null; reorder_point: number | null };

export default function AlertsClient({ rows }: { rows: A[] }) {
  const r = useRouter();
  const [err, setErr] = useState("");
  const exp = rows.filter((a) => a.kind === "expired" || a.kind === "expiring").sort((a, b) => (a.expiry_date! < b.expiry_date! ? -1 : 1));
  const qty = rows.filter((a) => a.kind === "out" || a.kind === "low").sort((a) => (a.kind === "out" ? -1 : 1));

  async function waste(batch: string) {
    setErr("");
    const { error } = await supabaseBrowser().rpc("adjust_batch", { p_batch: batch, p_new_qty: 0, p_type: "waste", p_ref: "تالف: انتهاء صلاحية" });
    if (error) return setErr(error.message);
    r.refresh();
  }

  return (<>
    <div className="head"><div><h1>التنبيهات</h1><div className="sub">تُحسب نقطة إعادة الطلب من متوسط البيع اليومي لآخر 28 يومًا ومدة توريد المورد ومخزون الأمان.</div></div></div>
    {err && <div className="err">{err}</div>}
    <div className="grid g2">
      <div className="card"><h2>الصلاحية ({num(exp.length)})</h2><div className="list">
        {exp.map((a) => (
          <div key={a.batch_id} className={`row sev ${a.severity}`}>
            <div><div className="t">{a.name}</div><div className="s">{expiryLabel(a.expiry_date!)} · {a.expiry_date} · {num(a.stock)} قطعة</div></div>
            {a.kind === "expired" ? <button className="btn danger sm" onClick={() => waste(a.batch_id!)}>تسجيل تالف</button>
              : <span className="pill p-warn">اعرضه بخصم</span>}
          </div>))}
        {exp.length === 0 && <p className="muted">لا منتجات قريبة الانتهاء.</p>}
      </div></div>
      <div className="card"><h2>الكميات ({num(qty.length)})</h2><div className="list">
        {qty.map((a) => (
          <div key={a.product_id} className={`row sev ${a.severity}`}>
            <div><div className="t">{a.name}</div><div className="s">{a.kind === "out" ? "نفد من المخزون" : `متبقٍ ${num(a.stock)} · نقطة الطلب ${num(a.reorder_point)}`}</div></div>
            <span className={`pill ${a.kind === "out" ? "p-bad" : "p-warn"}`}>{a.kind === "out" ? "نفد" : "منخفض"}</span>
          </div>))}
        {qty.length === 0 && <p className="muted">كل الكميات فوق نقطة الطلب.</p>}
        <p className="muted" style={{ fontSize: 12 }}>أوامر الشراء التلقائية من الموردين تأتي في المرحلة 2.</p>
      </div></div>
    </div>
  </>);
}
