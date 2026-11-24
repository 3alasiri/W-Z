import { notFound } from "next/navigation";
import { requireStore } from "@/lib/supabase-server";
import OrderClient from "./OrderClient";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, storeId } = await requireStore();
  const { data: o } = await sb.from("orders").select("*, customers(name,phone)").eq("id", id).eq("store_id", storeId).maybeSingle();
  if (!o) notFound();
  const [{ data: items }, { data: team }] = await Promise.all([
    sb.from("order_items").select("id,product_id,name,qty,ordered_qty,unit_price,picked,products(barcode)").eq("order_id", id).order("id"),
    sb.rpc("store_team", { p_store: storeId }),
  ]);
  return <OrderClient o={o as never} items={(items ?? []) as never} drivers={(team ?? []).filter((m: { role: string }) => m.role === "driver")} />;
}
