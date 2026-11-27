-- الدفع الإلكتروني المسبق (بوابة Moyasar): حالة الدفع على الطلب
alter table public.orders
  add column if not exists payment_status text not null default 'none' check (payment_status in ('none','pending','paid','failed')),
  add column if not exists payment_ref text,
  add column if not exists paid_amount numeric(12,2);

-- p_payment: cash | card (عند الاستلام) | online (دفع مسبق)
create or replace function public.place_order(p_slug text, p_items jsonb, p_fulfillment text, p_payment text,
  p_name text, p_phone text, p_address text default null, p_lat float8 default null, p_lng float8 default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s stores%rowtype; v_cust uuid; v_order uuid; it jsonb; v_prod products%rowtype; v_q numeric; v_av numeric; v_total numeric := 0; v_fee numeric := 0; v_price numeric;
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

-- لا يُجهَّز طلب الدفع المسبق قبل تأكيد الدفع
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

-- يُستدعى من الخادم فقط (service_role) بعد التحقق من الفاتورة لدى بوابة الدفع
create or replace function public.mark_order_payment(p_order uuid, p_ref text, p_status text, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  if o.id is null then raise exception 'الطلب غير موجود'; end if;
  if p_status = 'ref' then
    update orders set payment_ref = p_ref where id = p_order and payment_status = 'pending';
  elsif p_status = 'paid' then
    if o.payment_status = 'paid' then return; end if;
    if round(p_amount, 2) <> round(o.total, 2) then raise exception 'المبلغ المدفوع لا يطابق الطلب'; end if;
    update orders set payment_status = 'paid', paid_amount = p_amount, payment_ref = p_ref where id = p_order;
  elsif p_status = 'failed' then
    update orders set payment_status = 'failed' where id = p_order and payment_status = 'pending';
  end if;
end $$;
revoke execute on function public.mark_order_payment(uuid,text,text,numeric) from anon, authenticated, public;
grant execute on function public.mark_order_payment(uuid,text,text,numeric) to service_role;

-- إلغاء طلبات الدفع المسبق غير المدفوعة بعد 30 دقيقة لتحرير الكميات المحجوزة
create or replace function public._expire_unpaid_orders() returns int
language sql security definer set search_path = public as $$
  with x as (update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'لم يكتمل الدفع'
             where payment_status in ('pending','failed') and status = 'new' and created_at < now() - interval '30 minutes' returning 1)
  select count(*)::int from x;
$$;
revoke execute on function public._expire_unpaid_orders() from anon, authenticated, public;
select cron.schedule('expire-unpaid-orders', '*/10 * * * *', $$select public._expire_unpaid_orders()$$);
