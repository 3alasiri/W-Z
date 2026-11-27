"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num } from "@/lib/format";
import ProductImage from "@/components/ProductImage";

type Store = { id: string; slug: string; name: string; phone: string | null; address: string | null; delivery_fee: number; min_order: number; radius_km: number; accepting_orders: boolean; has_location: boolean };
type Pk = { id: string; name: string; units: number; price: number; original_price: number };
type P = { id: string; name: string; category: string | null; unit: string; image_url: string | null; price: number; original_price: number; available: number; packs: Pk[] };
type O = { key: string; pack_id: string | null; label: string; units: number; price: number; original_price: number };
const optsOf = (p: P): O[] => [
  { key: `${p.id}|s`, pack_id: null, label: "مفرد", units: 1, price: Number(p.price), original_price: Number(p.original_price) },
  ...(p.packs ?? []).map((k) => ({ key: `${p.id}|${k.id}`, pack_id: k.id, label: k.name, units: Number(k.units), price: Number(k.price), original_price: Number(k.original_price) })),
];
type Rec = { id: string; name: string; price: number; original_price: number; available: number; reason: string };
type Me = { name: string; phone: string | null; address: string | null; lat: number | null; lng: number | null } | null;

export default function ShopClient({ store, products, loggedIn, me, onlinePay }: { store: Store; products: P[]; loggedIn: boolean; me: Me; onlinePay: boolean }) {
  const r = useRouter();
  const key = `cart:${store.slug}`;
  const [cart, setCart] = useState<Record<string, number>>({});
  const [q, setQ] = useState(""); const [cat, setCat] = useState("");
  const [checkout, setCheckout] = useState(false);
  const [f, setF] = useState({ name: me?.name ?? "", phone: me?.phone ?? "", address: me?.address ?? "", notes: "", fulfillment: "delivery", payment: "cash" });
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(me?.lat ? { lat: me.lat, lng: me.lng! } : null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [recs, setRecs] = useState<Rec[]>([]);

  useEffect(() => { try {
    const raw = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, number>;
    setCart(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.includes("|") ? k : `${k}|s`, v])));
  } catch {} }, [key]);
  const cartKey = Array.from(new Set(Object.keys(cart).map((k) => k.split("|")[0]))).sort().join(",");
  useEffect(() => {
    const t = setTimeout(() => {
      supabaseBrowser().rpc("shop_recommendations", { p_slug: store.slug, p_cart: cartKey ? cartKey.split(",") : [] }).then(({ data }) => setRecs(data ?? []));
    }, 400);
    return () => clearTimeout(t);
  }, [cartKey, store.slug]);
  const save = (c: Record<string, number>) => { setCart(c); try { localStorage.setItem(key, JSON.stringify(c)); } catch {} };
  const [sel, setSel] = useState<Record<string, string>>({});
  const [view, setView] = useState<"all" | "single" | "packs">("all");
  const usedUnits = (pid: string, except: string) => Object.entries(cart).reduce((a, [k, q]) => k.startsWith(pid + "|") && k !== except ? a + q * (allOpts[k]?.o.units ?? 1) : a, 0);
  const add = (p: P, o: O, d: number) => {
    const max = Math.floor((p.available - usedUnits(p.id, o.key)) / o.units);
    const n = Math.min(max, Math.max(0, (cart[o.key] ?? 0) + d)); const c = { ...cart };
    if (n) c[o.key] = n; else delete c[o.key]; save(c);
  };

  const cats = useMemo(() => Array.from(new Set(products.map((p) => p.category).filter(Boolean))) as string[], [products]);
  const shown = products.filter((p) => (!cat || p.category === cat) && (!q || p.name.includes(q)) && (view !== "packs" || (p.packs ?? []).length > 0));
  const allOpts = useMemo(() => Object.fromEntries(products.flatMap((p) => optsOf(p).map((o) => [o.key, { p, o }]))), [products]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => { supabaseBrowser().rpc("log_shop_search", { p_slug: store.slug, p_term: q, p_results: shown.length }).then(() => {}); }, 1200);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(cart).filter(([k]) => allOpts[k]).map(([k, q]) => ({ ...allOpts[k], q }));
  const itemsTotal = lines.reduce((a, l) => a + l.o.price * l.q, 0);
  const fee = f.fulfillment === "delivery" ? Number(store.delivery_fee) : 0;
  const count = lines.reduce((a, l) => a + l.q, 0);
  const belowMin = itemsTotal < Number(store.min_order);

  function locate() {
    if (!navigator.geolocation) return setErr("المتصفح لا يدعم تحديد الموقع");
    navigator.geolocation.getCurrentPosition((p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }), () => setErr("تعذّر تحديد موقعك. اكتب العنوان بالتفصيل."), { enableHighAccuracy: true });
  }
  async function place(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("place_order", {
      p_slug: store.slug, p_items: lines.map((l) => ({ product_id: l.p.id, qty: l.q, pack_id: l.o.pack_id })), p_fulfillment: f.fulfillment, p_payment: f.payment,
      p_name: f.name, p_phone: f.phone, p_address: f.fulfillment === "delivery" ? f.address : null,
      p_lat: f.fulfillment === "delivery" ? loc?.lat ?? null : null, p_lng: f.fulfillment === "delivery" ? loc?.lng ?? null : null, p_notes: f.notes || null,
    });
    if (error) { setBusy(false); return setErr(error.message); }
    save({});
    if (f.payment === "online") {
      const res = await fetch("/api/pay/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: data, slug: store.slug }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.url) { window.location.href = j.url; return; }
      setBusy(false); r.push(`/shop/${store.slug}/orders/${data}`); return;
    }
    setBusy(false); r.push(`/shop/${store.slug}/orders/${data}`);
  }

  return (<>
    <header className="shop-top"><div className="in"><div><h1>{store.name}</h1>
      <div style={{ fontSize: 12, opacity: .85 }}>{store.address ?? ""}{Number(store.delivery_fee) ? ` · توصيل ${SAR(store.delivery_fee)}` : " · توصيل مجاني"}{Number(store.min_order) ? ` · الحد الأدنى ${SAR(store.min_order)}` : ""}</div></div>
      {loggedIn ? <Link href={`/shop/${store.slug}/orders`}>طلباتي</Link> : <Link href={`/login?next=/shop/${store.slug}`}>دخول</Link>}</div></header>
    <div className="shop" style={{ marginTop: 14 }}>
      {!store.accepting_orders && <div className="err">المتجر لا يستقبل طلبات الآن.</div>}
      {!checkout ? (<>
        {recs.length > 0 && !q && view === "all" && <div className="card"><h2 style={{ marginBottom: 10 }}>مقترح لك</h2>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6 }}>{recs.map((x) => { const p = byId[x.id]; if (!p) return null; const o = optsOf(p)[0]; return (
            <div key={x.id} className="prod" style={{ minWidth: 150, maxWidth: 160 }}>
              <ProductImage src={p.image_url} name={p.name} category={p.category} />
              <b style={{ fontSize: 13 }}>{x.name}</b><span className="muted" style={{ fontSize: 11 }}>{x.reason}</span><span className="pr">{SAR(x.price)}</span>
              <button className="btn sm" disabled={!store.accepting_orders} onClick={() => add(p, o, 1)}>{cart[o.key] ? `في السلة (${num(cart[o.key])})` : "أضف"}</button></div>); })}</div></div>}
        <div className="seg" style={{ alignSelf: "center" }}>{([["all", "كل المنتجات"], ["single", "بالحبة"], ["packs", "العائلي والجملة"]] as const).map(([k, t]) =>
          <button key={k} className={view === k ? "on" : ""} aria-pressed={view === k} onClick={() => setView(k)}>{t}</button>)}</div>
        <input placeholder="ابحث عن منتج" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
        {cats.length > 1 && <div className="chips"><button className={`btn sm ${cat ? "ghost" : ""}`} onClick={() => setCat("")}>الكل</button>
          {cats.map((c) => <button key={c} className={`btn sm ${cat === c ? "" : "ghost"}`} onClick={() => setCat(c)}>{c}</button>)}</div>}
        <div className="prods">{shown.map((p) => {
          const opts = optsOf(p);
          // «بالحبة» يفرض الحبة، و«العائلي والجملة» يفرض عبوة (المختارة إن كانت عبوة، وإلا الأكبر)
          const chosen = opts.find((x) => x.key === sel[p.id]);
          const o = view === "single" ? opts[0]
            : view === "packs" ? (chosen && chosen.units > 1 ? chosen : opts[opts.length - 1])
            : chosen ?? opts[0];
          const perUnit = o.price / o.units; const save = o.units > 1 ? (Number(p.price) - perUnit) * o.units : 0;
          const n = cart[o.key] ?? 0; const can = Math.floor((p.available - usedUnits(p.id, o.key)) / o.units) > n;
          return (
          <div className="prod" key={p.id}>
            <div style={{ position: "relative" }}>
              <ProductImage src={p.image_url} name={p.name} category={p.category} />
              {o.units > 1 && <span className="tag-pack">{o.label}</span>}
              {o.price < o.original_price && <span className="tag-offer">خصم {num(Math.round((1 - o.price / o.original_price) * 100))}٪</span>}
            </div>
            <b>{p.name}</b>
            {opts.length > 1 && view !== "single" && <div className="packs" role="group" aria-label={`عبوة ${p.name}`}>{opts.filter((x) => view !== "packs" || x.units > 1).map((x) =>
              <button key={x.key} className={x.key === o.key ? "on" : ""} aria-pressed={x.key === o.key} aria-label={x.units > 1 ? `${x.label} بسعر ${x.price}` : "حبة واحدة"} onClick={() => setSel({ ...sel, [p.id]: x.key })}>{x.units > 1 ? x.label.split(" ")[0] + " ×" + num(x.units) : "حبة"}</button>)}</div>}
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
              <span className="pr">{SAR(o.price)}</span>
              {o.price < o.original_price && <s className="muted" style={{ fontSize: 11.5 }}>{SAR(o.original_price)}</s>}
            </div>
            {o.units > 1 ? <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 11 }}>{SAR(perUnit)} للحبة</span>{save > 0.05 && <span className="save">وفّر {SAR(save)}</span>}</div>
              : <span className="muted" style={{ fontSize: 11 }}>{p.unit || "حبة"}{p.available <= 5 ? ` · متبقٍ ${num(p.available)}` : ""}</span>}
            {n ? <div className="qty" role="group" aria-label={`كمية ${p.name}`}><button onClick={() => add(p, o, -1)} aria-label={`إنقاص ${p.name}`}>−</button><b aria-live="polite">{num(n)}</b><button onClick={() => add(p, o, 1)} disabled={!can} aria-label={`زيادة ${p.name}`}>+</button></div>
              : <button className="btn sm" disabled={!store.accepting_orders || !can} onClick={() => add(p, o, 1)}>{can ? "أضف للسلة" : "غير متوفر"}</button>}
          </div>); })}</div>
        {shown.length === 0 && <p className="muted">لا منتجات مطابقة.</p>}
      </>) : (
        <form className="list" onSubmit={place}>
          <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setCheckout(false)}>→ متابعة التسوق</button>
          <div className="card"><h2>سلتك</h2>
            {lines.map((l) => <div className="row" key={l.o.key}><div className="thumb"><ProductImage src={l.p.image_url} name={l.p.name} category={l.p.category} size={52} />
              <div><div className="t">{l.p.name}</div><div className="s">{l.o.units > 1 ? `${l.o.label} · ` : ""}{SAR(l.o.price)}</div></div></div>
              <div className="qty" role="group" aria-label={`كمية ${l.p.name}`}><button type="button" onClick={() => add(l.p, l.o, -1)} aria-label={`إنقاص ${l.p.name}`}>−</button><b aria-live="polite">{num(l.q)}</b><button type="button" onClick={() => add(l.p, l.o, 1)} aria-label={`زيادة ${l.p.name}`}>+</button></div></div>)}
            <div className="total"><span>المنتجات</span><span>{SAR(itemsTotal)}</span></div>
            <div className="total"><span>التوصيل</span><span>{SAR(fee)}</span></div>
            <div className="total big"><span>الإجمالي (شامل الضريبة)</span><span>{SAR(itemsTotal + fee)}</span></div>
          </div>
          {!loggedIn ? <div className="card"><p>سجّل الدخول لإتمام الطلب. سلتك محفوظة.</p><Link className="btn" href={`/login?next=/shop/${store.slug}`}>دخول أو إنشاء حساب</Link></div> : (<>
            <div className="card list"><h2>الاستلام</h2>
              <div className="chips">
                <button type="button" className={`btn sm ${f.fulfillment === "delivery" ? "" : "ghost"}`} onClick={() => setF({ ...f, fulfillment: "delivery" })}>توصيل</button>
                <button type="button" className={`btn sm ${f.fulfillment === "pickup" ? "" : "ghost"}`} onClick={() => setF({ ...f, fulfillment: "pickup" })}>استلام من المتجر</button></div>
              <div className="field"><label htmlFor="cn">الاسم</label><input id="cn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="cp">الجوال</label><input id="cp" required type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
              {f.fulfillment === "delivery" && <>
                <div className="field"><label htmlFor="ca">العنوان (الحي، الشارع، رقم المنزل)</label><input id="ca" required value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
                <div className="row"><span className="s">{loc ? "✓ حُدّد موقعك على الخريطة" : "تحديد الموقع يساعد المندوب ويتحقق من نطاق التوصيل"}</span>
                  <button type="button" className="btn ghost sm" onClick={locate}>{loc ? "تحديث الموقع" : "تحديد موقعي"}</button></div></>}
              <div className="field"><label htmlFor="cno">ملاحظات</label><input id="cno" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="مثال: البوابة الخلفية" /></div>
            </div>
            <div className="card"><h2>الدفع</h2><div className="chips">
              {onlinePay && <button type="button" className={`btn sm ${f.payment === "online" ? "" : "ghost"}`} onClick={() => setF({ ...f, payment: "online" })}>ادفع الآن (مدى، Apple Pay، بطاقة)</button>}
              <button type="button" className={`btn sm ${f.payment === "cash" ? "" : "ghost"}`} onClick={() => setF({ ...f, payment: "cash" })}>نقدًا عند الاستلام</button>
              <button type="button" className={`btn sm ${f.payment === "card" ? "" : "ghost"}`} onClick={() => setF({ ...f, payment: "card" })}>مدى عند الاستلام</button></div></div>
            {err && <div className="err">{err}</div>}
            {belowMin && <div className="err">الحد الأدنى للطلب {SAR(store.min_order)}</div>}
            <button className="btn" disabled={busy || !lines.length || belowMin || !store.accepting_orders}>{busy ? "جارٍ الإرسال..." : f.payment === "online" ? `ادفع ${SAR(itemsTotal + fee)}` : `تأكيد الطلب · ${SAR(itemsTotal + fee)}`}</button>
          </>)}
        </form>)}
    </div>
    {!checkout && count > 0 && <div className="cartbar"><div className="in"><span><b>{num(count)}</b> منتجات · {SAR(itemsTotal)}</span>
      <button className="btn" onClick={() => { setCheckout(true); window.scrollTo(0, 0); }}>عرض السلة</button></div></div>}
  </>);
}
