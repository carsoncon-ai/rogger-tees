-- Rogger Studio: multi-shop custom apparel platform
-- Every business owns one shop. Customers design products, submit orders,
-- the shop approves/declines, and customers pay through Stripe Checkout.


-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------
create table public.shops (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null unique references auth.users(id) on delete cascade,
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name           text not null,
  logo_url       text,
  accent         text not null default '#ffffff',
  -- turnaround, email, phone, tiers[{min,off}], deposit, rush, tax
  settings       jsonb not null default '{"turnaround":"10–14 business days after approval","email":"","phone":"","tiers":[{"min":24,"off":0},{"min":48,"off":5},{"min":72,"off":8},{"min":144,"off":12}],"deposit":50,"rush":15,"tax":0}',
  next_order     int not null default 1001,
  stripe_account text,
  stripe_ready   boolean not null default false,
  created_at     timestamptz not null default now()
);

create table public.products (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id) on delete cascade,
  active     boolean not null default true,
  position   int not null default 0,
  -- name, category, price, extraLoc, extraEl, cost, minQty, sizes[], upcharge{}, images{front,back}, print{front,back}, colors[]
  data       jsonb not null,
  created_at timestamptz not null default now()
);
create index on public.products (shop_id, position);

create table public.orders (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id) on delete cascade,
  number         int not null,
  access_token   uuid not null default gen_random_uuid() unique,
  customer       jsonb not null,               -- {org,name,email,phone}
  customer_email text not null,
  title          text not null default 'Untitled design',
  due            date,
  notes          text not null default '',
  sizes          jsonb not null,
  design         jsonb not null,
  product_id     uuid references public.products(id) on delete set null,
  product_name   text not null,
  color_name     text,
  qty            int not null,
  unit           numeric(10,2) not null,
  total          numeric(10,2) not null,
  cost           numeric(10,2) not null default 0,
  status         text not null default 'Pending' check (status in ('Pending','Approved','Declined','Production','Ready','Completed')),
  amount_paid    numeric(10,2) not null default 0,
  paid           boolean not null default false,
  decline_reason text,
  message        text,                          -- shown to the customer
  note           text,                          -- internal only
  history        jsonb not null default '[]',
  revision_of    uuid references public.orders(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (shop_id, number)
);
create index on public.orders (shop_id, created_at desc);
create index on public.orders (lower(customer_email));

-- ---------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------
alter table public.shops    enable row level security;
alter table public.products enable row level security;
alter table public.orders   enable row level security;

create or replace function public.owns_shop(p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from shops where id = p_shop and owner = auth.uid())
$$;

-- shops: anyone can read (the storefront needs name/logo/pricing), owners manage their own
create policy shops_read   on public.shops for select using (true);
create policy shops_insert on public.shops for insert with check (owner = auth.uid());
create policy shops_update on public.shops for update using (owner = auth.uid()) with check (owner = auth.uid());

-- Owners can edit branding/settings only. Stripe fields and order counter are set by the server.
revoke insert, update on public.shops from anon, authenticated;
grant insert (owner, slug, name, logo_url, accent, settings) on public.shops to authenticated;
grant update (slug, name, logo_url, accent, settings) on public.shops to authenticated;

-- products: public sees active ones, owners see and manage all of theirs
create policy products_read  on public.products for select using (active or public.owns_shop(shop_id));
create policy products_write on public.products for all using (public.owns_shop(shop_id)) with check (public.owns_shop(shop_id));

-- orders: only the shop owner reads/updates/deletes. Customers go through the RPCs below.
create policy orders_owner_read   on public.orders for select using (public.owns_shop(shop_id));
create policy orders_owner_update on public.orders for update using (public.owns_shop(shop_id)) with check (public.owns_shop(shop_id));
create policy orders_owner_delete on public.orders for delete using (public.owns_shop(shop_id));
-- Orders are created only through submit_order(). Owners can move status, message the customer
-- and mark offline payments; amounts and Stripe payments are only changed by the server.
revoke insert, update on public.orders from anon, authenticated;
grant update (status, paid, decline_reason, message, note, history) on public.orders to authenticated;

