import Link from "next/link";
import { requireStore } from "@/lib/supabase-server";
import { SAR, num, expiryLabel } from "@/lib/format";

export default async function Dashboard() {
  const { sb, storeId, storeName } = await requireStore();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [{ data: today }, { data: alerts }, { data: stock }] = await Promise.all([
    sb.from("sales").select("id,total").eq("store_id", storeId).gte("created_at", start.toISOString()),
    sb.from("stock_alerts").select("*").eq("store_id", storeId),
    sb.from("product_stock").select("stock,cost").eq("store_id", storeId),
  ]);
  const { data: items } = today?.length
    ? await sb.from("sale_items").select("qty,unit_cost,line_total").in("sale_id", today.map((s) => s.id))
    : { data: [] as { qty: number; unit_cost: number; line_total: number }[] };
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
    <div className="card"><h2>تنبيهات تحتاج إجراء ({num(al.length)})</h2>
      {al.length === 0 ? <p className="muted">لا تنبيهات. المخزون والصلاحيات بحالة جيدة.</p> :
        <div className="list">{al.slice(0, 8).map((a, i) => (
          <div key={i} className={`row sev ${a.severity}`}><div><div className="t">{a.name}</div>
            <div className="s">{a.kind === "out" ? "نفد من المخزون" : a.kind === "low" ? `منخفض: ${num(a.stock)} · نقطة الطلب ${num(a.reorder_point)}` : `${expiryLabel(a.expiry_date)} · ${num(a.stock)} قطعة`}</div></div></div>))}
          <Link className="btn ghost sm" href="/alerts">كل التنبيهات</Link></div>}
    </div>
  </>);
}
