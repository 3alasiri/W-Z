import { requireStore } from "@/lib/supabase-server";
import InsightsClient from "./InsightsClient";

export default async function Insights() {
  const { sb, storeId, role } = await requireStore();
  if (role !== "owner" && role !== "manager") return <div className="card">التحليلات متاحة للمالك والمدير فقط.</div>;
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data: products }, { data: customers }, { data: pairs }, { data: heat }, { data: searches }, { data: offers }] = await Promise.all([
    sb.rpc("product_insights", { p_store: storeId }),
    sb.rpc("customer_segments", { p_store: storeId }),
    sb.rpc("basket_pairs", { p_store: storeId }),
    sb.rpc("sales_heatmap", { p_store: storeId }),
    sb.from("shop_searches").select("term,results").eq("store_id", storeId).eq("results", 0).gte("created_at", since).limit(1000),
    sb.from("price_offers").select("id,discount_pct,reason,ends_at,products(name)").eq("store_id", storeId).gt("ends_at", new Date().toISOString()).order("ends_at"),
  ]);
  const missing = Object.entries((searches ?? []).reduce<Record<string, number>>((a, s) => { a[s.term] = (a[s.term] ?? 0) + 1; return a; }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 12);
  return <InsightsClient products={products ?? []} customers={customers ?? []} pairs={pairs ?? []} heat={heat ?? []} missing={missing} offers={(offers ?? []) as never} />;
}
