"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

const LINKS = [
  ["/", "لوحة القيادة"], ["/pos", "نقطة البيع"], ["/orders", "الطلبات"], ["/products", "المنتجات"],
  ["/receive", "استلام بضاعة"], ["/alerts", "التنبيهات"], ["/purchasing", "المشتريات"],
  ["/suppliers", "الموردون"], ["/customers", "العملاء"], ["/sales", "المبيعات"], ["/accounting", "المحاسبة"], ["/team", "الفريق"], ["/settings", "الإعدادات"],
] as const;

export default function Nav({ storeName, alerts, drafts, newOrders }: { storeName: string; alerts: number; drafts: number; newOrders: number }) {
  const p = usePathname(); const r = useRouter();
  return (
    <nav className="side">
      <div className="logo"><i>ب</i>بقالتي الذكية</div>
      {LINKS.map(([href, t]) => (
        <Link key={href} href={href} className={(href === "/" ? p === "/" : p.startsWith(href)) ? "on" : ""}>
          <span>{t}</span>{href === "/alerts" && alerts > 0 && <span className="badge">{alerts.toLocaleString("ar-SA")}</span>}
          {href === "/orders" && newOrders > 0 && <span className="badge">{newOrders.toLocaleString("ar-SA")}</span>}
          {href === "/purchasing" && drafts > 0 && <span className="badge">{drafts.toLocaleString("ar-SA")}</span>}
        </Link>
      ))}
      <div className="foot">
        <span>{storeName}</span>
        <button onClick={async () => { await supabaseBrowser().auth.signOut(); r.replace("/login"); r.refresh(); }}>تسجيل الخروج</button>
      </div>
    </nav>
  );
}
