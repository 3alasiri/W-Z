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

export type Ctx = { sb: Awaited<ReturnType<typeof supabaseServer>>; storeId: string; storeName: string; role: string; userId: string };

/** يتحقق من الدخول ويعيد المتجر الحالي، أو يحوّل لصفحة الدخول/الإعداد */
export async function requireStore(next = "/"): Promise<Ctx> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  const { data } = await sb.from("store_members").select("role, stores(id,name)").eq("user_id", user.id).limit(1).maybeSingle();
  if (!data) redirect("/onboarding");
  const s = data.stores as unknown as { id: string; name: string };
  return { sb, storeId: s.id, storeName: s.name, role: data.role, userId: user.id };
}
