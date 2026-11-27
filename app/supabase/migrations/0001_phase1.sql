-- المرحلة 1: المتاجر، المنتجات، المخزون بالدفعات، نقطة البيع، التنبيهات
create extension if not exists pgcrypto;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vat_rate numeric(5,2) not null default 15,
  vat_number text,
  expiry_warn_days int not null default 7,
  created_at timestamptz not null default now()
);

create type public.store_role as enum ('owner','manager','cashier','stock');

create table public.store_members (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.store_role not null default 'cashier',
  primary key (store_id, user_id)
);
create index on public.store_members(user_id);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  kind text not null default 'shelf' check (kind in ('shelf','warehouse'))
);
create index on public.locations(store_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  unique (store_id, name)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  phone text,
  lead_days int not null default 2
);
create index on public.suppliers(store_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  barcode text not null,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  unit text not null default 'قطعة',
  cost numeric(12,2) not null default 0,
  price numeric(12,2) not null check (price >= 0),
  min_qty numeric(12,3) not null default 0,
  tracks_expiry boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, barcode)
);
create index on public.products(store_id);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  qty numeric(12,3) not null check (qty >= 0),
  expiry_date date,
  unit_cost numeric(12,2) not null default 0,
  received_at timestamptz not null default now()
);
create index on public.batches(product_id, expiry_date) where qty > 0;
create index on public.batches(store_id);

create type public.movement_type as enum ('receive','sale','adjust','waste','transfer');

create table public.stock_movements (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  batch_id uuid references public.batches(id) on delete set null,
  type public.movement_type not null,
  qty numeric(12,3) not null,
  ref text,
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.stock_movements(store_id, created_at desc);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint generated always as identity,
  cashier_id uuid default auth.uid(),
  subtotal numeric(12,2) not null,
  vat numeric(12,2) not null,
  total numeric(12,2) not null,
  payment_method text not null check (payment_method in ('cash','card','credit')),
  created_at timestamptz not null default now()
);
create index on public.sales(store_id, created_at desc);

create table public.sale_items (
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  name text not null,
  qty numeric(12,3) not null check (qty > 0),
  unit_price numeric(12,2) not null,
  unit_cost numeric(12,2) not null default 0,
  line_total numeric(12,2) not null
);
create index on public.sale_items(sale_id);

