create or replace function public.pick_item(p_item bigint, p_qty numeric, p_picked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_order orders%rowtype;
begin
  select ord.* into v_order from orders ord join order_items oi on oi.order_id = ord.id where oi.id = p_item for update of ord;
  if v_order.id is null then raise exception 'السطر غير موجود'; end if;
  if not has_store_role(v_order.store_id, '{owner,manager,cashier,stock}') then raise exception 'لا تملك الصلاحية'; end if;
  if v_order.status not in ('new','preparing') then raise exception 'لا يمكن التعديل بعد انتهاء التجهيز'; end if;
  if p_qty < 0 or p_qty > (select ordered_qty from order_items where id = p_item) then raise exception 'كمية غير صالحة'; end if;
  update order_items set qty = p_qty, picked = p_picked where id = p_item;
  if v_order.status = 'new' then update orders set status = 'preparing', preparing_at = now() where id = v_order.id; end if;
  perform _recalc_order(v_order.id);
end $$;
