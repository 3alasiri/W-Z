"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num } from "@/lib/format";

export type Row = { slug: string; name: string; district: string | null; city: string | null; address: string | null;
  delivery_fee: number; min_order: number; accepting_orders: boolean; distance_km: number | null; delivers: boolean | null; products: number };

export default function DirectoryClient({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [msg, setMsg] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(async () => {
      const { data, error } = await supabaseBrowser().rpc("store_directory", { p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_q: q || null });
      if (error) setMsg("تعذّر تحميل البقالات"); else setRows((data ?? []) as Row[]);
    }, 250);
    return () => clearTimeout(t);
  }, [q, pos]);
  function locate() {
    if (!navigator.geolocation) return setMsg("المتصفح لا يدعم تحديد الموقع");
    setMsg("جارٍ تحديد موقعك...");
    navigator.geolocation.getCurrentPosition((p) => { setMsg(""); setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => setMsg("تعذّر تحديد الموقع. اسمح للمتصفح بالوصول إليه."));
  }
  return (
    <div className="page-plain">
      <div className="wrap" style={{ maxWidth: 980, padding: "24px 16px" }}>
        <div className="head"><div><h1>بقالات الحي</h1><div className="sub">اختر بقالتك واطلب منها مباشرة، توصيل أو استلام</div></div>
          <Link href="/login" className="btn ghost">دخول أصحاب البقالات</Link></div>
        <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم البقالة أو الحي أو المدينة" aria-label="بحث" style={{ flex: 1, minWidth: 200 }} />
          <button className="btn" onClick={locate}>{pos ? "تحديث موقعي" : "الأقرب لي"}</button>
          {msg && <span className="muted" role="status" style={{ width: "100%" }}>{msg}</span>}
        </div>
        <div className="grid g2">
          {rows.map((s) => (
            <Link key={s.slug} href={`/shop/${s.slug}`} className="card storecard" aria-label={`${s.name}${s.district ? "، حي " + s.district : ""}`}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <b className="avatar">{s.name.replace(/^بقالة\s*/, "").slice(0, 1)}</b>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 style={{ margin: 0, fontSize: 17 }}>{s.name}</h2>
                  <div className="muted" style={{ fontSize: 13 }}>{[s.district && "حي " + s.district, s.city].filter(Boolean).join("، ") || s.address || "—"}</div>
                </div>
                {s.distance_km != null && <span className="pill p-info">{num(s.distance_km)} كم</span>}
              </div>
              <div className="chips" style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span className={`pill ${s.accepting_orders ? "p-ok" : "p-bad"}`}>{s.accepting_orders ? "يستقبل الطلبات" : "مغلق حاليًا"}</span>
                {s.delivers === false && <span className="pill p-warn">خارج نطاق التوصيل · استلام فقط</span>}
                <span className="pill p-info">توصيل {Number(s.delivery_fee) ? SAR(s.delivery_fee) : "مجاني"}</span>
                {Number(s.min_order) > 0 && <span className="pill p-info">الحد الأدنى {SAR(s.min_order)}</span>}
                <span className="pill p-info">{num(s.products)} منتج</span>
              </div>
            </Link>
          ))}
        </div>
        {!rows.length && <p className="muted">لا توجد بقالات مطابقة.</p>}
      </div>
    </div>
  );
}
