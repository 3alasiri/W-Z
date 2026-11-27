-- المرحلة 2: المحاسبة (قيد مزدوج)، الضريبة، العملاء الآجلون، الموردون، أوامر الشراء التلقائية

alter table public.stores add column if not exists auto_approve_limit numeric(12,2) not null default 500;
alter table public.suppliers add column if not exists email text;

create type public.account_type as enum ('asset','liability','equity','revenue','expense');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null,
  name text not null,
  type public.account_type not null,
  unique (store_id, code)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  phone text,
  credit_limit numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index on public.customers(store_id);

alter table public.sales add column if not exists customer_id uuid references public.customers(id);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint generated always as identity,
  entry_date date not null default current_date,
  memo text not null,
  source text not null,
  source_id text,
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.journal_entries(store_id, entry_date desc);

create table public.journal_lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  supplier_id uuid references public.suppliers(id),
  customer_id uuid references public.customers(id)
);
create index on public.journal_lines(entry_id);
create index on public.journal_lines(account_id);
create index on public.journal_lines(supplier_id) where supplier_id is not null;
create index on public.journal_lines(customer_id) where customer_id is not null;

create type public.po_status as enum ('draft','approved','sent','partial','received','cancelled');

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint generated always as identity,
  supplier_id uuid not null references public.suppliers(id),
  status public.po_status not null default 'draft',
  auto boolean not null default false,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid,
  sent_at timestamptz
);
create index on public.purchase_orders(store_id, created_at desc);

create table public.po_items (
  id bigint generated always as identity primary key,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty numeric(12,3) not null check (qty > 0),
  unit_cost numeric(12,2) not null default 0,
  received_qty numeric(12,3) not null default 0,
  unique (po_id, product_id)
);

-- RLS
alter table public.accounts enable row level security;
alter table public.customers enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.po_items enable row level security;

create policy accounts_read on public.accounts for select to authenticated using (has_store_role(store_id));
create policy customers_read on public.customers for select to authenticated using (has_store_role(store_id));
create policy customers_write on public.customers for all to authenticated
  using (has_store_role(store_id, '{owner,manager,cashier}')) with check (has_store_role(store_id, '{owner,manager,cashier}'));
create policy je_read on public.journal_entries for select to authenticated using (has_store_role(store_id, '{owner,manager}'));
create policy jl_read on public.journal_lines for select to authenticated
  using (exists(select 1 from journal_entries e where e.id = entry_id and has_store_role(e.store_id, '{owner,manager}')));
create policy po_read on public.purchase_orders for select to authenticated using (has_store_role(store_id));
create policy poi_read on public.po_items for select to authenticated
  using (exists(select 1 from purchase_orders o where o.id = po_id and has_store_role(o.store_id)));

-- ============ دوال داخلية (غير مكشوفة) ============
create or replace function public._seed_accounts(p_store uuid) returns void
language sql security definer set search_path = public as $$
  insert into accounts(store_id, code, name, type) values
   (p_store,'1100','الصندوق','asset'),(p_store,'1110','البنك / مدى','asset'),
   (p_store,'1200','ذمم العملاء','asset'),(p_store,'1300','المخزون','asset'),
   (p_store,'1400','ضريبة المدخلات','asset'),
   (p_store,'2100','ذمم الموردين','liability'),(p_store,'2200','ضريبة المخرجات','liability'),
   (p_store,'3100','رأس المال','equity'),
   (p_store,'4100','المبيعات','revenue'),
   (p_store,'5100','تكلفة البضاعة المباعة','expense'),(p_store,'5200','الهدر والتالف','expense'),
   (p_store,'5300','فروقات الجرد','expense'),
   (p_store,'6100','الرواتب','expense'),(p_store,'6200','الإيجار','expense'),
   (p_store,'6300','الكهرباء والماء','expense'),(p_store,'6400','التوصيل والنقل','expense'),
   (p_store,'6900','مصروفات أخرى','expense')
  on conflict (store_id, code) do nothing;
$$;
select public._seed_accounts(id) from public.stores;

