import { supabaseAdmin } from "./supabase-admin";

// بوابة Moyasar: فاتورة دفع مستضافة (POST /v1/invoices، مصادقة Basic بالمفتاح السري). المبالغ بالهللة.
// callback_url يستقبل كائن الفاتورة عند الدفع، ونعيد جلبها من Moyasar للتحقق بدل الثقة بمحتوى الإشعار.
const API = "https://api.moyasar.com/v1";
const auth = () => "Basic " + Buffer.from(`${process.env.MOYASAR_SECRET_KEY}:`).toString("base64");

export type MoyasarInvoice = { id: string; status: string; amount: number; currency: string; url: string; metadata?: Record<string, string> | null };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: auth(), "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Moyasar ${res.status}: ${body?.message ?? "خطأ غير معروف"}`);
  return body as T;
}

export const createInvoice = (p: { amount: number; description: string; successUrl: string; backUrl: string; callbackUrl: string }) =>
  call<MoyasarInvoice>("/invoices", {
    method: "POST",
    body: JSON.stringify({ amount: p.amount, currency: "SAR", description: p.description, success_url: p.successUrl, back_url: p.backUrl,
      callback_url: p.callbackUrl }),
  });

export const fetchInvoice = (id: string) => call<MoyasarInvoice>(`/invoices/${encodeURIComponent(id)}`);

/** يتحقق من حالة الفاتورة لدى Moyasar مباشرة (لا يثق بأي بيانات من المتصفح أو الإشعار) ثم يحدّث الطلب */
export async function verifyOrderPayment(orderId: string): Promise<string> {
  const admin = supabaseAdmin();
  const { data: o } = await admin.from("orders").select("id,total,payment_status,payment_ref").eq("id", orderId).maybeSingle();
  if (!o) return "not_found";
  if (o.payment_status !== "pending" || !o.payment_ref) return o.payment_status;
  const inv = await fetchInvoice(o.payment_ref);
  const halalas = Math.round(Number(o.total) * 100);
  // الفاتورة مرتبطة بالطلب عبر رقمها المحفوظ في payment_ref، ونتحقق من المبلغ والعملة
  if (inv.id === o.payment_ref && inv.status === "paid" && inv.amount === halalas && inv.currency === "SAR") {
    const { error } = await admin.rpc("mark_order_payment", { p_order: o.id, p_ref: inv.id, p_status: "paid", p_amount: inv.amount / 100 });
    if (error) throw error;
    return "paid";
  }
  if (["failed", "expired", "canceled", "voided"].includes(inv.status)) {
    await admin.rpc("mark_order_payment", { p_order: o.id, p_ref: inv.id, p_status: "failed", p_amount: 0 });
    return "failed";
  }
  return "pending";
}
