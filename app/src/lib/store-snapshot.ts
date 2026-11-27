import type { Ctx } from "./supabase-server";

const r2 = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;

/** لقطة مختصرة من بيانات المتجر يستند إليها المساعد. تُقرأ بصلاحيات المستخدم نفسه. */
export async function storeSnapshot({ sb, storeId, storeName }: Pick<Ctx, "sb" | "storeId" | "storeName">) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();

  const [products, customers, pairs, heat, alerts, sales, pos, suppliers, balances, orders] = await Promise.all([
    sb.rpc("product_insights", { p_store: storeId }),
    sb.rpc("customer_segments", { p_store: storeId }),
    sb.rpc("basket_pairs", { p_store: storeId }),
    sb.rpc("sales_heatmap", { p_store: storeId }),
    sb.from("stock_alerts").select("name,kind,stock,expiry_date").eq("store_id", storeId),
    sb.from("sales").select("total,payment_method,created_at,order_id").eq("store_id", storeId).gte("created_at", since30).limit(5000),
    sb.from("purchase_orders").select("number,status,total,created_at,suppliers(name)").eq("store_id", storeId).in("status", ["draft", "approved", "sent", "partial"]),
    sb.from("supplier_balances").select("name,balance,lead_days").eq("store_id", storeId),
    sb.rpc("account_balances", { p_store: storeId, p_from: monthStart, p_to: today }),
    sb.from("orders").select("status,total,created_at").eq("store_id", storeId).gte("created_at", since30).limit(2000),
  ]);

  const byDay: Record<string, { total: number; invoices: number }> = {};
  for (const s of sales.data ?? []) {
    const d = s.created_at.slice(0, 10);
    byDay[d] ??= { total: 0, invoices: 0 };
    byDay[d].total = r2(byDay[d].total + Number(s.total)); byDay[d].invoices++;
  }
  const net = (b: { type: string; debit: number; credit: number }) => r2(b.type === "asset" || b.type === "expense" ? b.debit - b.credit : b.credit - b.debit);

  return {
    store: storeName,
    generated_at: now.toISOString(),
    currency: "SAR (الأسعار شاملة ضريبة 15٪، التكاليف قبل الضريبة)",
    sales_by_day_last_30: byDay,
    online_orders_last_30: (orders.data ?? []).reduce<Record<string, number>>((a, o) => { a[o.status] = (a[o.status] ?? 0) + 1; return a; }, {}),
    month_to_date_accounts: (balances.data ?? []).filter((b: { debit: number; credit: number }) => Number(b.debit) || Number(b.credit))
      .map((b: { code: string; name: string; type: string; debit: number; credit: number }) => ({ code: b.code, name: b.name, balance: net(b) })),
    products: (products.data ?? []).map((p: Record<string, unknown>) => ({
      name: p.name, supplier: p.supplier, abc: p.abc, price: r2(p.price), cost: r2(p.cost), stock: r2(p.stock), avg_daily: r2(p.avg_daily),
      trend: r2(p.trend), forecast_7d: r2(p.forecast_7d), days_cover: p.days_cover, lead_days: p.lead_days, revenue_30d: r2(p.revenue_30d),
      profit_30d: r2(p.profit_30d), last_sale: p.last_sale, next_expiry: p.next_expiry, expiring_qty: r2(p.expiring_qty),
      surplus_before_expiry: r2(p.surplus), suggested_discount_pct: p.suggested_discount, active_offer_pct: p.offer_pct,
    })),
    stock_alerts: alerts.data ?? [],
    open_purchase_orders: pos.data ?? [],
    suppliers: suppliers.data ?? [],
    customer_segments: (customers.data ?? []).map((c: Record<string, unknown>) => ({
      name: c.name, segment: c.segment, purchases: c.purchases, spent: r2(c.spent), avg_interval_days: c.avg_interval, days_since_last: c.days_since, high_value: c.high_value,
    })),
    bought_together: pairs.data ?? [],
    sales_heatmap_dow_hour: heat.data ?? [],
  };
}
