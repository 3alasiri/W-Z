import { requireStore } from "@/lib/supabase-server";
import OrdersBoard from "./OrdersBoard";

export default async function Orders() {
  const { sb, storeId } = await requireStore();
  const since = new Date(Date.now() - 2 * 864e5).toISOString();
  const { data } = await sb.from("orders").select("id,number,status,fulfillment,total,payment_method,address,created_at,driver_id,customers(name,phone)")
    .eq("store_id", storeId).or(`status.in.(new,preparing,ready,out_for_delivery),created_at.gte.${since}`).order("created_at", { ascending: false }).limit(200);
  return <OrdersBoard storeId={storeId} orders={(data ?? []) as never} />;
}
