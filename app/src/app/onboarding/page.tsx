"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Onboarding() {
  const r = useRouter();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const { error } = await supabaseBrowser().rpc("create_store", { p_name: name });
    setBusy(false);
    if (error) return setErr(error.message);
    r.replace("/"); r.refresh();
  }
  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <h1>إعداد متجرك</h1>
        <div className="sub">سننشئ لك موقعين افتراضيين: رفوف المتجر والمستودع.</div>
        <div className="field"><label htmlFor="n">اسم المتجر</label><input id="n" required value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: بقالة النرجس" /></div>
        {err && <div className="err">{err}</div>}
        <button className="btn" disabled={busy}>إنشاء المتجر</button>
      </form>
    </div>
  );
}
