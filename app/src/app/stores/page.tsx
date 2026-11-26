import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase-server";
import DirectoryClient, { type Row } from "./DirectoryClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "بقالات الحي · بقالتي الذكية" };

export default async function Stores() {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("store_directory", {});
  return <DirectoryClient initial={(data ?? []) as Row[]} />;
}
