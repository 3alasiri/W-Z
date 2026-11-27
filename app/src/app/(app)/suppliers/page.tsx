import { requireStore } from "@/lib/supabase-server";
import PartyPage from "@/components/PartyPage";

export default async function Suppliers() {
  const { sb, storeId, role } = await requireStore();
  const { data } = await sb.from("supplier_balances").select("*").eq("store_id", storeId).order("name");
  return <PartyPage kind="supplier" storeId={storeId} rows={data ?? []} canPay={role === "owner" || role === "manager"} />;
}
