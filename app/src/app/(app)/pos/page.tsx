import { requireStore } from "@/lib/supabase-server";
import PosClient, { type Sellable } from "./PosClient";

export default async function Pos() {
  const { sb, storeId } = await requireStore();
  const [{ data }, { data: packs }, { data: st }, { data: customers }] = await Promise.all([
    sb.from("product_stock").select("id,barcode,name,price,sell_price,stock,image_url,category,unit").eq("store_id", storeId).eq("active", true).order("name"),
    sb.from("product_packs").select("id,product_id,name,units,price,barcode").eq("store_id", storeId).eq("active", true).order("units"),
    sb.from("stores").select("name,vat_rate,vat_number").eq("id", storeId).single(),
    sb.from("customers").select("id,name,phone").eq("store_id", storeId).order("name"),
  ]);
  // كل منتج يُباع مفردًا، وكل عبوة كبطاقة مستقلة بسعرها وباركودها
  const items: Sellable[] = [];
  for (const p of data ?? []) {
    const ratio = Number(p.sell_price ?? p.price) / Number(p.price || 1);
    items.push({ id: p.id, product_id: p.id, pack_id: null, units: 1, barcode: p.barcode, name: p.name, pack: null, category: p.category, image_url: p.image_url,
      price: Number(p.sell_price ?? p.price), list_price: Number(p.price), stock: Number(p.stock) });
    for (const k of (packs ?? []).filter((k) => k.product_id === p.id))
      items.push({ id: k.id, product_id: p.id, pack_id: k.id, units: Number(k.units), barcode: k.barcode ?? "", name: p.name, pack: k.name, category: p.category, image_url: p.image_url,
        price: Math.round(Number(k.price) * ratio * 100) / 100, list_price: Number(k.price), stock: Math.floor(Number(p.stock) / Number(k.units)) });
  }
  return <PosClient storeId={storeId} products={items} store={st!} customers={customers ?? []} />;
}
