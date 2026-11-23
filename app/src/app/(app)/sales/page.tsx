import { requireStore } from "@/lib/supabase-server";
import { SAR, num } from "@/lib/format";

const M: Record<string, string> = { cash: "نقدًا", card: "مدى / بطاقة", credit: "آجل" };

export default async function Sales() {
  const { sb, storeId } = await requireStore();
  const { data } = await sb.from("sales").select("id,number,total,vat,payment_method,created_at,sale_items(name,qty)").eq("store_id", storeId).order("created_at", { ascending: false }).limit(100);
  const rows = data ?? [];
  return (<>
    <div className="head"><div><h1>المبيعات</h1><div className="sub">آخر 100 فاتورة</div></div></div>
    <div className="card tbl"><table><thead><tr><th>رقم</th><th>الوقت</th><th>الأصناف</th><th>الضريبة</th><th>الإجمالي</th><th>الدفع</th></tr></thead>
      <tbody>{rows.map((s) => (
        <tr key={s.id}><td>{num(s.number)}</td><td className="muted">{new Date(s.created_at).toLocaleString("ar-SA")}</td>
          <td style={{ whiteSpace: "normal" }}>{s.sale_items.map((i: { name: string; qty: number }) => `${i.name} × ${num(i.qty)}`).join("، ")}</td>
          <td>{SAR(s.vat)}</td><td><b>{SAR(s.total)}</b></td><td>{M[s.payment_method]}</td></tr>))}</tbody></table>
      {rows.length === 0 && <p className="muted">لا مبيعات بعد.</p>}
    </div>
  </>);
}
