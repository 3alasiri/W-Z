import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {}
      },
    },
  });
}

export type StoreRef = { id: string; name: string; role: string };
export type Ctx = { sb: Awaited<ReturnType<typeof supabaseServer>>; storeId: string; storeName: string; role: string; userId: string; stores: StoreRef[] };

/** الفرع الحالي محفوظ في كوكي، ويُتحقق أنه من فروع المستخدم */
export const STORE_COOKIE = "sid";

/** يتحقق من الدخول ويعيد المتجر الحالي، أو يحوّل لصفحة الدخول/الإعداد */
export async function requireStore(next = "/"): Promise<Ctx> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  const { data } = await sb.from("store_members").select("role, stores(id,name,created_at)").eq("user_id", user.id);
  const stores = (data ?? []).map((m) => { const s = m.stores as unknown as { id: string; name: string; created_at: string };
    return { id: s.id, name: s.name, role: m.role as string, at: s.created_at }; })
    .sort((a, b) => a.at.localeCompare(b.at)).map(({ at: _at, ...r }) => r); // eslint-disable-line @typescript-eslint/no-unused-vars
  if (!stores.length) redirect("/onboarding");
  const sid = (await cookies()).get(STORE_COOKIE)?.value;
  const cur = stores.find((s) => s.id === sid) ?? stores[0];
  return { sb, storeId: cur.id, storeName: cur.name, role: cur.role, userId: user.id, stores };
}
