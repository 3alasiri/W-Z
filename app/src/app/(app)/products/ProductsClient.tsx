"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num, expiryLabel, daysTo } from "@/lib/format";
import BarcodeInput from "@/components/BarcodeInput";

type Row = { id: string; barcode: string; name: string; category: string | null; supplier: string | null; cost: number; price: number; min_qty: number; stock: number; next_expiry: string | null; active: boolean };
type Opt = { id: string; name: string };
const empty = { id: "", barcode: "", name: "", category: "", supplier: "", lead: "2", cost: "", price: "", min_qty: "0", unit: "قطعة" };

export default function ProductsClient({ storeId, rows, cats, sups }: { storeId: string; rows: Row[]; cats: Opt[]; sups: Opt[] }) {
  const r = useRouter();
  const [f, setF] = useState(empty);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  function startNew(barcode = "") {
    const ex = rows.find((x) => x.barcode === barcode);
    if (ex) return edit(ex);
    setF({ ...empty, barcode }); setOpen(true); setErr("");
  }
  function edit(x: Row) {
    setF({ id: x.id, barcode: x.barcode, name: x.name, category: x.category ?? "", supplier: x.supplier ?? "", lead: "2", cost: String(x.cost), price: String(x.price), min_qty: String(x.min_qty), unit: "قطعة" });
    setOpen(true); setErr("");
  }

  async function idFor(table: "categories" | "suppliers", name: string, list: Opt[], extra: Record<string, unknown> = {}) {
    if (!name.trim()) return null;
    const ex = list.find((c) => c.name === name.trim());
    if (ex) return ex.id;
    const { data, error } = await supabaseBrowser().from(table).insert({ store_id: storeId, name: name.trim(), ...extra }).select("id").single();
    if (error) throw error;
    return data.id as string;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try {
      const category_id = await idFor("categories", f.category, cats);
      const supplier_id = await idFor("suppliers", f.supplier, sups, { lead_days: Number(f.lead) || 2 });
      const body = { store_id: storeId, barcode: f.barcode.trim(), name: f.name.trim(), category_id, supplier_id, cost: Number(f.cost) || 0, price: Number(f.price), min_qty: Number(f.min_qty) || 0, unit: f.unit };
      const sb = supabaseBrowser();
      const { error } = f.id ? await sb.from("products").update(body).eq("id", f.id) : await sb.from("products").insert(body);
      if (error) throw error;
      setOpen(false); r.refresh();
    } catch (x: unknown) {
      const m = (x as { message?: string }).message ?? "";
      setErr(m.includes("duplicate") ? "هذا الباركود مسجل لمنتج آخر" : m);
    }
  }

  const shown = rows.filter((x) => !q || x.name.includes(q) || x.barcode.includes(q));

  return (<>
    <div className="head"><div><h1>المنتجات</h1><div className="sub">{num(rows.length)} منتجًا</div></div>
      <button className="btn" onClick={() => startNew()}>منتج جديد</button></div>
    <div className="card"><h2>بحث أو تعريف منتج بالباركود</h2>
      <BarcodeInput onScan={startNew} placeholder="امسح باركود منتج لتعريفه أو تعديله" autoFocus={false} />
    </div>
    {open && (
      <form className="card" onSubmit={save}>
        <h2>{f.id ? "تعديل منتج" : "منتج جديد"}</h2>
        <div className="form">
          <div className="field"><label htmlFor="bc">الباركود</label><input id="bc" required value={f.barcode} onChange={set("barcode")} dir="ltr" /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="nm">الاسم</label><input id="nm" required value={f.name} onChange={set("name")} /></div>
          <div className="field"><label htmlFor="ct">الفئة</label><input id="ct" list="cats" value={f.category} onChange={set("category")} /></div>
          <div className="field"><label htmlFor="sp">المورد</label><input id="sp" list="sups" value={f.supplier} onChange={set("supplier")} /></div>
          <div className="field"><label htmlFor="ld">مدة التوريد (أيام)</label><input id="ld" type="number" min="1" value={f.lead} onChange={set("lead")} /></div>
          <div className="field"><label htmlFor="co">التكلفة</label><input id="co" type="number" step="0.01" min="0" value={f.cost} onChange={set("cost")} /></div>
          <div className="field"><label htmlFor="pr">سعر البيع (شامل الضريبة)</label><input id="pr" type="number" step="0.01" min="0" required value={f.price} onChange={set("price")} /></div>
          <div className="field"><label htmlFor="mq">الحد الأدنى للكمية</label><input id="mq" type="number" min="0" value={f.min_qty} onChange={set("min_qty")} /></div>
        </div>
        <datalist id="cats">{cats.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <datalist id="sups">{sups.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
        <div className="chips" style={{ marginTop: 12 }}><button className="btn">حفظ</button><button type="button" className="btn ghost" onClick={() => setOpen(false)}>إلغاء</button></div>
      </form>
    )}
    <div className="card">
      <input placeholder="ابحث بالاسم أو الباركود" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" style={{ marginBottom: 10 }} />
      <div className="tbl"><table><thead><tr><th>الباركود</th><th>المنتج</th><th>الفئة</th><th>الكمية</th><th>أقرب صلاحية</th><th>التكلفة</th><th>السعر</th><th>المورد</th><th></th></tr></thead>
        <tbody>{shown.map((x) => {
          const d = x.next_expiry ? daysTo(x.next_expiry) : null;
          return (<tr key={x.id}><td className="muted" dir="ltr">{x.barcode}</td><td>{x.name}</td><td>{x.category ?? "—"}</td>
            <td><span className={`pill ${Number(x.stock) <= 0 ? "p-bad" : Number(x.stock) <= Number(x.min_qty) ? "p-warn" : "p-ok"}`}>{num(x.stock)}</span></td>
            <td>{x.next_expiry ? <span className={`pill ${d! < 0 || d! <= 3 ? "p-bad" : d! <= 7 ? "p-warn" : "p-info"}`}>{expiryLabel(x.next_expiry)}</span> : "—"}</td>
            <td>{SAR(x.cost)}</td><td>{SAR(x.price)}</td><td>{x.supplier ?? "—"}</td>
            <td><button className="btn ghost sm" onClick={() => edit(x)}>تعديل</button></td></tr>);
        })}</tbody></table>
        {shown.length === 0 && <p className="muted">لا منتجات بعد. امسح باركود أول منتج لتعريفه.</p>}
      </div>
    </div>
  </>);
}
