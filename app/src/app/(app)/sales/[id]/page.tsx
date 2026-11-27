import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStore } from "@/lib/supabase-server";
import { SAR, num, PAY } from "@/lib/format";
import InvoiceQR from "@/components/InvoiceQR";
import PrintButton from "@/components/PrintButton";

export default async function Invoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, storeId } = await requireStore();
  const [{ data: s }, { data: st }] = await Promise.all([
    sb.from("sales").select("*, sale_items(name,qty,unit_price,line_total), customers(name,phone)").eq("id", id).eq("store_id", storeId).maybeSingle(),
    sb.from("stores").select("name,vat_number,address,phone,vat_rate").eq("id", storeId).single(),
  ]);
  if (!s || !st) notFound();
  return (
    <div className="card" style={{ maxWidth: 420, margin: "0 auto", width: "100%" }}>
      <div className="list" style={{ textAlign: "center", gap: 4 }}>
        <h2 style={{ margin: 0 }}>{st.name}</h2>
        {st.address && <div className="muted">{st.address}</div>}
        {st.vat_number && <div className="muted">الرقم الضريبي: {st.vat_number}</div>}
        <b style={{ marginTop: 8 }}>فاتورة ضريبية مبسطة</b>
        <div className="muted">رقم {num(s.number)} · {new Date(s.created_at).toLocaleString("ar-SA")}</div>
        {s.customers && <div className="muted">العميل: {s.customers.name}</div>}
      </div>
      <div className="tbl" style={{ margin: "12px 0" }}><table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>{s.sale_items.map((i: { name: string; qty: number; unit_price: number; line_total: number }, k: number) =>
          <tr key={k}><td style={{ whiteSpace: "normal" }}>{i.name}</td><td>{num(i.qty)}</td><td>{SAR(i.unit_price)}</td><td>{SAR(i.line_total)}</td></tr>)}</tbody></table></div>
      {Number(s.delivery_fee) > 0 && <div className="total"><span>التوصيل</span><span>{SAR(s.delivery_fee)}</span></div>}
      <div className="total"><span>الإجمالي قبل الضريبة</span><span>{SAR(s.subtotal)}</span></div>
      <div className="total"><span>ضريبة القيمة المضافة {num(st.vat_rate)}٪</span><span>{SAR(s.vat)}</span></div>
      <div className="total big"><span>الإجمالي شامل الضريبة</span><span>{SAR(s.total)}</span></div>
      <div className="muted" style={{ textAlign: "center", margin: "8px 0" }}>طريقة الدفع: {PAY[s.payment_method]}</div>
      <InvoiceQR seller={st.name} vatNumber={st.vat_number} time={s.created_at} total={Number(s.total)} vat={Number(s.vat)} size={160} />
      <div className="chips noprint" style={{ justifyContent: "center", marginTop: 12 }}><PrintButton /><Link className="btn ghost" href="/sales">رجوع</Link></div>
    </div>
  );
}
