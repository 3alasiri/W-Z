import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin, paymentsEnabled } from "@/lib/supabase-admin";
import { createInvoice } from "@/lib/moyasar";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!paymentsEnabled()) return Response.json({ error: "الدفع الإلكتروني غير مفعّل" }, { status: 503 });
  const { orderId, slug } = await req.json().catch(() => ({}));
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return Response.json({ error: "سجّل الدخول أولًا" }, { status: 401 });
  // القراءة بصلاحيات العميل نفسه: لا يرى إلا طلباته
  const { data: o } = await sb.from("orders").select("id,number,total,payment_status,status,customers!inner(user_id)").eq("id", orderId).eq("customers.user_id", user.id).maybeSingle();
  if (!o) return Response.json({ error: "الطلب غير موجود" }, { status: 404 });
  if (o.payment_status !== "pending" || o.status !== "new") return Response.json({ error: "لا يحتاج هذا الطلب إلى دفع" }, { status: 400 });

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const back = `${origin}/shop/${encodeURIComponent(slug)}/orders/${o.id}`;
  try {
    const inv = await createInvoice({ amount: Math.round(Number(o.total) * 100), description: `طلب رقم ${o.number}`,
      successUrl: `${back}?paid=1`, backUrl: back, callbackUrl: `${origin}/api/pay/webhook` });
    const { error } = await supabaseAdmin().rpc("mark_order_payment", { p_order: o.id, p_ref: inv.id, p_status: "ref", p_amount: 0 });
    if (error) throw error;
    return Response.json({ url: inv.url });
  } catch (e) {
    console.error("pay/start", e);
    return Response.json({ error: "تعذّر إنشاء عملية الدفع. حاول مجددًا أو اختر الدفع عند الاستلام." }, { status: 502 });
  }
}
