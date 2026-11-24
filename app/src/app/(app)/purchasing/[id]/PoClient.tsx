"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num, PO_STATUS } from "@/lib/format";
import BarcodeInput from "@/components/BarcodeInput";

type PO = { id: string; number: number; status: string; auto: boolean; total: number; created_at: string; suppliers: { name: string; phone: string | null; email: string | null } };
type Item = { id: number; product_id: string; qty: number; unit_cost: number; received_qty: number; products: { name: string; barcode: string } };
type P = { id: string; barcode: string; name: string; cost: number };
type Rcv = { qty: string; expiry: string };

export default function PoClient({ po, items, products, locs, role, storeName, vat }: { po: PO; items: Item[]; products: P[]; locs: { id: string; name: string }[]; role: string; storeName: string; vat: number }) {
  const r = useRouter();
  const sb = supabaseBrowser();
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);
  const [rcv, setRcv] = useState<Record<number, Rcv>>(() => Object.fromEntries(items.map((i) => [i.id, { qty: String(Math.max(0, i.qty - i.received_qty)), expiry: "" }])));
  const [loc, setLoc] = useState(locs[0]?.id ?? "");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = po.status === "draft" || po.status === "approved";
  const receivable = ["approved", "sent", "partial"].includes(po.status);
  const isAdmin = role === "owner" || role === "manager";

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    setBusy(true); setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) return setMsg({ t: "err", m: error.message });
    if (ok) setMsg({ t: "ok", m: ok });
    r.refresh();
  };
  const setItem = (product: string, qty: number, cost?: number) => run(() => sb.rpc("set_po_item", { p_po: po.id, p_product: product, p_qty: qty, p_unit_cost: cost ?? null }));
  const onScan = useCallback((code: string) => {
    const p = products.find((x) => x.barcode === code);
    if (!p) return setMsg({ t: "err", m: `الباركود ${code} غير معرّف` });
    const ex = items.find((i) => i.product_id === p.id);
    setItem(p.id, ex ? Number(ex.qty) + 1 : 1);
  }, [products, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = [`أمر شراء رقم ${po.number} من ${storeName}`, ...items.map((i) => `- ${i.products.name}: ${num(i.qty)}`), `الإجمالي قبل الضريبة: ${SAR(po.total)}`].join("\n");
  const phone = (po.suppliers.phone ?? "").replace(/\D/g, "").replace(/^0/, "966");

  async function send() {
    try { await navigator.clipboard.writeText(text); } catch {}
    await run(() => sb.rpc("set_po_status", { p_po: po.id, p_status: "sent" }), "عُلّم الأمر مرسلًا ونُسخ نصه.");
    if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  }
  async function receive() {
    const payload = items.map((i) => ({ item_id: i.id, qty: Number(rcv[i.id]?.qty || 0), expiry: rcv[i.id]?.expiry || "", location_id: loc })).filter((x) => x.qty > 0);
    await run(() => sb.rpc("receive_po", { p_po: po.id, p_items: payload, p_ref: ref || null }), "سُجّل الاستلام وأُضيف للمخزون وقُيّد على المورد.");
  }

  const st = PO_STATUS[po.status];
  return (<>
    <div className="head"><div><h1>أمر شراء رقم {num(po.number)}</h1>
      <div className="sub">{po.suppliers.name} · {new Date(po.created_at).toLocaleString("ar-SA")} · {po.auto ? "أنشأه النظام تلقائيًا" : "يدوي"}</div></div>
      <span className={`pill ${st[1]}`}>{st[0]}</span></div>
    {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}

    <div className="card">
      <div className="tbl"><table><thead><tr><th>المنتج</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th><th>المستلم</th>{editable && <th></th>}</tr></thead>
        <tbody>{items.map((i) => (
          <tr key={i.id}><td>{i.products.name}</td>
            <td>{editable ? <input type="number" min="0" step="any" defaultValue={i.qty} style={{ width: 90 }} aria-label="الكمية"
              onBlur={(e) => Number(e.target.value) !== Number(i.qty) && setItem(i.product_id, Number(e.target.value))} /> : num(i.qty)}</td>
            <td>{editable ? <input type="number" min="0" step="0.01" defaultValue={i.unit_cost} style={{ width: 90 }} aria-label="التكلفة"
              onBlur={(e) => Number(e.target.value) !== Number(i.unit_cost) && setItem(i.product_id, Number(i.qty), Number(e.target.value))} /> : SAR(i.unit_cost)}</td>
            <td>{SAR(i.qty * i.unit_cost)}</td>
            <td><span className={`pill ${i.received_qty >= i.qty ? "p-ok" : i.received_qty > 0 ? "p-warn" : "p-info"}`}>{num(i.received_qty)} / {num(i.qty)}</span></td>
            {editable && <td><button className="btn ghost sm" onClick={() => setItem(i.product_id, 0)}>حذف</button></td>}</tr>))}</tbody></table>
        {items.length === 0 && <p className="muted">الأمر فارغ. امسح منتجات لإضافتها.</p>}
      </div>
      <div className="total"><span>قبل الضريبة</span><span>{SAR(po.total)}</span></div>
      <div className="total"><span>الضريبة {num(vat)}٪</span><span>{SAR(po.total * vat / 100)}</span></div>
      <div className="total big"><span>الإجمالي</span><span>{SAR(po.total * (1 + vat / 100))}</span></div>
    </div>

    {editable && <div className="card"><h2>إضافة منتج</h2><BarcodeInput onScan={onScan} autoFocus={false} /></div>}

    <div className="chips">
      {po.status === "draft" && isAdmin && <button className="btn" disabled={busy || !items.length} onClick={() => run(() => sb.rpc("set_po_status", { p_po: po.id, p_status: "approved" }), "اعتُمد الأمر.")}>اعتماد</button>}
      {po.status === "draft" && !isAdmin && <span className="muted">ينتظر اعتماد المالك أو المدير.</span>}
      {po.status === "approved" && <button className="btn" disabled={busy} onClick={send}>{phone ? "إرسال عبر واتساب" : "نسخ النص وتعليمه مرسلًا"}</button>}
      {["draft", "approved", "sent"].includes(po.status) && isAdmin && <button className="btn ghost" disabled={busy} onClick={() => run(() => sb.rpc("set_po_status", { p_po: po.id, p_status: "cancelled" }), "أُلغي الأمر.")}>إلغاء الأمر</button>}
      <Link className="btn ghost" href="/purchasing">رجوع</Link>
    </div>
    {po.status === "approved" && !phone && <p className="muted" style={{ fontSize: 12 }}>أضف رقم جوال المورد في صفحة الموردين لإرسال الأوامر عبر واتساب مباشرة.</p>}

    {receivable && items.length > 0 && (
      <div className="card"><h2>استلام البضاعة</h2>
        <div className="tbl"><table><thead><tr><th>المنتج</th><th>المتبقي</th><th>الكمية المستلمة</th><th>تاريخ الصلاحية</th></tr></thead>
          <tbody>{items.filter((i) => i.received_qty < i.qty).map((i) => (
            <tr key={i.id}><td>{i.products.name}</td><td>{num(i.qty - i.received_qty)}</td>
              <td><input type="number" min="0" step="any" value={rcv[i.id]?.qty ?? ""} style={{ width: 90 }} aria-label="الكمية المستلمة"
                onChange={(e) => setRcv({ ...rcv, [i.id]: { ...rcv[i.id], qty: e.target.value } })} /></td>
              <td><input type="date" value={rcv[i.id]?.expiry ?? ""} aria-label="تاريخ الصلاحية"
                onChange={(e) => setRcv({ ...rcv, [i.id]: { ...rcv[i.id], expiry: e.target.value } })} /></td></tr>))}</tbody></table></div>
        <div className="form" style={{ marginTop: 10 }}>
          <div className="field"><label htmlFor="pl">الموقع</label><select id="pl" value={loc} onChange={(e) => setLoc(e.target.value)}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div className="field"><label htmlFor="pr">رقم فاتورة المورد</label><input id="pr" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <button className="btn" disabled={busy} onClick={receive}>تسجيل الاستلام</button>
        </div>
      </div>
    )}
  </>);
}
