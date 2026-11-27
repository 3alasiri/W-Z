"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import Icon from "./Icon";
import { AppearanceMini } from "./Appearance";

type L = { href: string; t: string; i: string; badge?: "alerts" | "drafts" | "orders" };
const GROUPS: { g: string; items: L[] }[] = [
  { g: "اليوم", items: [
    { href: "/", t: "لوحة القيادة", i: "home" }, { href: "/assistant", t: "المساعد الذكي", i: "spark" },
    { href: "/insights", t: "الذكاء والتحليلات", i: "chart" }] },
  { g: "البيع", items: [
    { href: "/pos", t: "نقطة البيع", i: "cart" }, { href: "/orders", t: "الطلبات", i: "bag", badge: "orders" },
    { href: "/sales", t: "المبيعات", i: "receipt" }, { href: "/customers", t: "العملاء", i: "users" }] },
  { g: "المخزون", items: [
    { href: "/products", t: "المنتجات", i: "box" }, { href: "/receive", t: "استلام بضاعة", i: "inbox" },
    { href: "/alerts", t: "التنبيهات", i: "bell", badge: "alerts" }, { href: "/purchasing", t: "المشتريات", i: "truck", badge: "drafts" },
    { href: "/suppliers", t: "الموردون", i: "factory" }] },
  { g: "الإدارة", items: [
    { href: "/accounting", t: "المحاسبة", i: "calc" }, { href: "/team", t: "الفريق", i: "team" }, { href: "/settings", t: "الإعدادات", i: "gear" }] },
];

type SR = { id: string; name: string; role: string };
const ROLE: Record<string, string> = { owner: "مالك", manager: "مدير", cashier: "كاشير", stock: "مخزون", driver: "مندوب" };

export default function Nav({ storeName, storeId, stores, admin, alerts, drafts, newOrders }:
  { storeName: string; storeId: string; stores: SR[]; admin: boolean; alerts: number; drafts: number; newOrders: number }) {
  const p = usePathname(); const r = useRouter();
  const counts = { alerts, drafts, orders: newOrders };
  return (
    <nav className="side" aria-label="القائمة الرئيسية">
      <div className="logo"><i>ب</i><div>بقالتي الذكية<small>{storeName}</small></div></div>
      {GROUPS.map((g) => (<div key={g.g} style={{ display: "contents" }}>
        <div className="group">{g.g}</div>
        {g.items.map((l) => {
          const on = l.href === "/" ? p === "/" : p.startsWith(l.href); const n = l.badge ? counts[l.badge] : 0;
          return (
            <Link key={l.href} href={l.href} prefetch={false} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
              <Icon name={l.i} /><span className="lbl">{l.t}</span>
              {n > 0 && <span className="badge">{n.toLocaleString("ar-SA")}</span>}
            </Link>);
        })}
      </div>))}
      <div className="foot">
        <div className="branch">
          <label htmlFor="branch" className="group" style={{ padding: 0 }}>الفرع</label>
          <select id="branch" value={storeId} onChange={async (e) => {
            const res = await fetch("/api/store", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: e.target.value }) });
            if (res.ok) window.location.assign("/"); // تحميل كامل لأن كل بيانات الصفحة تتغير مع الفرع
          }}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name} · {ROLE[s.role] ?? s.role}</option>)}
          </select>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/onboarding?new=1" prefetch={false} className="mini">+ إضافة فرع</Link>
            {admin && <Link href="/admin" prefetch={false} className="mini">إدارة المنصة</Link>}
          </div>
        </div>
        <AppearanceMini />
        <div className="who"><b>{storeName.slice(0, 1)}</b><span style={{ flex: 1 }}>{storeName}</span>
          <button className="link" onClick={async () => { await supabaseBrowser().auth.signOut(); r.replace("/login"); r.refresh(); }}>خروج</button></div>
      </div>
    </nav>
  );
}
