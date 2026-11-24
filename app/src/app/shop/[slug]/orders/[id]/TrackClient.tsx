"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num, PAY } from "@/lib/format";

type O = { id: string; number: number; status: string; fulfillment: string; payment_method: string; items_total: number; delivery_fee: number; total: number; created_at: string; cancel_reason: string | null;
  order_items: { name: string; qty: number; ordered_qty: number; unit_price: number }[] };
type T = { status: string; driver_lat: number | null; driver_lng: number | null; driver_at: string | null; km: number | null };

const STEPS = ["new", "preparing", "ready", "out_for_delivery", "delivered"];
const TXT: Record<string, string> = { new: "استلمنا طلبك", preparing: "نجهّز طلبك الآن", ready: "طلبك جاهز", out_for_delivery: "المندوب في الطريق إليك", delivered: "تم التسليم. بالعافية!", cancelled: "أُلغي الطلب" };

export default function TrackClient({ slug, o, storePhone }: { slug: string; o: O; storePhone: string | null }) {
  const r = useRouter(); const sb = supabaseBrowser();
  const [t, setT] = useState<T | null>(null); const [err, setErr] = useState("");
  useEffect(() => {
    const ch = sb.channel(`order-${o.id}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${o.id}` }, () => r.refresh()).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [o.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (o.status !== "out_for_delivery") return;
    const load = () => sb.rpc("order_tracking", { p_order: o.id }).then(({ data }) => data && setT(data));
    load(); const i = setInterval(load, 15000); return () => clearInterval(i);
  }, [o.status, o.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = o.fulfillment === "pickup" ? STEPS.filter((s) => s !== "out_for_delivery") : STEPS;
  const idx = steps.indexOf(o.status);
  const txt = o.fulfillment === "pickup" && o.status === "ready" ? "طلبك جاهز للاستلام من المتجر" : TXT[o.status];

  return (<>
    <header className="shop-top"><div className="in"><h1>طلب #{num(o.number)}</h1><Link href={`/shop/${slug}/orders`}>طلباتي</Link></div></header>
    <div className="shop" style={{ marginTop: 14 }}>
      <div className="card list">
        <h2 style={{ margin: 0 }}>{txt}</h2>
        {o.status !== "cancelled" && <div className="steps">{steps.map((s, i) => <span key={s} className={i <= idx ? "on" : ""} />)}</div>}
        {o.status === "cancelled" && o.cancel_reason && <div className="muted">{o.cancel_reason}</div>}
        {o.status === "out_for_delivery" && t?.driver_at && <div className="okmsg">
          {t.km != null ? `المندوب على بعد ${num(t.km)} كم تقريبًا` : "المندوب في الطريق"} · آخر تحديث {new Date(t.driver_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
          {t.driver_lat != null && <> · <a href={`https://www.google.com/maps?q=${t.driver_lat},${t.driver_lng}`} target="_blank" rel="noreferrer">عرض على الخريطة</a></>}</div>}
        <div className="muted" style={{ fontSize: 12 }}>تتحدث هذه الصفحة تلقائيًا.</div>
      </div>
      <div className="card">
        {o.order_items.map((i, k) => <div className="total" key={k}><span>{i.name} × {num(i.qty)}{Number(i.qty) < Number(i.ordered_qty) && <span className="pill p-warn" style={{ marginInlineStart: 6 }}>{Number(i.qty) === 0 ? "غير متوفر" : `متوفر ${num(i.qty)} من ${num(i.ordered_qty)}`}</span>}</span><span>{SAR(Number(i.qty) * Number(i.unit_price))}</span></div>)}
        <div className="total"><span>التوصيل</span><span>{SAR(o.delivery_fee)}</span></div>
        <div className="total big"><span>الإجمالي · {PAY[o.payment_method]} عند الاستلام</span><span>{SAR(o.total)}</span></div>
      </div>
      {err && <div className="err">{err}</div>}
      {o.status === "new" && <button className="btn ghost" onClick={async () => { const { error } = await sb.rpc("cancel_my_order", { p_order: o.id }); if (error) setErr(error.message); else r.refresh(); }}>إلغاء الطلب</button>}
      {storePhone && <div className="muted">للاستفسار: <span dir="ltr">{storePhone}</span></div>}
    </div>
  </>);
}
