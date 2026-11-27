-- التتبع يعيد مواقع المتجر والعميل والمندوب للخريطة
create or replace function public.order_tracking(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o orders%rowtype; d driver_locations%rowtype; s stores%rowtype;
begin
  select * into o from orders where id = p_order;
  if o.id is null or not (has_store_role(o.store_id) or exists(select 1 from customers c where c.id = o.customer_id and c.user_id = auth.uid())) then
    raise exception 'الطلب غير موجود'; end if;
  select * into s from stores where id = o.store_id;
  if o.status = 'out_for_delivery' and o.driver_id is not null then select * into d from driver_locations where user_id = o.driver_id; end if;
  return jsonb_build_object('status', o.status, 'driver_lat', d.lat, 'driver_lng', d.lng, 'driver_at', d.updated_at,
    'km', case when d.lat is not null and o.lat is not null then round(_km(d.lat, d.lng, o.lat, o.lng), 1) end,
    'store_lat', s.lat, 'store_lng', s.lng, 'dest_lat', o.lat, 'dest_lng', o.lng);
end $$;
