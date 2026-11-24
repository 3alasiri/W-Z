import Nav from "@/components/Nav";
import { redirect } from "next/navigation";
import { requireStore } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function Shell({ children }: { children: React.ReactNode }) {
  const { sb, storeId, storeName, role } = await requireStore();
  if (role === "driver") redirect("/driver");
  const [{ count }, { count: drafts }, { count: newOrders }] = await Promise.all([
    sb.from("stock_alerts").select("*", { count: "exact", head: true }).eq("store_id", storeId),
    sb.from("purchase_orders").select("*", { count: "exact", head: true }).eq("store_id", storeId).in("status", ["draft", "approved"]),
    sb.from("orders").select("*", { count: "exact", head: true }).eq("store_id", storeId).eq("status", "new"),
  ]);
  return (
    <div className="app">
      <Nav storeName={storeName} alerts={count ?? 0} drafts={drafts ?? 0} newOrders={newOrders ?? 0} />
      <main><div className="wrap">{children}</div></main>
    </div>
  );
}
