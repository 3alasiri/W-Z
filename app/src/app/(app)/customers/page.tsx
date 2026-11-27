import { requireStore } from "@/lib/supabase-server";
import PartyPage from "@/components/PartyPage";

export default async function Customers() {
  const { sb, storeId, role } = await requireStore();
  const { data } = await sb.from("customer_balances").select("*").eq("store_id", storeId).order("name");
  return <PartyPage kind="customer" storeId={storeId} rows={data ?? []} canPay={role !== "stock"} />;
}
