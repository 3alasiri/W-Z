-- صور المنتجات، وعبوات البيع (مفرد / عائلي / جملة)، وكتالوج تجريبي بمنتجات حقيقية

-- ============ الصور ============
alter table public.products add column if not exists image_url text;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy product_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.has_store_role(((storage.foldername(name))[1])::uuid, '{owner,manager,stock}'));
create policy product_images_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.has_store_role(((storage.foldername(name))[1])::uuid, '{owner,manager,stock}'));
create policy product_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.has_store_role(((storage.foldername(name))[1])::uuid, '{owner,manager,stock}'));

-- ============ العبوات ============
-- المخزون يُحسب دائمًا بالوحدة المفردة؛ العبوة = عدد وحدات + سعر + باركود خاص بها
create table public.product_packs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  units numeric(12,3) not null check (units > 1),
  price numeric(12,2) not null check (price >= 0),
  barcode text,
  active boolean not null default true,
  sort int not null default 0
);
create index on public.product_packs(product_id);
create unique index product_packs_barcode on public.product_packs(store_id, barcode) where barcode is not null;
alter table public.product_packs enable row level security;
create policy packs_read on public.product_packs for select to authenticated using (has_store_role(store_id));
create policy packs_write on public.product_packs for all to authenticated
  using (has_store_role(store_id, '{owner,manager,stock}')) with check (has_store_role(store_id, '{owner,manager,stock}'));

alter table public.sale_items
  add column if not exists pack_id uuid references public.product_packs(id) on delete set null,
  add column if not exists base_qty numeric(12,3);
update public.sale_items set base_qty = qty where base_qty is null;
alter table public.order_items
  add column if not exists pack_id uuid references public.product_packs(id) on delete set null,
  add column if not exists units numeric(12,3) not null default 1;

-- سعر العبوة بعد عرض المنتج (إن وجد)
create or replace function public._pack_price(p_pack uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select round(k.price * (1 - coalesce((select max(discount_pct) from price_offers o
     where o.product_id = k.product_id and now() between o.starts_at and o.ends_at), 0) / 100), 2)
  from product_packs k where k.id = p_pack;
$$;

-- المتاح بالوحدات المفردة بعد حجز الطلبات المفتوحة
create or replace function public._available(p_product uuid, p_exclude_order uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(qty) from batches where product_id = p_product and qty > 0
                   and (expiry_date is null or expiry_date >= current_date)), 0)
       - coalesce((select sum(i.qty * i.units) from order_items i join orders o on o.id = i.order_id
                   where i.product_id = p_product and o.status in ('new','preparing','ready','out_for_delivery')
                     and o.id is distinct from p_exclude_order), 0);
$$;

