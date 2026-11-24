-- البيانات التجريبية على 16 خطوة قصيرة (حد زمن الطلب في Supabase 8 ثوانٍ)
create index if not exists stock_movements_ref_idx on public.stock_movements(ref);
create index if not exists journal_entries_source_idx on public.journal_entries(source_id);
create index if not exists stock_movements_product_type_idx on public.stock_movements(product_id, type, created_at);
create index if not exists sale_items_product_idx on public.sale_items(product_id);
create index if not exists sales_customer_idx on public.sales(customer_id) where customer_id is not null;

create or replace function public._demo_catalog()
returns table(bc text, nm text, cat text, sup text, cost numeric, price numeric, rate numeric, shelf int)
language sql immutable as $$
  values
    ('6281007031129','حليب طازج كامل الدسم 1 لتر','ألبان','المراعي',4.20,6.00,14,7),
    ('6281007032003','لبن 2 لتر','ألبان','المراعي',7.00,9.50,6,10),
    ('6281043020113','زبادي 170 جم','ألبان','المراعي',0.90,1.50,10,12),
    ('6281105830024','جبن شرائح 200 جم','ألبان','المراعي',6.50,9.00,2.5,20),
    ('6281006411304','بيض طازج 30 حبة','ألبان','موزع الجملة',17.00,22.00,4,20),
    ('6281100050012','خبز توست أبيض','مخبوزات','مخابز الحي',3.10,4.50,16,4),
    ('6281100050029','خبز بر','مخبوزات','مخابز الحي',3.40,5.00,5,4),
    ('6281100050036','صامولي 6 حبات','مخبوزات','مخابز الحي',2.50,4.00,8,3),
    ('6281036001237','أرز بسمتي 5 كجم','مواد غذائية','موزع الجملة',38.00,49.00,1.6,300),
    ('6281036102114','زيت دوار الشمس 1.5 لتر','مواد غذائية','موزع الجملة',13.00,17.50,1.8,200),
    ('6281031254102','شاي أحمر 100 كيس','مواد غذائية','موزع الجملة',9.00,13.00,1.2,400),
    ('6281031255109','سكر أبيض 2 كجم','مواد غذائية','موزع الجملة',7.50,10.00,1.5,400),
    ('6281031256106','مكرونة 450 جم','مواد غذائية','موزع الجملة',2.20,3.50,2.5,300),
    ('6281031257103','معجون طماطم 135 جم','مواد غذائية','موزع الجملة',0.80,1.25,3,300),
    ('6281001214337','مياه معبأة 330 مل × 40','مشروبات','نوفا للمياه',14.00,19.00,7,360),
    ('6281001214344','مياه 1.5 لتر × 6','مشروبات','نوفا للمياه',6.00,8.50,4,360),
    ('6281001214351','عصير برتقال 1 لتر','مشروبات','المراعي',5.50,7.50,3,25),
    ('6281001214368','مشروب غازي 330 مل','مشروبات','موزع الجملة',1.80,3.00,9,200),
    ('6281034001208','منظف أطباق 1 لتر','منظفات','موزع الجملة',6.00,9.00,0.8,700),
    ('6281034001215','مناديل 5 علب','منظفات','موزع الجملة',11.00,15.00,1,700),
    ('6281003030114','دجاج مجمد 1 كجم','مجمدات','موزع الجملة',14.00,19.00,4,60),
    ('6281003030121','بطاطس مقلية مجمدة 2.5 كجم','مجمدات','موزع الجملة',12.00,16.50,1.2,120),
    ('6281003030138','شيبس 23 جم','سناكس','موزع الجملة',0.60,1.00,12,120),
    ('6281003030145','بسكويت شوكولاتة','سناكس','موزع الجملة',1.20,2.00,6,150),
    ('6281003030152','آيس كريم كوب','مجمدات','المراعي',2.00,3.50,0.3,90)
$$;

-- p_step: 0 = الكتالوج والمخزون الافتتاحي، 1..14 = مبيعات 3 أيام لكل خطوة، 15 = الإنهاء
create or replace function public.seed_demo_step(p_store uuid, p_step int) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_shelf uuid; v_wh uuid; p record; v_prod uuid; d int; k int; v_items jsonb; v_sale uuid; v_cust uuid; v_ts timestamptz;
  n int := 0; custs uuid[]; v_pay text; v_bread uuid; v_cheese uuid; v_milk uuid; v_eggs uuid; v_inv numeric;
