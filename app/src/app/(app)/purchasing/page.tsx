import { requireStore } from "@/lib/supabase-server";
import PurchasingClient from "./PurchasingClient";

export default async function Purchasing() {
  const { sb, storeId, role } = await requireStore();
  const [{ data: pos }, { data: sups }, { data: st }] = await Promise.all([
    sb.from("purchase_orders").select("id,number,status,auto,total,created_at,suppliers(name)").eq("store_id", storeId).order("created_at", { ascending: false }).limit(100),
    sb.from("suppliers").select("id,name").eq("store_id", storeId).order("name"),
    sb.from("stores").select("auto_approve_limit").eq("id", storeId).single(),
  ]);
  return <PurchasingClient storeId={storeId} role={role} pos={(pos ?? []) as never} sups={sups ?? []} limit={Number(st?.auto_approve_limit ?? 0)} />;
}
