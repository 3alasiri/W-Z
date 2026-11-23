import { requireStore } from "@/lib/supabase-server";
import ReceiveClient from "./ReceiveClient";

export default async function Receive() {
  const { sb, storeId } = await requireStore();
  const [{ data: products }, { data: locs }, { data: recent }] = await Promise.all([
    sb.from("products").select("id,barcode,name,cost").eq("store_id", storeId),
    sb.from("locations").select("id,name").eq("store_id", storeId).order("kind", { ascending: false }),
    sb.from("stock_movements").select("id,qty,created_at,ref,products(name)").eq("store_id", storeId).eq("type", "receive").order("created_at", { ascending: false }).limit(15),
  ]);
  return <ReceiveClient products={products ?? []} locs={locs ?? []} recent={(recent ?? []) as never} />;
}
