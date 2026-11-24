"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num, PAY } from "@/lib/format";
import DeliveryMap from "@/components/DeliveryMap";

type O = { id: string; number: number; status: string; fulfillment: string; payment_method: string; payment_status: string; paid_amount: number | null; items_total: number; delivery_fee: number; total: number; created_at: string; cancel_reason: string | null;
  order_items: { name: string; qty: number; ordered_qty: number; unit_price: number }[] };
type T = { status: string; driver_lat: number | null; driver_lng: number | null; driver_at: string | null; km: number | null; store_lat: number | null; store_lng: number | null; dest_lat: number | null; dest_lng: number | null };

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
    const load = () => sb.rpc("order_tracking", { p_order: o.id }).then(({ data }) => data && setT(data));
    load();
    if (o.status !== "out_for_delivery") return;
    const i = setInterval(load, 15000); return () => clearInterval(i);
  }, [o.status, o.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [paying, setPaying] = useState(false);
  useEffect(() => {
    if (o.payment_status !== "pending") return;
    fetch("/api/pay/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.id }) })
      .then((x) => x.json()).then((j) => { if (j.status === "paid" || j.status === "failed") r.refresh(); }).catch(() => {});
  }, [o.id, o.payment_status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function pay() {
    setPaying(true); setErr("");
    const res = await fetch("/api/pay/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.id, slug }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.url) { window.location.href = j.url; return; }
    setPaying(false); setErr(j.error ?? "تعذّر بدء الدفع");
  }
  const steps = o.fulfillment === "pickup" ? STEPS.filter((s) => s !== "out_for_delivery") : STEPS;
  const idx = steps.indexOf(o.status);
  const txt = o.fulfillment === "pickup" && o.status === "ready" ? "طلبك جاهز للاستلام من المتجر" : TXT[o.status];

  return (<>
    <header className="shop-top"><div className="in"><h1>طلب #{num(o.number)}</h1><Link href={`/shop/${slug}/orders`}>طلباتي</Link></div></header>
    <div className="shop" style={{ marginTop: 14 }}>
      {o.status !== "cancelled" && (o.payment_status === "pending" || o.payment_status === "failed") && <div className="card list">
        <div className="err">{o.payment_status === "failed" ? "لم تكتمل عملية الدفع." : "طلبك بانتظار الدفع. يبدأ التجهيز بعد تأكيد الدفع، ويُلغى تلقائيًا بعد 30 دقيقة."}</div>
        <button className="btn" disabled={paying} onClick={pay}>{paying ? "جارٍ التحويل..." : `ادفع الآن ${SAR(o.total)}`}</button></div>}
      <div className="card list">
        <h2 style={{ margin: 0 }}>{txt}</h2>
        {o.status !== "cancelled" && <div className="steps">{steps.map((s, i) => <span key={s} className={i <= idx ? "on" : ""} />)}</div>}
        {o.status === "cancelled" && o.cancel_reason && <div className="muted">{o.cancel_reason}</div>}
        {o.status === "out_for_delivery" && t?.driver_at && <div className="okmsg">
          {t.km != null ? `المندوب على بعد ${num(t.km)} كم تقريبًا` : "المندوب في الطريق"} · آخر تحديث {new Date(t.driver_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
          {t.driver_lat != null && <> · <a href={`https://www.google.com/maps?q=${t.driver_lat},${t.driver_lng}`} target="_blank" rel="noreferrer">عرض على الخريطة</a></>}</div>}
        {o.fulfillment === "delivery" && t && !["delivered", "cancelled"].includes(o.status) && <DeliveryMap points={[
          t.store_lat != null ? { lat: t.store_lat, lng: t.store_lng!, label: "المتجر", color: "#1f6b4a" } : null,
          t.dest_lat != null ? { lat: t.dest_lat, lng: t.dest_lng!, label: "موقعك", color: "#c2413b" } : null,
          t.driver_lat != null ? { lat: t.driver_lat, lng: t.driver_lng!, label: "المندوب", color: "#e0a526" } : null,
        ]} />}
        <div className="muted" style={{ fontSize: 12 }}>تتحدث هذه الصفحة تلقائيًا.</div>
      </div>
      <div className="card">
        {o.order_items.map((i, k) => <div className="total" key={k}><span>{i.name} × {num(i.qty)}{Number(i.qty) < Number(i.ordered_qty) && <span className="pill p-warn" style={{ marginInlineStart: 6 }}>{Number(i.qty) === 0 ? "غير متوفر" : `متوفر ${num(i.qty)} من ${num(i.ordered_qty)}`}</span>}</span><span>{SAR(Number(i.qty) * Number(i.unit_price))}</span></div>)}
        <div className="total"><span>التوصيل</span><span>{SAR(o.delivery_fee)}</span></div>
        <div className="total big"><span>الإجمالي · {o.payment_status === "paid" ? "مدفوع إلكترونيًا" : o.payment_status === "none" ? `${PAY[o.payment_method]} عند الاستلام` : "بانتظار الدفع"}</span><span>{SAR(o.total)}</span></div>
        {o.payment_status === "paid" && o.paid_amount != null && Number(o.paid_amount) > Number(o.total) && <div className="okmsg">سيُعاد لك {SAR(Number(o.paid_amount) - Number(o.total))} عن الأصناف غير المتوفرة.</div>}
      </div>
      {err && <div className="err">{err}</div>}
      {o.status === "new" && <button className="btn ghost" onClick={async () => { const { error } = await sb.rpc("cancel_my_order", { p_order: o.id }); if (error) setErr(error.message); else r.refresh(); }}>إلغاء الطلب</button>}
      {storePhone && <div className="muted">للاستفسار: <span dir="ltr">{storePhone}</span></div>}
    </div>
  </>);
}
