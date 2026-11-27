-- المرحلة 4: التنبؤ بالطلب، العروض الذكية، تحليل العملاء والسلال، سجل البحث

-- ============ العروض والخصومات ============
create table public.price_offers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  discount_pct numeric(5,2) not null check (discount_pct > 0 and discount_pct <= 90),
  reason text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.price_offers(product_id, ends_at);
alter table public.price_offers enable row level security;
create policy offers_read on public.price_offers for select to authenticated using (has_store_role(store_id));

create or replace function public._effective_price(p_product uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select round(p.price * (1 - coalesce((select max(discount_pct) from price_offers o
     where o.product_id = p.id and now() between o.starts_at and o.ends_at), 0) / 100), 2)
  from products p where p.id = p_product;
$$;

create or replace function public.create_offer(p_product uuid, p_pct numeric, p_days int, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_store uuid; v uuid;
begin
  select store_id into v_store from products where id = p_product;
  if v_store is null then raise exception 'المنتج غير موجود'; end if;
  if not has_store_role(v_store, '{owner,manager}') then raise exception 'للمالك أو المدير فقط'; end if;
  if p_days < 1 or p_days > 60 then raise exception 'مدة العرض بين 1 و60 يومًا'; end if;
  update price_offers set ends_at = now() where product_id = p_product and ends_at > now();
  insert into price_offers(store_id, product_id, discount_pct, reason, ends_at)
    values (v_store, p_product, p_pct, p_reason, now() + make_interval(days => p_days)) returning id into v;
  return v;
end $$;

create or replace function public.end_offer(p_offer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_store uuid;
begin
  select store_id into v_store from price_offers where id = p_offer;
  if not has_store_role(v_store, '{owner,manager}') then raise exception 'للمالك أو المدير فقط'; end if;
  update price_offers set ends_at = now() where id = p_offer and ends_at > now();
end $$;

-- السعر الفعلي في عرض المخزون (يستخدمه نقطة البيع)
create or replace view public.product_stock with (security_invoker = true) as
select p.id, p.store_id, p.barcode, p.name, p.unit, p.cost, p.price, p.min_qty, p.active,
  c.name as category, s.name as supplier, coalesce(s.lead_days, 2) as lead_days,
  coalesce((select sum(qty) from batches b where b.product_id = p.id), 0) as stock,
  (select min(expiry_date) from batches b where b.product_id = p.id and b.qty > 0) as next_expiry,
  coalesce((select -sum(m.qty) / 28.0 from stock_movements m where m.product_id = p.id and m.type = 'sale'
     and m.created_at > now() - interval '28 days'), 0) as avg_daily,
  _effective_price(p.id) as sell_price
from products p
left join categories c on c.id = p.category_id
left join suppliers s on s.id = p.supplier_id;
grant execute on function public._effective_price(uuid) to authenticated;

-- ============ تطبيق السعر الفعلي في البيع والطلب ============
create or replace function public._sale_core(p_store uuid, p_items jsonb, p_payment text, p_customer uuid, p_fee numeric, p_order uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sale uuid; it jsonb; v_prod products%rowtype; v_need numeric; v_take numeric; b record; v_price numeric;
  v_total numeric := 0; v_rate numeric; v_cost_sum numeric; v_cogs numeric := 0; v_sub numeric; v_vat numeric;
  v_fee_sub numeric; v_fee_vat numeric; v_no bigint;
begin
  if jsonb_array_length(p_items) = 0 then raise exception 'الفاتورة فارغة'; end if;
  select vat_rate into v_rate from stores where id = p_store;
  insert into sales(store_id, subtotal, vat, total, payment_method, customer_id, order_id)
    values (p_store, 0, 0, 0, p_payment, p_customer, p_order) returning id, number into v_sale, v_no;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from products where id = (it->>'product_id')::uuid and store_id = p_store;
    if v_prod.id is null then raise exception 'منتج غير صالح'; end if;
    v_need := (it->>'qty')::numeric;
    if v_need <= 0 then raise exception 'كمية غير صالحة'; end if;
    v_price := coalesce((it->>'unit_price')::numeric, _effective_price(v_prod.id));
    v_cost_sum := 0;
    for b in select id, qty, unit_cost from batches
      where product_id = v_prod.id and qty > 0 and (expiry_date is null or expiry_date >= current_date)
      order by expiry_date nulls last, received_at for update loop
      exit when v_need <= 0;
      v_take := least(b.qty, v_need);
      update batches set qty = qty - v_take where id = b.id;
      insert into stock_movements(store_id, product_id, batch_id, type, qty, ref) values (p_store, v_prod.id, b.id, 'sale', -v_take, v_sale::text);
      v_cost_sum := v_cost_sum + v_take * b.unit_cost;
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then raise exception 'الكمية غير متوفرة من %', v_prod.name; end if;
    insert into sale_items(sale_id, product_id, name, qty, unit_price, unit_cost, line_total)
      values (v_sale, v_prod.id, v_prod.name, (it->>'qty')::numeric, v_price,
              round(v_cost_sum / (it->>'qty')::numeric, 2), round(v_price * (it->>'qty')::numeric, 2));
    v_total := v_total + round(v_price * (it->>'qty')::numeric, 2);
    v_cogs := v_cogs + v_cost_sum;
  end loop;
  v_sub := round(v_total / (1 + v_rate/100), 2); v_vat := v_total - v_sub;
  v_fee_sub := round(coalesce(p_fee,0) / (1 + v_rate/100), 2); v_fee_vat := coalesce(p_fee,0) - v_fee_sub;
  update sales set total = v_total + coalesce(p_fee,0), vat = v_vat + v_fee_vat, subtotal = v_sub + v_fee_sub, delivery_fee = coalesce(p_fee,0)
    where id = v_sale;
  perform _post(p_store, case when p_order is null then 'فاتورة مبيعات رقم ' else 'طلب أونلاين · فاتورة رقم ' end || v_no, 'sale', v_sale::text, jsonb_build_array(
    jsonb_build_object('code', _pay_acc(p_payment), 'debit', v_total + coalesce(p_fee,0), 'customer_id', case when p_payment = 'credit' then p_customer end),
    jsonb_build_object('code','4100','credit', v_sub),
    jsonb_build_object('code','4200','credit', v_fee_sub),
    jsonb_build_object('code','2200','credit', v_vat + v_fee_vat),
    jsonb_build_object('code','5100','debit', round(v_cogs, 2)),
    jsonb_build_object('code','1300','credit', round(v_cogs, 2))));
  return v_sale;
end $$;

create or replace function public.place_order(p_slug text, p_items jsonb, p_fulfillment text, p_payment text,
  p_name text, p_phone text, p_address text default null, p_lat float8 default null, p_lng float8 default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s stores%rowtype; v_cust uuid; v_order uuid; it jsonb; v_prod products%rowtype; v_q numeric; v_av numeric; v_total numeric := 0; v_fee numeric := 0; v_price numeric;
begin
  if auth.uid() is null then raise exception 'سجّل الدخول لإتمام الطلب'; end if;
  select * into s from stores where slug = lower(p_slug);
  if s.id is null then raise exception 'المتجر غير موجود'; end if;
  if not s.accepting_orders then raise exception 'المتجر لا يستقبل طلبات حاليًا'; end if;
  if p_fulfillment not in ('delivery','pickup') or p_payment not in ('cash','card') then raise exception 'بيانات غير صالحة'; end if;
  if coalesce(trim(p_name),'') = '' or coalesce(trim(p_phone),'') = '' then raise exception 'الاسم والجوال مطلوبان'; end if;
  if jsonb_array_length(coalesce(p_items,'[]')) = 0 then raise exception 'السلة فارغة'; end if;
  if p_fulfillment = 'delivery' then
    if coalesce(trim(p_address),'') = '' then raise exception 'العنوان مطلوب للتوصيل'; end if;
    if s.lat is not null and p_lat is not null and _km(s.lat, s.lng, p_lat, p_lng) > s.delivery_radius_km then
      raise exception 'موقعك خارج نطاق التوصيل (% كم)', s.delivery_radius_km;
    end if;
    v_fee := s.delivery_fee;
  end if;
  insert into customers(store_id, user_id, name, phone, address, lat, lng)
    values (s.id, auth.uid(), trim(p_name), trim(p_phone), p_address, p_lat, p_lng)
    on conflict (store_id, user_id) where user_id is not null
    do update set name = excluded.name, phone = excluded.phone,
      address = coalesce(excluded.address, customers.address), lat = coalesce(excluded.lat, customers.lat), lng = coalesce(excluded.lng, customers.lng)
    returning id into v_cust;
  insert into orders(store_id, customer_id, fulfillment, address, lat, lng, notes, payment_method, delivery_fee)
    values (s.id, v_cust, p_fulfillment, p_address, p_lat, p_lng, p_notes, p_payment, v_fee) returning id into v_order;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from products where id = (it->>'product_id')::uuid and store_id = s.id and active;
    if v_prod.id is null then raise exception 'منتج غير متاح'; end if;
    v_q := (it->>'qty')::numeric;
    if v_q is null or v_q <= 0 then raise exception 'كمية غير صالحة'; end if;
    perform 1 from products where id = v_prod.id for update;
    v_av := _available(v_prod.id, v_order);
    if v_av < v_q then raise exception 'المتاح من % هو % فقط', v_prod.name, greatest(v_av, 0); end if;
    v_price := _effective_price(v_prod.id);
    insert into order_items(order_id, product_id, name, qty, ordered_qty, unit_price) values (v_order, v_prod.id, v_prod.name, v_q, v_q, v_price);
    v_total := v_total + round(v_price * v_q, 2);
  end loop;
  if v_total < s.min_order then raise exception 'الحد الأدنى للطلب % ر.س', s.min_order; end if;
  update orders set items_total = v_total, total = v_total + v_fee where id = v_order;
  return v_order;
end $$;

-- كتالوج المتجر مع السعر قبل الخصم
create or replace function public.shop_catalog(p_slug text)
returns table(id uuid, name text, category text, unit text, price numeric, original_price numeric, available numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, c.name, p.unit, _effective_price(p.id), p.price, greatest(_available(p.id), 0)
  from products p join stores s on s.id = p.store_id left join categories c on c.id = p.category_id
  where s.slug = lower(p_slug) and p.active and _available(p.id) > 0
  order by c.name nulls last, p.name;
$$;

-- ============ التنبؤ وتحليل المنتجات ============
-- التوقع = متوسط يوم الأسبوع (8 أسابيع) ممزوجًا بمتوسط 28 يومًا، مضروبًا في معامل الاتجاه (آخر 14 / السابقة 14)
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
    coalesce((select sum(q) from d where d.product_id = ps.id and day > current_date - 28), 0) / 28.0 avg28,
    coalesce((select sum(q) from d where d.product_id = ps.id and day > current_date - 14), 0) / 14.0 a14,
    coalesce((select sum(q) from d where d.product_id = ps.id and day <= current_date - 14 and day > current_date - 28), 0) / 14.0 p14,
    coalesce((select sum(rev) from d where d.product_id = ps.id and day > current_date - 30), 0) rev30,
    coalesce((select sum(prof) from d where d.product_id = ps.id and day > current_date - 30), 0) prof30,
    (select max(day) from d where d.product_id = ps.id) last_sale
  from product_stock ps where ps.store_id = p_store and ps.active
),
wd as (select product_id, extract(dow from day)::int dow, sum(q) / 8.0 avgq from d group by 1, 2),
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
    sum(b.rev30) over (order by b.rev30 desc, b.id rows unbounded preceding) / nullif(sum(b.rev30) over (), 0) cum
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
  case when f.rev30 = 0 then 'C' when f.cum <= 0.8 then 'A' when f.cum <= 0.95 then 'B' else 'C' end,
  f.last_sale, f.first_exp, f.exq, f.sb, greatest(f.exq - f.sb, 0),
  case when f.first_exp is null or f.exq - f.sb <= 0 then 0
       when (f.first_exp - current_date) <= 2 or (f.exq - f.sb) / f.exq > 0.6 then 40
       when (f.exq - f.sb) / f.exq > 0.3 then 25 else 15 end,
  (select max(o.discount_pct) from price_offers o where o.product_id = f.id and now() between o.starts_at and o.ends_at)
from fin f
order by f.rev30 desc, f.name;
$$;

-- ============ تحليل العملاء (RFM) ============
create or replace function public.customer_segments(p_store uuid)
returns table(customer_id uuid, name text, phone text, last_purchase date, purchases int, spent numeric, avg_interval numeric,
  days_since int, segment text, high_value boolean)
language sql stable security invoker set search_path = public as $$
with s as (
  select c.id, c.name, c.phone, count(sa.id)::int n, sum(sa.total) spent,
    max(sa.created_at)::date last_p, min(sa.created_at)::date first_p
  from customers c join sales sa on sa.customer_id = c.id
  where c.store_id = p_store and sa.created_at > now() - interval '180 days'
  group by c.id
),
r as (
  select s.*, (current_date - s.last_p) ds,
    case when s.n > 1 then round((s.last_p - s.first_p)::numeric / (s.n - 1), 1) end ai,
    percent_rank() over (order by s.spent) pr
  from s
)
select r.id, r.name, r.phone, r.last_p, r.n, round(r.spent, 2), r.ai, r.ds,
  case when r.ds > 90 then 'lost'
       when r.n >= 2 and r.ds > greatest(21, 2 * coalesce(r.ai, 7)) then 'at_risk'
       when (current_date - r.first_p) <= 30 and r.n <= 2 then 'new'
       when r.n >= 4 and r.ds <= 30 then 'loyal'
       else 'regular' end,
  r.pr >= 0.8 and r.n >= 2
from r order by r.spent desc;
$$;

-- ============ تحليل السلة: منتجات تُشترى معًا ============
create or replace function public.basket_pairs(p_store uuid)
returns table(product_a uuid, name_a text, product_b uuid, name_b text, together int, confidence numeric, lift numeric)
language sql stable security invoker set search_path = public as $$
with t as (
  select distinct sa.id sid, si.product_id pid from sales sa join sale_items si on si.sale_id = sa.id
  where sa.store_id = p_store and sa.created_at > now() - interval '90 days'
),
n as (select count(distinct sid)::numeric total from t),
c as (select pid, count(*)::numeric cnt from t group by 1),
pr as (select a.pid pa, b.pid pb, count(*)::int bt from t a join t b on a.sid = b.sid and a.pid < b.pid group by 1, 2 having count(*) >= 2)
select pr.pa, p1.name, pr.pb, p2.name, pr.bt,
  round(pr.bt / least(ca.cnt, cb.cnt) * 100, 0), round(pr.bt * n.total / (ca.cnt * cb.cnt), 2)
from pr cross join n join c ca on ca.pid = pr.pa join c cb on cb.pid = pr.pb
join products p1 on p1.id = pr.pa join products p2 on p2.id = pr.pb
order by pr.bt desc, 7 desc limit 30;
$$;

-- ============ أوقات الذروة ============
create or replace function public.sales_heatmap(p_store uuid)
returns table(dow int, hour int, invoices int, revenue numeric)
language sql stable security invoker set search_path = public as $$
  select extract(dow from created_at at time zone 'Asia/Riyadh')::int, extract(hour from created_at at time zone 'Asia/Riyadh')::int,
    count(*)::int, round(sum(total), 2)
  from sales where store_id = p_store and created_at > now() - interval '28 days' group by 1, 2;
$$;

-- ============ سجل البحث في متجر العميل ============
create table public.shop_searches (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  term text not null, results int not null, user_id uuid, created_at timestamptz not null default now()
);
create index on public.shop_searches(store_id, created_at desc);
alter table public.shop_searches enable row level security;
create policy searches_read on public.shop_searches for select to authenticated using (has_store_role(store_id, '{owner,manager,stock}'));

create or replace function public.log_shop_search(p_slug text, p_term text, p_results int) returns void
language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_term text := lower(trim(p_term));
begin
  if length(v_term) < 2 or length(v_term) > 60 then return; end if;
  select id into v_store from stores where slug = lower(p_slug);
  if v_store is null then return; end if;
  -- حد بسيط: سجل واحد لكل مصطلح ومستخدم كل 10 دقائق
  if exists(select 1 from shop_searches where store_id = v_store and term = v_term and user_id is not distinct from auth.uid()
            and created_at > now() - interval '10 minutes') then return; end if;
  insert into shop_searches(store_id, term, results, user_id) values (v_store, v_term, greatest(p_results, 0), auth.uid());
end $$;

-- ============ توصيات للعميل في المتجر ============
create or replace function public.shop_recommendations(p_slug text, p_cart uuid[] default '{}')
returns table(id uuid, name text, price numeric, original_price numeric, available numeric, reason text)
language sql stable security definer set search_path = public as $$
with st as (select id from stores where slug = lower(p_slug)),
me as (select c.id from customers c, st where c.store_id = st.id and c.user_id = auth.uid() and auth.uid() is not null),
hist as (
  select si.product_id pid, count(distinct sa.id) n, max(sa.created_at)::date last_d, min(sa.created_at)::date first_d
  from sales sa join sale_items si on si.sale_id = sa.id where sa.customer_id in (select id from me)
  group by 1 having count(distinct sa.id) >= 2
),
again as (
  select pid, 1 pri, 'حان وقت إعادة الشراء' reason from hist
  where current_date - last_d >= greatest(2, (last_d - first_d)::numeric / (n - 1) * 0.9)
),
t as (
  select distinct sa.id sid, si.product_id pid from sales sa join sale_items si on si.sale_id = sa.id, st
  where sa.store_id = st.id and sa.created_at > now() - interval '90 days'
),
together as (
  select b.pid, 2 pri, 'يُشترى عادة مع ما في سلتك' reason from t a join t b on a.sid = b.sid and a.pid <> b.pid
  where a.pid = any(p_cart) group by b.pid having count(*) >= 2
),
popular as (
  select si.product_id pid, 3 pri, 'الأكثر طلبًا هذا الأسبوع' reason from sales sa join sale_items si on si.sale_id = sa.id, st
  where sa.store_id = st.id and sa.created_at > now() - interval '14 days' group by 1 order by sum(si.qty) desc limit 8
),
allr as (select * from again union all select * from together union all select * from popular),
best as (select distinct on (pid) pid, pri, reason from allr where not (pid = any(p_cart)) order by pid, pri)
select p.id, p.name, _effective_price(p.id), p.price, _available(p.id), best.reason
from best join products p on p.id = best.pid, st
where p.store_id = st.id and p.active and _available(p.id) > 0
order by best.pri, p.name limit 8;
$$;

-- ============ أوامر الشراء التلقائية تستخدم التوقع ============
create or replace function public._generate_pos(p_store uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_limit numeric; sup record; v_po uuid; v_total numeric; n int := 0;
begin
  select auto_approve_limit into v_limit from stores where id = p_store;
  for sup in
    select distinct p.supplier_id from stock_alerts a join products p on p.id = a.product_id
    where a.store_id = p_store and a.kind in ('low','out') and p.supplier_id is not null and p.active
      and not exists(select 1 from po_items i join purchase_orders o on o.id = i.po_id
                     where i.product_id = p.id and o.status in ('draft','approved','sent','partial'))
  loop
    insert into purchase_orders(store_id, supplier_id, status, auto) values (p_store, sup.supplier_id, 'draft', true) returning id into v_po;
    insert into po_items(po_id, product_id, qty, unit_cost)
    select v_po, a.product_id,
      greatest(1, ceil(case when coalesce(pi.forecast_7d, 0) > 0 then pi.forecast_7d + a.reorder_point - a.stock
                            when ps.avg_daily > 0 then ps.avg_daily * 7 + a.reorder_point - a.stock
                            else greatest(ps.min_qty * 2, 1) - a.stock end)),
      ps.cost
    from stock_alerts a join product_stock ps on ps.id = a.product_id join products p on p.id = a.product_id
    left join product_insights(p_store) pi on pi.product_id = a.product_id
    where a.store_id = p_store and a.kind in ('low','out') and p.supplier_id = sup.supplier_id and p.active
      and not exists(select 1 from po_items i join purchase_orders o on o.id = i.po_id
                     where i.product_id = p.id and o.status in ('draft','approved','sent','partial') and o.id <> v_po);
    perform _recalc_po(v_po);
    select total into v_total from purchase_orders where id = v_po;
    if v_total <= v_limit then update purchase_orders set status = 'approved', approved_at = now() where id = v_po; end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ============ الصلاحيات ============
revoke execute on function public._generate_pos(uuid) from anon, authenticated, public;
revoke execute on function public.create_offer(uuid,numeric,int,text), public.end_offer(uuid), public.product_insights(uuid),
  public.customer_segments(uuid), public.basket_pairs(uuid), public.sales_heatmap(uuid) from anon, public;
grant execute on function public.create_offer(uuid,numeric,int,text), public.end_offer(uuid), public.product_insights(uuid),
  public.customer_segments(uuid), public.basket_pairs(uuid), public.sales_heatmap(uuid) to authenticated;
grant execute on function public.shop_catalog(text), public.log_shop_search(text,text,int), public.shop_recommendations(text,uuid[]) to anon, authenticated;
