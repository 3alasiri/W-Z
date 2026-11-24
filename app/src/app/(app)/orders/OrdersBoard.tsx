"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num, ORDER_STATUS } from "@/lib/format";

type O = { id: string; number: number; status: string; fulfillment: string; total: number; payment_method: string; address: string | null; created_at: string; driver_id: string | null; customers: { name: string; phone: string | null } };
const COLS = ["new", "preparing", "ready", "out_for_delivery"];

function beep() {
  try {
    const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(); o.stop(ctx.currentTime + 0.35);
  } catch {}
}

export default function OrdersBoard({ storeId, orders }: { storeId: string; orders: O[] }) {
  const r = useRouter();
  const known = useRef(new Set(orders.map((o) => o.id)));
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel("orders-board").on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` }, (p) => {
      const id = (p.new as { id?: string })?.id;
      if (p.eventType === "INSERT" && id && !known.current.has(id)) { known.current.add(id); beep(); }
      r.refresh();
    }).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [storeId, r]);

  const mins = (d: string) => Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  const done = orders.filter((o) => o.status === "delivered" || o.status === "cancelled");

  return (<>
    <div className="head"><div><h1>الطلبات الأونلاين</h1><div className="sub">تتحدث الصفحة تلقائيًا ويصدر تنبيه صوتي عند وصول طلب جديد.</div></div></div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(220px, 1fr))", gap: 12, overflowX: "auto" }}>
      {COLS.map((c) => { const list = orders.filter((o) => o.status === c); return (
        <div key={c} style={{ background: "var(--brand-soft)", borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 200 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>{ORDER_STATUS[c][0]}<span className="pill p-info">{num(list.length)}</span></div>
          {list.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="card" style={{ padding: 10, textDecoration: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><b>#{num(o.number)}</b><span>{SAR(o.total)}</span></div>
              <div>{o.customers?.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{o.fulfillment === "pickup" ? "استلام من المتجر" : o.address} · منذ {num(mins(o.created_at))} د</div>
              {c === "ready" && o.fulfillment === "delivery" && !o.driver_id && <span className="pill p-warn">بلا مندوب</span>}
            </Link>))}
        </div>); })}
    </div>
    <div className="card tbl"><h2>المغلقة آخر يومين</h2><table><thead><tr><th>رقم</th><th>العميل</th><th>الحالة</th><th>الإجمالي</th><th>الوقت</th></tr></thead>
      <tbody>{done.map((o) => <tr key={o.id}><td><Link href={`/orders/${o.id}`}>#{num(o.number)}</Link></td><td>{o.customers?.name}</td>
        <td><span className={`pill ${ORDER_STATUS[o.status][1]}`}>{ORDER_STATUS[o.status][0]}</span></td><td>{SAR(o.total)}</td>
        <td className="muted">{new Date(o.created_at).toLocaleString("ar-SA")}</td></tr>)}</tbody></table>
      {done.length === 0 && <p className="muted">لا طلبات مغلقة.</p>}
    </div>
  </>);
}