-- مساعد الصلاحيات
create or replace function public.has_store_role(p_store uuid, roles public.store_role[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from store_members m
    where m.store_id = p_store and m.user_id = auth.uid()
      and (roles is null or m.role = any(roles)));
$$;

-- RLS
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.locations enable row level security;
alter table public.categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

create policy stores_read on public.stores for select to authenticated using (has_store_role(id));
create policy stores_update on public.stores for update to authenticated using (has_store_role(id, '{owner,manager}'));
create policy members_read on public.store_members for select to authenticated using (has_store_role(store_id));
create policy members_admin on public.store_members for all to authenticated
  using (has_store_role(store_id, '{owner}')) with check (has_store_role(store_id, '{owner}'));

-- القراءة لكل الأعضاء، والكتابة للمدير وأمين المخزون
do $$ declare t text; begin
  foreach t in array array['locations','categories','suppliers','products'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (has_store_role(store_id))', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (has_store_role(store_id, ''{owner,manager,stock}'')) with check (has_store_role(store_id, ''{owner,manager,stock}''))', t);
  end loop;
end $$;

-- الدفعات والحركات والمبيعات: قراءة فقط، والكتابة عبر الدوال
create policy batches_read on public.batches for select to authenticated using (has_store_role(store_id));
create policy movements_read on public.stock_movements for select to authenticated using (has_store_role(store_id));
create policy sales_read on public.sales for select to authenticated using (has_store_role(store_id));
create policy sale_items_read on public.sale_items for select to authenticated
  using (exists(select 1 from sales s where s.id = sale_id and has_store_role(s.store_id)));

-- إنشاء متجر جديد للمستخدم الحالي
create or replace function public.create_store(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  insert into stores(name) values (p_name) returning id into v;
  insert into store_members(store_id, user_id, role) values (v, auth.uid(), 'owner');
  insert into locations(store_id, name, kind) values (v, 'رفوف المتجر', 'shelf'), (v, 'المستودع', 'warehouse');
  return v;
end $$;

-- استلام بضاعة
create or replace function public.receive_stock(p_product uuid, p_qty numeric, p_location uuid,
  p_expiry date default null, p_unit_cost numeric default null, p_ref text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_cost numeric; v_batch uuid;
begin
  select store_id, cost into v_store, v_cost from products where id = p_product;
  if v_store is null then raise exception 'المنتج غير موجود'; end if;
  if not has_store_role(v_store, '{owner,manager,stock}') then raise exception 'لا تملك صلاحية الاستلام'; end if;
  if p_qty <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر'; end if;
  if not exists(select 1 from locations where id = p_location and store_id = v_store) then raise exception 'موقع غير صالح'; end if;
  insert into batches(store_id, product_id, location_id, qty, expiry_date, unit_cost)
    values (v_store, p_product, p_location, p_qty, p_expiry, coalesce(p_unit_cost, v_cost))
    returning id into v_batch;
  insert into stock_movements(store_id, product_id, batch_id, type, qty, ref)
    values (v_store, p_product, v_batch, 'receive', p_qty, p_ref);
  -- تحديث التكلفة بالمتوسط المرجح
  if p_unit_cost is not null then
    update products p set cost = round(((select coalesce(sum(qty * unit_cost),0) from batches b where b.product_id = p.id)
      / nullif((select sum(qty) from batches b where b.product_id = p.id),0))::numeric, 2)
    where p.id = p_product;
  end if;
  return v_batch;
end $$;

-- إتمام بيع: يخصم بالأقرب انتهاءً أولًا (FEFO) بشكل ذري
create or replace function public.complete_sale(p_store uuid, p_items jsonb, p_payment text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sale uuid; it jsonb; v_prod products%rowtype; v_need numeric; v_take numeric; b record;
  v_total numeric := 0; v_vat_rate numeric; v_cost_sum numeric;
begin
  if not has_store_role(p_store) then raise exception 'لا تملك صلاحية البيع'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'الفاتورة فارغة'; end if;
  select vat_rate into v_vat_rate from stores where id = p_store;
  insert into sales(store_id, subtotal, vat, total, payment_method) values (p_store, 0, 0, 0, p_payment) returning id into v_sale;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from products where id = (it->>'product_id')::uuid and store_id = p_store;
    if v_prod.id is null then raise exception 'منتج غير صالح'; end if;
    v_need := (it->>'qty')::numeric;
    if v_need <= 0 then raise exception 'كمية غير صالحة'; end if;
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
      values (v_sale, v_prod.id, v_prod.name, (it->>'qty')::numeric, v_prod.price,
              round(v_cost_sum / (it->>'qty')::numeric, 2), round(v_prod.price * (it->>'qty')::numeric, 2));
    v_total := v_total + round(v_prod.price * (it->>'qty')::numeric, 2);
  end loop;

  -- الأسعار شاملة الضريبة
  update sales set total = v_total,
    vat = round(v_total - v_total / (1 + v_vat_rate/100), 2),
    subtotal = round(v_total / (1 + v_vat_rate/100), 2)
  where id = v_sale;
  return v_sale;
end $$;

-- تسجيل تالف أو تسوية جرد لدفعة
create or replace function public.adjust_batch(p_batch uuid, p_new_qty numeric, p_type public.movement_type default 'adjust', p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b batches%rowtype;
begin
  select * into b from batches where id = p_batch for update;
  if b.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if not has_store_role(b.store_id, '{owner,manager,stock}') then raise exception 'لا تملك الصلاحية'; end if;
  if p_new_qty < 0 then raise exception 'كمية غير صالحة'; end if;
  if p_type not in ('adjust','waste') then raise exception 'نوع غير صالح'; end if;
  update batches set qty = p_new_qty where id = p_batch;
  insert into stock_movements(store_id, product_id, batch_id, type, qty, ref) values (b.store_id, b.product_id, b.id, p_type, p_new_qty - b.qty, p_ref);
end $$;

-- عرض المخزون مع متوسط البيع ونقطة إعادة الطلب
create or replace view public.product_stock with (security_invoker = true) as
select p.id, p.store_id, p.barcode, p.name, p.unit, p.cost, p.price, p.min_qty, p.active,
  c.name as category, s.name as supplier, coalesce(s.lead_days, 2) as lead_days,
  coalesce((select sum(qty) from batches b where b.product_id = p.id), 0) as stock,
  (select min(expiry_date) from batches b where b.product_id = p.id and b.qty > 0) as next_expiry,
  coalesce((select -sum(m.qty) / 28.0 from stock_movements m where m.product_id = p.id and m.type = 'sale'
     and m.created_at > now() - interval '28 days'), 0) as avg_daily
from products p
left join categories c on c.id = p.category_id
left join suppliers s on s.id = p.supplier_id;

-- التنبيهات: نفاد، انخفاض، قرب انتهاء، منتهي
create or replace view public.stock_alerts with (security_invoker = true) as
with ps as (
  select *, greatest(min_qty, ceil(avg_daily * lead_days + 1.65 * avg_daily * 0.35 * sqrt(lead_days))) as reorder_point
  from product_stock where active
)
select store_id, id as product_id, name, 'out' as kind, 'bad' as severity, stock, null::date as expiry_date, null::uuid as batch_id, reorder_point
  from ps where stock <= 0
union all
select store_id, id, name, 'low', 'warn', stock, null, null, reorder_point
  from ps where stock > 0 and stock <= reorder_point
union all
select b.store_id, b.product_id, p.name,
  case when b.expiry_date < current_date then 'expired' else 'expiring' end,
  case when b.expiry_date <= current_date + 3 then 'bad' else 'warn' end,
  b.qty, b.expiry_date, b.id, null
from batches b join products p on p.id = b.product_id join stores st on st.id = b.store_id
where b.qty > 0 and b.expiry_date is not null and b.expiry_date <= current_date + st.expiry_warn_days;

revoke execute on function public.create_store, public.receive_stock, public.complete_sale, public.adjust_batch from anon, public;
grant execute on function public.create_store, public.receive_stock, public.complete_sale, public.adjust_batch to authenticated;