-- البيع: كل سطر {product_id, qty, pack_id?, unit_price?}؛ qty بعدد العبوات إن وُجدت عبوة
create or replace function public._sale_core(p_store uuid, p_items jsonb, p_payment text, p_customer uuid, p_fee numeric, p_order uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sale uuid; it jsonb; v_prod products%rowtype; v_pack product_packs%rowtype; v_need numeric; v_take numeric; b record; v_price numeric;
  v_q numeric; v_units numeric; v_name text;
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
    v_q := (it->>'qty')::numeric;
    if v_q is null or v_q <= 0 then raise exception 'كمية غير صالحة'; end if;
    v_pack := null; v_units := 1; v_name := v_prod.name;
    if nullif(it->>'pack_id','') is not null then
      select * into v_pack from product_packs where id = (it->>'pack_id')::uuid and product_id = v_prod.id;
      if v_pack.id is null then raise exception 'عبوة غير صالحة'; end if;
      v_units := v_pack.units; v_name := v_prod.name || ' · ' || v_pack.name;
    end if;
    v_price := coalesce((it->>'unit_price')::numeric, case when v_pack.id is not null then _pack_price(v_pack.id) else _effective_price(v_prod.id) end);
    v_need := v_q * v_units; v_cost_sum := 0;
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
    if v_need > 0 then raise exception 'الكمية غير متوفرة من %', v_name; end if;
    insert into sale_items(sale_id, product_id, name, qty, unit_price, unit_cost, line_total, pack_id, base_qty)
      values (v_sale, v_prod.id, v_name, v_q, v_price, round(v_cost_sum / v_q, 2), round(v_price * v_q, 2), v_pack.id, v_q * v_units);
    v_total := v_total + round(v_price * v_q, 2);
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
declare s stores%rowtype; v_cust uuid; v_order uuid; it jsonb; v_prod products%rowtype; v_pack product_packs%rowtype;
  v_q numeric; v_units numeric; v_av numeric; v_total numeric := 0; v_fee numeric := 0; v_price numeric; v_name text;
begin
  if auth.uid() is null then raise exception 'سجّل الدخول لإتمام الطلب'; end if;
  select * into s from stores where slug = lower(p_slug);
  if s.id is null then raise exception 'المتجر غير موجود'; end if;
  if not s.accepting_orders then raise exception 'المتجر لا يستقبل طلبات حاليًا'; end if;
  if p_fulfillment not in ('delivery','pickup') or p_payment not in ('cash','card','online') then raise exception 'بيانات غير صالحة'; end if;
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
  insert into orders(store_id, customer_id, fulfillment, address, lat, lng, notes, payment_method, delivery_fee, payment_status)
    values (s.id, v_cust, p_fulfillment, p_address, p_lat, p_lng, p_notes,
            case when p_payment = 'online' then 'card' else p_payment end, v_fee,
            case when p_payment = 'online' then 'pending' else 'none' end) returning id into v_order;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from products where id = (it->>'product_id')::uuid and store_id = s.id and active;
    if v_prod.id is null then raise exception 'منتج غير متاح'; end if;
    v_q := (it->>'qty')::numeric;
    if v_q is null or v_q <= 0 then raise exception 'كمية غير صالحة'; end if;
    v_pack := null; v_units := 1; v_name := v_prod.name; v_price := _effective_price(v_prod.id);
    if nullif(it->>'pack_id','') is not null then
      select * into v_pack from product_packs where id = (it->>'pack_id')::uuid and product_id = v_prod.id and active;
      if v_pack.id is null then raise exception 'العبوة غير متاحة'; end if;
      v_units := v_pack.units; v_name := v_prod.name || ' · ' || v_pack.name; v_price := _pack_price(v_pack.id);
    end if;
    perform 1 from products where id = v_prod.id for update;
    v_av := _available(v_prod.id, v_order) - coalesce((select sum(qty * units) from order_items where order_id = v_order and product_id = v_prod.id), 0);
    if v_av < v_q * v_units then raise exception 'المتاح من % لا يكفي', v_name; end if;
    insert into order_items(order_id, product_id, name, qty, ordered_qty, unit_price, pack_id, units)
      values (v_order, v_prod.id, v_name, v_q, v_q, v_price, v_pack.id, v_units);
    v_total := v_total + round(v_price * v_q, 2);
  end loop;
  if v_total < s.min_order then raise exception 'الحد الأدنى للطلب % ر.س', s.min_order; end if;
  update orders set items_total = v_total, total = v_total + v_fee where id = v_order;
  return v_order;
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
  if o.payment_status in ('pending','failed') and p_status not in ('cancelled') then
    raise exception 'لم يكتمل الدفع الإلكتروني لهذا الطلب بعد'; end if;
  if p_status = 'preparing' and o.status = 'new' and staff then
    update orders set status = 'preparing', preparing_at = now() where id = p_order;
  elsif p_status = 'ready' and o.status in ('new','preparing') and staff then
    if not exists(select 1 from order_items where order_id = p_order and qty > 0) then raise exception 'لا أصناف متوفرة في الطلب، ألغه بدلًا من ذلك'; end if;
    update orders set status = 'ready', ready_at = now(), preparing_at = coalesce(preparing_at, now()) where id = p_order;
  elsif p_status = 'out_for_delivery' and o.status = 'ready' and o.fulfillment = 'delivery' and (staff or is_driver) then
    if o.driver_id is null then raise exception 'عيّن مندوبًا أولًا'; end if;
    update orders set status = 'out_for_delivery', out_at = now() where id = p_order;
  elsif p_status = 'delivered' and ((o.status = 'out_for_delivery' and (staff or is_driver)) or (o.status = 'ready' and o.fulfillment = 'pickup' and staff)) then
    select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty, 'unit_price', unit_price, 'pack_id', pack_id)) into v_items
      from order_items where order_id = p_order and qty > 0;
    v_sale := _sale_core(o.store_id, v_items, o.payment_method, o.customer_id, o.delivery_fee, o.id);
    update orders set status = 'delivered', delivered_at = now(), sale_id = v_sale where id = p_order;
  elsif p_status = 'cancelled' and o.status not in ('delivered','cancelled') and staff then
    update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason where id = p_order;
  else
    raise exception 'لا يمكن نقل الطلب من % إلى %', o.status, p_status;
  end if;
