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

export default function Nav({ storeName, alerts, drafts, newOrders }: { storeName: string; alerts: number; drafts: number; newOrders: number }) {
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
        <AppearanceMini />
        <div className="who"><b>{storeName.slice(0, 1)}</b><span style={{ flex: 1 }}>{storeName}</span>
          <button className="link" onClick={async () => { await supabaseBrowser().auth.signOut(); r.replace("/login"); r.refresh(); }}>خروج</button></div>
      </div>
    </nav>
  );
}
