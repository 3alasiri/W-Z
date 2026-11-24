import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import TrackClient from "./TrackClient";

export const dynamic = "force-dynamic";

export default async function Track({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/shop/${slug}/orders/${id}`);
  const { data: o } = await sb.from("orders").select("*, order_items(name,qty,ordered_qty,unit_price)").eq("id", id).maybeSingle();
  if (!o) notFound();
  const { data: store } = await sb.rpc("shop_store", { p_slug: slug });
  return <TrackClient slug={slug} o={o as never} storePhone={store?.phone ?? null} />;
}
