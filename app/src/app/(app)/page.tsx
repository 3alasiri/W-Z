import Link from "next/link";
import { requireStore } from "@/lib/supabase-server";
import { SAR, num, expiryLabel } from "@/lib/format";

export default async function Dashboard() {
  const { sb, storeId, storeName, role } = await requireStore();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [{ data: today }, { data: alerts }, { data: stock }] = await Promise.all([
    sb.from("sales").select("id,total").eq("store_id", storeId).gte("created_at", start.toISOString()),
    sb.from("stock_alerts").select("*").eq("store_id", storeId),
    sb.from("product_stock").select("stock,cost").eq("store_id", storeId),
  ]);
  const { data: items } = today?.length
    ? await sb.from("sale_items").select("qty,unit_cost,line_total").in("sale_id", today.map((s) => s.id))
    : { data: [] as { qty: number; unit_cost: number; line_total: number }[] };
  const admin = role === "owner" || role === "manager";
  const { data: ins } = admin ? await sb.rpc("product_insights", { p_store: storeId }) : { data: null };
  type PI = { name: string; stock: number; days_cover: number | null; lead_days: number; suggested_discount: number; offer_pct: number | null; forecast_7d: number; trend: number; abc: string };
  const pi = (ins ?? []) as PI[];
  const aiExpiry = pi.filter((p) => p.suggested_discount > 0 && !p.offer_pct);
  const aiRisk = pi.filter((p) => Number(p.stock) > 0 && p.days_cover != null && Number(p.days_cover) <= p.lead_days + 1);
  const aiRising = pi.filter((p) => p.abc !== "C" && Number(p.trend) >= 1.15);
  const revenue = (today ?? []).reduce((a, s) => a + Number(s.total), 0);
  const cogs = (items ?? []).reduce((a, i) => a + Number(i.qty) * Number(i.unit_cost), 0);
  const invValue = (stock ?? []).reduce((a, p) => a + Number(p.stock) * Number(p.cost), 0);
  const al = alerts ?? [];
  const order = { bad: 0, warn: 1 } as Record<string, number>;
  al.sort((a, b) => order[a.severity] - order[b.severity]);

  return (<>
    <div className="head"><div><h1>لوحة القيادة</h1><div className="sub">{storeName} · {new Date().toLocaleDateString("ar-SA", { weekday: "long", day: "numeric", month: "long" })}</div></div>
      <Link className="btn" href="/pos">فتح نقطة البيع</Link></div>
    <div className="grid g4">
      <div className="card kpi"><div className="l">مبيعات اليوم</div><div className="v">{SAR(revenue)}</div></div>
      <div className="card kpi"><div className="l">عدد الفواتير</div><div className="v">{num(today?.length ?? 0)}</div></div>
      <div className="card kpi"><div className="l">مجمل الربح اليوم</div><div className="v">{SAR(revenue / 1.15 - cogs)}</div></div>
      <div className="card kpi"><div className="l">قيمة المخزون بالتكلفة</div><div className="v">{SAR(invValue)}</div></div>
    </div>
    {admin && (aiExpiry.length + aiRisk.length + aiRising.length > 0) && <div className="card"><h2>توصيات الذكاء الاصطناعي</h2><div className="list">
      {aiRisk.slice(0, 3).map((p) => <div key={"r" + p.name} className="row sev bad"><div><div className="t">{p.name} سينفد خلال {num(p.days_cover)} يوم</div><div className="s">التوريد يستغرق {num(p.lead_days)} يوم. المتوقع بيعه هذا الأسبوع {num(p.forecast_7d)}.</div></div><Link className="btn sm" href="/purchasing">المشتريات</Link></div>)}
      {aiExpiry.slice(0, 3).map((p) => <div key={"e" + p.name} className="row sev warn"><div><div className="t">خصم {num(p.suggested_discount)}٪ على {p.name}</div><div className="s">لن تُباع الكمية كاملة قبل انتهاء صلاحيتها بمعدل البيع الحالي.</div></div><Link className="btn sm" href="/insights">تطبيق</Link></div>)}
      {aiRising.slice(0, 2).map((p) => <div key={"t" + p.name} className="row sev info"><div><div className="t">الطلب على {p.name} يرتفع {num(Math.round((Number(p.trend) - 1) * 100))}٪</div><div className="s">زِد الكمية في أمر الشراء القادم.</div></div></div>)}
      <Link className="btn ghost sm" href="/assistant">اسأل المساعد الذكي</Link></div></div>}
    <div className="card"><h2>تنبيهات تحتاج إجراء ({num(al.length)})</h2>
      {al.length === 0 ? <p className="muted">لا تنبيهات. المخزون والصلاحيات بحالة جيدة.</p> :
        <div className="list">{al.slice(0, 8).map((a, i) => (
          <div key={i} className={`row sev ${a.severity}`}><div><div className="t">{a.name}</div>
            <div className="s">{a.kind === "out" ? "نفد من المخزون" : a.kind === "low" ? `منخفض: ${num(a.stock)} · نقطة الطلب ${num(a.reorder_point)}` : `${expiryLabel(a.expiry_date)} · ${num(a.stock)} قطعة`}</div></div></div>))}
          <Link className="btn ghost sm" href="/alerts">كل التنبيهات</Link></div>}
    </div>
  </>);
}
