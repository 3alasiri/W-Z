"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Login() {
  const r = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const sb = supabaseBrowser();
    const { data, error } = mode === "in"
      ? await sb.auth.signInWithPassword({ email, password: pw })
      : await sb.auth.signUp({ email, password: pw });
    setBusy(false);
    if (error) return setMsg({ t: "err", m: error.message === "Invalid login credentials" ? "البريد أو كلمة المرور غير صحيحة" : error.message });
    if (!data.session) return setMsg({ t: "ok", m: "أرسلنا رابط التفعيل إلى بريدك. فعّل الحساب ثم سجّل الدخول." });
    r.replace("/"); r.refresh();
  }

  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <h1>بقالتي الذكية</h1>
        <div className="sub">{mode === "in" ? "سجّل الدخول لإدارة متجرك" : "أنشئ حسابًا جديدًا"}</div>
        <div className="field"><label htmlFor="email">البريد الإلكتروني</label><input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" /></div>
        <div className="field"><label htmlFor="pw">كلمة المرور</label><input id="pw" type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} dir="ltr" /></div>
        {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}
        <button className="btn" disabled={busy}>{busy ? "جارٍ..." : mode === "in" ? "دخول" : "إنشاء الحساب"}</button>
        <button type="button" className="btn ghost" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "ليس لديك حساب؟ أنشئ حسابًا" : "لديك حساب؟ سجّل الدخول"}
        </button>
      </form>
    </div>
  );
}
