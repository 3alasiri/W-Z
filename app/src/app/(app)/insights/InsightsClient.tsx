"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num } from "@/lib/format";

type P = { product_id: string; name: string; supplier: string | null; lead_days: number; price: number; stock: number; avg_daily: number; trend: number; forecast_7d: number;
  days_cover: number | null; revenue_30d: number; profit_30d: number; abc: string; last_sale: string | null; next_expiry: string | null; expiring_qty: number;
  sell_before_expiry: number; surplus: number; suggested_discount: number; offer_pct: number | null };
type C = { customer_id: string; name: string; phone: string | null; last_purchase: string; purchases: number; spent: number; avg_interval: number | null; days_since: number; segment: string; high_value: boolean };
type Pair = { name_a: string; name_b: string; together: number; confidence: number; lift: number };
type H = { dow: number; hour: number; invoices: number; revenue: number };
type O = { id: string; discount_pct: number; reason: string | null; ends_at: string; products: { name: string } };

const SEG: Record<string, [string, string]> = { loyal: ["دائمون", "p-ok"], regular: ["منتظمون", "p-info"], new: ["جدد", "p-info"], at_risk: ["معرّضون للفقد", "p-warn"], lost: ["مفقودون", "p-bad"] };
const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export default function InsightsClient({ products, customers, pairs, heat, missing, offers }: { products: P[]; customers: C[]; pairs: Pair[]; heat: H[]; missing: [string, number][]; offers: O[] }) {
  const r = useRouter(); const sb = supabaseBrowser();
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);
  const [tab, setTab] = useState<"actions" | "forecast" | "customers" | "patterns">("actions");

  const expiry = products.filter((p) => p.suggested_discount > 0 && !p.offer_pct);
  const risk = products.filter((p) => Number(p.stock) > 0 && p.days_cover != null && Number(p.days_cover) <= p.lead_days + 1);
  const slow = products.filter((p) => Number(p.stock) > 0 && (!p.last_sale || (Date.now() - new Date(p.last_sale).getTime()) / 864e5 > 21));
  const atRisk = customers.filter((c) => c.segment === "at_risk");
  const segCount = Object.keys(SEG).map((k) => [k, customers.filter((c) => c.segment === k).length] as const);
  const maxHeat = Math.max(1, ...heat.map((h) => h.invoices));
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);
  const peak = [...heat].sort((a, b) => b.invoices - a.invoices)[0];

  async function offer(p: P, pct: number) {
    const days = Math.max(1, p.next_expiry ? Math.ceil((new Date(p.next_expiry).getTime() - Date.now()) / 864e5) : 3);
    const { error } = await sb.rpc("create_offer", { p_product: p.product_id, p_pct: pct, p_days: Math.min(days, 60), p_reason: "قرب انتهاء الصلاحية" });
    if (error) return setMsg({ t: "err", m: error.message });
    setMsg({ t: "ok", m: `طُبّق خصم ${num(pct)}٪ على ${p.name} في نقطة البيع والمتجر الأونلاين` }); r.refresh();
  }
  async function endOffer(id: string) {
    const { error } = await sb.rpc("end_offer", { p_offer: id });
    if (error) return setMsg({ t: "err", m: error.message });
    r.refresh();
  }
  const wa = (c: C) => c.phone ? `https://wa.me/${c.phone.replace(/\D/g, "").replace(/^0/, "966")}?text=${encodeURIComponent(`أهلًا ${c.name}، اشتقنا لك! عندنا عروض جديدة هذا الأسبوع.`)}` : null;

  return (<>
    <div className="head"><div><h1>الذكاء والتحليلات</h1><div className="sub">توقعات مبنية على مبيعات آخر 8 أسابيع حسب يوم الأسبوع واتجاه آخر أسبوعين.</div></div></div>
    {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}
    <div className="grid g4">
      <div className="card kpi"><div className="l">عروض مقترحة لتقليل الهدر</div><div className="v">{num(expiry.length)}</div><div className="muted" style={{ fontSize: 12 }}>قيمة معرّضة {SAR(expiry.reduce((a, p) => a + Number(p.surplus) * Number(p.price), 0))}</div></div>
      <div className="card kpi"><div className="l">أصناف ستنفد قبل التوريد</div><div className="v" style={{ color: risk.length ? "var(--bad)" : undefined }}>{num(risk.length)}</div></div>
      <div className="card kpi"><div className="l">أصناف راكدة (+21 يومًا)</div><div className="v">{num(slow.length)}</div></div>
      <div className="card kpi"><div className="l">عملاء معرّضون للفقد</div><div className="v">{num(atRisk.length)}</div></div>
    </div>
    <div className="chips">{([["actions", "إجراءات مقترحة"], ["forecast", "توقع الطلب"], ["customers", "العملاء"], ["patterns", "أنماط الشراء"]] as const).map(([k, t]) =>
      <button key={k} className={`btn sm ${tab === k ? "" : "ghost"}`} onClick={() => setTab(k)}>{t}</button>)}</div>

    {tab === "actions" && <div className="grid g2">
      <div className="card"><h2>خصومات مقترحة قبل انتهاء الصلاحية</h2><div className="list">
        {expiry.map((p) => <div key={p.product_id} className="row sev warn"><div><div className="t">{p.name}</div>
          <div className="s">{num(p.expiring_qty)} تنتهي {p.next_expiry} · المتوقع بيعه قبلها {num(p.sell_before_expiry)} · فائض {num(p.surplus)}</div></div>
          <button className="btn sm" onClick={() => offer(p, p.suggested_discount)}>خصم {num(p.suggested_discount)}٪</button></div>)}
        {!expiry.length && <p className="muted">لا منتجات تحتاج خصمًا الآن.</p>}
      </div></div>
      <div className="card"><h2>ستنفد قبل وصول التوريد</h2><div className="list">
        {risk.map((p) => <div key={p.product_id} className="row sev bad"><div><div className="t">{p.name}</div>
          <div className="s">يكفي {num(p.days_cover)} يوم · التوريد {num(p.lead_days)} يوم · المتوقع 7 أيام {num(p.forecast_7d)}</div></div>
          <a className="btn ghost sm" href="/purchasing">المشتريات</a></div>)}
        {!risk.length && <p className="muted">المخزون يكفي حتى التوريد القادم.</p>}
      </div></div>
      <div className="card"><h2>أصناف راكدة</h2><div className="list">
        {slow.slice(0, 10).map((p) => <div key={p.product_id} className="row"><div><div className="t">{p.name}</div>
          <div className="s">{num(p.stock)} قطعة · {p.last_sale ? `آخر بيع ${p.last_sale}` : "لم يُبع منذ 8 أسابيع"} · رأس مال مجمّد {SAR(Number(p.stock) * Number(p.price) / 1.15)}</div></div>
          {!p.offer_pct && <button className="btn ghost sm" onClick={() => offer(p, 15)}>عرض 15٪</button>}</div>)}
        {!slow.length && <p className="muted">لا أصناف راكدة.</p>}
      </div></div>
      <div className="card"><h2>العروض النشطة</h2><div className="list">
        {offers.map((o) => <div key={o.id} className="row"><div><div className="t">{o.products.name} · خصم {num(o.discount_pct)}٪</div>
          <div className="s">{o.reason ?? ""} · ينتهي {new Date(o.ends_at).toLocaleDateString("ar-SA")}</div></div>
          <button className="btn ghost sm" onClick={() => endOffer(o.id)}>إيقاف</button></div>)}
        {!offers.length && <p className="muted">لا عروض نشطة.</p>}
      </div></div>
    </div>}

    {tab === "forecast" && <div className="card tbl"><h2>توقع الطلب للأيام السبعة القادمة</h2>
      <table><thead><tr><th>المنتج</th><th>الفئة ABC</th><th>المخزون</th><th>متوسط يومي</th><th>الاتجاه</th><th>المتوقع 7 أيام</th><th>يكفي (يوم)</th><th>إيراد 30 يومًا</th><th>ربح 30 يومًا</th></tr></thead>
        <tbody>{products.map((p) => <tr key={p.product_id}><td>{p.name}</td>
          <td><span className={`pill ${p.abc === "A" ? "p-ok" : p.abc === "B" ? "p-info" : "p-warn"}`}>{p.abc}</span></td>
          <td>{num(p.stock)}</td><td>{num(p.avg_daily)}</td>
          <td style={{ color: Number(p.trend) > 1.05 ? "var(--ok)" : Number(p.trend) < 0.95 ? "var(--bad)" : undefined }}>{Number(p.trend) > 1.05 ? "▲" : Number(p.trend) < 0.95 ? "▼" : "—"} {num(Math.round((Number(p.trend) - 1) * 100))}٪</td>
          <td><b>{num(p.forecast_7d)}</b></td>
          <td><span className={`pill ${p.days_cover == null ? "p-info" : Number(p.days_cover) <= p.lead_days + 1 ? "p-bad" : Number(p.days_cover) <= 7 ? "p-warn" : "p-ok"}`}>{p.days_cover == null ? "—" : num(p.days_cover)}</span></td>
          <td>{SAR(p.revenue_30d)}</td><td>{SAR(p.profit_30d)}</td></tr>)}</tbody></table>
      <p className="muted" style={{ fontSize: 12 }}>A: أصناف تحقق 80٪ من الإيراد، احرص ألا تنفد. C: أصناف قليلة المساهمة، قلّل مخزونها.</p>
    </div>}

    {tab === "customers" && <>
      <div className="chips">{segCount.map(([k, n]) => <span key={k} className={`pill ${SEG[k][1]}`}>{SEG[k][0]}: {num(n)}</span>)}</div>
      <div className="card tbl"><h2>العملاء المعروفون (آخر 6 أشهر)</h2>
        <table><thead><tr><th>العميل</th><th>الشريحة</th><th>مرات الشراء</th><th>الإنفاق</th><th>يشتري كل</th><th>آخر شراء</th><th></th></tr></thead>
          <tbody>{customers.map((c) => { const w = wa(c); return <tr key={c.customer_id}><td>{c.name}{c.high_value && <span className="pill p-ok" style={{ marginInlineStart: 6 }}>عالي القيمة</span>}</td>
            <td><span className={`pill ${SEG[c.segment][1]}`}>{SEG[c.segment][0]}</span></td><td>{num(c.purchases)}</td><td>{SAR(c.spent)}</td>
            <td>{c.avg_interval ? `${num(c.avg_interval)} يوم` : "—"}</td><td>منذ {num(c.days_since)} يوم</td>
            <td>{c.segment === "at_risk" && w && <a className="btn ghost sm" href={w} target="_blank" rel="noreferrer">تواصل</a>}</td></tr>; })}</tbody></table>
        {!customers.length && <p className="muted">تظهر هنا تحليلات العملاء بعد طلبات أونلاين أو مبيعات مرتبطة بعملاء.</p>}
      </div></>}

    {tab === "patterns" && <div className="grid g2">
      <div className="card"><h2>منتجات تُشترى معًا</h2><div className="list">
        {pairs.slice(0, 12).map((p, i) => <div key={i} className="row"><div><div className="t">{p.name_a} + {p.name_b}</div>
          <div className="s">{num(p.together)} فاتورة · ارتباط {num(p.lift)}×</div></div><span className="pill p-info">{num(p.confidence)}٪</span></div>)}
        {!pairs.length && <p className="muted">تحتاج مبيعات أكثر لاكتشاف الأنماط.</p>}
        <p className="muted" style={{ fontSize: 12 }}>ضع هذه المنتجات قرب بعضها، أو اعرضها كباقة. تظهر تلقائيًا كاقتراحات في سلة العميل.</p>
      </div></div>
      <div className="card"><h2>أوقات الذروة (آخر 4 أسابيع)</h2>
        {peak && <p className="muted" style={{ marginTop: 0 }}>الأعلى: {DAYS[peak.dow]} الساعة {num(peak.hour)}:00 ({num(peak.invoices)} فاتورة)</p>}
        <div className="tbl"><table style={{ fontSize: 11 }}><thead><tr><th></th>{hours.map((h) => <th key={h} style={{ padding: 2, textAlign: "center" }}>{h}</th>)}</tr></thead>
          <tbody>{DAYS.map((d, di) => <tr key={d}><td style={{ padding: "2px 6px" }}>{d}</td>{hours.map((h) => {
            const c = heat.find((x) => x.dow === di && x.hour === h)?.invoices ?? 0;
            return <td key={h} title={`${num(c)} فاتورة`} style={{ padding: 0, border: "1px solid var(--bg)" }}>
              <div style={{ width: "100%", minWidth: 16, height: 18, background: "var(--brand)", opacity: c ? 0.15 + 0.85 * c / maxHeat : 0.04 }} /></td>; })}</tr>)}</tbody></table></div>
      </div>
      <div className="card"><h2>بحث عنه العملاء ولم يجدوه</h2><div className="list">
        {missing.map(([t, n]) => <div key={t} className="row"><span className="t">{t}</span><span className="pill p-warn">{num(n)} مرة</span></div>)}
        {!missing.length && <p className="muted">لا عمليات بحث بلا نتائج في آخر 30 يومًا.</p>}
        <p className="muted" style={{ fontSize: 12 }}>طلب موجود لا تبيعه: فكّر في إضافته.</p>
      </div></div>
    </div>}
  </>);
}
