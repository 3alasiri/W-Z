"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

function Form() {
  const isNew = useSearchParams().get("new") === "1";
  const [f, setF] = useState({ name: "", district: "", city: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const { data: id, error } = await supabaseBrowser().rpc("create_store", { p_name: f.name, p_district: f.district, p_city: f.city });
    if (error) { setBusy(false); return setErr(error.message); }
    // الانتقال للفرع الجديد مباشرة
    await fetch("/api/store", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    window.location.assign("/");
  }
  return (
    <div className="auth" style={{ gridTemplateColumns: "1fr" }}>
      <div className="side-form"><form className="card" onSubmit={submit}>
        <h1>{isNew ? "إضافة فرع أو بقالة" : "إعداد متجرك"}</h1>
        <div className="sub">لكل بقالة مخزونها وحساباتها وطلباتها ورابط متجرها الخاص. سننشئ موقعين افتراضيين: رفوف المتجر والمستودع.</div>
        <div className="field"><label htmlFor="n">اسم البقالة</label><input id="n" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثال: بقالة النرجس" /></div>
        <div className="field"><label htmlFor="d">الحي</label><input id="d" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} placeholder="مثال: النرجس" /></div>
        <div className="field"><label htmlFor="c">المدينة</label><input id="c" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="مثال: الرياض" /></div>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn" disabled={busy}>{isNew ? "إضافة الفرع" : "إنشاء المتجر"}</button>
        {isNew && <Link href="/" className="btn ghost" style={{ textAlign: "center" }}>رجوع</Link>}
      </form></div>
    </div>
  );
}
export default function Onboarding() { return <Suspense><Form /></Suspense>; }
