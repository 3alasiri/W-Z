import { NextResponse } from "next/server";
import { supabaseServer, STORE_COOKIE } from "@/lib/supabase-server";

// تبديل الفرع الحالي
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({}));
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "سجّل الدخول" }, { status: 401 });
  const { data } = await sb.from("store_members").select("store_id").eq("user_id", user.id).eq("store_id", String(id ?? "")).maybeSingle();
  if (!data) return NextResponse.json({ error: "ليس من فروعك" }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STORE_COOKIE, data.store_id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return res;
}
