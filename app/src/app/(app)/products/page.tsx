import { requireStore } from "@/lib/supabase-server";
import ProductsClient from "./ProductsClient";

export default async function Products() {
  const { sb, storeId } = await requireStore();
  const [{ data: rows }, { data: cats }, { data: sups }] = await Promise.all([
    sb.from("product_stock").select("*").eq("store_id", storeId).order("name"),
    sb.from("categories").select("id,name").eq("store_id", storeId).order("name"),
    sb.from("suppliers").select("id,name,lead_days").eq("store_id", storeId).order("name"),
  ]);
  return <ProductsClient storeId={storeId} rows={rows ?? []} cats={cats ?? []} sups={sups ?? []} />;
}
