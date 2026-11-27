-- تصحيح: التوقع حسب عمر بيانات المنتج، وتصنيف ABC حسب الحصة التراكمية قبل الصنف
create or replace function public.product_insights(p_store uuid)
returns table(product_id uuid, name text, category text, supplier text, lead_days int, price numeric, cost numeric, stock numeric,
  avg_daily numeric, trend numeric, forecast_7d numeric, days_cover numeric, revenue_30d numeric, profit_30d numeric, abc text,
  last_sale date, next_expiry date, expiring_qty numeric, sell_before_expiry numeric, surplus numeric, suggested_discount int, offer_pct numeric)
language sql stable security invoker set search_path = public as $$
with d as (
  select si.product_id, (s.created_at at time zone 'Asia/Riyadh')::date as day, sum(si.qty) q, sum(si.line_total) rev,
         sum(si.line_total / (1 + st.vat_rate/100) - si.qty * si.unit_cost) prof
  from sales s join sale_items si on si.sale_id = s.id join stores st on st.id = s.store_id
  where s.store_id = p_store and s.created_at > now() - interval '56 days' group by 1, 2
),
base as (
  select ps.id, ps.name, ps.category, ps.supplier, ps.lead_days::int lead_days, ps.price, ps.cost, ps.stock,
    coalesce((select sum(q) from d where d.product_id = ps.id and day > current_date - 28), 0)
      / greatest(7, least(28, current_date - coalesce((select min(day) from d where d.product_id = ps.id), current_date - 28))) avg28,
    coalesce((select sum(q) from d where d.product_id = ps.id and day > current_date - 14), 0) / 14.0 a14,
    coalesce((select sum(q) from d where d.product_id = ps.id and day <= current_date - 14 and day > current_date - 28), 0) / 14.0 p14,
    coalesce((select sum(rev) from d where d.product_id = ps.id and day > current_date - 30), 0) rev30,
    coalesce((select sum(prof) from d where d.product_id = ps.id and day > current_date - 30), 0) prof30,
    (select max(day) from d where d.product_id = ps.id) last_sale
  from product_stock ps where ps.store_id = p_store and ps.active
),
fd as (select product_id, min(day) first_day from d group by 1),
wd as (
  select d.product_id, extract(dow from d.day)::int dow,
    sum(d.q) / greatest(1, floor((current_date - fd.first_day) / 7.0)) avgq
  from d join fd on fd.product_id = d.product_id group by 1, 2, fd.first_day
),
fc as (
  select b.id, sum(0.5 * coalesce(w.avgq, 0) + 0.5 * b.avg28) f7
  from base b cross join generate_series(1, 7) g
  left join wd w on w.product_id = b.id and w.dow = extract(dow from current_date + g)::int
  group by b.id
),
ex as (
  select bt.product_id, min(bt.expiry_date) first_exp, sum(bt.qty) qty
  from batches bt where bt.store_id = p_store and bt.qty > 0 and bt.expiry_date between current_date and current_date + 14
  group by 1
),
calc as (
  select b.*, case when b.p14 > 0 then least(1.3, greatest(0.7, b.a14 / b.p14)) else 1 end tr, fc.f7, ex.first_exp, coalesce(ex.qty, 0) exq,
    (sum(b.rev30) over (order by b.rev30 desc, b.id rows unbounded preceding) - b.rev30) / nullif(sum(b.rev30) over (), 0) cum
  from base b join fc on fc.id = b.id left join ex on ex.product_id = b.id
),
fin as (
  select c.*, round(c.f7 * c.tr, 1) f7t,
    case when c.first_exp is null then 0 else least(c.exq, round(c.f7 * c.tr / 7 * (c.first_exp - current_date), 1)) end sb
  from calc c
)
select f.id, f.name, f.category, f.supplier, f.lead_days, f.price, f.cost, f.stock,
  round(f.avg28, 2), round(f.tr, 2), f.f7t,
  case when f.f7t > 0 then round(f.stock / (f.f7t / 7), 1) end,
  round(f.rev30, 2), round(f.prof30, 2),
  case when f.rev30 = 0 then 'C' when f.cum < 0.8 then 'A' when f.cum < 0.95 then 'B' else 'C' end,
  f.last_sale, f.first_exp, f.exq, f.sb, greatest(f.exq - f.sb, 0),
  case when f.first_exp is null or f.exq - f.sb <= 0 then 0
       when (f.first_exp - current_date) <= 2 or (f.exq - f.sb) / f.exq > 0.6 then 40
       when (f.exq - f.sb) / f.exq > 0.3 then 25 else 15 end,
  (select max(o.discount_pct) from price_offers o where o.product_id = f.id and now() between o.starts_at and o.ends_at)
from fin f
order by f.rev30 desc, f.name;
$$;

