"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ROLES } from "@/lib/format";

type M = { user_id: string; email: string; role: string };

export default function TeamClient({ storeId, isOwner, me, team }: { storeId: string; isOwner: boolean; me: string; team: M[] }) {
  const r = useRouter(); const sb = supabaseBrowser();
  const [email, setEmail] = useState(""); const [role, setRole] = useState("cashier");
  const [msg, setMsg] = useState<{ t: "err" | "ok"; m: string } | null>(null);
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setMsg(null); const { error } = await fn();
    if (error) return setMsg({ t: "err", m: error.message });
    setMsg({ t: "ok", m: ok }); r.refresh();
  };
  return (<>
    <div className="head"><div><h1>فريق العمل</h1><div className="sub">كل عضو يرى ما يناسب دوره فقط. المندوب يرى تطبيق التوصيل وطلباته فقط.</div></div></div>
    {msg && <div className={msg.t === "err" ? "err" : "okmsg"}>{msg.m}</div>}
    {isOwner && <form className="card" onSubmit={(e) => { e.preventDefault(); run(() => sb.rpc("add_member", { p_store: storeId, p_email: email, p_role: role }), "أُضيف العضو"); setEmail(""); }}>
      <h2>إضافة عضو</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>يجب أن يكون لديه حساب في التطبيق أولًا. أرسل له رابط التطبيق ليسجّل ثم أضفه هنا ببريده.</p>
      <div className="form">
        <div className="field"><label htmlFor="te">البريد الإلكتروني</label><input id="te" type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="tr">الدور</label><select id="tr" value={role} onChange={(e) => setRole(e.target.value)}>
          {Object.entries(ROLES).filter(([k]) => k !== "owner").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <button className="btn">إضافة</button>
      </div>
    </form>}
    <div className="card tbl"><table><thead><tr><th>البريد</th><th>الدور</th><th></th></tr></thead>
      <tbody>{team.map((m) => (
        <tr key={m.user_id}><td dir="ltr" style={{ textAlign: "right" }}>{m.email}</td>
          <td>{isOwner && m.user_id !== me && m.role !== "owner" ? <select value={m.role} aria-label="الدور"
            onChange={(e) => run(() => sb.rpc("add_member", { p_store: storeId, p_email: m.email, p_role: e.target.value }), "تغيّر الدور")}>
            {Object.entries(ROLES).filter(([k]) => k !== "owner").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> : ROLES[m.role]}</td>
          <td>{isOwner && m.user_id !== me && <button className="btn ghost sm" onClick={() => run(() => sb.rpc("remove_member", { p_store: storeId, p_user: m.user_id }), "أُزيل العضو")}>إزالة</button>}</td></tr>))}</tbody></table></div>
  </>);
}