begin
  if not has_store_role(p_store, '{owner}') then raise exception 'للمالك فقط'; end if;
  select id into v_shelf from locations where store_id = p_store and kind = 'shelf' limit 1;
  select id into v_wh from locations where store_id = p_store and kind = 'warehouse' limit 1;

  if p_step = 0 then
    if exists(select 1 from products where store_id = p_store) then raise exception 'المتجر يحتوي منتجات بالفعل. البيانات التجريبية لمتجر فارغ فقط'; end if;
    insert into suppliers(store_id, name, phone, lead_days) values
      (p_store,'المراعي','0500000001',1),(p_store,'مخابز الحي','0500000002',1),(p_store,'موزع الجملة','0500000003',3),(p_store,'نوفا للمياه','0500000004',2);
    insert into categories(store_id, name) select distinct p_store, cat from _demo_catalog() on conflict do nothing;
    for p in select * from _demo_catalog() loop
      insert into products(store_id, barcode, name, category_id, supplier_id, cost, price, min_qty)
        values (p_store, p.bc, p.nm, (select id from categories where store_id = p_store and name = p.cat),
                (select id from suppliers where store_id = p_store and name = p.sup), p.cost, p.price, greatest(2, round(p.rate * 2)))
        returning id into v_prod;
      perform _receive_batch(p_store, v_prod, ceil(p.rate * 80), v_wh,
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
    return 25;
  end if;

  if p_step between 1 and 14 then
    perform setseed(p_step / 20.0);
    select array_agg(id order by name) into custs from customers where store_id = p_store;
    select id into v_bread from products where store_id = p_store and barcode = '6281100050012';
    select id into v_cheese from products where store_id = p_store and barcode = '6281105830024';
    select id into v_milk from products where store_id = p_store and barcode = '6281007031129';
    select id into v_eggs from products where store_id = p_store and barcode = '6281006411304';
    for d in reverse (42 - (p_step - 1) * 3)..(42 - p_step * 3 + 1) loop
      for k in 1..(14 + floor(random() * 8) + case when extract(dow from current_date - d) in (4,5) then 8 else 0 end)::int loop
        select jsonb_agg(jsonb_build_object('product_id', x.id, 'qty', greatest(1, round(random() * 2 + 0.3)))) into v_items
        from (select pr.id from products pr join _demo_catalog() c on c.bc = pr.barcode
              where pr.store_id = p_store and random() < least(0.85, c.rate / 16.0 + 0.04) order by random() limit 5) x;
        continue when v_items is null;
        if v_items @> jsonb_build_array(jsonb_build_object('product_id', v_bread)) and random() < 0.5 then
          v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', v_cheese, 'qty', 1)); end if;
        if v_items @> jsonb_build_array(jsonb_build_object('product_id', v_milk)) and random() < 0.4 then
          v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', v_eggs, 'qty', 1)); end if;
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
    perform receive_stock((select id from products where store_id = p_store and barcode = '6281105830024'), 70, v_shelf, current_date + 3, 6.5, 'دفعة قريبة الانتهاء');
    perform receive_stock((select id from products where store_id = p_store and barcode = '6281043020113'), 120, v_shelf, current_date + 4, 0.9, 'دفعة قريبة الانتهاء');
    for p in select b.id, b.qty, b.unit_cost, b.product_id, case pr.barcode when '6281100050012' then 6 else 9 end keep
             from batches b join products pr on pr.id = b.product_id
             where pr.store_id = p_store and pr.barcode in ('6281100050012','6281007031129') and b.qty > 0 loop
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

-- للاستخدام من SQL مباشرة
create or replace function public.seed_demo_data(p_store uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; i int; k int;
begin
  for i in 0..15 loop
    k := seed_demo_step(p_store, i);
    if i between 1 and 14 then n := n + k; end if;
  end loop;
  return n;
end $$;

revoke execute on function public._demo_catalog() from anon, authenticated, public;
revoke execute on function public.seed_demo_step(uuid,int) from anon, public;
grant execute on function public.seed_demo_step(uuid,int) to authenticated;
