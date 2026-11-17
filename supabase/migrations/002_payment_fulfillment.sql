-- Server calls this RPC only after independently verifying a provider transaction.
-- Each payment can be fulfilled at most once, even if an IPN is delivered multiple times.
create or replace function public.fulfill_verified_payment(p_payment uuid,p_provider_reference text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_payment public.payments%rowtype;v_plan public.plans%rowtype;
begin
 select * into v_payment from public.payments where id=p_payment for update;
 if not found then raise exception 'Payment not found'; end if;
 if v_payment.status='verified' then return false;end if;
 if v_payment.status not in ('pending','processing') then raise exception 'Payment cannot be fulfilled';end if;
 if v_payment.provider_reference is distinct from p_provider_reference then raise exception 'Provider reference mismatch';end if;
 if v_payment.purpose='subscription' then
  select * into v_plan from public.plans where key=v_payment.plan_key;
  if not found or v_plan.price_kes<>v_payment.amount_kes or v_plan.price_kes<=0 then raise exception 'Plan amount mismatch'; end if;
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
  if v_payment.credit_quantity is null or v_payment.credit_quantity<=0 or v_payment.credit_kind not in ('text','image') then raise exception 'Invalid topup';end if;
  update public.credit_wallets set topup_balance=topup_balance+v_payment.credit_quantity
   where workspace_id=v_payment.workspace_id and kind=v_payment.credit_kind;
 else raise exception 'Unsupported payment purpose';
 end if;
 update public.payments set status='verified',verified_at=now() where id=p_payment;
 insert into public.invoices(workspace_id,payment_id,invoice_number,total_kes)
 values(v_payment.workspace_id,p_payment,'SO-'||replace(p_payment::text,'-',''),v_payment.amount_kes)
 on conflict(invoice_number) do nothing;
 return true;
end;$$;
revoke execute on function public.fulfill_verified_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.fulfill_verified_payment(uuid,text) to service_role;
