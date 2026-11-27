-- المرحلة 3: الطلب الأونلاين، التجهيز، التوصيل، المناديب، فريق العمل

-- إعدادات المتجر للطلب الأونلاين
alter table public.stores
  add column if not exists slug text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists delivery_fee numeric(12,2) not null default 0,
  add column if not exists min_order numeric(12,2) not null default 0,
  add column if not exists delivery_radius_km numeric(6,2) not null default 3,
  add column if not exists accepting_orders boolean not null default true;
update public.stores set slug = substr(replace(id::text,'-',''),1,8) where slug is null;
alter table public.stores alter column slug set default substr(replace(gen_random_uuid()::text,'-',''),1,8);
alter table public.stores alter column slug set not null;
alter table public.stores add constraint stores_slug_key unique (slug);
alter table public.stores add constraint stores_slug_fmt check (slug ~ '^[a-z0-9-]{3,40}$');

-- عملاء التطبيق مرتبطون بحساب
alter table public.customers
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists address text,
  add column if not exists lat double precision,
  add column if not exists lng double precision;
create unique index if not exists customers_store_user on public.customers(store_id, user_id) where user_id is not null;
create policy customers_self on public.customers for select to authenticated using (user_id = auth.uid());

alter table public.sales
  add column if not exists order_id uuid,
  add column if not exists delivery_fee numeric(12,2) not null default 0;

-- حساب إيرادات التوصيل
create or replace function public._seed_accounts(p_store uuid) returns void
language sql security definer set search_path = public as $$
  insert into accounts(store_id, code, name, type) values
   (p_store,'1100','الصندوق','asset'),(p_store,'1110','البنك / مدى','asset'),
   (p_store,'1200','ذمم العملاء','asset'),(p_store,'1300','المخزون','asset'),
   (p_store,'1400','ضريبة المدخلات','asset'),
   (p_store,'2100','ذمم الموردين','liability'),(p_store,'2200','ضريبة المخرجات','liability'),
   (p_store,'3100','رأس المال','equity'),
   (p_store,'4100','المبيعات','revenue'),(p_store,'4200','إيرادات التوصيل','revenue'),
   (p_store,'5100','تكلفة البضاعة المباعة','expense'),(p_store,'5200','الهدر والتالف','expense'),
   (p_store,'5300','فروقات الجرد','expense'),
   (p_store,'6100','الرواتب','expense'),(p_store,'6200','الإيجار','expense'),
   (p_store,'6300','الكهرباء والماء','expense'),(p_store,'6400','التوصيل والنقل','expense'),
   (p_store,'6900','مصروفات أخرى','expense')
  on conflict (store_id, code) do nothing;
$$;
select public._seed_accounts(id) from public.stores;

create type public.order_status as enum ('new','preparing','ready','out_for_delivery','delivered','cancelled');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint generated always as identity,
  customer_id uuid not null references public.customers(id),
  status public.order_status not null default 'new',
  fulfillment text not null check (fulfillment in ('delivery','pickup')),
  address text, lat double precision, lng double precision, notes text,
  payment_method text not null check (payment_method in ('cash','card')),
  items_total numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  driver_id uuid references auth.users(id),
  sale_id uuid references public.sales(id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  preparing_at timestamptz, ready_at timestamptz, out_at timestamptz, delivered_at timestamptz, cancelled_at timestamptz
);
create index on public.orders(store_id, created_at desc);
create index on public.orders(customer_id);
create index on public.orders(driver_id) where driver_id is not null;

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  name text not null,
  qty numeric(12,3) not null check (qty >= 0),
  ordered_qty numeric(12,3) not null,
  unit_price numeric(12,2) not null,
  picked boolean not null default false
);
create index on public.order_items(order_id);

create table public.driver_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lat double precision not null, lng double precision not null,
  updated_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.driver_locations enable row level security;

create policy orders_read on public.orders for select to authenticated using (
  has_store_role(store_id, '{owner,manager,cashier,stock}')
  or driver_id = auth.uid()
  or exists(select 1 from customers c where c.id = customer_id and c.user_id = auth.uid()));
create policy order_items_read on public.order_items for select to authenticated using (
  exists(select 1 from orders o where o.id = order_id));
create policy driver_loc_read on public.driver_locations for select to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table public.orders;

