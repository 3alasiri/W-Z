"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAR, num, expiryLabel, daysTo } from "@/lib/format";
import BarcodeInput from "@/components/BarcodeInput";
import ProductImage from "@/components/ProductImage";

type Row = { id: string; barcode: string; name: string; category: string | null; supplier: string | null; cost: number; price: number; min_qty: number;
  stock: number; next_expiry: string | null; active: boolean; image_url: string | null; unit: string };
type Opt = { id: string; name: string };
type Pack = { id?: string; product_id?: string; name: string; units: number | string; price: number | string; barcode: string | null; active?: boolean };
const empty = { id: "", barcode: "", name: "", category: "", supplier: "", lead: "2", cost: "", price: "", min_qty: "0", unit: "حبة", image_url: "" };
const PRESETS = [["عائلي 6 حبات", 6], ["علبة 12 حبة", 12], ["كرتون 24 حبة", 24], ["كرتون 40 حبة", 40]] as const;

/** يصغّر الصورة إلى 800 بكسل كحد أقصى ويحوّلها إلى WebP قبل الرفع */
async function compress(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("تعذّر تجهيز الصورة"))), "image/webp", 0.85));
}

export default function ProductsClient({ storeId, rows, cats, sups, packs }: { storeId: string; rows: Row[]; cats: Opt[]; sups: Opt[]; packs: Pack[] }) {
  const r = useRouter(); const sb = supabaseBrowser();
  const [f, setF] = useState(empty);
  const [fp, setFp] = useState<Pack[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(""); const [cat, setCat] = useState("");
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);
  const [busy, setBusy] = useState(""); // "", "lookup", "upload", "save"
  const packsBy = useMemo(() => packs.reduce<Record<string, Pack[]>>((a, p) => { (a[p.product_id!] ??= []).push(p); return a; }, {}), [packs]);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function lookup(code: string, nameToo: boolean) {
    setBusy("lookup");
    const d = await fetch(`/api/barcode?code=${encodeURIComponent(code)}`).then((x) => x.json()).catch(() => ({ found: false }));
    setBusy("");
    if (!d.found) return setMsg({ t: "err", m: "لم نجد هذا الباركود في قاعدة المنتجات العالمية. ارفع صورة المنتج بنفسك." });
    setF((x) => ({ ...x, image_url: d.image ?? x.image_url, name: nameToo && !x.name ? d.name : x.name }));
    setMsg({ t: "ok", m: `وُجد المنتج${d.image ? " مع صورته" : ""} (المصدر: ${d.source}).` });
  }
  function startNew(barcode = "") {
    const pk = packs.find((p) => p.barcode === barcode);
    const ex = rows.find((x) => x.barcode === barcode) ?? (pk && rows.find((x) => x.id === pk.product_id));
    if (ex) return edit(ex);
    setF({ ...empty, barcode }); setFp([]); setOpen(true); setMsg(null);
    if (barcode) lookup(barcode, true);
  }
  function edit(x: Row) {
    setF({ id: x.id, barcode: x.barcode, name: x.name, category: x.category ?? "", supplier: x.supplier ?? "", lead: "2", cost: String(x.cost), price: String(x.price),
      min_qty: String(x.min_qty), unit: x.unit || "حبة", image_url: x.image_url ?? "" });
    setFp((packsBy[x.id] ?? []).filter((p) => p.active !== false).map((p) => ({ ...p }))); setOpen(true); setMsg(null);
    setTimeout(() => document.getElementById("pform")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy("upload"); setMsg(null);
    try {
      const blob = await compress(file);
      const path = `${storeId}/${crypto.randomUUID()}.webp`;
      const { error } = await sb.storage.from("product-images").upload(path, blob, { contentType: "image/webp", upsert: false });
      if (error) throw error;
      setF((x) => ({ ...x, image_url: sb.storage.from("product-images").getPublicUrl(path).data.publicUrl }));
    } catch (e) { setMsg({ t: "err", m: (e as Error).message || "تعذّر رفع الصورة" }); }
    setBusy("");
  }
  async function idFor(table: "categories" | "suppliers", name: string, list: Opt[], extra: Record<string, unknown> = {}) {
    if (!name.trim()) return null;
    const ex = list.find((c) => c.name === name.trim()); if (ex) return ex.id;
    const { data, error } = await sb.from(table).insert({ store_id: storeId, name: name.trim(), ...extra }).select("id").single();
    if (error) throw error; return data.id as string;
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setBusy("save");
    try {
      const category_id = await idFor("categories", f.category, cats);
      const supplier_id = await idFor("suppliers", f.supplier, sups, { lead_days: Number(f.lead) || 2 });
      const body = { store_id: storeId, barcode: f.barcode.trim(), name: f.name.trim(), category_id, supplier_id, cost: Number(f.cost) || 0, price: Number(f.price),
        min_qty: Number(f.min_qty) || 0, unit: f.unit || "حبة", image_url: f.image_url.trim() || null };
      let pid = f.id;
      if (pid) { const { error } = await sb.from("products").update(body).eq("id", pid); if (error) throw error; }
      else { const { data, error } = await sb.from("products").insert(body).select("id").single(); if (error) throw error; pid = data.id; }
      const keep = fp.filter((p) => p.name.trim() && Number(p.units) > 1 && p.price !== "");
      const gone = (packsBy[pid] ?? []).filter((o) => !keep.some((k) => k.id === o.id)).map((o) => o.id!);
      if (gone.length) { const { error } = await sb.from("product_packs").update({ active: false }).in("id", gone); if (error) throw error; }
      for (const [i, p] of keep.entries()) {
        const row = { store_id: storeId, product_id: pid, name: p.name.trim(), units: Number(p.units), price: Number(p.price), barcode: p.barcode?.trim() || null, sort: i, active: true };
        const { error } = p.id ? await sb.from("product_packs").update(row).eq("id", p.id) : await sb.from("product_packs").insert(row);
        if (error) throw error;
      }
      setOpen(false); setMsg({ t: "ok", m: "حُفظ المنتج" }); r.refresh();
    } catch (x: unknown) {
      const m = (x as { message?: string }).message ?? "";
      setMsg({ t: "err", m: m.includes("duplicate") ? "هذا الباركود مسجل لمنتج أو عبوة أخرى" : m });
    }
    setBusy("");
  }

  const allCats = Array.from(new Set(rows.map((x) => x.category).filter(Boolean))) as string[];
  const shown = rows.filter((x) => (!q || x.name.includes(q) || x.barcode.includes(q)) && (!cat || x.category === cat));
  const unitPrice = Number(f.price) || 0;

  return (<>
    <div className="head"><div><h1>المنتجات</h1><div className="sub">{num(rows.length)} منتجًا · {num(packs.filter((p) => p.active).length)} عبوة عائلية وجملة</div></div>
      <button className="btn" onClick={() => startNew()}>منتج جديد</button></div>
    {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}
    <div className="card"><h2>امسح باركود لتعريف منتج أو تعديله</h2>
      <BarcodeInput onScan={startNew} placeholder="امسح الباركود: نجلب الاسم والصورة تلقائيًا إن توفرت" autoFocus={false} /></div>

    {open && (
      <form className="card" id="pform" onSubmit={save}>
        <h2>{f.id ? "تعديل منتج" : "منتج جديد"}</h2>
        <div className="drop">
          <ProductImage src={f.image_url || null} name={f.name || "؟"} category={f.category} size={120} />
          <div className="list" style={{ flex: 1, minWidth: 220 }}>
            <div className="chips">
              <label className="btn sm" style={{ cursor: "pointer" }}>{busy === "upload" ? "جارٍ الرفع..." : "رفع صورة أو تصوير"}
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>
              <button type="button" className="btn ghost sm" disabled={!f.barcode || busy === "lookup"} onClick={() => lookup(f.barcode, false)}>
                {busy === "lookup" ? "جارٍ البحث..." : "جلب الصورة من الباركود"}</button>
              {f.image_url && <button type="button" className="btn ghost sm" onClick={() => setF({ ...f, image_url: "" })}>إزالة الصورة</button>}
            </div>
            <input placeholder="أو الصق رابط صورة المنتج" value={f.image_url} onChange={set("image_url")} dir="ltr" aria-label="رابط الصورة" />
            <span className="muted" style={{ fontSize: 12 }}>صورة واضحة للمنتج على خلفية فاتحة تظهر أجمل في المتجر. تُضغط تلقائيًا قبل الرفع.</span>
          </div>
        </div>
        <div className="form" style={{ marginTop: 14 }}>
          <div className="field"><label htmlFor="bc">الباركود</label><input id="bc" required value={f.barcode} onChange={set("barcode")} dir="ltr" /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="nm">الاسم (مع الحجم)</label><input id="nm" required value={f.name} onChange={set("name")} placeholder="مثال: حليب المراعي كامل الدسم 1 لتر" /></div>
          <div className="field"><label htmlFor="un">وحدة البيع المفردة</label><input id="un" value={f.unit} onChange={set("unit")} placeholder="حبة، علبة، كيلو" /></div>
          <div className="field"><label htmlFor="ct">الفئة</label><input id="ct" list="cats" value={f.category} onChange={set("category")} /></div>
          <div className="field"><label htmlFor="sp">المورد</label><input id="sp" list="sups" value={f.supplier} onChange={set("supplier")} /></div>
          <div className="field"><label htmlFor="ld">مدة التوريد (أيام)</label><input id="ld" type="number" min="1" value={f.lead} onChange={set("lead")} /></div>
          <div className="field"><label htmlFor="co">تكلفة الحبة (قبل الضريبة)</label><input id="co" type="number" step="0.01" min="0" value={f.cost} onChange={set("cost")} /></div>
          <div className="field"><label htmlFor="pr">سعر الحبة (شامل الضريبة)</label><input id="pr" type="number" step="0.01" min="0" required value={f.price} onChange={set("price")} /></div>
          <div className="field"><label htmlFor="mq">الحد الأدنى للكمية</label><input id="mq" type="number" min="0" value={f.min_qty} onChange={set("min_qty")} /></div>
        </div>
        <datalist id="cats">{cats.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <datalist id="sups">{sups.map((c) => <option key={c.id} value={c.name} />)}</datalist>

        <h2 style={{ marginTop: 18 }}>عبوات العائلي والجملة</h2>
        <p className="muted" style={{ marginTop: -6, fontSize: 12.5 }}>المخزون يُحسب بالحبة. العبوة تبيع عدة حبات بسعر خاص وباركود مستقل (مثل باركود الكرتون).</p>
        <div className="list">
          {fp.map((p, i) => { const per = Number(p.price) / Number(p.units); const save = unitPrice && per ? (unitPrice - per) / unitPrice * 100 : 0;
            return (
            <div className="row" key={p.id ?? `n${i}`} style={{ alignItems: "end" }}>
              <div className="form" style={{ flex: 1, gridTemplateColumns: "2fr 1fr 1fr 2fr" }}>
                <div className="field"><label>اسم العبوة</label><input value={p.name} onChange={(e) => setFp(fp.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></div>
                <div className="field"><label>عدد الحبات</label><input type="number" min="2" value={p.units} onChange={(e) => setFp(fp.map((x, j) => j === i ? { ...x, units: e.target.value } : x))} /></div>
                <div className="field"><label>سعر العبوة</label><input type="number" step="0.01" min="0" value={p.price} onChange={(e) => setFp(fp.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} /></div>
                <div className="field"><label>باركود العبوة (اختياري)</label><input dir="ltr" value={p.barcode ?? ""} onChange={(e) => setFp(fp.map((x, j) => j === i ? { ...x, barcode: e.target.value } : x))} /></div>
              </div>
              <div className="list" style={{ gap: 4, alignItems: "flex-end" }}>
                {save > 0.5 && <span className="save">توفير {num(Math.round(save))}٪ للحبة</span>}
                {per > 0 && <span className="muted" style={{ fontSize: 11 }}>{SAR(per)} للحبة</span>}
                <button type="button" className="btn ghost sm" onClick={() => setFp(fp.filter((_, j) => j !== i))}>حذف</button>
              </div>
            </div>); })}
          <div className="chips">{PRESETS.map(([n, u]) => (
            <button type="button" key={n} className="chip" onClick={() => setFp([...fp, { name: n, units: u, price: unitPrice ? Math.round(unitPrice * u * 0.92 * 4) / 4 : "", barcode: "" }])}>+ {n}</button>))}
            <button type="button" className="chip" onClick={() => setFp([...fp, { name: "", units: "", price: "", barcode: "" }])}>+ عبوة مخصصة</button></div>
        </div>
        <div className="chips" style={{ marginTop: 16 }}><button className="btn" disabled={busy === "save"}>{busy === "save" ? "جارٍ الحفظ..." : "حفظ"}</button>
          <button type="button" className="btn ghost" onClick={() => setOpen(false)}>إلغاء</button></div>
      </form>
    )}

    <div className="card">
      <div className="head" style={{ marginBottom: 12, alignItems: "center" }}>
        <input placeholder="ابحث بالاسم أو الباركود" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" style={{ maxWidth: 320 }} />
        <div className="seg"><button className={!cat ? "on" : ""} onClick={() => setCat("")}>الكل</button>
          {allCats.map((c) => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>)}</div>
      </div>
      <div className="tbl"><table><thead><tr><th>المنتج</th><th>الفئة</th><th>المخزون</th><th>أقرب صلاحية</th><th>سعر الحبة</th><th>العبوات</th><th></th></tr></thead>
        <tbody>{shown.map((x) => {
          const d = x.next_expiry ? daysTo(x.next_expiry) : null; const pk = (packsBy[x.id] ?? []).filter((p) => p.active);
          return (<tr key={x.id}>
            <td><div className="thumb"><ProductImage src={x.image_url} name={x.name} category={x.category} size={44} />
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, whiteSpace: "normal" }}>{x.name}</div><div className="muted" dir="ltr" style={{ fontSize: 11, textAlign: "right" }}>{x.barcode}</div></div></div></td>
            <td>{x.category ?? "—"}</td>
            <td><span className={`pill ${Number(x.stock) <= 0 ? "p-bad" : Number(x.stock) <= Number(x.min_qty) ? "p-warn" : "p-ok"}`}>{num(x.stock)} {x.unit}</span></td>
            <td>{x.next_expiry ? <span className={`pill ${d! < 0 || d! <= 3 ? "p-bad" : d! <= 7 ? "p-warn" : "p-info"}`}>{expiryLabel(x.next_expiry)}</span> : "—"}</td>
            <td><b>{SAR(x.price)}</b><div className="muted" style={{ fontSize: 11 }}>تكلفة {SAR(x.cost)}</div></td>
            <td style={{ whiteSpace: "normal" }}>{pk.length ? <div className="chips">{pk.map((p) => <span key={p.id} className="pill p-info">{p.name} · {SAR(p.price)}</span>)}</div> : <span className="muted">مفرد فقط</span>}</td>
            <td><button className="btn ghost sm" onClick={() => edit(x)}>تعديل</button></td></tr>);
        })}</tbody></table>
        {shown.length === 0 && <p className="muted">لا منتجات بعد. امسح باركود أول منتج لتعريفه.</p>}
      </div>
    </div>
  </>);
}
