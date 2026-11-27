import { requireStore } from "@/lib/supabase-server";
import TeamClient from "./TeamClient";

export default async function Team() {
  const { sb, storeId, role, userId } = await requireStore();
  const { data } = await sb.rpc("store_team", { p_store: storeId });
  return <TeamClient storeId={storeId} isOwner={role === "owner"} me={userId} team={data ?? []} />;
}
