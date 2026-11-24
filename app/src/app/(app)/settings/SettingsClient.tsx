"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import Appearance from "@/components/Appearance";

type S = Record<string, string | number | boolean | null>;
const F = [
  ["name", "اسم المتجر", "text"], ["phone", "جوال المتجر", "tel"], ["address", "العنوان", "text"], ["vat_number", "الرقم الضريبي", "text"],
  ["slug", "رابط المتجر (أحرف إنجليزية صغيرة وأرقام)", "text"], ["delivery_fee", "رسوم التوصيل (شاملة الضريبة)", "number"],
  ["min_order", "الحد الأدنى للطلب", "number"], ["delivery_radius_km", "نطاق التوصيل (كم)", "number"], ["expiry_warn_days", "التنبيه قبل انتهاء الصلاحية (أيام)", "number"],
] as const;

export default function SettingsClient({ s, canEdit }: { s: S; canEdit: boolean }) {
  const r = useRouter();
  const [f, setF] = useState<S>(s);
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const shopUrl = `${origin}/shop/${s.slug}`;

  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const body: S = {};
    F.forEach(([k, , t]) => { body[k] = t === "number" ? Number(f[k]) || 0 : (String(f[k] ?? "").trim() || null); });
    body.slug = String(f.slug ?? "").trim().toLowerCase();
    body.accepting_orders = !!f.accepting_orders; body.lat = f.lat; body.lng = f.lng;
    const { error } = await supabaseBrowser().from("stores").update(body).eq("id", s.id as string);
    if (error) return setMsg({ t: "err", m: error.message.includes("slug") ? "الرابط مستخدم أو غير صالح" : error.message });
    setMsg({ t: "ok", m: "حُفظت الإعدادات" }); r.refresh();
  }
  function locate() {
    if (!navigator.geolocation) return setMsg({ t: "err", m: "المتصفح لا يدعم تحديد الموقع" });
    navigator.geolocation.getCurrentPosition((p) => setF({ ...f, lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setMsg({ t: "err", m: "تعذّر تحديد الموقع. اسمح للمتصفح بالوصول إليه." }), { enableHighAccuracy: true });
  }

  return (<>
    <div className="head"><div><h1>الإعدادات</h1><div className="sub">بيانات المتجر والطلب الأونلاين</div></div></div>
    {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}
    <div className="card"><h2>المظهر والخط</h2>
      <p className="muted" style={{ marginTop: -6 }}>يُحفظ اختيارك على هذا الجهاز، ويسري على النظام ومتجر العملاء.</p>
      <Appearance /></div>
    <div className="card"><h2>رابط متجرك للعملاء</h2>
      <div className="scan"><input readOnly value={shopUrl} dir="ltr" aria-label="رابط المتجر" />
        <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(shopUrl); setMsg({ t: "ok", m: "نُسخ الرابط" }); } catch {} }}>نسخ</button>
        <a className="btn ghost" href={`/shop/${s.slug}`} target="_blank" rel="noreferrer">فتح</a></div>
      <p className="muted" style={{ fontSize: 12 }}>شاركه مع سكان الحي عبر واتساب أو اطبعه كرمز QR على باب المتجر.</p>
    </div>
    <form className="card" onSubmit={save}>
      <div className="form">
        {F.map(([k, l, t]) => <div className="field" key={k}><label htmlFor={k}>{l}</label>
          <input id={k} type={t} step={t === "number" ? "0.01" : undefined} dir={k === "slug" || t === "tel" ? "ltr" : undefined} disabled={!canEdit}
            value={String(f[k] ?? "")} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <div><div className="t">موقع المتجر</div><div className="s">{f.lat ? `${Number(f.lat).toFixed(5)}, ${Number(f.lng).toFixed(5)} — يُستخدم لحساب نطاق التوصيل` : "غير محدد: لن يُتحقق من نطاق التوصيل"}</div></div>
        <button type="button" className="btn ghost sm" disabled={!canEdit} onClick={locate}>استخدام موقعي الحالي</button>
      </div>
      <label className="row" style={{ marginTop: 8, cursor: "pointer" }}><span className="t">استقبال الطلبات الأونلاين</span>
        <input type="checkbox" style={{ width: 20 }} disabled={!canEdit} checked={!!f.accepting_orders} onChange={(e) => setF({ ...f, accepting_orders: e.target.checked })} /></label>
      <button className="btn" style={{ marginTop: 12 }} disabled={!canEdit}>حفظ</button>
    </form>
  </>);
}
