-- Administrative suspension, transactional credit packs, and processing projects.
alter table public.profiles add column if not exists status text not null default 'active' check(status in ('active','suspended'));
create table if not exists public.credit_packs(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('text','image')),
 units integer not null check(units>0),price_kes integer not null check(price_kes>0),
 enabled boolean not null default true, created_at timestamptz not null default now(),
 unique(kind,units)
);
insert into public.credit_packs(kind,units,price_kes) values('text',100,99),('image',10,199)
on conflict(kind,units) do nothing;
alter table public.credit_packs enable row level security;
create policy packs_read on public.credit_packs for select to authenticated using(enabled);
alter table public.payments add column if not exists credit_pack_id uuid references public.credit_packs(id);
alter table public.clip_projects add column if not exists created_by uuid references auth.users(id);
alter table public.clip_projects add column if not exists credit_tx_id uuid references public.credit_transactions(id);
alter table public.clip_projects add column if not exists output_media_id uuid references public.media_assets(id);
alter table public.clip_projects add column if not exists error_message text;
alter table public.clip_projects add column if not exists updated_at timestamptz not null default now();
create index if not exists clip_projects_status_idx on public.clip_projects(status);

-- A payment's total is matched with the server-owned pack at fulfillment time.
create or replace function public.fulfill_verified_payment(p_payment uuid,p_provider_reference text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_payment public.payments%rowtype;v_plan public.plans%rowtype;v_pack public.credit_packs%rowtype;
begin
 select * into v_payment from public.payments where id=p_payment for update;
 if not found then raise exception 'Payment not found';end if;
 if v_payment.status='verified' then return false;end if;
 if v_payment.status not in ('pending','processing') then raise exception 'Payment cannot be fulfilled';end if;
 if v_payment.provider_reference is distinct from p_provider_reference then raise exception 'Provider reference mismatch';end if;
 if v_payment.purpose='subscription' then
  select * into v_plan from public.plans where key=v_payment.plan_key;
  if not found or v_plan.price_kes<>v_payment.amount_kes or v_plan.price_kes<=0 then raise exception 'Plan amount mismatch';end if;
  insert into public.subscriptions(workspace_id,plan_key,status,current_period_start,current_period_end)
  values(v_payment.workspace_id,v_plan.key,'active',now(),now()+interval '1 month')
  on conflict(workspace_id) do update set plan_key=excluded.plan_key,status='active',
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,updated_at=now();
  update public.credit_wallets set monthly_balance=case kind
   when 'text' then v_plan.text_credits when 'image' then v_plan.image_credits
   when 'clips' then v_plan.clips when 'publishing' then v_plan.publishing_jobs
   when 'old_video' then v_plan.old_videos else monthly_balance end
   where workspace_id=v_payment.workspace_id;
 elsif v_payment.purpose='topup' then
  select * into v_pack from public.credit_packs where id=v_payment.credit_pack_id;
  if not found or not v_pack.enabled or v_pack.price_kes<>v_payment.amount_kes
    or v_pack.units<>v_payment.credit_quantity or v_pack.kind<>v_payment.credit_kind then
   raise exception 'Credit pack mismatch';
  end if;
  update public.credit_wallets set topup_balance=topup_balance+v_pack.units
   where workspace_id=v_payment.workspace_id and kind=v_pack.kind;
 else raise exception 'Unsupported payment purpose';end if;
 update public.payments set status='verified',verified_at=now() where id=p_payment;
 insert into public.invoices(workspace_id,payment_id,invoice_number,total_kes)
 values(v_payment.workspace_id,p_payment,'SO-'||replace(p_payment::text,'-',''),v_payment.amount_kes)
 on conflict(invoice_number) do nothing;
 return true;
end;$$;
revoke execute on function public.fulfill_verified_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.fulfill_verified_payment(uuid,text) to service_role;
