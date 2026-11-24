import { supabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

/** بحث عن منتج بالباركود في قاعدة Open Food Facts المفتوحة (اسم، علامة، حجم، صورة حقيقية) */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.replace(/\D/g, "") ?? "";
  if (code.length < 8 || code.length > 14) return Response.json({ found: false });
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return Response.json({ found: false }, { status: 401 });
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_ar,brands,quantity,image_front_url,categories_tags`,
      { headers: { "User-Agent": "BaqaltiSmart/1.0 (grocery POS)" }, next: { revalidate: 86400 } });
    const d = await r.json();
    if (d.status !== 1 || !d.product) return Response.json({ found: false });
    const p = d.product;
    const name = [p.product_name_ar || p.product_name, p.quantity].filter(Boolean).join(" ").trim();
    return Response.json({ found: true, name, brand: p.brands ?? null, image: p.image_front_url ?? null, source: "Open Food Facts" });
  } catch {
    return Response.json({ found: false });
  }
}
