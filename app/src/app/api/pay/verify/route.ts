import { supabaseServer } from "@/lib/supabase-server";
import { paymentsEnabled } from "@/lib/supabase-admin";
import { verifyOrderPayment } from "@/lib/moyasar";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!paymentsEnabled()) return Response.json({ status: "disabled" }, { status: 503 });
  const { orderId } = await req.json().catch(() => ({}));
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return Response.json({ error: "سجّل الدخول أولًا" }, { status: 401 });
  const { data: o } = await sb.from("orders").select("id").eq("id", orderId).maybeSingle();
  if (!o) return Response.json({ error: "الطلب غير موجود" }, { status: 404 });
  try { return Response.json({ status: await verifyOrderPayment(o.id) }); }
  catch (e) { console.error("pay/verify", e); return Response.json({ status: "error" }, { status: 502 }); }
}
