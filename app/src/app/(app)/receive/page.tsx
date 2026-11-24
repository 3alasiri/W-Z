import { requireStore } from "@/lib/supabase-server";
import ReceiveClient from "./ReceiveClient";

export default async function Receive() {
  const { sb, storeId } = await requireStore();
  const [{ data: products }, { data: locs }, { data: recent }] = await Promise.all([
    sb.from("products").select("id,barcode,name,cost,image_url").eq("store_id", storeId),
    sb.from("locations").select("id,name").eq("store_id", storeId).order("kind", { ascending: false }),
    sb.from("stock_movements").select("id,qty,created_at,ref,products(name)").eq("store_id", storeId).eq("type", "receive").order("created_at", { ascending: false }).limit(15),
  ]);
  const { data: packs } = await sb.from("product_packs").select("id,product_id,name,units,barcode").eq("store_id", storeId).eq("active", true);
  return <ReceiveClient packs={packs ?? []} products={products ?? []} locs={locs ?? []} recent={(recent ?? []) as never} />;
}
