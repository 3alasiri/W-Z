import { supabaseAdmin, paymentsEnabled } from "@/lib/supabase-admin";
import { verifyOrderPayment } from "@/lib/moyasar";

export const runtime = "nodejs";

// إشعار من Moyasar: نستخرج رقم الفاتورة فقط ونتحقق منها مباشرة لدى Moyasar، دون الثقة بمحتوى الإشعار
export async function POST(req: Request) {
  if (!paymentsEnabled()) return new Response(null, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const ids = [body?.id, body?.invoice_id, body?.data?.invoice_id, body?.data?.id].filter((x) => typeof x === "string");
  if (!ids.length) return new Response(null, { status: 200 });
  const { data: o } = await supabaseAdmin().from("orders").select("id").in("payment_ref", ids).maybeSingle();
  if (o) { try { await verifyOrderPayment(o.id); } catch (e) { console.error("pay/webhook", e); return new Response(null, { status: 500 }); } }
  return new Response(null, { status: 200 });
}