-- ============ دوال مساعدة ============
create or replace function public._km(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns numeric
language sql immutable as $$
  select (6371 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))::numeric;
$$;

-- المتاح للبيع أونلاين = غير المنتهي − المحجوز في طلبات مفتوحة
create or replace function public._available(p_product uuid, p_exclude_order uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(qty) from batches where product_id = p_product and qty > 0
                   and (expiry_date is null or expiry_date >= current_date)), 0)
       - coalesce((select sum(i.qty) from order_items i join orders o on o.id = i.order_id
                   where i.product_id = p_product and o.status in ('new','preparing','ready','out_for_delivery')
                     and o.id is distinct from p_exclude_order), 0);
$$;

-- قلب البيع: يخصم FEFO، يسجل الفاتورة والقيد. رسوم التوصيل شاملة الضريبة
create or replace function public._sale_core(p_store uuid, p_items jsonb, p_payment text, p_customer uuid, p_fee numeric, p_order uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sale uuid; it jsonb; v_prod products%rowtype; v_need numeric; v_take numeric; b record;
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
      values (v_sale, v_prod.id, v_prod.name, (it->>'qty')::numeric, coalesce((it->>'unit_price')::numeric, v_prod.price),
              round(v_cost_sum / (it->>'qty')::numeric, 2), round(coalesce((it->>'unit_price')::numeric, v_prod.price) * (it->>'qty')::numeric, 2));
    v_total := v_total + round(coalesce((it->>'unit_price')::numeric, v_prod.price) * (it->>'qty')::numeric, 2);
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

create or replace function public.complete_sale(p_store uuid, p_items jsonb, p_payment text, p_customer uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sale uuid; v_limit numeric; v_bal numeric;
begin
  if not has_store_role(p_store, '{owner,manager,cashier,stock}') then raise exception 'لا تملك صلاحية البيع'; end if;
  if p_payment not in ('cash','card','credit') then raise exception 'طريقة دفع غير صالحة'; end if;
  if p_payment = 'credit' and p_customer is null then raise exception 'اختر العميل للبيع الآجل'; end if;
  if p_customer is not null and not exists(select 1 from customers where id = p_customer and store_id = p_store) then raise exception 'عميل غير صالح'; end if;
  v_sale := _sale_core(p_store, p_items, p_payment, p_customer, 0, null);
  if p_payment = 'credit' then
    select credit_limit into v_limit from customers where id = p_customer;
    select coalesce(sum(jl.debit - jl.credit), 0) into v_bal from journal_lines jl join accounts a on a.id = jl.account_id
      where jl.customer_id = p_customer and a.code = '1200';
    if v_limit > 0 and v_bal > v_limit then
      raise exception 'تجاوز حد الائتمان: الرصيد سيصبح % والحد %', v_bal, v_limit;
    end if;
  end if;
  return v_sale;
end $$;

-- ============ واجهة المتجر للعملاء ============
create or replace function public.shop_store(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'slug', slug, 'name', name, 'phone', phone, 'address', address,
    'delivery_fee', delivery_fee, 'min_order', min_order, 'radius_km', delivery_radius_km,
    'accepting_orders', accepting_orders, 'has_location', lat is not null)
  from stores where slug = lower(p_slug);
$$;

create or replace function public.shop_products(p_slug text)
returns table(id uuid, name text, category text, unit text, price numeric, available numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, c.name, p.unit, p.price, greatest(_available(p.id), 0)
  from products p join stores s on s.id = p.store_id left join categories c on c.id = p.category_id
  where s.slug = lower(p_slug) and p.active and _available(p.id) > 0
  order by c.name nulls last, p.name;
$$;

create or replace function public.place_order(p_slug text, p_items jsonb, p_fulfillment text, p_payment text,
  p_name text, p_phone text, p_address text default null, p_lat float8 default null, p_lng float8 default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s stores%rowtype; v_cust uuid; v_order uuid; it jsonb; v_prod products%rowtype; v_q numeric; v_av numeric; v_total numeric := 0; v_fee numeric := 0;
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
    insert into order_items(order_id, product_id, name, qty, ordered_qty, unit_price) values (v_order, v_prod.id, v_prod.name, v_q, v_q, v_prod.price);
    v_total := v_total + round(v_prod.price * v_q, 2);
  end loop;
  if v_total < s.min_order then raise exception 'الحد الأدنى للطلب % ر.س', s.min_order; end if;
  update orders set items_total = v_total, total = v_total + v_fee where id = v_order;
  return v_order;
end $$;

create or replace function public._recalc_order(p_order uuid) returns void
language sql security definer set search_path = public as $$
  update orders set items_total = coalesce((select sum(round(qty * unit_price, 2)) from order_items where order_id = p_order), 0),
    total = coalesce((select sum(round(qty * unit_price, 2)) from order_items where order_id = p_order), 0) + delivery_fee
  where id = p_order;
$$;

-- التجهيز: تعديل الكمية (0 = غير متوفر) وتعليم الصنف مجهزًا
create or replace function public.pick_item(p_item bigint, p_qty numeric, p_picked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select o.* into o from orders o join order_items i on i.order_id = o.id where i.id = p_item for update of o;
  if o.id is null then raise exception 'السطر غير موجود'; end if;
  if not has_store_role(o.store_id, '{owner,manager,cashier,stock}') then raise exception 'لا تملك الصلاحية'; end if;
  if o.status not in ('new','preparing') then raise exception 'لا يمكن التعديل بعد انتهاء التجهيز'; end if;
  if p_qty < 0 or p_qty > (select ordered_qty from order_items where id = p_item) then raise exception 'كمية غير صالحة'; end if;
  update order_items set qty = p_qty, picked = p_picked where id = p_item;
  if o.status = 'new' then update orders set status = 'preparing', preparing_at = now() where id = o.id; end if;
  perform _recalc_order(o.id);
end $$;

create or replace function public.assign_driver(p_order uuid, p_driver uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  if o.id is null then raise exception 'الطلب غير موجود'; end if;
  if not has_store_role(o.store_id, '{owner,manager,cashier,stock}') then raise exception 'لا تملك الصلاحية'; end if;
  if o.status in ('delivered','cancelled') then raise exception 'الطلب مغلق'; end if;
  if p_driver is not null and not exists(select 1 from store_members where store_id = o.store_id and user_id = p_driver) then
    raise exception 'المندوب ليس من فريق المتجر'; end if;
  update orders set driver_id = p_driver where id = p_order;
end $$;

create or replace function public.set_order_status(p_order uuid, p_status public.order_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; staff boolean; is_driver boolean; v_items jsonb; v_sale uuid;
begin
  select * into o from orders where id = p_order for update;
  if o.id is null then raise exception 'الطلب غير موجود'; end if;
  staff := has_store_role(o.store_id, '{owner,manager,cashier,stock}');
  is_driver := o.driver_id = auth.uid();
  if not (staff or is_driver) then raise exception 'لا تملك الصلاحية'; end if;

  if p_status = 'preparing' and o.status = 'new' and staff then
    update orders set status = 'preparing', preparing_at = now() where id = p_order;
  elsif p_status = 'ready' and o.status in ('new','preparing') and staff then
    if not exists(select 1 from order_items where order_id = p_order and qty > 0) then raise exception 'لا أصناف متوفرة في الطلب، ألغه بدلًا من ذلك'; end if;
    update orders set status = 'ready', ready_at = now(), preparing_at = coalesce(preparing_at, now()) where id = p_order;
  elsif p_status = 'out_for_delivery' and o.status = 'ready' and o.fulfillment = 'delivery' and (staff or is_driver) then
    if o.driver_id is null then raise exception 'عيّن مندوبًا أولًا'; end if;
    update orders set status = 'out_for_delivery', out_at = now() where id = p_order;
  elsif p_status = 'delivered' and ((o.status = 'out_for_delivery' and (staff or is_driver)) or (o.status = 'ready' and o.fulfillment = 'pickup' and staff)) then
    select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty, 'unit_price', unit_price)) into v_items
      from order_items where order_id = p_order and qty > 0;
    v_sale := _sale_core(o.store_id, v_items, o.payment_method, o.customer_id, o.delivery_fee, o.id);
    update orders set status = 'delivered', delivered_at = now(), sale_id = v_sale where id = p_order;
  elsif p_status = 'cancelled' and o.status not in ('delivered','cancelled') and staff then
    update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason where id = p_order;
  else
    raise exception 'لا يمكن نقل الطلب من % إلى %', o.status, p_status;
  end if;
end $$;

create or replace function public.cancel_my_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update orders o set status = 'cancelled', cancelled_at = now(), cancel_reason = 'ألغاه العميل'
  where o.id = p_order and o.status = 'new'
    and exists(select 1 from customers c where c.id = o.customer_id and c.user_id = auth.uid());
  if not found then raise exception 'لا يمكن إلغاء الطلب بعد بدء تجهيزه'; end if;
end $$;

create or replace function public.update_my_location(p_lat float8, p_lng float8)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from store_members where user_id = auth.uid()) then raise exception 'لا تملك الصلاحية'; end if;
  insert into driver_locations(user_id, lat, lng, updated_at) values (auth.uid(), p_lat, p_lng, now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
end $$;

-- تتبع الطلب: موقع المندوب يظهر فقط أثناء التوصيل
create or replace function public.order_tracking(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o orders%rowtype; d driver_locations%rowtype;
begin
  select * into o from orders where id = p_order;
  if o.id is null or not (has_store_role(o.store_id) or exists(select 1 from customers c where c.id = o.customer_id and c.user_id = auth.uid())) then
    raise exception 'الطلب غير موجود'; end if;
  if o.status = 'out_for_delivery' and o.driver_id is not null then select * into d from driver_locations where user_id = o.driver_id; end if;
  return jsonb_build_object('status', o.status, 'driver_lat', d.lat, 'driver_lng', d.lng, 'driver_at', d.updated_at,
    'km', case when d.lat is not null and o.lat is not null then round(_km(d.lat, d.lng, o.lat, o.lng), 1) end);
end $$;

-- ============ فريق العمل ============
create or replace function public.store_team(p_store uuid)
returns table(user_id uuid, email text, role public.store_role)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role from store_members m join auth.users u on u.id = m.user_id
  where m.store_id = p_store and has_store_role(p_store, '{owner,manager,cashier,stock}')
  order by m.role, u.email;
$$;

create or replace function public.add_member(p_store uuid, p_email text, p_role public.store_role)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not has_store_role(p_store, '{owner}') then raise exception 'للمالك فقط'; end if;
  select id into v from auth.users where lower(email) = lower(trim(p_email));
  if v is null then raise exception 'لا يوجد حساب بهذا البريد. اطلب منه إنشاء حساب أولًا'; end if;
  if v = auth.uid() then raise exception 'لا يمكنك تغيير دورك'; end if;
  insert into store_members(store_id, user_id, role) values (p_store, v, p_role)
  on conflict (store_id, user_id) do update set role = excluded.role;
end $$;

create or replace function public.remove_member(p_store uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_store_role(p_store, '{owner}') then raise exception 'للمالك فقط'; end if;
  if p_user = auth.uid() then raise exception 'لا يمكنك إزالة نفسك'; end if;
  delete from store_members where store_id = p_store and user_id = p_user;
end $$;

-- ============ الصلاحيات ============
revoke execute on function public._km(float8,float8,float8,float8), public._available(uuid,uuid),
  public._sale_core(uuid,jsonb,text,uuid,numeric,uuid), public._recalc_order(uuid), public._seed_accounts(uuid)
  from anon, authenticated, public;
revoke execute on function public.place_order(text,jsonb,text,text,text,text,text,float8,float8,text), public.pick_item(bigint,numeric,boolean),
  public.assign_driver(uuid,uuid), public.set_order_status(uuid,public.order_status,text), public.cancel_my_order(uuid),
  public.update_my_location(float8,float8), public.order_tracking(uuid), public.store_team(uuid),
  public.add_member(uuid,text,public.store_role), public.remove_member(uuid,uuid), public.complete_sale(uuid,jsonb,text,uuid)
  from anon, public;
grant execute on function public.place_order(text,jsonb,text,text,text,text,text,float8,float8,text), public.pick_item(bigint,numeric,boolean),
  public.assign_driver(uuid,uuid), public.set_order_status(uuid,public.order_status,text), public.cancel_my_order(uuid),
  public.update_my_location(float8,float8), public.order_tracking(uuid), public.store_team(uuid),
  public.add_member(uuid,text,public.store_role), public.remove_member(uuid,uuid), public.complete_sale(uuid,jsonb,text,uuid)
  to authenticated;
grant execute on function public.shop_store(text), public.shop_products(text) to anon, authenticated;