create or replace function public._acc(p_store uuid, p_code text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from accounts where store_id = p_store and code = p_code;
$$;

create or replace function public._pay_acc(p_method text) returns text
language sql immutable as $$
  select case p_method when 'cash' then '1100' when 'card' then '1110' when 'credit' then '1200' end;
$$;

-- ينشئ قيدًا متوازنًا. السطور: [{code, debit, credit, supplier_id?, customer_id?}]
create or replace function public._post(p_store uuid, p_memo text, p_source text, p_source_id text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; l jsonb; d numeric := 0; c numeric := 0; dv numeric; cv numeric; acc uuid;
begin
  insert into journal_entries(store_id, memo, source, source_id) values (p_store, p_memo, p_source, p_source_id) returning id into v;
  for l in select * from jsonb_array_elements(p_lines) loop
    dv := round(coalesce((l->>'debit')::numeric, 0), 2); cv := round(coalesce((l->>'credit')::numeric, 0), 2);
    continue when dv = 0 and cv = 0;
    acc := _acc(p_store, l->>'code');
    if acc is null then raise exception 'حساب غير موجود %', l->>'code'; end if;
    insert into journal_lines(entry_id, account_id, debit, credit, supplier_id, customer_id)
      values (v, acc, dv, cv, nullif(l->>'supplier_id','')::uuid, nullif(l->>'customer_id','')::uuid);
    d := d + dv; c := c + cv;
  end loop;
  if d <> c then raise exception 'قيد غير متوازن: مدين % دائن %', d, c; end if;
  return v;
end $$;

-- إضافة دفعة مخزون دون قيد
create or replace function public._receive_batch(p_store uuid, p_product uuid, p_qty numeric, p_location uuid,
  p_expiry date, p_unit_cost numeric, p_ref text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_batch uuid;
begin
  if p_qty <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر'; end if;
  if not exists(select 1 from locations where id = p_location and store_id = p_store) then raise exception 'موقع غير صالح'; end if;
  insert into batches(store_id, product_id, location_id, qty, expiry_date, unit_cost)
    values (p_store, p_product, p_location, p_qty, p_expiry, p_unit_cost) returning id into v_batch;
  insert into stock_movements(store_id, product_id, batch_id, type, qty, ref) values (p_store, p_product, v_batch, 'receive', p_qty, p_ref);
  update products p set cost = round(((select coalesce(sum(qty * unit_cost),0) from batches b where b.product_id = p.id)
      / nullif((select sum(qty) from batches b where b.product_id = p.id),0))::numeric, 2)
    where p.id = p_product;
  return v_batch;
end $$;

-- ============ تحديث دوال المرحلة 1 لتسجيل القيود ============
create or replace function public.create_store(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  insert into stores(name) values (p_name) returning id into v;
  insert into store_members(store_id, user_id, role) values (v, auth.uid(), 'owner');
  insert into locations(store_id, name, kind) values (v, 'رفوف المتجر', 'shelf'), (v, 'المستودع', 'warehouse');
  perform _seed_accounts(v);
  return v;
end $$;

-- التكلفة قبل الضريبة. يُقيَّد على المورد الافتراضي للمنتج، أو نقدًا إن لم يوجد مورد
create or replace function public.receive_stock(p_product uuid, p_qty numeric, p_location uuid,
  p_expiry date default null, p_unit_cost numeric default null, p_ref text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_cost numeric; v_sup uuid; v_batch uuid; v_amt numeric; v_vat numeric; v_rate numeric; v_name text;
begin
  select p.store_id, p.cost, p.supplier_id, p.name, s.vat_rate into v_store, v_cost, v_sup, v_name, v_rate
    from products p join stores s on s.id = p.store_id where p.id = p_product;
  if v_store is null then raise exception 'المنتج غير موجود'; end if;
  if not has_store_role(v_store, '{owner,manager,stock}') then raise exception 'لا تملك صلاحية الاستلام'; end if;
  v_cost := coalesce(p_unit_cost, v_cost);
  v_batch := _receive_batch(v_store, p_product, p_qty, p_location, p_expiry, v_cost, p_ref);
  v_amt := round(p_qty * v_cost, 2); v_vat := round(v_amt * v_rate / 100, 2);
  if v_amt > 0 then
    perform _post(v_store, 'استلام ' || v_name || coalesce(' · ' || p_ref, ''), 'receive', v_batch::text, jsonb_build_array(
      jsonb_build_object('code','1300','debit',v_amt),
      jsonb_build_object('code','1400','debit',v_vat),
      case when v_sup is null then jsonb_build_object('code','1100','credit',v_amt+v_vat)
           else jsonb_build_object('code','2100','credit',v_amt+v_vat,'supplier_id',v_sup) end));
  end if;
  return v_batch;
end $$;

drop function if exists public.complete_sale(uuid, jsonb, text);
create or replace function public.complete_sale(p_store uuid, p_items jsonb, p_payment text, p_customer uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sale uuid; it jsonb; v_prod products%rowtype; v_need numeric; v_take numeric; b record;
  v_total numeric := 0; v_vat_rate numeric; v_cost_sum numeric; v_cogs numeric := 0; v_sub numeric; v_vat numeric;
  v_limit numeric; v_bal numeric; v_no bigint;
begin
  if not has_store_role(p_store) then raise exception 'لا تملك صلاحية البيع'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'الفاتورة فارغة'; end if;
  if p_payment not in ('cash','card','credit') then raise exception 'طريقة دفع غير صالحة'; end if;
  if p_payment = 'credit' and p_customer is null then raise exception 'اختر العميل للبيع الآجل'; end if;
  if p_customer is not null and not exists(select 1 from customers where id = p_customer and store_id = p_store) then raise exception 'عميل غير صالح'; end if;
  select vat_rate into v_vat_rate from stores where id = p_store;
  insert into sales(store_id, subtotal, vat, total, payment_method, customer_id) values (p_store, 0, 0, 0, p_payment, p_customer) returning id, number into v_sale, v_no;

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
    v_cogs := v_cogs + v_cost_sum;
  end loop;

  v_sub := round(v_total / (1 + v_vat_rate/100), 2);
  v_vat := v_total - v_sub;

  if p_payment = 'credit' then
    select credit_limit into v_limit from customers where id = p_customer;
    select coalesce(sum(jl.debit - jl.credit), 0) into v_bal from journal_lines jl join accounts a on a.id = jl.account_id
      where jl.customer_id = p_customer and a.code = '1200';
    if v_limit > 0 and v_bal + v_total > v_limit then
      raise exception 'تجاوز حد الائتمان: الرصيد الحالي % والحد %', v_bal, v_limit;
    end if;
  end if;

  update sales set total = v_total, vat = v_vat, subtotal = v_sub where id = v_sale;

  perform _post(p_store, 'فاتورة مبيعات رقم ' || v_no, 'sale', v_sale::text, jsonb_build_array(
    jsonb_build_object('code', _pay_acc(p_payment), 'debit', v_total, 'customer_id', case when p_payment = 'credit' then p_customer end),
    jsonb_build_object('code','4100','credit', v_sub),
    jsonb_build_object('code','2200','credit', v_vat),
    jsonb_build_object('code','5100','debit', round(v_cogs, 2)),
    jsonb_build_object('code','1300','credit', round(v_cogs, 2))));
  return v_sale;
end $$;

create or replace function public.adjust_batch(p_batch uuid, p_new_qty numeric, p_type public.movement_type default 'adjust', p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b batches%rowtype; v_diff numeric; v_val numeric; v_exp text; v_name text;
begin
  select * into b from batches where id = p_batch for update;
  if b.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if not has_store_role(b.store_id, '{owner,manager,stock}') then raise exception 'لا تملك الصلاحية'; end if;
  if p_new_qty < 0 then raise exception 'كمية غير صالحة'; end if;
  if p_type not in ('adjust','waste') then raise exception 'نوع غير صالح'; end if;
  v_diff := p_new_qty - b.qty;
  update batches set qty = p_new_qty where id = p_batch;
  insert into stock_movements(store_id, product_id, batch_id, type, qty, ref) values (b.store_id, b.product_id, b.id, p_type, v_diff, p_ref);
  v_val := round(abs(v_diff) * b.unit_cost, 2);
  select name into v_name from products where id = b.product_id;
  v_exp := case when p_type = 'waste' then '5200' else '5300' end;
  if v_val > 0 then
    perform _post(b.store_id, (case when p_type = 'waste' then 'تالف: ' else 'تسوية جرد: ' end) || v_name, p_type::text, b.id::text,
      case when v_diff < 0 then jsonb_build_array(jsonb_build_object('code', v_exp, 'debit', v_val), jsonb_build_object('code','1300','credit', v_val))
           else jsonb_build_array(jsonb_build_object('code','1300','debit', v_val), jsonb_build_object('code', '5300', 'credit', v_val)) end);
  end if;
end $$;

-- ============ المدفوعات والمصروفات ============
create or replace function public.pay_supplier(p_supplier uuid, p_amount numeric, p_method text, p_memo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_name text;
begin
  select store_id, name into v_store, v_name from suppliers where id = p_supplier;
  if v_store is null then raise exception 'المورد غير موجود'; end if;
  if not has_store_role(v_store, '{owner,manager}') then raise exception 'لا تملك الصلاحية'; end if;
  if p_amount <= 0 or p_method not in ('cash','card') then raise exception 'بيانات دفع غير صالحة'; end if;
  return _post(v_store, 'سداد للمورد ' || v_name || coalesce(' · ' || p_memo, ''), 'supplier_payment', p_supplier::text, jsonb_build_array(
    jsonb_build_object('code','2100','debit',p_amount,'supplier_id',p_supplier),
    jsonb_build_object('code',_pay_acc(p_method),'credit',p_amount)));
end $$;

create or replace function public.receive_customer_payment(p_customer uuid, p_amount numeric, p_method text, p_memo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_name text;
begin
  select store_id, name into v_store, v_name from customers where id = p_customer;
  if v_store is null then raise exception 'العميل غير موجود'; end if;
  if not has_store_role(v_store, '{owner,manager,cashier}') then raise exception 'لا تملك الصلاحية'; end if;
  if p_amount <= 0 or p_method not in ('cash','card') then raise exception 'بيانات دفع غير صالحة'; end if;
  return _post(v_store, 'تحصيل من العميل ' || v_name || coalesce(' · ' || p_memo, ''), 'customer_payment', p_customer::text, jsonb_build_array(
    jsonb_build_object('code',_pay_acc(p_method),'debit',p_amount),
    jsonb_build_object('code','1200','credit',p_amount,'customer_id',p_customer)));
end $$;

-- المبلغ قبل الضريبة + ضريبة المدخلات (اختياري)
create or replace function public.record_expense(p_store uuid, p_code text, p_amount numeric, p_vat numeric, p_method text, p_memo text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not has_store_role(p_store, '{owner,manager}') then raise exception 'لا تملك الصلاحية'; end if;
  if p_code not like '6%' and p_code not in ('5200','5300') then raise exception 'حساب مصروف غير صالح'; end if;
  if p_amount <= 0 or coalesce(p_vat,0) < 0 or p_method not in ('cash','card') then raise exception 'بيانات غير صالحة'; end if;
  return _post(p_store, coalesce(nullif(p_memo,''), 'مصروف'), 'expense', null, jsonb_build_array(
    jsonb_build_object('code',p_code,'debit',p_amount),
    jsonb_build_object('code','1400','debit',coalesce(p_vat,0)),
    jsonb_build_object('code',_pay_acc(p_method),'credit',p_amount + coalesce(p_vat,0))));
end $$;

create or replace function public.owner_deposit(p_store uuid, p_amount numeric, p_method text, p_memo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not has_store_role(p_store, '{owner}') then raise exception 'للمالك فقط'; end if;
  if p_amount <= 0 or p_method not in ('cash','card') then raise exception 'بيانات غير صالحة'; end if;
  return _post(p_store, coalesce(nullif(p_memo,''), 'إيداع رأس مال'), 'capital', null, jsonb_build_array(
    jsonb_build_object('code',_pay_acc(p_method),'debit',p_amount),
    jsonb_build_object('code','3100','credit',p_amount)));
end $$;

-- ============ أوامر الشراء ============
create or replace function public._recalc_po(p_po uuid) returns void
language sql security definer set search_path = public as $$
  update purchase_orders set total = coalesce((select round(sum(qty * unit_cost), 2) from po_items where po_id = p_po), 0) where id = p_po;
$$;

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
      greatest(1, ceil(case when ps.avg_daily > 0 then ps.avg_daily * 7 + a.reorder_point - a.stock
                            else greatest(ps.min_qty * 2, 1) - a.stock end)),
      ps.cost
    from stock_alerts a join product_stock ps on ps.id = a.product_id join products p on p.id = a.product_id
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

create or replace function public.generate_purchase_orders(p_store uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not has_store_role(p_store, '{owner,manager,stock}') then raise exception 'لا تملك الصلاحية'; end if;
  return _generate_pos(p_store);
end $$;

create or replace function public._run_auto_purchase_orders() returns int
language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  for s in select id from stores loop n := n + _generate_pos(s.id); end loop;
  return n;
end $$;

create or replace function public.create_po(p_store uuid, p_supplier uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not has_store_role(p_store, '{owner,manager,stock}') then raise exception 'لا تملك الصلاحية'; end if;
  if not exists(select 1 from suppliers where id = p_supplier and store_id = p_store) then raise exception 'مورد غير صالح'; end if;
  insert into purchase_orders(store_id, supplier_id) values (p_store, p_supplier) returning id into v;
  return v;
end $$;

create or replace function public._po_editable(p_po uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare o purchase_orders%rowtype;
begin
  select * into o from purchase_orders where id = p_po for update;
  if o.id is null then raise exception 'أمر الشراء غير موجود'; end if;
  if not has_store_role(o.store_id, '{owner,manager,stock}') then raise exception 'لا تملك الصلاحية'; end if;
  if o.status not in ('draft','approved') then raise exception 'لا يمكن تعديل أمر بعد إرساله'; end if;
  return o.store_id;
end $$;

-- p_qty = 0 يحذف السطر
create or replace function public.set_po_item(p_po uuid, p_product uuid, p_qty numeric, p_unit_cost numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_cost numeric;
begin
  v_store := _po_editable(p_po);
  select cost into v_cost from products where id = p_product and store_id = v_store;
  if not found then raise exception 'منتج غير صالح'; end if;
  if p_qty <= 0 then delete from po_items where po_id = p_po and product_id = p_product;
  else
    insert into po_items(po_id, product_id, qty, unit_cost) values (p_po, p_product, p_qty, coalesce(p_unit_cost, v_cost))
    on conflict (po_id, product_id) do update set qty = excluded.qty, unit_cost = coalesce(p_unit_cost, po_items.unit_cost);
  end if;
  -- أي تعديل يعيد الأمر لمسودة تحتاج اعتمادًا
  update purchase_orders set status = 'draft', approved_at = null, approved_by = null where id = p_po;
  perform _recalc_po(p_po);
end $$;

create or replace function public.set_po_status(p_po uuid, p_status public.po_status)
returns void language plpgsql security definer set search_path = public as $$
declare o purchase_orders%rowtype;
begin
  select * into o from purchase_orders where id = p_po for update;
  if o.id is null then raise exception 'أمر الشراء غير موجود'; end if;
  if p_status = 'approved' then
    if not has_store_role(o.store_id, '{owner,manager}') then raise exception 'الاعتماد للمالك أو المدير'; end if;
    if o.status <> 'draft' then raise exception 'الأمر ليس مسودة'; end if;
    if not exists(select 1 from po_items where po_id = p_po) then raise exception 'الأمر فارغ'; end if;
    update purchase_orders set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_po;
  elsif p_status = 'sent' then
    if not has_store_role(o.store_id, '{owner,manager,stock}') then raise exception 'لا تملك الصلاحية'; end if;
    if o.status <> 'approved' then raise exception 'يجب اعتماد الأمر أولًا'; end if;
    update purchase_orders set status = 'sent', sent_at = now() where id = p_po;
  elsif p_status = 'cancelled' then
    if not has_store_role(o.store_id, '{owner,manager}') then raise exception 'لا تملك الصلاحية'; end if;
    if o.status in ('partial','received') then raise exception 'لا يمكن إلغاء أمر بدأ استلامه'; end if;
    update purchase_orders set status = 'cancelled' where id = p_po;
  else raise exception 'حالة غير مدعومة'; end if;
end $$;

-- استلام أمر شراء: [{item_id, qty, expiry, location_id, unit_cost?}] — قيد واحد على المورد
create or replace function public.receive_po(p_po uuid, p_items jsonb, p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o purchase_orders%rowtype; it jsonb; li po_items%rowtype; v_cost numeric; v_q numeric; v_amt numeric := 0; v_rate numeric; v_vat numeric;
begin
  select * into o from purchase_orders where id = p_po for update;
  if o.id is null then raise exception 'أمر الشراء غير موجود'; end if;
  if not has_store_role(o.store_id, '{owner,manager,stock}') then raise exception 'لا تملك الصلاحية'; end if;
  if o.status not in ('approved','sent','partial') then raise exception 'الأمر غير جاهز للاستلام'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_q := coalesce((it->>'qty')::numeric, 0);
    continue when v_q <= 0;
    select * into li from po_items where id = (it->>'item_id')::bigint and po_id = p_po;
    if li.id is null then raise exception 'سطر غير صالح'; end if;
    v_cost := coalesce((it->>'unit_cost')::numeric, li.unit_cost);
    perform _receive_batch(o.store_id, li.product_id, v_q, (it->>'location_id')::uuid, nullif(it->>'expiry','')::date, v_cost,
      'أمر شراء ' || o.number || coalesce(' · ' || p_ref, ''));
    update po_items set received_qty = received_qty + v_q where id = li.id;
    v_amt := v_amt + round(v_q * v_cost, 2);
  end loop;
  if v_amt = 0 then raise exception 'لا كميات للاستلام'; end if;
  select vat_rate into v_rate from stores where id = o.store_id;
  v_vat := round(v_amt * v_rate / 100, 2);
  perform _post(o.store_id, 'استلام أمر شراء رقم ' || o.number || coalesce(' · فاتورة ' || p_ref, ''), 'po_receipt', p_po::text, jsonb_build_array(
    jsonb_build_object('code','1300','debit',v_amt),
    jsonb_build_object('code','1400','debit',v_vat),
    jsonb_build_object('code','2100','credit',v_amt + v_vat,'supplier_id',o.supplier_id)));
  update purchase_orders set status = case when exists(select 1 from po_items where po_id = p_po and received_qty < qty) then 'partial' else 'received' end::po_status
    where id = p_po;
end $$;

-- ============ التقارير ============
create or replace function public.account_balances(p_store uuid, p_from date, p_to date)
returns table(code text, name text, type public.account_type, debit numeric, credit numeric)
language sql stable security invoker set search_path = public as $$
  select a.code, a.name, a.type, coalesce(sum(l.debit),0), coalesce(sum(l.credit),0)
  from accounts a
  left join journal_lines l on l.account_id = a.id
    and exists(select 1 from journal_entries e where e.id = l.entry_id and e.entry_date between p_from and p_to)
  where a.store_id = p_store and has_store_role(p_store, '{owner,manager}')
  group by a.code, a.name, a.type order by a.code;
$$;

create or replace view public.supplier_balances with (security_invoker = true) as
select s.id, s.store_id, s.name, s.phone, s.email, s.lead_days,
  coalesce((select sum(l.credit - l.debit) from journal_lines l join accounts a on a.id = l.account_id
    where l.supplier_id = s.id and a.code = '2100'), 0) as balance
from suppliers s;

create or replace view public.customer_balances with (security_invoker = true) as
select c.id, c.store_id, c.name, c.phone, c.credit_limit, c.created_at,
  coalesce((select sum(l.debit - l.credit) from journal_lines l join accounts a on a.id = l.account_id
    where l.customer_id = c.id and a.code = '1200'), 0) as balance
from customers c;

-- ============ الصلاحيات ============
revoke execute on function public._seed_accounts(uuid), public._acc(uuid,text), public._pay_acc(text),
  public._post(uuid,text,text,text,jsonb), public._receive_batch(uuid,uuid,numeric,uuid,date,numeric,text),
  public._recalc_po(uuid), public._generate_pos(uuid), public._run_auto_purchase_orders(), public._po_editable(uuid)
  from anon, authenticated, public;

revoke execute on function public.complete_sale(uuid,jsonb,text,uuid), public.pay_supplier(uuid,numeric,text,text),
  public.receive_customer_payment(uuid,numeric,text,text), public.record_expense(uuid,text,numeric,numeric,text,text),
  public.owner_deposit(uuid,numeric,text,text), public.generate_purchase_orders(uuid), public.create_po(uuid,uuid),
  public.set_po_item(uuid,uuid,numeric,numeric), public.set_po_status(uuid,public.po_status),
  public.receive_po(uuid,jsonb,text), public.account_balances(uuid,date,date)
  from anon, public;
grant execute on function public.complete_sale(uuid,jsonb,text,uuid), public.pay_supplier(uuid,numeric,text,text),
  public.receive_customer_payment(uuid,numeric,text,text), public.record_expense(uuid,text,numeric,numeric,text,text),
  public.owner_deposit(uuid,numeric,text,text), public.generate_purchase_orders(uuid), public.create_po(uuid,uuid),
  public.set_po_item(uuid,uuid,numeric,numeric), public.set_po_status(uuid,public.po_status),
  public.receive_po(uuid,jsonb,text), public.account_balances(uuid,date,date)
  to authenticated;

-- ============ الطلب التلقائي كل ساعة ============
create extension if not exists pg_cron;
select cron.schedule('auto-purchase-orders', '7 * * * *', $$select public._run_auto_purchase_orders()$$);
