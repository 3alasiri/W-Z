import { requireStore } from "@/lib/supabase-server";
import PosClient from "./PosClient";

export default async function Pos() {
  const { sb, storeId } = await requireStore();
  const { data } = await sb.from("product_stock").select("id,barcode,name,price,sell_price,stock").eq("store_id", storeId).eq("active", true).order("name");
  const { data: st } = await sb.from("stores").select("name,vat_rate,vat_number").eq("id", storeId).single();
  const { data: customers } = await sb.from("customers").select("id,name,phone").eq("store_id", storeId).order("name");
  return <PosClient storeId={storeId} products={(data ?? []).map((p) => ({ ...p, list_price: p.price, price: p.sell_price ?? p.price }))} store={st!} customers={customers ?? []} />;
}
