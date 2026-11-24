"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num, PAY, ORDER_STATUS, mapsLink } from "@/lib/format";

type O = { id: string; number: number; status: string; address: string | null; lat: number | null; lng: number | null; notes: string | null; total: number; payment_method: string; delivered_at: string | null;
  customers: { name: string; phone: string | null }; order_items: { name: string; qty: number }[] };

export default function DriverClient({ userId, storeName, orders }: { userId: string; storeName: string; orders: O[] }) {
  const r = useRouter(); const sb = supabaseBrowser();
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);
  const [gps, setGps] = useState<"off" | "on" | "denied">("off");
  const last = useRef(0);
  const active = orders.filter((o) => o.status !== "delivered");
  const done = orders.filter((o) => o.status === "delivered");
  const delivering = active.some((o) => o.status === "out_for_delivery");

  useEffect(() => {
    const ch = sb.channel("driver").on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `driver_id=eq.${userId}` }, () => r.refresh()).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // مشاركة الموقع أثناء التوصيل فقط، كل 20 ثانية
  useEffect(() => {
    if (!delivering || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition((p) => {
      setGps("on");
      if (Date.now() - last.current < 20000) return;
      last.current = Date.now();
      sb.rpc("update_my_location", { p_lat: p.coords.latitude, p_lng: p.coords.longitude });
    }, () => setGps("denied"), { enableHighAccuracy: true, maximumAge: 10000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [delivering]); // eslint-disable-line react-hooks/exhaustive-deps

  async function status(o: O, s: string, ok: string) {
    setMsg(null);
    const { error } = await sb.rpc("set_order_status", { p_order: o.id, p_status: s });
    if (error) return setMsg({ t: "err", m: error.message });
    setMsg({ t: "ok", m: ok }); r.refresh();
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto" }}><div className="wrap">
      <div className="head"><div><h1>طلباتي</h1><div className="sub">{storeName} · مندوب التوصيل</div></div>
        <button className="btn ghost sm" onClick={async () => { await sb.auth.signOut(); r.replace("/login"); }}>خروج</button></div>
      {delivering && <div className={gps === "denied" ? "err" : "okmsg"}>{gps === "denied" ? "اسمح بالوصول للموقع ليتتبع العميل طلبه." : "موقعك يُشارك مع العميل أثناء التوصيل."}</div>}
      {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}
      {active.length === 0 && <div className="card muted">لا طلبات مسندة إليك الآن. ستظهر هنا فور تعيينك.</div>}
      {active.map((o) => { const nav = mapsLink(o.lat, o.lng, o.address); return (
        <div key={o.id} className="card list">
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>طلب #{num(o.number)}</b><span className={`pill ${ORDER_STATUS[o.status][1]}`}>{ORDER_STATUS[o.status][0]}</span></div>
          <div className="t">{o.customers.name}</div>
          <div className="muted">{o.address}</div>
          {o.notes && <div className="okmsg">ملاحظة العميل: {o.notes}</div>}
          <div className="muted" style={{ fontSize: 12 }}>{o.order_items.filter((i) => Number(i.qty) > 0).map((i) => `${i.name} × ${num(i.qty)}`).join("، ")}</div>
          <div className="total big"><span>حصّل {PAY[o.payment_method]}</span><span>{SAR(o.total)}</span></div>
          <div className="grid g2">
            {nav && <a className="btn ghost" href={nav} target="_blank" rel="noreferrer">الملاحة</a>}
            {o.customers.phone && <a className="btn ghost" href={`tel:${o.customers.phone}`}>اتصال {o.customers.phone}</a>}
          </div>
          {o.status === "ready" && <button className="btn" onClick={() => status(o, "out_for_delivery", "بدأ التوصيل وأُبلغ العميل")}>استلمت الطلب، بدء التوصيل</button>}
          {o.status === "out_for_delivery" && <button className="btn" onClick={() => status(o, "delivered", "سُلّم الطلب")}>سلّمت الطلب وحصّلت المبلغ</button>}
        </div>); })}
      {done.length > 0 && <div className="card"><h2>سلّمتها اليوم ({num(done.length)})</h2>
        {done.map((o) => <div key={o.id} className="total"><span>#{num(o.number)} · {o.customers.name} · {PAY[o.payment_method]}</span><span>{SAR(o.total)}</span></div>)}
        <div className="total big"><span>نقدًا معك</span><span>{SAR(done.filter((o) => o.payment_method === "cash").reduce((a, o) => a + Number(o.total), 0))}</span></div>
      </div>}
    </div></main>
  );
}
