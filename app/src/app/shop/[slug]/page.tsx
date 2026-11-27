import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import ShopClient from "./ShopClient";
import { paymentsEnabled } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function Shop({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await supabaseServer();
  const [{ data: store }, { data: products }, { data: { user } }] = await Promise.all([
    sb.rpc("shop_store", { p_slug: slug }), sb.rpc("shop_items", { p_slug: slug }), sb.auth.getUser(),
  ]);
  if (!store) notFound();
  const { data: me } = user ? await sb.from("customers").select("name,phone,address,lat,lng").eq("user_id", user.id).eq("store_id", store.id).maybeSingle() : { data: null };
  return <ShopClient store={store} products={products ?? []} loggedIn={!!user} me={me} onlinePay={paymentsEnabled()} />;
}