end $$;

-- كتالوج متجر العميل مع الصورة والعبوات
create or replace function public.shop_items(p_slug text)
returns table(id uuid, name text, category text, unit text, image_url text, price numeric, original_price numeric, available numeric, packs jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, c.name, p.unit, p.image_url, _effective_price(p.id), p.price, greatest(_available(p.id), 0),
    coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'units', k.units, 'price', _pack_price(k.id), 'original_price', k.price) order by k.units)
              from product_packs k where k.product_id = p.id and k.active), '[]'::jsonb)
  from products p join stores s on s.id = p.store_id left join categories c on c.id = p.category_id
  where s.slug = lower(p_slug) and p.active and _available(p.id) > 0
  order by c.name nulls last, p.name;
$$;

-- عرض المخزون مع الصورة
create or replace view public.product_stock with (security_invoker = true) as
select p.id, p.store_id, p.barcode, p.name, p.unit, p.cost, p.price, p.min_qty, p.active,
  c.name as category, s.name as supplier, coalesce(s.lead_days, 2) as lead_days,
  coalesce((select sum(qty) from batches b where b.product_id = p.id), 0) as stock,
  (select min(expiry_date) from batches b where b.product_id = p.id and b.qty > 0) as next_expiry,
  coalesce((select -sum(m.qty) / 28.0 from stock_movements m where m.product_id = p.id and m.type = 'sale'
     and m.created_at > now() - interval '28 days'), 0) as avg_daily,
  _effective_price(p.id) as sell_price,
  p.image_url
from products p
left join categories c on c.id = p.category_id
left join suppliers s on s.id = p.supplier_id;

-- التوقع يعتمد على الوحدات المفردة المباعة
do $do$
declare def text;
begin
  def := pg_get_functiondef('public.product_insights(uuid)'::regprocedure);
  def := replace(def, 'sum(si.qty) q,', 'sum(coalesce(si.base_qty, si.qty)) q,');
  if position('coalesce(si.base_qty' in def) = 0 then raise exception 'insights replace failed'; end if;
  execute def;
end $do$;

