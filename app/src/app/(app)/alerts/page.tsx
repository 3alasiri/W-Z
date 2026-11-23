import { requireStore } from "@/lib/supabase-server";
import AlertsClient from "./AlertsClient";

export default async function Alerts() {
  const { sb, storeId } = await requireStore();
  const { data } = await sb.from("stock_alerts").select("*").eq("store_id", storeId);
  return <AlertsClient rows={data ?? []} />;
}
