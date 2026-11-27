import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import AdminClient, { type A } from "./AdminClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "إدارة المنصة · بقالتي الذكية" };

export default async function Admin() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  const { data: ok } = await sb.rpc("is_platform_admin");
  if (!ok) notFound();
  const { data } = await sb.rpc("admin_stores");
  return <AdminClient rows={(data ?? []) as A[]} />;
}
