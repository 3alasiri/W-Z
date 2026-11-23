"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num } from "@/lib/format";
import BarcodeInput from "@/components/BarcodeInput";

type P = { id: string; barcode: string; name: string; price: number; stock: number };
type Line = { p: P; q: number };
type Receipt = { number: number; total: number; vat: number; subtotal: number; method: string; lines: Line[]; at: string };
const METHODS: Record<string, string> = { cash: "نقدًا", card: "مدى / بطاقة", credit: "آجل" };

export default function PosClient({ storeId, products, store }: { storeId: string; products: P[]; store: { name: string; vat_rate: number; vat_number: string | null } }) {
  const r = useRouter();
  const [cart, setCart] = useState<Line[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const add = useCallback((p: P) => {
    setErr(""); setReceipt(null);
    setCart((c) => {
      const i = c.findIndex((l) => l.p.id === p.id);
      if (i < 0) return [...c, { p, q: 1 }];
      const n = [...c]; n[i] = { ...n[i], q: n[i].q + 1 }; return n;
    });
  }, []);
  const onScan = useCallback((code: string) => {
    const p = products.find((x) => x.barcode === code);
    p ? add(p) : setErr(`الباركود ${code} غير معرّف`);
  }, [products, add]);
  const setQty = (i: number, q: number) => setCart((c) => q <= 0 ? c.filter((_, j) => j !== i) : c.map((l, j) => j === i ? { ...l, q } : l));

  const total = cart.reduce((a, l) => a + l.p.price * l.q, 0);
  const vatRate = Number(store.vat_rate);
  const subtotal = total / (1 + vatRate / 100);

  async function pay(method: string) {
    setBusy(true); setErr("");
    const sb = supabaseBrowser();
    const { data: id, error } = await sb.rpc("complete_sale", {
      p_store: storeId, p_payment: method, p_items: cart.map((l) => ({ product_id: l.p.id, qty: l.q })),
    });
    if (error) { setBusy(false); return setErr(error.message); }
    const { data: s } = await sb.from("sales").select("number,total,vat,subtotal,created_at").eq("id", id).single();
    setReceipt({ number: s!.number, total: s!.total, vat: s!.vat, subtotal: s!.subtotal, method, lines: cart, at: s!.created_at });
    setCart([]); setBusy(false); r.refresh();
  }

  const quick = products.filter((p) => !q || p.name.includes(q)).slice(0, 24);

  return (<>
    <div className="head noprint"><div><h1>نقطة البيع</h1><div className="sub">الأسعار شاملة ضريبة القيمة المضافة {num(vatRate)}٪</div></div></div>
    <div className="grid g3">
      <div className="card noprint"><h2>امسح المنتج</h2>
        <BarcodeInput onScan={onScan} />
        <input placeholder="أو ابحث بالاسم" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: "12px 0" }} aria-label="بحث بالاسم" />
        <div className="chips">{quick.map((p) => (
          <button key={p.id} className="chip" onClick={() => add(p)} disabled={Number(p.stock) <= 0} style={Number(p.stock) <= 0 ? { opacity: .45 } : undefined}>
            <b>{p.name}</b>{SAR(p.price)} · <span className="muted">{num(p.stock)}</span></button>))}
          {products.length === 0 && <p className="muted">أضف منتجات واستلم بضاعة أولًا.</p>}
        </div>
      </div>
      <div className="card">
        {receipt ? (
          <div className="list">
            <h2 style={{ textAlign: "center", margin: 0 }}>{store.name}</h2>
            <div className="muted" style={{ textAlign: "center", fontSize: 12 }}>فاتورة ضريبية مبسطة رقم {num(receipt.number)}<br />{new Date(receipt.at).toLocaleString("ar-SA")}{store.vat_number && <><br />الرقم الضريبي {store.vat_number}</>}</div>
            {receipt.lines.map((l) => <div className="total" key={l.p.id}><span>{l.p.name} × {num(l.q)}</span><span>{SAR(l.p.price * l.q)}</span></div>)}
            <div className="total"><span>قبل الضريبة</span><span>{SAR(receipt.subtotal)}</span></div>
            <div className="total"><span>الضريبة</span><span>{SAR(receipt.vat)}</span></div>
            <div className="total big"><span>الإجمالي</span><span>{SAR(receipt.total)}</span></div>
            <div className="muted" style={{ textAlign: "center" }}>طريقة الدفع: {METHODS[receipt.method]}</div>
            <div className="chips noprint"><button className="btn" onClick={() => window.print()}>طباعة الإيصال</button><button className="btn ghost" onClick={() => setReceipt(null)}>فاتورة جديدة</button></div>
          </div>
        ) : (<>
          <h2>الفاتورة</h2>
          {cart.length === 0 ? <p className="muted">امسح أول منتج لبدء الفاتورة.</p> :
            <div className="list">{cart.map((l, i) => (
              <div className="row" key={l.p.id}><div><div className="t">{l.p.name}</div><div className="s">{SAR(l.p.price)}</div></div>
                <div className="chips" style={{ alignItems: "center" }}>
                  <button className="chip" onClick={() => setQty(i, l.q - 1)} aria-label="إنقاص">−</button>
                  <input type="number" value={l.q} min={0} step="any" onChange={(e) => setQty(i, Number(e.target.value))} style={{ width: 64, textAlign: "center" }} aria-label="الكمية" />
                  <button className="chip" onClick={() => setQty(i, l.q + 1)} aria-label="زيادة">+</button>
                </div></div>))}</div>}
          <div className="total"><span>قبل الضريبة</span><span>{SAR(subtotal)}</span></div>
          <div className="total"><span>الضريبة {num(vatRate)}٪</span><span>{SAR(total - subtotal)}</span></div>
          <div className="total big"><span>الإجمالي</span><span>{SAR(total)}</span></div>
          {err && <div className="err">{err}</div>}
          <div className="grid g2" style={{ marginTop: 10 }}>
            <button className="btn" disabled={!cart.length || busy} onClick={() => pay("cash")}>نقدًا</button>
            <button className="btn" disabled={!cart.length || busy} onClick={() => pay("card")}>مدى / بطاقة</button>
          </div>
          <button className="btn ghost" style={{ marginTop: 8, width: "100%", boxSizing: "border-box" }} disabled={!cart.length || busy} onClick={() => setCart([])}>إلغاء الفاتورة</button>
        </>)}
      </div>
    </div>
  </>);
}
