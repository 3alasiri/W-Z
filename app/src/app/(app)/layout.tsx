import Nav from "@/components/Nav";
import { requireStore } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function Shell({ children }: { children: React.ReactNode }) {
  const { sb, storeId, storeName } = await requireStore();
  const { count } = await sb.from("stock_alerts").select("*", { count: "exact", head: true }).eq("store_id", storeId);
  return (
    <div className="app">
      <Nav storeName={storeName} alerts={count ?? 0} />
      <main><div className="wrap">{children}</div></main>
    </div>
  );
}