-- ============ كتالوج تجريبي بمنتجات حقيقية من السوق السعودي (الصور من Open Food Facts) ============
create or replace function public._demo_catalog_v2()
returns table(bc text, nm text, cat text, sup text, cost numeric, price numeric, rate numeric, shelf int, img text, packs jsonb)
language sql immutable as $$
  values
    ('6281007032261','حليب المراعي كامل الدسم 1 لتر','ألبان','المراعي',4.4,6.25,12,90,'https://images.openfoodfacts.org/images/products/628/100/703/2261/front_en.48.400.jpg','[{"n": "كرتون 12 حبة", "u": 12, "p": 69}]'::jsonb),
    ('6281007120401','حليب المراعي كامل الدسم 2 لتر','ألبان','المراعي',8.2,11.5,5,90,'https://images.openfoodfacts.org/images/products/628/100/712/0401/front_en.26.400.jpg','[{"n": "عائلي 4 حبات", "u": 4, "p": 43}]'::jsonb),
    ('6281057010011','حليب نادك 1 لتر','ألبان','نادك',4.2,6,6,90,'https://images.openfoodfacts.org/images/products/628/105/701/0011/front_en.53.400.jpg','[{"n": "كرتون 12 حبة", "u": 12, "p": 66}]'::jsonb),
    ('6281007110402','لبن المراعي 2 لتر','ألبان','المراعي',7.6,10.5,6,14,'https://images.openfoodfacts.org/images/products/628/100/711/0402/front_en.35.400.jpg','[]'::jsonb),
    ('6281007023122','لبن المراعي 180 مل','ألبان','المراعي',0.75,1.25,14,14,'https://images.openfoodfacts.org/images/products/628/100/702/3122/front_fr.28.400.jpg','[{"n": "عائلي 6 حبات", "u": 6, "p": 6.75}, {"n": "كرتون 30 حبة", "u": 30, "p": 32}]'::jsonb),
    ('6281007040655','زبادي المراعي 170 جم','ألبان','المراعي',0.95,1.5,12,14,'https://images.openfoodfacts.org/images/products/628/100/704/0655/front_en.57.400.jpg','[{"n": "عائلي 6 حبات", "u": 6, "p": 8.25}]'::jsonb),
    ('6281007046466','زبادي المراعي بالفراولة 150 جم','ألبان','المراعي',1.3,2,5,14,'https://images.openfoodfacts.org/images/products/628/100/704/6466/front_fr.8.400.jpg','[{"n": "عائلي 6 حبات", "u": 6, "p": 11}]'::jsonb),
    ('6281057001118','زبادي نادك','ألبان','نادك',1.1,1.75,4,14,'https://images.openfoodfacts.org/images/products/628/105/700/1118/front_fr.8.400.jpg','[]'::jsonb),
    ('6281007038898','حليب المراعي بالشوكولاتة 150 مل','ألبان','المراعي',1.1,1.75,7,60,'https://images.openfoodfacts.org/images/products/628/100/703/8898/front_fr.15.400.jpg','[{"n": "عائلي 6 حبات", "u": 6, "p": 9.5}]'::jsonb),
    ('6281007031202','كريمة طبخ المراعي 500 مل','ألبان','المراعي',7.5,10.5,1.5,90,'https://images.openfoodfacts.org/images/products/628/100/703/1202/front_fr.16.400.jpg','[]'::jsonb),
    ('6281007047654','خبز المراعي بالنخالة 615 جم','مخبوزات','المراعي',5.5,7.5,6,5,'https://images.openfoodfacts.org/images/products/628/100/704/7654/front_en.30.400.jpg','[]'::jsonb),
    ('6281100081029','خبز لوزين أسمر','مخبوزات','لوزين',4.2,6,5,5,'https://images.openfoodfacts.org/images/products/628/110/008/1029/front_en.70.400.jpg','[]'::jsonb),
    ('6281183000023','كرواسون سفن دايز 55 جم','مخبوزات','موزع الجملة',1.2,2,9,60,'https://images.openfoodfacts.org/images/products/628/118/300/0023/front_en.3.400.jpg','[{"n": "علبة 6 حبات", "u": 6, "p": 10.5}]'::jsonb),
    ('6281035000034','مياه نوفا 330 مل','مشروبات','نوفا للمياه',0.4,0.75,20,360,'https://images.openfoodfacts.org/images/products/628/103/500/0034/front_en.33.400.jpg','[{"n": "كرتون 40 حبة", "u": 40, "p": 19}]'::jsonb),
    ('6281100063001','مياه صفا 330 مل','مشروبات','موزع الجملة',0.38,0.75,8,360,'https://images.openfoodfacts.org/images/products/628/110/006/3001/front_en.5.400.jpg','[{"n": "كرتون 40 حبة", "u": 40, "p": 18}]'::jsonb),
    ('6288004001030','ميلاف كولا 240 مل','مشروبات','موزع الجملة',1.6,2.5,6,200,'https://images.openfoodfacts.org/images/products/628/800/400/1030/front_en.25.400.jpg','[{"n": "عائلي 6 حبات", "u": 6, "p": 13.5}]'::jsonb),
    ('6281012033178','صن توب برتقال 125 مل','مشروبات','موزع الجملة',0.55,1,10,200,'https://images.openfoodfacts.org/images/products/628/101/203/3178/front_en.12.400.jpg','[{"n": "عائلي 10 حبات", "u": 10, "p": 9}]'::jsonb),
    ('6281026164004','عصير الربيع برتقال 250 مل','مشروبات','موزع الجملة',1.1,1.75,6,200,'https://images.openfoodfacts.org/images/products/628/102/616/4004/front_en.25.400.jpg','[{"n": "عائلي 6 حبات", "u": 6, "p": 9.5}]'::jsonb),
    ('6281034001063','فيمتو 710 مل','مشروبات','موزع الجملة',9.5,13.95,1.5,300,'https://images.openfoodfacts.org/images/products/628/103/400/1063/front_xx.36.400.jpg','[{"n": "كرتون 6 حبات", "u": 6, "p": 78}]'::jsonb),
    ('6281039701012','معجون طماطم السعودية 135 جم','مواد غذائية','موزع الجملة',0.85,1.25,4,300,'https://images.openfoodfacts.org/images/products/628/103/970/1012/front_en.37.400.jpg','[{"n": "عائلي 8 حبات", "u": 8, "p": 9}]'::jsonb),
    ('6281064110025','ملح ساسا 700 جم','مواد غذائية','موزع الجملة',1.8,2.75,1.2,700,'https://images.openfoodfacts.org/images/products/628/106/411/0025/front_en.7.400.jpg','[]'::jsonb),
    ('6281014110020','زبدة فول سوداني قودي 510 جم','مواد غذائية','موزع الجملة',13.5,18.95,0.6,300,'https://images.openfoodfacts.org/images/products/628/101/411/0020/front_en.25.400.jpg','[]'::jsonb),
    ('6281100031031','صلصة رنا الحارة','مواد غذائية','موزع الجملة',2.2,3.5,1,300,'https://images.openfoodfacts.org/images/products/628/110/003/1031/front_fr.5.400.jpg','[]'::jsonb),
    ('6281036110107','شيبس ليز كاتشب','سناكس','موزع الجملة',0.65,1,14,120,'https://images.openfoodfacts.org/images/products/628/103/611/0107/front_hi.8.400.jpg','[{"n": "كرتون 14 حبة", "u": 14, "p": 12.5}]'::jsonb),
    ('6281100350149','أولكر شوكو ساندويتش 23.5 جم','سناكس','موزع الجملة',0.5,0.75,10,150,'https://images.openfoodfacts.org/images/products/628/110/035/0149/front_en.7.400.jpg','[{"n": "علبة 12 حبة", "u": 12, "p": 8}]'::jsonb),
    ('6281105473065','بسكويت أولكر بالسمسم 70 جم','سناكس','موزع الجملة',1.1,1.75,3,150,'https://images.openfoodfacts.org/images/products/628/110/547/3065/front_en.29.400.jpg','[]'::jsonb)
