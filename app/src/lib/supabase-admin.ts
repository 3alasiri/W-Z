import { createClient } from "@supabase/supabase-js";

/** عميل بصلاحية الخادم الكاملة. يُستخدم في مسارات الخادم فقط لتأكيد الدفع، ولا يُرسل للمتصفح أبدًا. */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY غير مضبوط");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const paymentsEnabled = () => !!(process.env.MOYASAR_SECRET_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
