"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { num } from "@/lib/format";
import BarcodeInput from "@/components/BarcodeInput";

type P = { id: string; barcode: string; name: string; cost: number };
type Recent = { id: number; qty: number; created_at: string; ref: string | null; products: { name: string } | null };

export default function ReceiveClient({ products, locs, recent }: { products: P[]; locs: { id: string; name: string }[]; recent: Recent[] }) {
  const r = useRouter();
  const [p, setP] = useState<P | null>(null);
  const [miss, setMiss] = useState("");
  const [qty, setQty] = useState("1");
  const [exp, setExp] = useState("");
  const [cost, setCost] = useState("");
  const [loc, setLoc] = useState(locs[0]?.id ?? "");
  const [ref, setRef] = useState("");
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);

  const onScan = useCallback((code: string) => {
    const f = products.find((x) => x.barcode === code);
    setMsg(null);
    if (!f) { setP(null); setMiss(code); return; }
    setMiss(""); setP(f); setCost(String(f.cost)); setQty("1");
    setTimeout(() => document.getElementById("rq")?.focus(), 50);
  }, [products]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!p) return;
    const { error } = await supabaseBrowser().rpc("receive_stock", {
      p_product: p.id, p_qty: Number(qty), p_location: loc, p_expiry: exp || null,
      p_unit_cost: cost ? Number(cost) : null, p_ref: ref || null,
    });
    if (error) return setMsg({ t: "err", m: error.message });
    setMsg({ t: "ok", m: `أُضيف ${num(qty)} من ${p.name}` });
    setP(null); setExp(""); r.refresh();
  }

  return (<>
    <div className="head"><div><h1>استلام بضاعة</h1><div className="sub">امسح المنتج ثم أدخل الكمية وتاريخ الصلاحية. كل استلام يُسجَّل كدفعة مستقلة.</div></div></div>
    <div className="card"><BarcodeInput onScan={onScan} />
      {miss && <div className="err" style={{ marginTop: 10 }}>الباركود {miss} غير معرّف. <Link href="/products">عرّفه في صفحة المنتجات</Link> ثم أعد المسح.</div>}
      {msg && <div className={msg.t === "err" ? "err" : "okmsg"} style={{ marginTop: 10 }}>{msg.m}</div>}
    </div>
    {p && (
      <form className="card" onSubmit={save}>
        <h2>{p.name}</h2>
        <div className="form">
          <div className="field"><label htmlFor="rq">الكمية</label><input id="rq" type="number" min="0.001" step="any" required value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="field"><label htmlFor="re">تاريخ الصلاحية</label><input id="re" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></div>
          <div className="field"><label htmlFor="rc">تكلفة الوحدة</label><input id="rc" type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          <div className="field"><label htmlFor="rl">الموقع</label><select id="rl" value={loc} onChange={(e) => setLoc(e.target.value)}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div className="field"><label htmlFor="rr">رقم فاتورة المورد</label><input id="rr" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <button className="btn">تسجيل الاستلام</button>
        </div>
      </form>
    )}
    <div className="card tbl"><h2>آخر عمليات الاستلام</h2>
      <table><thead><tr><th>المنتج</th><th>الكمية</th><th>المرجع</th><th>الوقت</th></tr></thead>
        <tbody>{recent.map((m) => <tr key={m.id}><td>{m.products?.name}</td><td>{num(m.qty)}</td><td>{m.ref ?? "—"}</td><td className="muted">{new Date(m.created_at).toLocaleString("ar-SA")}</td></tr>)}</tbody></table>
      {recent.length === 0 && <p className="muted">لا عمليات استلام بعد.</p>}
    </div>
  </>);
}
