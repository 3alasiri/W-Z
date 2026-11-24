"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num, PO_STATUS } from "@/lib/format";

type PO = { id: string; number: number; status: string; auto: boolean; total: number; created_at: string; suppliers: { name: string } | null };

export default function PurchasingClient({ storeId, role, pos, sups, limit }: { storeId: string; role: string; pos: PO[]; sups: { id: string; name: string }[]; limit: number }) {
  const r = useRouter();
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);
  const [sup, setSup] = useState(sups[0]?.id ?? "");
  const [lim, setLim] = useState(String(limit));
  const [tab, setTab] = useState<"open" | "all">("open");
  const sb = supabaseBrowser();

  async function generate() {
    setMsg(null);
    const { data, error } = await sb.rpc("generate_purchase_orders", { p_store: storeId });
    if (error) return setMsg({ t: "err", m: error.message });
    setMsg({ t: "ok", m: data ? `أُنشئ ${num(data)} أمر شراء للأصناف الناقصة` : "لا أصناف ناقصة بلا أمر شراء مفتوح" });
    r.refresh();
  }
  async function create() {
    const { data, error } = await sb.rpc("create_po", { p_store: storeId, p_supplier: sup });
    if (error) return setMsg({ t: "err", m: error.message });
    r.push(`/purchasing/${data}`);
  }
  async function saveLimit() {
    const { error } = await sb.from("stores").update({ auto_approve_limit: Number(lim) || 0 }).eq("id", storeId);
    setMsg(error ? { t: "err", m: error.message } : { t: "ok", m: "حُفظ حد الاعتماد التلقائي" });
  }

  const shown = pos.filter((p) => tab === "all" || !["received", "cancelled"].includes(p.status));
  const isAdmin = role === "owner" || role === "manager";

  return (<>
    <div className="head"><div><h1>المشتريات</h1><div className="sub">يفحص النظام المخزون كل ساعة ويجهّز أمر شراء لكل مورد عند نزول الكمية تحت نقطة إعادة الطلب.</div></div>
      <button className="btn" onClick={generate}>فحص النواقص الآن</button></div>
    {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}
    <div className="grid g2">
      <div className="card"><h2>أمر شراء يدوي</h2>
        {sups.length ? <div className="scan"><select value={sup} onChange={(e) => setSup(e.target.value)} aria-label="المورد">{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <button className="btn" onClick={create}>إنشاء</button></div> : <p className="muted">أضف موردًا أولًا من صفحة الموردين.</p>}
      </div>
      <div className="card"><h2>الاعتماد التلقائي</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>الأوامر التلقائية التي لا تتجاوز هذا المبلغ (قبل الضريبة) تُعتمد دون تدخل. ضع 0 لاعتماد كل الأوامر يدويًا.</p>
        <div className="scan"><input type="number" min="0" value={lim} onChange={(e) => setLim(e.target.value)} disabled={!isAdmin} aria-label="حد الاعتماد" /><button className="btn" disabled={!isAdmin} onClick={saveLimit}>حفظ</button></div>
      </div>
    </div>
    <div className="card">
      <div className="chips" style={{ marginBottom: 10 }}>
        <button className={`btn sm ${tab === "open" ? "" : "ghost"}`} onClick={() => setTab("open")}>المفتوحة</button>
        <button className={`btn sm ${tab === "all" ? "" : "ghost"}`} onClick={() => setTab("all")}>الكل</button>
      </div>
      <div className="tbl"><table><thead><tr><th>رقم</th><th>المورد</th><th>الحالة</th><th>المصدر</th><th>الإجمالي قبل الضريبة</th><th>التاريخ</th><th></th></tr></thead>
        <tbody>{shown.map((p) => (
          <tr key={p.id}><td>{num(p.number)}</td><td>{p.suppliers?.name}</td>
            <td><span className={`pill ${PO_STATUS[p.status][1]}`}>{PO_STATUS[p.status][0]}</span></td>
            <td>{p.auto ? <span className="pill p-info">تلقائي</span> : "يدوي"}</td>
            <td>{SAR(p.total)}</td><td className="muted">{new Date(p.created_at).toLocaleDateString("ar-SA")}</td>
            <td><Link className="btn ghost sm" href={`/purchasing/${p.id}`}>فتح</Link></td></tr>))}</tbody></table>
        {shown.length === 0 && <p className="muted">لا أوامر شراء {tab === "open" ? "مفتوحة" : ""}.</p>}
      </div>
    </div>
  </>);
}
