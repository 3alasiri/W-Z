"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

const EXP = [["6100", "الرواتب"], ["6200", "الإيجار"], ["6300", "الكهرباء والماء"], ["6400", "التوصيل والنقل"], ["6900", "مصروفات أخرى"]];

export default function AccountingForms({ storeId, isOwner }: { storeId: string; isOwner: boolean }) {
  const r = useRouter(); const sb = supabaseBrowser();
  const [e, setE] = useState({ code: "6300", amount: "", vat: "", method: "cash", memo: "" });
  const [d, setD] = useState({ amount: "", method: "cash" });
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);

  async function expense(ev: React.FormEvent) {
    ev.preventDefault(); setMsg(null);
    const { error } = await sb.rpc("record_expense", { p_store: storeId, p_code: e.code, p_amount: Number(e.amount), p_vat: Number(e.vat) || 0, p_method: e.method, p_memo: e.memo });
    if (error) return setMsg({ t: "err", m: error.message });
    setE({ ...e, amount: "", vat: "", memo: "" }); setMsg({ t: "ok", m: "سُجّل المصروف" }); r.refresh();
  }
  async function deposit(ev: React.FormEvent) {
    ev.preventDefault(); setMsg(null);
    const { error } = await sb.rpc("owner_deposit", { p_store: storeId, p_amount: Number(d.amount), p_method: d.method });
    if (error) return setMsg({ t: "err", m: error.message });
    setD({ ...d, amount: "" }); setMsg({ t: "ok", m: "سُجّل الإيداع" }); r.refresh();
  }

  return (<>
    {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}
    <div className="grid g2">
      <form className="card" onSubmit={expense}><h2>تسجيل مصروف</h2>
        <div className="form">
          <div className="field"><label htmlFor="ec">النوع</label><select id="ec" value={e.code} onChange={(x) => setE({ ...e, code: x.target.value })}>{EXP.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
          <div className="field"><label htmlFor="ea">المبلغ قبل الضريبة</label><input id="ea" type="number" min="0.01" step="0.01" required value={e.amount} onChange={(x) => setE({ ...e, amount: x.target.value })} /></div>
          <div className="field"><label htmlFor="ev">الضريبة (إن وجدت)</label><input id="ev" type="number" min="0" step="0.01" value={e.vat} onChange={(x) => setE({ ...e, vat: x.target.value })} /></div>
          <div className="field"><label htmlFor="em">الدفع</label><select id="em" value={e.method} onChange={(x) => setE({ ...e, method: x.target.value })}><option value="cash">نقدًا</option><option value="card">بنك</option></select></div>
          <div className="field"><label htmlFor="en">البيان</label><input id="en" value={e.memo} onChange={(x) => setE({ ...e, memo: x.target.value })} placeholder="فاتورة كهرباء نوفمبر" /></div>
          <button className="btn">تسجيل</button>
        </div>
      </form>
      {isOwner && <form className="card" onSubmit={deposit}><h2>إيداع رأس مال</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>استخدمه لتسجيل رصيد الصندوق أو البنك الافتتاحي، أو أي مبلغ يضيفه المالك.</p>
        <div className="form">
          <div className="field"><label htmlFor="da">المبلغ</label><input id="da" type="number" min="0.01" step="0.01" required value={d.amount} onChange={(x) => setD({ ...d, amount: x.target.value })} /></div>
          <div className="field"><label htmlFor="dm">إلى</label><select id="dm" value={d.method} onChange={(x) => setD({ ...d, method: x.target.value })}><option value="cash">الصندوق</option><option value="card">البنك</option></select></div>
          <button className="btn">تسجيل</button>
        </div>
      </form>}
    </div>
  </>);
}
