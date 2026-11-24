import { requireStore } from "@/lib/supabase-server";
import DriverClient from "./DriverClient";

export const dynamic = "force-dynamic";

export default async function Driver() {
  const { sb, userId, storeName } = await requireStore("/driver");
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const { data } = await sb.from("orders").select("id,number,status,payment_status,address,lat,lng,notes,total,payment_method,delivered_at,customers(name,phone),order_items(name,qty)")
    .eq("driver_id", userId).or(`status.in.(ready,out_for_delivery),delivered_at.gte.${since.toISOString()}`).order("created_at");
  return <DriverClient userId={userId} storeName={storeName} orders={(data ?? []) as never} />;
}
