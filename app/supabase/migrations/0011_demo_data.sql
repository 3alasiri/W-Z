-- تعبئة متجر فارغ ببيانات تجريبية واقعية (6 أسابيع) للعرض والتجربة
create or replace function public.seed_demo_data(p_store uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_shelf uuid; v_wh uuid; s_marai uuid; s_bakery uuid; s_whole uuid; s_water uuid;
  c_dairy uuid; c_bread uuid; c_food uuid; c_drinks uuid; c_clean uuid; c_frozen uuid; c_snacks uuid;
  p record; v_prod uuid; d int; k int; v_items jsonb; v_sale uuid; v_cust uuid; v_ts timestamptz; n int := 0; custs uuid[]; v_pay text;
begin
  if not has_store_role(p_store, '{owner}') then raise exception 'للمالك فقط'; end if;
  if exists(select 1 from products where store_id = p_store) then raise exception 'المتجر يحتوي منتجات بالفعل. البيانات التجريبية لمتجر فارغ فقط'; end if;
  perform setseed(0.42);
  select id into v_shelf from locations where store_id = p_store and kind = 'shelf' limit 1;
  select id into v_wh from locations where store_id = p_store and kind = 'warehouse' limit 1;

  insert into suppliers(store_id, name, phone, lead_days) values (p_store, 'المراعي', '0500000001', 1) returning id into s_marai;
  insert into suppliers(store_id, name, phone, lead_days) values (p_store, 'مخابز الحي', '0500000002', 1) returning id into s_bakery;
  insert into suppliers(store_id, name, phone, lead_days) values (p_store, 'موزع الجملة', '0500000003', 3) returning id into s_whole;
  insert into suppliers(store_id, name, phone, lead_days) values (p_store, 'نوفا للمياه', '0500000004', 2) returning id into s_water;
  insert into categories(store_id, name) values (p_store,'ألبان') returning id into c_dairy;
  insert into categories(store_id, name) values (p_store,'مخبوزات') returning id into c_bread;
  insert into categories(store_id, name) values (p_store,'مواد غذائية') returning id into c_food;
  insert into categories(store_id, name) values (p_store,'مشروبات') returning id into c_drinks;
  insert into categories(store_id, name) values (p_store,'منظفات') returning id into c_clean;
  insert into categories(store_id, name) values (p_store,'مجمدات') returning id into c_frozen;
  insert into categories(store_id, name) values (p_store,'سناكس') returning id into c_snacks;

  create temp table _demo(id uuid, rate numeric, shelf_days int) on commit drop;
  for p in select * from (values
    ('6281007031129','حليب طازج كامل الدسم 1 لتر', c_dairy, s_marai, 4.20, 6.00, 14, 7),
    ('6281007032003','لبن 2 لتر', c_dairy, s_marai, 7.00, 9.50, 6, 10),
    ('6281043020113','زبادي 170 جم', c_dairy, s_marai, 0.90, 1.50, 10, 12),
    ('6281105830024','جبن شرائح 200 جم', c_dairy, s_marai, 6.50, 9.00, 2.5, 20),
    ('6281006411304','بيض طازج 30 حبة', c_dairy, s_whole, 17.00, 22.00, 4, 20),
    ('6281100050012','خبز توست أبيض', c_bread, s_bakery, 3.10, 4.50, 16, 4),
    ('6281100050029','خبز بر', c_bread, s_bakery, 3.40, 5.00, 5, 4),
    ('6281100050036','صامولي 6 حبات', c_bread, s_bakery, 2.50, 4.00, 8, 3),
    ('6281036001237','أرز بسمتي 5 كجم', c_food, s_whole, 38.00, 49.00, 1.6, 300),
    ('6281036102114','زيت دوار الشمس 1.5 لتر', c_food, s_whole, 13.00, 17.50, 1.8, 200),
    ('6281031254102','شاي أحمر 100 كيس', c_food, s_whole, 9.00, 13.00, 1.2, 400),
    ('6281031255109','سكر أبيض 2 كجم', c_food, s_whole, 7.50, 10.00, 1.5, 400),
    ('6281031256106','مكرونة 450 جم', c_food, s_whole, 2.20, 3.50, 2.5, 300),
    ('6281031257103','معجون طماطم 135 جم', c_food, s_whole, 0.80, 1.25, 3, 300),
    ('6281001214337','مياه معبأة 330 مل × 40', c_drinks, s_water, 14.00, 19.00, 7, 360),
    ('6281001214344','مياه 1.5 لتر × 6', c_drinks, s_water, 6.00, 8.50, 4, 360),
    ('6281001214351','عصير برتقال 1 لتر', c_drinks, s_marai, 5.50, 7.50, 3, 25),
    ('6281001214368','مشروب غازي 330 مل', c_drinks, s_whole, 1.80, 3.00, 9, 200),
    ('6281034001208','منظف أطباق 1 لتر', c_clean, s_whole, 6.00, 9.00, 0.8, 700),
    ('6281034001215','مناديل 5 علب', c_clean, s_whole, 11.00, 15.00, 1, 700),
    ('6281003030114','دجاج مجمد 1 كجم', c_frozen, s_whole, 14.00, 19.00, 4, 60),
    ('6281003030121','بطاطس مقلية مجمدة 2.5 كجم', c_frozen, s_whole, 12.00, 16.50, 1.2, 120),
    ('6281003030138','شيبس 23 جم', c_snacks, s_whole, 0.60, 1.00, 12, 120),
    ('6281003030145','بسكويت شوكولاتة', c_snacks, s_whole, 1.20, 2.00, 6, 150),
    ('6281003030152','آيس كريم كوب', c_frozen, s_marai, 2.00, 3.50, 0.3, 90)
  ) as t(bc, nm, cat, sup, cost, price, rate, shelf)
  loop
    insert into products(store_id, barcode, name, category_id, supplier_id, cost, price, min_qty)
      values (p_store, p.bc, p.nm, p.cat, p.sup, p.cost, p.price, greatest(2, round(p.rate * 2)))
      returning id into v_prod;
    insert into _demo values (v_prod, p.rate, p.shelf);
    -- مخزون أول المدة قبل 45 يومًا يكفي الفترة
    perform _receive_batch(p_store, v_prod, ceil(p.rate * 50), v_wh,
      case when p.shelf < 60 then current_date + (p.shelf + 45) else current_date + p.shelf end, p.cost, 'مخزون افتتاحي');
  end loop;
  update batches set received_at = now() - interval '45 days' where store_id = p_store;
  update stock_movements set created_at = now() - interval '45 days' where store_id = p_store;
  -- رأس المال الافتتاحي: نقد + قيمة المخزون الافتتاحي
  perform _post(p_store, 'رأس المال الافتتاحي (نقد ومخزون)', 'capital', null, jsonb_build_array(
    jsonb_build_object('code','1100','debit', 20000),
    jsonb_build_object('code','1300','debit', (select round(sum(qty * unit_cost), 2) from batches where store_id = p_store)),
    jsonb_build_object('code','3100','credit', 20000 + (select round(sum(qty * unit_cost), 2) from batches where store_id = p_store))));

  insert into customers(store_id, name, phone, credit_limit) values
    (p_store,'أبو فيصل','0551111111',500),(p_store,'أم خالد','0552222222',300),(p_store,'سعد العتيبي','0553333333',0),
    (p_store,'نورة الحربي','0554444444',0),(p_store,'محمد القحطاني','0555555555',0),(p_store,'ريم الشهري','0556666666',0),
    (p_store,'عبدالله الدوسري','0557777777',0),(p_store,'هند الزهراني','0558888888',0);
  select array_agg(id order by name) into custs from customers where store_id = p_store;

  -- مبيعات 42 يومًا: ذروة مسائية ونهاية الأسبوع، و"هند" و"عبدالله" توقفا قبل 4 أسابيع
  for d in reverse 42..1 loop
    for k in 1..(14 + floor(random() * 8) + case when extract(dow from current_date - d) in (4,5) then 8 else 0 end)::int loop
      select jsonb_agg(jsonb_build_object('product_id', x.id, 'qty', greatest(1, round(random() * 2 + 0.3)))) into v_items
      from (select id from _demo where random() < least(0.85, rate / 16.0 + 0.04) order by random() limit 5) x;
      continue when v_items is null;
      -- الخبز والجبن، والحليب والبيض، يُشترى غالبًا معًا
      if v_items::text like '%' || (select id from products where store_id = p_store and barcode = '6281100050012') || '%' and random() < 0.5 then
        v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', (select id from products where store_id = p_store and barcode = '6281105830024'), 'qty', 1));
      end if;
      if v_items::text like '%' || (select id from products where store_id = p_store and barcode = '6281007031129') || '%' and random() < 0.4 then
        v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', (select id from products where store_id = p_store and barcode = '6281006411304'), 'qty', 1));
      end if;
      v_cust := case when random() < 0.3 then custs[1 + floor(random() * array_length(custs, 1))::int] end;
      if v_cust in (custs[1], custs[4]) and d < 28 then v_cust := null; end if;
      v_pay := case when v_cust = custs[2] and random() < 0.5 then 'credit' when random() < 0.55 then 'card' else 'cash' end;
      if v_pay = 'credit' and v_cust is null then v_pay := 'cash'; end if;
      begin
        v_sale := _sale_core(p_store, v_items, v_pay, v_cust, 0, null);
      exception when others then continue; end;
      v_ts := (current_date - d)::timestamp at time zone 'Asia/Riyadh'
        + make_interval(hours => (case when random() < 0.55 then 17 + floor(random() * 6) else 7 + floor(random() * 10) end)::int, mins => floor(random() * 60)::int);
      update sales set created_at = v_ts where id = v_sale;
      update stock_movements set created_at = v_ts where ref = v_sale::text;
      update journal_entries set created_at = v_ts, entry_date = (v_ts at time zone 'Asia/Riyadh')::date where source_id = v_sale::text;
      n := n + 1;
    end loop;
  end loop;
  -- دفعات قريبة الانتهاء (بعد المبيعات السابقة) لإظهار اقتراحات الخصم
  perform receive_stock((select id from products where store_id = p_store and barcode = '6281105830024'), 70, v_shelf, current_date + 3, 6.5, 'دفعة قريبة الانتهاء');
  perform receive_stock((select id from products where store_id = p_store and barcode = '6281043020113'), 120, v_shelf, current_date + 4, 0.9, 'دفعة قريبة الانتهاء');
  -- جرد يُظهر نقصًا في الخبز والحليب (مع قيد التسوية) لإظهار تنبيهات وأوامر شراء
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
  return n;
end $$;
revoke execute on function public.seed_demo_data(uuid) from anon, public;
grant execute on function public.seed_demo_data(uuid) to authenticated;
