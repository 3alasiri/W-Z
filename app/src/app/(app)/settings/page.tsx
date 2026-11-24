import { requireStore } from "@/lib/supabase-server";
import SettingsClient from "./SettingsClient";

export default async function Settings() {
  const { sb, storeId, role } = await requireStore();
  const { data } = await sb.from("stores").select("*").eq("id", storeId).single();
  return <SettingsClient s={data} canEdit={role === "owner" || role === "manager"} />;
}