$$;

create or replace function public.seed_demo_step(p_store uuid, p_step int) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_shelf uuid; v_wh uuid; p record; k record; v_prod uuid; d int; i int; v_items jsonb; v_sale uuid; v_cust uuid; v_ts timestamptz;
  n int := 0; custs uuid[]; v_pay text; v_inv numeric;
begin
  if not has_store_role(p_store, '{owner}') then raise exception 'للمالك فقط'; end if;
  select id into v_shelf from locations where store_id = p_store and kind = 'shelf' limit 1;
  select id into v_wh from locations where store_id = p_store and kind = 'warehouse' limit 1;

  if p_step = 0 then
    if exists(select 1 from products where store_id = p_store) then raise exception 'المتجر يحتوي منتجات بالفعل. البيانات التجريبية لمتجر فارغ فقط'; end if;
    insert into suppliers(store_id, name, phone, lead_days)
      select distinct p_store, sup, '05000000' || lpad((row_number() over ())::text, 2, '0'), case sup when 'موزع الجملة' then 3 when 'نوفا للمياه' then 2 else 1 end
      from (select distinct sup from _demo_catalog_v2()) x;
    insert into categories(store_id, name) select distinct p_store, cat from _demo_catalog_v2() on conflict do nothing;
    for p in select * from _demo_catalog_v2() loop
      insert into products(store_id, barcode, name, category_id, supplier_id, cost, price, min_qty, image_url)
        values (p_store, p.bc, p.nm, (select id from categories where store_id = p_store and name = p.cat),
                (select id from suppliers where store_id = p_store and name = p.sup), p.cost, p.price, greatest(2, round(p.rate * 2)), p.img)
        returning id into v_prod;
      i := 0;
      for k in select * from jsonb_to_recordset(p.packs) as x(n text, u numeric, p numeric) loop
        i := i + 1;
        insert into product_packs(store_id, product_id, name, units, price, barcode, sort)
          values (p_store, v_prod, k.n, k.u, k.p, '2' || substr(p.bc, 2, 11) || i, i);
      end loop;
      perform _receive_batch(p_store, v_prod, ceil(p.rate * 90), v_wh,
        case when p.shelf < 60 then current_date + (p.shelf + 45) else current_date + p.shelf end, p.cost, 'مخزون افتتاحي');
    end loop;
    update batches set received_at = now() - interval '45 days' where store_id = p_store;
    update stock_movements set created_at = now() - interval '45 days' where store_id = p_store;
    select round(sum(qty * unit_cost), 2) into v_inv from batches where store_id = p_store;
    perform _post(p_store, 'رأس المال الافتتاحي (نقد ومخزون)', 'capital', null, jsonb_build_array(
      jsonb_build_object('code','1100','debit', 20000), jsonb_build_object('code','1300','debit', v_inv),
      jsonb_build_object('code','3100','credit', 20000 + v_inv)));
    update journal_entries set entry_date = current_date - 45, created_at = now() - interval '45 days' where store_id = p_store and source = 'capital';
    insert into customers(store_id, name, phone, credit_limit) values
      (p_store,'أبو فيصل','0551111111',500),(p_store,'أم خالد','0552222222',300),(p_store,'سعد العتيبي','0553333333',0),
      (p_store,'نورة الحربي','0554444444',0),(p_store,'محمد القحطاني','0555555555',0),(p_store,'ريم الشهري','0556666666',0),
      (p_store,'عبدالله الدوسري','0557777777',0),(p_store,'هند الزهراني','0558888888',0);
    return 26;
  end if;

  if p_step between 1 and 14 then
    perform setseed(p_step / 20.0);
    select array_agg(id order by name) into custs from customers where store_id = p_store;
    for d in reverse (42 - (p_step - 1) * 3)..(42 - p_step * 3 + 1) loop
      for i in 1..(14 + floor(random() * 8) + case when extract(dow from current_date - d) in (4,5) then 8 else 0 end)::int loop
        select jsonb_agg(case when x.pack is not null then jsonb_build_object('product_id', x.id, 'qty', 1, 'pack_id', x.pack)
                              else jsonb_build_object('product_id', x.id, 'qty', greatest(1, round(random() * 2 + 0.3))) end) into v_items
        from (select pr.id, case when random() < 0.12 then (select pk.id from product_packs pk where pk.product_id = pr.id order by pk.units limit 1) end pack
              from products pr join _demo_catalog_v2() c on c.bc = pr.barcode
              where pr.store_id = p_store and random() < least(0.85, c.rate / 16.0 + 0.04) order by random() limit 5) x;
        continue when v_items is null;
        v_cust := case when random() < 0.3 then custs[1 + floor(random() * array_length(custs, 1))::int] end;
        if v_cust in (custs[1], custs[4]) and d < 28 then v_cust := null; end if;
        v_pay := case when v_cust = custs[2] and random() < 0.5 then 'credit' when random() < 0.55 then 'card' else 'cash' end;
        begin v_sale := _sale_core(p_store, v_items, v_pay, v_cust, 0, null); exception when others then continue; end;
        v_ts := (current_date - d)::timestamp at time zone 'Asia/Riyadh'
          + make_interval(hours => (case when random() < 0.55 then 17 + floor(random() * 6) else 7 + floor(random() * 10) end)::int, mins => floor(random() * 60)::int);
        update sales set created_at = v_ts where id = v_sale;
        update stock_movements set created_at = v_ts where ref = v_sale::text;
        update journal_entries set created_at = v_ts, entry_date = (v_ts at time zone 'Asia/Riyadh')::date where source_id = v_sale::text;
        n := n + 1;
      end loop;
    end loop;
    return n;
  end if;

  if p_step = 15 then
    perform receive_stock((select id from products where store_id = p_store and barcode = '6281007040655'), 120, v_shelf, current_date + 3, 0.95, 'دفعة قريبة الانتهاء');
    perform receive_stock((select id from products where store_id = p_store and barcode = '6281007110402'), 40, v_shelf, current_date + 2, 7.6, 'دفعة قريبة الانتهاء');
    for p in select b.id, b.qty, b.unit_cost, b.product_id, case pr.barcode when '6281007047654' then 4 else 7 end keep
             from batches b join products pr on pr.id = b.product_id
             where pr.store_id = p_store and pr.barcode in ('6281007047654','6281007032261') and b.qty > 0 loop
      if p.qty > p.keep then
        update batches set qty = p.keep where id = p.id;
        insert into stock_movements(store_id, product_id, batch_id, type, qty, ref) values (p_store, p.product_id, p.id, 'adjust', p.keep - p.qty, 'جرد تجريبي');
        perform _post(p_store, 'تسوية جرد تجريبية', 'adjust', p.id::text, jsonb_build_array(
          jsonb_build_object('code','5300','debit', round((p.qty - p.keep) * p.unit_cost, 2)),
          jsonb_build_object('code','1300','credit', round((p.qty - p.keep) * p.unit_cost, 2))));
      end if;
    end loop;
    update stores set address = coalesce(address, 'حي النرجس، الرياض'), delivery_fee = case when delivery_fee = 0 then 7 else delivery_fee end,
      min_order = case when min_order = 0 then 25 else min_order end where id = p_store;
    return 0;
  end if;
  raise exception 'خطوة غير صالحة';
end $$;

revoke execute on function public._pack_price(uuid), public._demo_catalog_v2() from anon, authenticated, public;
grant execute on function public.shop_items(text) to anon, authenticated;
