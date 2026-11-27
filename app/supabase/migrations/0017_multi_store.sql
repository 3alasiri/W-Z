-- تعدد البقالات: دليل للعملاء، عدة فروع للمالك، ولوحة مدير المنصة
alter table public.stores
  add column if not exists district text,
  add column if not exists city text,
  add column if not exists is_active boolean not null default true;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
create policy platform_admins_self on public.platform_admins for select using (user_id = auth.uid());

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from platform_admins where user_id = auth.uid());
$$;

-- المتجر الموقوف من المنصة لا يظهر ولا يستقبل طلبات
create or replace function public.shop_store(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'slug', slug, 'name', name, 'phone', phone, 'address', address,
    'district', district, 'city', city,
    'delivery_fee', delivery_fee, 'min_order', min_order, 'radius_km', delivery_radius_km,
    'accepting_orders', accepting_orders, 'has_location', lat is not null)
  from stores where slug = lower(p_slug) and is_active;
$$;

do $do$
declare def text;
begin
  def := pg_get_functiondef('public.shop_items(text)'::regprocedure);
  def := replace(def, 'where s.slug = lower(p_slug) and p.active', 'where s.slug = lower(p_slug) and s.is_active and p.active');
  if position('s.is_active' in def) = 0 then raise exception 'shop_items patch failed'; end if;
  execute def;
  def := pg_get_functiondef('public.place_order(text,jsonb,text,text,text,text,text,float8,float8,text)'::regprocedure);
  def := replace(def, 'if not s.accepting_orders then', 'if not s.accepting_orders or not s.is_active then');
  if position('not s.is_active' in def) = 0 then raise exception 'place_order patch failed'; end if;
  execute def;
end $do$;

-- دليل البقالات للعميل: الأقرب أولًا إن أُرسل الموقع
create or replace function public.store_directory(p_lat float8 default null, p_lng float8 default null, p_q text default null)
returns table(slug text, name text, district text, city text, address text, delivery_fee numeric, min_order numeric,
  accepting_orders boolean, distance_km numeric, delivers boolean, products bigint)
language sql stable security definer set search_path = public as $$
  select s.slug, s.name, s.district, s.city, s.address, s.delivery_fee, s.min_order, s.accepting_orders,
    case when p_lat is not null and s.lat is not null then round(_km(s.lat, s.lng, p_lat, p_lng), 1) end,
    case when p_lat is not null and s.lat is not null then _km(s.lat, s.lng, p_lat, p_lng) <= s.delivery_radius_km end,
    (select count(*) from products p where p.store_id = s.id and p.active)
  from stores s
  where s.is_active
    and exists (select 1 from products p where p.store_id = s.id and p.active)
    and (coalesce(trim(p_q), '') = '' or s.name ilike '%' || trim(p_q) || '%'
         or s.district ilike '%' || trim(p_q) || '%' or s.city ilike '%' || trim(p_q) || '%')
  order by 9 nulls last, s.accepting_orders desc, s.name
  limit 100;
$$;

-- إنشاء متجر أو فرع جديد (المالك يمكنه امتلاك عدة فروع)
drop function if exists public.create_store(text);
create or replace function public.create_store(p_name text, p_district text default null, p_city text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'اسم المتجر مطلوب'; end if;
  if (select count(*) from store_members where user_id = auth.uid() and role = 'owner') >= 20 then
    raise exception 'وصلت للحد الأعلى من الفروع'; end if;
  insert into stores(name, district, city) values (trim(p_name), nullif(trim(p_district), ''), nullif(trim(p_city), '')) returning id into v;
  insert into store_members(store_id, user_id, role) values (v, auth.uid(), 'owner');
  insert into locations(store_id, name, kind) values (v, 'رفوف المتجر', 'shelf'), (v, 'المستودع', 'warehouse');
  perform _seed_accounts(v);
  return v;
end $$;

-- لوحة مدير المنصة
create or replace function public.admin_stores()
returns table(id uuid, name text, slug text, district text, city text, is_active boolean, accepting_orders boolean,
  created_at timestamptz, owner_email text, members bigint, products bigint, sales_30d numeric, invoices_30d bigint,
  orders_30d bigint, last_activity timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'هذه الصفحة لمدير المنصة فقط'; end if;
  return query
  select s.id, s.name, s.slug, s.district, s.city, s.is_active, s.accepting_orders, s.created_at,
    (select u.email::text from store_members m join auth.users u on u.id = m.user_id where m.store_id = s.id and m.role = 'owner' limit 1),
    (select count(*) from store_members m where m.store_id = s.id),
    (select count(*) from products p where p.store_id = s.id and p.active),
    coalesce((select sum(x.total) from sales x where x.store_id = s.id and x.created_at > now() - interval '30 days'), 0),
    (select count(*) from sales x where x.store_id = s.id and x.created_at > now() - interval '30 days'),
    (select count(*) from orders o where o.store_id = s.id and o.created_at > now() - interval '30 days'),
    greatest((select max(x.created_at) from sales x where x.store_id = s.id), (select max(o.created_at) from orders o where o.store_id = s.id))
  from stores s order by s.created_at desc;
end $$;

create or replace function public.admin_set_store_active(p_store uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'هذه العملية لمدير المنصة فقط'; end if;
  update stores set is_active = p_active where id = p_store;
  if not found then raise exception 'المتجر غير موجود'; end if;
end $$;

create index if not exists sales_store_created_idx on public.sales(store_id, created_at);
create index if not exists orders_store_created_idx on public.orders(store_id, created_at);

revoke execute on function public.is_platform_admin(), public.create_store(text,text,text),
  public.admin_stores(), public.admin_set_store_active(uuid,boolean) from anon, public;
grant execute on function public.is_platform_admin(), public.create_store(text,text,text),
  public.admin_stores(), public.admin_set_store_active(uuid,boolean) to authenticated;
grant execute on function public.store_directory(float8,float8,text) to anon, authenticated;

-- إيقاف المتجر وتفعيله من صلاحية مدير المنصة فقط
create or replace function public._guard_store_active() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_active is distinct from old.is_active and auth.uid() is not null and not is_platform_admin() then
    raise exception 'تفعيل المتجر أو إيقافه من صلاحية إدارة المنصة';
  end if;
  return new;
end $$;
drop trigger if exists stores_guard_active on public.stores;
create trigger stores_guard_active before update on public.stores for each row execute function public._guard_store_active();
revoke execute on function public._guard_store_active() from anon, authenticated, public;
