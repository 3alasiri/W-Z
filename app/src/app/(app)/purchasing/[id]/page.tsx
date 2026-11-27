import { notFound } from "next/navigation";
import { requireStore } from "@/lib/supabase-server";
import PoClient from "./PoClient";

export default async function PoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, storeId, storeName, role } = await requireStore();
  const { data: po } = await sb.from("purchase_orders").select("*, suppliers(name,phone,email)").eq("id", id).eq("store_id", storeId).maybeSingle();
  if (!po) notFound();
  const [{ data: items }, { data: products }, { data: locs }, { data: st }] = await Promise.all([
    sb.from("po_items").select("id,product_id,qty,unit_cost,received_qty,products(name,barcode)").eq("po_id", id).order("id"),
    sb.from("products").select("id,barcode,name,cost").eq("store_id", storeId).eq("active", true),
    sb.from("locations").select("id,name").eq("store_id", storeId).order("kind", { ascending: false }),
    sb.from("stores").select("vat_rate").eq("id", storeId).single(),
  ]);
  return <PoClient po={po as never} items={(items ?? []) as never} products={products ?? []} locs={locs ?? []} role={role} storeName={storeName} vat={Number(st?.vat_rate ?? 15)} />;
}
