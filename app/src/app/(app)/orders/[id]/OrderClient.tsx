"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num, ORDER_STATUS, PAY, mapsLink } from "@/lib/format";
import BarcodeInput from "@/components/BarcodeInput";
import DeliveryMap from "@/components/DeliveryMap";
import { useEffect } from "react";

type O = { id: string; number: number; status: string; fulfillment: string; payment_status: string; paid_amount: number | null; address: string | null; lat: number | null; lng: number | null; notes: string | null; payment_method: string; items_total: number; delivery_fee: number; total: number; driver_id: string | null; created_at: string; cancel_reason: string | null; customers: { name: string; phone: string | null } };
type I = { id: number; name: string; qty: number; ordered_qty: number; unit_price: number; picked: boolean; products: { barcode: string } };

export default function OrderClient({ o, items, drivers }: { o: O; items: I[]; drivers: { user_id: string; email: string }[] }) {
  const r = useRouter(); const sb = supabaseBrowser();
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const picking = o.status === "new" || o.status === "preparing";
  const [trk, setTrk] = useState<{ store_lat: number | null; store_lng: number | null; driver_lat: number | null; driver_lng: number | null } | null>(null);
  useEffect(() => {
    if (o.fulfillment !== "delivery") return;
    const load = () => sb.rpc("order_tracking", { p_order: o.id }).then(({ data }) => data && setTrk(data));
    load();
    if (o.status !== "out_for_delivery") return;
    const i = setInterval(load, 20000); return () => clearInterval(i);
  }, [o.id, o.status, o.fulfillment]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    setBusy(true); setMsg(null);
    const { error } = await fn(); setBusy(false);
    if (error) return setMsg({ t: "err", m: error.message });
    if (ok) setMsg({ t: "ok", m: ok }); r.refresh();
  };
  const pick = (i: I, qty: number, picked: boolean) => run(() => sb.rpc("pick_item", { p_item: i.id, p_qty: qty, p_picked: picked }));
  const status = (s: string, ok: string) => run(() => sb.rpc("set_order_status", { p_order: o.id, p_status: s, p_reason: s === "cancelled" ? reason || null : null }), ok);
  const onScan = useCallback((code: string) => {
    const i = items.find((x) => x.products.barcode === code && !x.picked);
    if (!i) return setMsg({ t: "err", m: "هذا المنتج ليس في الطلب أو جُهّز بالفعل" });
    pick(i, Number(i.qty), true);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = mapsLink(o.lat, o.lng, o.address);
  const allPicked = items.every((i) => i.picked || Number(i.qty) === 0);

  return (<>
    <div className="head"><div><h1>طلب #{num(o.number)}</h1>
      <div className="sub">{new Date(o.created_at).toLocaleString("ar-SA")} · {o.fulfillment === "pickup" ? "استلام من المتجر" : "توصيل"} · {o.payment_status === "none" ? `الدفع عند الاستلام ${PAY[o.payment_method]}` : "دفع إلكتروني مسبق"}</div></div>
      <div className="chips">{o.payment_status === "paid" && <span className="pill p-ok">مدفوع إلكترونيًا</span>}
        {o.payment_status === "pending" && <span className="pill p-warn">بانتظار الدفع</span>}{o.payment_status === "failed" && <span className="pill p-bad">فشل الدفع</span>}
        <span className={`pill ${ORDER_STATUS[o.status][1]}`}>{ORDER_STATUS[o.status][0]}</span></div></div>
    {o.payment_status === "pending" && <div className="err">لا تجهّز هذا الطلب حتى يكتمل الدفع. يُلغى تلقائيًا إن لم يُدفع خلال 30 دقيقة.</div>}
    {o.payment_status === "paid" && o.paid_amount != null && Number(o.paid_amount) > Number(o.total) && <div className="err">دفع العميل {SAR(o.paid_amount)}. أعد له {SAR(Number(o.paid_amount) - Number(o.total))} من لوحة Moyasar عن الأصناف غير المتوفرة.</div>}
    {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}
    <div className="grid g3">
      <div className="card">
        <h2>{picking ? "التجهيز: امسح كل صنف أو علّمه" : "الأصناف"}</h2>
        {picking && <div style={{ marginBottom: 12 }}><BarcodeInput onScan={onScan} /></div>}
        <div className="list">{items.map((i) => (
          <div key={i.id} className={`row sev ${Number(i.qty) === 0 ? "bad" : i.picked ? "info" : "warn"}`}>
            <div><div className="t">{i.name}</div><div className="s">{num(i.qty)}{Number(i.qty) !== Number(i.ordered_qty) && ` من ${num(i.ordered_qty)} مطلوبة`} × {SAR(i.unit_price)}</div></div>
            {picking ? <div className="chips">
              <button className={`btn sm ${i.picked ? "" : "ghost"}`} disabled={busy} onClick={() => pick(i, Number(i.qty), !i.picked)}>{i.picked ? "✓ جُهّز" : "تجهيز"}</button>
              {Number(i.qty) > 0 && <button className="btn ghost sm" disabled={busy} onClick={() => pick(i, Number(i.qty) - 1, i.picked)}>−1</button>}
              {Number(i.qty) < Number(i.ordered_qty) && <button className="btn ghost sm" disabled={busy} onClick={() => pick(i, Number(i.qty) + 1, i.picked)}>+1</button>}
              {Number(i.qty) > 0 && <button className="btn ghost sm" disabled={busy} onClick={() => pick(i, 0, true)}>غير متوفر</button>}
            </div> : <span>{SAR(Number(i.qty) * Number(i.unit_price))}</span>}
          </div>))}</div>
        <div className="total"><span>الأصناف</span><span>{SAR(o.items_total)}</span></div>
        <div className="total"><span>التوصيل</span><span>{SAR(o.delivery_fee)}</span></div>
        <div className="total big"><span>{o.payment_status === "paid" ? "الإجمالي (مدفوع)" : "المطلوب تحصيله"}</span><span>{SAR(o.total)}</span></div>
      </div>
      <div className="list">
        <div className="card"><h2>العميل</h2>
          <div className="t">{o.customers.name}</div>
          <div dir="ltr" style={{ textAlign: "right" }}>{o.customers.phone}</div>
          {o.address && <div className="muted">{o.address}</div>}
          {o.notes && <div className="okmsg" style={{ marginTop: 8 }}>ملاحظة: {o.notes}</div>}
          {nav && <a className="btn ghost sm" style={{ marginTop: 8 }} href={nav} target="_blank" rel="noreferrer">فتح الموقع في الخرائط</a>}
          {o.lat != null && <div style={{ marginTop: 8 }}><DeliveryMap height={200} points={[
            trk?.store_lat != null ? { lat: trk.store_lat, lng: trk.store_lng!, label: "المتجر", color: "#1f6b4a" } : null,
            { lat: o.lat, lng: o.lng!, label: "العميل", color: "#c2413b" },
            trk?.driver_lat != null ? { lat: trk.driver_lat, lng: trk.driver_lng!, label: "المندوب", color: "#e0a526" } : null,
          ]} /></div>}
        </div>
        {o.fulfillment === "delivery" && !["delivered", "cancelled"].includes(o.status) && (
          <div className="card"><h2>المندوب</h2>
            {drivers.length ? <select value={o.driver_id ?? ""} disabled={busy} aria-label="المندوب"
              onChange={(e) => run(() => sb.rpc("assign_driver", { p_order: o.id, p_driver: e.target.value || null }), "عُيّن المندوب")}>
              <option value="">— اختر مندوبًا —</option>{drivers.map((d) => <option key={d.user_id} value={d.user_id}>{d.email}</option>)}
            </select> : <p className="muted">لا مناديب. <Link href="/team">أضف مندوبًا من صفحة الفريق</Link>.</p>}
          </div>)}
        <div className="card list"><h2>الإجراء التالي</h2>
          {o.status === "new" && <button className="btn" disabled={busy} onClick={() => status("preparing", "بدأ التجهيز وأُبلغ العميل")}>بدء التجهيز</button>}
          {picking && <button className="btn" disabled={busy || !allPicked} onClick={() => status("ready", "الطلب جاهز")}>الطلب جاهز</button>}
          {picking && !allPicked && <span className="muted" style={{ fontSize: 12 }}>جهّز كل الأصناف أو علّم غير المتوفر منها.</span>}
          {o.status === "ready" && o.fulfillment === "delivery" && <button className="btn" disabled={busy || !o.driver_id} onClick={() => status("out_for_delivery", "خرج الطلب مع المندوب")}>تسليم للمندوب</button>}
          {o.status === "ready" && o.fulfillment === "pickup" && <button className="btn" disabled={busy} onClick={() => status("delivered", "سُلّم الطلب وسُجّلت الفاتورة")}>سلّمه العميل ودفع</button>}
          {o.status === "out_for_delivery" && <button className="btn" disabled={busy} onClick={() => status("delivered", "سُلّم الطلب وسُجّلت الفاتورة")}>تأكيد التسليم</button>}
          {!["delivered", "cancelled"].includes(o.status) && <div className="scan">
            <input placeholder="سبب الإلغاء" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="سبب الإلغاء" />
            <button className="btn danger sm" disabled={busy} onClick={() => status("cancelled", "أُلغي الطلب")}>إلغاء</button></div>}
          {o.status === "cancelled" && <span className="muted">أُلغي{o.cancel_reason ? `: ${o.cancel_reason}` : ""}</span>}
          {o.status === "delivered" && <span className="okmsg">سُلّم وسُجّل في المبيعات والمحاسبة.</span>}
        </div>
        <Link className="btn ghost" href="/orders">رجوع للطلبات</Link>
      </div>
    </div>
  </>);
}
