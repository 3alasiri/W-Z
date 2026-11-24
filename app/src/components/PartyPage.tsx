"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR } from "@/lib/format";

type Row = { id: string; name: string; phone: string | null; balance: number; lead_days?: number; credit_limit?: number };
type Kind = "supplier" | "customer";

const T = {
  supplier: { title: "الموردون", table: "suppliers", sub: "الرصيد = المستحق للمورد من فواتير الاستلام بعد خصم المدفوع.", extra: "lead_days", extraLabel: "مدة التوريد (أيام)",
    rpc: "pay_supplier", rpcKey: "p_supplier", payLabel: "سداد", payOk: "سُجّل السداد", bal: "المستحق له", none: "لا موردين بعد." },
  customer: { title: "العملاء", table: "customers", sub: "عملاء البيع الآجل. الرصيد = المستحق على العميل.", extra: "credit_limit", extraLabel: "حد الائتمان (0 = بلا حد)",
    rpc: "receive_customer_payment", rpcKey: "p_customer", payLabel: "تحصيل", payOk: "سُجّل التحصيل", bal: "المستحق عليه", none: "لا عملاء بعد." },
} as const;

export default function PartyPage({ kind, storeId, rows, canPay }: { kind: Kind; storeId: string; rows: Row[]; canPay: boolean }) {
  const t = T[kind];
  const r = useRouter();
  const sb = supabaseBrowser();
  const [f, setF] = useState({ id: "", name: "", phone: "", extra: kind === "supplier" ? "2" : "0" });
  const [pay, setPay] = useState<{ id: string; amount: string; method: string; memo: string } | null>(null);
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);
  const total = rows.reduce((a, x) => a + Number(x.balance), 0);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const body = { store_id: storeId, name: f.name.trim(), phone: f.phone.trim() || null, [t.extra]: Number(f.extra) || 0 };
    const { error } = f.id ? await sb.from(t.table).update(body).eq("id", f.id) : await sb.from(t.table).insert(body);
    if (error) return setMsg({ t: "err", m: error.message });
    setF({ id: "", name: "", phone: "", extra: kind === "supplier" ? "2" : "0" }); r.refresh();
  }
  async function doPay(e: React.FormEvent) {
    e.preventDefault(); if (!pay) return; setMsg(null);
    const { error } = await sb.rpc(t.rpc, { [t.rpcKey]: pay.id, p_amount: Number(pay.amount), p_method: pay.method, p_memo: pay.memo || null });
    if (error) return setMsg({ t: "err", m: error.message });
    setPay(null); setMsg({ t: "ok", m: t.payOk }); r.refresh();
  }

  return (<>
    <div className="head"><div><h1>{t.title}</h1><div className="sub">{t.sub}</div></div>
      <div className="card kpi" style={{ padding: "8px 14px" }}><div className="l">إجمالي {t.bal}</div><div className="v" style={{ fontSize: 18 }}>{SAR(total)}</div></div></div>
    {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}
    <form className="card" onSubmit={save}><h2>{f.id ? "تعديل" : "إضافة"}</h2>
      <div className="form">
        <div className="field"><label htmlFor="pn">الاسم</label><input id="pn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="pp">الجوال</label><input id="pp" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="05xxxxxxxx" /></div>
        <div className="field"><label htmlFor="px">{t.extraLabel}</label><input id="px" type="number" min="0" value={f.extra} onChange={(e) => setF({ ...f, extra: e.target.value })} /></div>
        <button className="btn">حفظ</button>
      </div>
    </form>
    {pay && (
      <form className="card" onSubmit={doPay}><h2>{t.payLabel}: {rows.find((x) => x.id === pay.id)?.name}</h2>
        <div className="form">
          <div className="field"><label htmlFor="pa">المبلغ</label><input id="pa" type="number" min="0.01" step="0.01" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
          <div className="field"><label htmlFor="pm">الطريقة</label><select id="pm" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="cash">نقدًا</option><option value="card">مدى / تحويل بنكي</option></select></div>
          <div className="field"><label htmlFor="po">ملاحظة</label><input id="po" value={pay.memo} onChange={(e) => setPay({ ...pay, memo: e.target.value })} /></div>
          <button className="btn">تأكيد</button><button type="button" className="btn ghost" onClick={() => setPay(null)}>إلغاء</button>
        </div>
      </form>
    )}
    <div className="card tbl"><table><thead><tr><th>الاسم</th><th>الجوال</th><th>{t.extraLabel}</th><th>{t.bal}</th><th></th></tr></thead>
      <tbody>{rows.map((x) => (
        <tr key={x.id}><td>{x.name}</td><td dir="ltr" style={{ textAlign: "right" }}>{x.phone ?? "—"}</td>
          <td>{kind === "supplier" ? x.lead_days : Number(x.credit_limit) ? SAR(x.credit_limit) : "بلا حد"}</td>
          <td><b className={Number(x.balance) > 0 ? "" : "muted"}>{SAR(x.balance)}</b></td>
          <td className="chips">
            <button className="btn ghost sm" onClick={() => setF({ id: x.id, name: x.name, phone: x.phone ?? "", extra: String(kind === "supplier" ? x.lead_days : x.credit_limit) })}>تعديل</button>
            {canPay && Number(x.balance) > 0 && <button className="btn sm" onClick={() => setPay({ id: x.id, amount: String(x.balance), method: "cash", memo: "" })}>{t.payLabel}</button>}
          </td></tr>))}</tbody></table>
      {rows.length === 0 && <p className="muted">{t.none}</p>}
    </div>
  </>);
}
