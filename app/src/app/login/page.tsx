"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Login() {
  return <Suspense><LoginForm /></Suspense>;
}

function LoginForm() {
  const r = useRouter();
  const next = useSearchParams().get("next") || "/";
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
    r.replace(next.startsWith("/") ? next : "/"); r.refresh();
  }

  return (
    <div className="auth">
      <section className="hero">
        <div className="logo" style={{ padding: 0 }}><i>ب</i><div>بقالتي الذكية<small>لبقالات الأحياء</small></div></div>
        <div>
          <h2>متجرك كله في مكان واحد،<br />ويفكّر معك.</h2>
          <ul>
            <li><i>◎</i>نقطة بيع بالباركود وفاتورة ضريبية</li>
            <li><i>▦</i>مخزون بالدفعات وتنبيهات الصلاحية</li>
            <li><i>⇄</i>طلبات أونلاين وتوصيل وتتبّع</li>
            <li><i>✦</i>توقعات وطلب تلقائي من الموردين</li>
          </ul>
        </div>
        <small style={{ opacity: .6 }}>© بقالتي الذكية</small>
      </section>
      <div className="side-form">
        <form className="card" onSubmit={submit}>
          <h1>{mode === "in" ? "أهلًا بعودتك" : "ابدأ مجانًا"}</h1>
          <div className="sub" style={{ marginTop: -6 }}>{mode === "in" ? "سجّل الدخول لإدارة متجرك أو متابعة طلباتك" : "أنشئ حسابًا في أقل من دقيقة"}</div>
          <div className="field"><label htmlFor="email">البريد الإلكتروني</label><input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoComplete="email" /></div>
          <div className="field"><label htmlFor="pw">كلمة المرور</label><input id="pw" type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} dir="ltr" autoComplete={mode === "in" ? "current-password" : "new-password"} /></div>
          {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}
          <button className="btn" disabled={busy}>{busy ? "جارٍ..." : mode === "in" ? "دخول" : "إنشاء الحساب"}</button>
          <button type="button" className="btn ghost" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "ليس لديك حساب؟ أنشئ حسابًا" : "لديك حساب؟ سجّل الدخول"}
          </button>
        </form>
      </div>
    </div>
  );
}
