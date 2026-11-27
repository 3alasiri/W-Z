"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num } from "@/lib/format";

export type A = { id: string; name: string; slug: string; district: string | null; city: string | null; is_active: boolean; accepting_orders: boolean;
  created_at: string; owner_email: string | null; members: number; products: number; sales_30d: number; invoices_30d: number; orders_30d: number; last_activity: string | null };

const date = (d: string | null) => d ? new Date(d).toLocaleDateString("ar-SA", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function AdminClient({ rows }: { rows: A[] }) {
  const r = useRouter();
  const [q, setQ] = useState(""); const [f, setF] = useState<"all" | "on" | "off">("all");
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const list = useMemo(() => rows.filter((s) => (f === "all" || (f === "on") === s.is_active)
    && (!q || [s.name, s.district, s.city, s.owner_email, s.slug].some((x) => x?.includes(q)))), [rows, q, f]);
  const k = {
    stores: rows.length, active: rows.filter((s) => s.is_active).length,
    sales: rows.reduce((a, s) => a + Number(s.sales_30d), 0), orders: rows.reduce((a, s) => a + Number(s.orders_30d), 0),
  };
  async function toggle(s: A) {
    if (s.is_active && !confirm(`إيقاف «${s.name}»؟ سيختفي من دليل البقالات ولن يستقبل طلبات أونلاين.`)) return;
    setBusy(s.id); setErr("");
    const { error } = await supabaseBrowser().rpc("admin_set_store_active", { p_store: s.id, p_active: !s.is_active });
    setBusy(""); if (error) setErr(error.message); else r.refresh();
  }
  return (
    <div className="page-plain"><div className="wrap" style={{ padding: "24px 16px" }}>
      <div className="head"><div><h1>إدارة المنصة</h1><div className="sub">كل البقالات المسجّلة في بقالتي الذكية</div></div>
        <div style={{ display: "flex", gap: 8 }}><Link href="/stores" className="btn ghost">دليل البقالات</Link><Link href="/" className="btn ghost">لوحة متجري</Link></div></div>
      <div className="grid g4">
        <div className="card kpi"><div className="l">البقالات المسجّلة</div><div className="v">{num(k.stores)}</div></div>
        <div className="card kpi"><div className="l">النشطة</div><div className="v">{num(k.active)}</div></div>
        <div className="card kpi"><div className="l">مبيعات نقاط البيع (30 يومًا)</div><div className="v">{SAR(k.sales)}</div></div>
        <div className="card kpi"><div className="l">طلبات أونلاين (30 يومًا)</div><div className="v">{num(k.orders)}</div></div>
      </div>
      <div className="card">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم أو الحي أو بريد المالك" aria-label="بحث" style={{ flex: 1, minWidth: 200 }} />
          <div className="seg" role="group" aria-label="الحالة">{([["all", "الكل"], ["on", "نشطة"], ["off", "موقوفة"]] as const).map(([v, t]) =>
            <button key={v} className={f === v ? "on" : ""} aria-pressed={f === v} onClick={() => setF(v)}>{t}</button>)}</div>
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="tbl"><table>
          <thead><tr><th>البقالة</th><th>المالك</th><th>الفريق</th><th>المنتجات</th><th>المبيعات 30 يومًا</th><th>الطلبات</th><th>آخر نشاط</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{list.map((s) => (
            <tr key={s.id}>
              <td><b>{s.name}</b><div className="muted" style={{ fontSize: 12 }}>{[s.district, s.city].filter(Boolean).join("، ") || "—"} · <span dir="ltr">/{s.slug}</span></div></td>
              <td dir="ltr" style={{ fontSize: 12 }}>{s.owner_email ?? "—"}</td>
              <td>{num(s.members)}</td><td>{num(s.products)}</td>
              <td>{SAR(s.sales_30d)}<div className="muted" style={{ fontSize: 12 }}>{num(s.invoices_30d)} فاتورة</div></td>
              <td>{num(s.orders_30d)}</td><td>{date(s.last_activity)}</td>
              <td><span className={`pill ${s.is_active ? "p-ok" : "p-bad"}`}>{s.is_active ? "نشطة" : "موقوفة"}</span></td>
              <td><button className={`btn sm ${s.is_active ? "ghost" : ""}`} disabled={busy === s.id} onClick={() => toggle(s)}>{s.is_active ? "إيقاف" : "تفعيل"}</button></td>
            </tr>))}</tbody>
        </table></div>
        {!list.length && <p className="muted">لا نتائج.</p>}
      </div>
    </div></div>
  );
}