-- ---------------------------------------------------------------
-- Server-side pricing (the client's numbers are never trusted)
-- ---------------------------------------------------------------
create or replace function public.quote_order(p_product jsonb, p_design jsonb, p_sizes jsonb, p_due date, p_settings jsonb)
returns jsonb language plpgsql stable as $$
declare
  layers   jsonb := coalesce(p_design->'layers','[]');
  locs     int;
  els      int := jsonb_array_length(layers);
  base     numeric;
  qty      int := 0;
  off      numeric := 0;
  unit     numeric;
  sub      numeric := 0;
  up       numeric := 0;
  rush     numeric := 0;
  tax      numeric := 0;
  k text; v jsonb; n int; t jsonb;
begin
  select greatest(1, count(distinct l.value->>'side')) into locs
    from jsonb_array_elements(layers) as l(value) where l.value->>'side' in ('front','back');
  base := (p_product->>'price')::numeric
        + (locs-1) * coalesce((p_product->>'extraLoc')::numeric,0)
        + greatest(0, els-locs) * coalesce((p_product->>'extraEl')::numeric,0);

  for k, v in select * from jsonb_each(p_sizes) loop
    n := least(100000, greatest(0, (v#>>'{}')::int));
    if n > 0 and not (p_product->'sizes') ? k then
      raise exception 'Size % is not offered for this product', k;
    end if;
    qty := qty + n;
    up  := up + n * coalesce((p_product->'upcharge'->>k)::numeric, 0);
  end loop;

  for t in select x.value from jsonb_array_elements(coalesce(p_settings->'tiers','[]')) as x(value) order by (x.value->>'min')::int loop
    if qty >= (t->>'min')::int then off := (t->>'off')::numeric; end if;
  end loop;

  unit := round(base * (1 - off/100), 2);
  sub  := unit * qty;
  if p_due is not null and p_due - current_date < 7 then
    rush := (sub + up) * coalesce((p_settings->>'rush')::numeric,0) / 100;
  end if;
  tax := (sub + up + rush) * coalesce((p_settings->>'tax')::numeric,0) / 100;

  return jsonb_build_object(
    'qty', qty, 'unit', unit, 'off', off, 'sub', round(sub,2), 'up', round(up,2),
    'rush', round(rush,2), 'tax', round(tax,2), 'total', round(sub+up+rush+tax, 2),
    'cost', round(qty * coalesce((p_product->>'cost')::numeric,0), 2));
end $$;

-- ---------------------------------------------------------------
-- Customer RPCs
-- ---------------------------------------------------------------

-- Submit an order (no login needed). Price is computed here.
create or replace function public.submit_order(
  p_shop uuid, p_product uuid, p_design jsonb, p_sizes jsonb, p_customer jsonb,
  p_title text, p_due date, p_notes text, p_revision_of uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s shops; p products; q jsonb; num int; o orders; email text; color jsonb;
begin
  select * into s from shops where id = p_shop;
  if not found then raise exception 'Shop not found'; end if;
  select * into p from products where id = p_product and shop_id = p_shop and active;
  if not found then raise exception 'That product is not available'; end if;

  email := lower(trim(p_customer->>'email'));
  if email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'A valid email is required'; end if;
  if coalesce(trim(p_customer->>'org'),'') = '' then raise exception 'Organization is required'; end if;
  if jsonb_array_length(coalesce(p_design->'layers','[]')) = 0 then raise exception 'Add a design first'; end if;
  if jsonb_array_length(p_design->'layers') > 40 then raise exception 'Too many design elements'; end if;

  q := quote_order(p.data, p_design, p_sizes, p_due, s.settings);
  if (q->>'qty')::int < coalesce((p.data->>'minQty')::int,1) then
    raise exception 'Minimum order is % pieces', p.data->>'minQty';
  end if;

  select c.value into color from jsonb_array_elements(p.data->'colors') as c(value) where c.value->>'id' = p_design->>'colorId';

  update shops set next_order = next_order + 1 where id = p_shop returning next_order - 1 into num;

  insert into orders (shop_id, number, customer, customer_email, title, due, notes, sizes, design,
                      product_id, product_name, color_name, qty, unit, total, cost, revision_of, history)
  values (p_shop, num,
          jsonb_build_object('org', left(p_customer->>'org',120), 'name', left(coalesce(p_customer->>'name',''),120),
                             'email', email, 'phone', left(coalesce(p_customer->>'phone',''),40)),
          email, left(coalesce(nullif(trim(p_title),''),'Untitled design'),120), p_due, left(coalesce(p_notes,''),2000),
          p_sizes, jsonb_set(p_design,'{productId}', to_jsonb(p.id::text)),
          p.id, p.data->>'name', color->>'name', (q->>'qty')::int, (q->>'unit')::numeric,
          (q->>'total')::numeric, (q->>'cost')::numeric,
          (select id from orders where id = p_revision_of and shop_id = p_shop and lower(customer_email) = email),
          jsonb_build_array(jsonb_build_object('at', now(), 'text',
            case when p_revision_of is null then 'Order submitted' else 'Resubmitted after changes' end)))
  returning * into o;

  return jsonb_build_object('id', o.id, 'number', o.number, 'token', o.access_token, 'total', o.total, 'quote', q);
end $$;

-- What a customer is allowed to see about an order (no internal notes, no cost).
create or replace function public.customer_view(o orders) returns jsonb language sql stable as $$
  select jsonb_build_object('id', o.id, 'number', o.number, 'token', o.access_token, 'title', o.title,
    'status', o.status, 'product_name', o.product_name, 'color_name', o.color_name, 'qty', o.qty,
    'sizes', o.sizes, 'total', o.total, 'amount_paid', o.amount_paid, 'paid', o.paid, 'due', o.due,
    'decline_reason', o.decline_reason, 'message', o.message, 'design', o.design,
    'created_at', o.created_at, 'shop_id', o.shop_id, 'customer', o.customer)
$$;

-- Order status page via the private link the customer gets after submitting.
create or replace function public.order_by_token(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select customer_view(o) from orders o where access_token = p_token
$$;

-- "My orders" for a customer signed in with an email code.
create or replace function public.my_orders(p_shop uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(customer_view(o) order by o.created_at desc), '[]')
  from orders o
  where o.shop_id = p_shop and lower(o.customer_email) = lower(auth.jwt()->>'email')
$$;

grant execute on function public.submit_order, public.order_by_token to anon, authenticated;
grant execute on function public.my_orders to authenticated;

-- ---------------------------------------------------------------
-- Payments (written only by the Stripe webhook via the service role)
-- ---------------------------------------------------------------
create table public.payments (
  id         text primary key,          -- Stripe Checkout session id (makes webhooks idempotent)
  order_id   uuid not null references public.orders(id) on delete cascade,
  amount     numeric(10,2) not null,
  kind       text not null,
  created_at timestamptz not null default now()
);
alter table public.payments enable row level security;
create policy payments_owner_read on public.payments for select
  using (exists(select 1 from orders o where o.id = order_id and public.owns_shop(o.shop_id)));

create or replace function public.record_payment(p_session text, p_order uuid, p_amount numeric, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into payments (id, order_id, amount, kind) values (p_session, p_order, p_amount, p_kind)
  on conflict (id) do nothing;
  if not found then return; end if;  -- already recorded
  update orders set
    amount_paid = amount_paid + p_amount,
    paid        = amount_paid + p_amount >= total,
    history     = history || jsonb_build_array(jsonb_build_object('at', now(),
                    'text', format('Paid $%s online (%s)', to_char(p_amount,'FM999999990.00'), p_kind)))
  where id = p_order;
end $$;
revoke execute on function public.record_payment from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Storage: product photos, logos and customer artwork
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/png','image/jpeg','image/webp','image/svg+xml','image/gif'])
on conflict (id) do nothing;

create policy media_read on storage.objects for select using (bucket_id = 'media');
-- customers upload artwork under uploads/, owners upload under shops/<shop id>/
create policy media_upload_art on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = 'uploads');
create policy media_upload_shop on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = 'shops'
              and public.owns_shop(((storage.foldername(name))[2])::uuid));

-- Live order updates in Business HQ
alter publication supabase_realtime add table public.orders;
