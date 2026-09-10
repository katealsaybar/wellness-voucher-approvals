-- Wellness Voucher: how she paid
-- Run in Supabase: Dashboard -> SQL Editor -> New Query -> paste -> Run.
-- Project: vlqvefsaxztitcbhirxt
--
-- Adds payment_method to voucher_issues (Stripe / Salon Payment / Tabby, seen on the till so
-- far), backfills the 8 rows issued before this column existed from Kate's own reconciliation
-- sheet, and puts both payment_method and the amount she actually placed (paid_aed, as opposed
-- to credit_aed which is what the voucher is WORTH) onto public.voucher_log so the log can show
-- both. Idempotent: re-running this file after it has already run changes nothing.
--
-- WHY A CHECK CONSTRAINT WITH ONLY THREE VALUES
--   Same reasoning as tier and branch elsewhere in this pack: a typo at the till ('stripe',
--   'stripee') should fail loudly rather than sit in the log as a fourth silent method. If a
--   new payment method is added later this line is where it gets taught.

-- ---------------------------------------------------------------------------
-- 1. the column
-- ---------------------------------------------------------------------------

alter table public.voucher_issues
  add column if not exists payment_method text
    check (payment_method in ('Stripe','Salon Payment','Tabby'));

comment on column public.voucher_issues.payment_method is
  'How she actually paid at the till: Stripe, Salon Payment (card/cash at the desk) or Tabby. Not printed on any card, log only.';

-- ---------------------------------------------------------------------------
-- 2. backfill the 8 rows issued before this column existed
--    (source: Kate's reconciliation sheet, 21 Aug - 6 Sep 2026)
--    Matched on (branch, seq), which is the table's own unique key, with client_name
--    checked in the WHERE clause as a second key so a mismatched row updates nothing.
-- ---------------------------------------------------------------------------

update public.voucher_issues set payment_method = 'Stripe'
  where branch = 'KCA' and seq = 6  and client_name ilike 'Isabelle Siaud%';
update public.voucher_issues set payment_method = 'Stripe'
  where branch = 'KCA' and seq = 4  and client_name ilike 'Irina Chi%';
update public.voucher_issues set payment_method = 'Stripe'
  where branch = 'SAA' and seq = 3  and client_name ilike 'Kali Bhandari%';
update public.voucher_issues set payment_method = 'Stripe'
  where branch = 'KCA' and seq = 9  and client_name ilike 'Raqad Alhashmi%';
update public.voucher_issues set payment_method = 'Salon Payment'
  where branch = 'KCA' and seq = 10 and client_name ilike 'Ella Klohnova%';
update public.voucher_issues set payment_method = 'Stripe'
  where branch = 'SAA' and seq = 4  and client_name ilike 'Amelia Hemphill%';
update public.voucher_issues set payment_method = 'Tabby'
  where branch = 'KCA' and seq = 12 and client_name ilike 'Sengul Saval%';
update public.voucher_issues set payment_method = 'Stripe'
  where branch = 'SAA' and seq = 5  and client_name ilike 'Veronika Pereseina%';

-- ---------------------------------------------------------------------------
-- 3. issue_voucher() gains a 7th parameter
--    A new parameter changes the function's signature, so CREATE OR REPLACE would leave the
--    old 6-argument version sitting alongside this one rather than replacing it. Dropped
--    first, same reasoning voucher_referrals.sql gives for the view below.
-- ---------------------------------------------------------------------------

drop function if exists public.issue_voucher(text,text,text,date,text,text);

create function public.issue_voucher(
  p_branch         text,
  p_tier           text,
  p_client_name    text,
  p_purchase_date  date,
  p_client_contact text default null,
  p_issued_by      text default null,
  p_payment_method text default null
) returns public.voucher_issues
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq    integer;
  v_months integer;
  v_row    public.voucher_issues;
begin
  if p_branch is null or p_branch not in ('SAA','KCA','AQ','MC') then
    raise exception 'unknown branch %, expected SAA, KCA, AQ or MC', p_branch;
  end if;

  v_months := case p_tier
                when 'D' then 6
                when 'S' then 9
                when 'V' then 12
              end;
  if v_months is null then
    raise exception 'unknown tier %, expected D, S or V', p_tier;
  end if;

  if p_client_name is null or length(btrim(p_client_name)) < 2 then
    raise exception 'a client name is required';
  end if;

  if p_purchase_date is null then
    raise exception 'a purchase date is required';
  end if;

  if p_purchase_date > current_date + 1 then
    raise exception 'purchase date % is in the future', p_purchase_date;
  end if;

  if p_purchase_date > date '2026-10-31' then
    raise exception 'purchases closed on 31 October 2026, % is after that', p_purchase_date;
  end if;
  if p_purchase_date < date '2026-01-01' then
    raise exception 'purchase date % is before this campaign, check the year', p_purchase_date;
  end if;

  if p_payment_method is not null and p_payment_method not in ('Stripe','Salon Payment','Tabby') then
    raise exception 'unknown payment method %, expected Stripe, Salon Payment or Tabby', p_payment_method;
  end if;

  update public.voucher_counters
     set next_seq = next_seq + 1, updated_at = now()
   where branch = p_branch
  returning next_seq - 1 into v_seq;

  if v_seq is null then
    raise exception 'no counter row for branch %, re-run sql/voucher_issues_setup.sql', p_branch;
  end if;

  insert into public.voucher_issues (
    branch, seq, tier, client_name, client_contact,
    purchase_date, main_expires_on, friend_expires_on, issued_by, payment_method
  ) values (
    p_branch, v_seq, p_tier, btrim(p_client_name), nullif(btrim(coalesce(p_client_contact,'')), ''),
    p_purchase_date,
    (p_purchase_date + make_interval(months => v_months))::date,
    (p_purchase_date + make_interval(months => 2))::date,
    nullif(btrim(coalesce(p_issued_by,'')), ''),
    p_payment_method
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.issue_voucher(text,text,text,date,text,text,text) from public;
revoke all on function public.issue_voucher(text,text,text,date,text,text,text) from anon;
grant execute on function public.issue_voucher(text,text,text,date,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. voucher_log gains payment_method and paid_aed
--    Same drop-then-create as voucher_referrals.sql: a replaced view can only ADD columns at
--    the end, and this puts them next to credit_aed for anyone reading the SQL, so drop first.
--    paid_aed is what she PLACED (the ticket price); credit_aed is what the card is WORTH. The
--    two match Kate's own reconciliation sheet and shared/voucher-card.js TIERS.places.
-- ---------------------------------------------------------------------------

drop view if exists public.voucher_log;
create view public.voucher_log as
with counted as (
  select
    r.issue_id,
    count(*) as friends_so_far,
    (array_agg(r.visited_on order by r.visited_on))[public.referrals_required()] as nth_visit
  from public.voucher_referrals r
  group by r.issue_id
)
select
  i.id,
  'WV-' || i.tier || 'M-' || i.branch || '-' || lpad(i.seq::text, 4, '0') as main_serial,
  i.branch,
  case when i.branch in ('SAA','KCA') then 'Abu Dhabi' else 'Dubai' end as emirate,
  i.seq,
  i.tier,
  case i.tier when 'D' then 'Dip Your Toes'
              when 'S' then 'Season of You'
              when 'V' then 'All-In VIP Year' end as tier_name,
  case i.tier when 'D' then 1000 when 'S' then 2500 when 'V' then 4500 end as paid_aed,
  i.payment_method,
  case i.tier when 'D' then 1150 when 'S' then 3000 when 'V' then 5400 end as credit_aed,
  case i.tier when 'D' then 1    when 'S' then 3    when 'V' then 5    end as friend_cards,
  case i.tier when 'D' then 100  when 'S' then 150  when 'V' then 200  end as referral_aed,
  i.client_name,
  i.client_contact,
  i.purchase_date,
  i.main_expires_on,
  i.friend_expires_on,

  coalesce(c.friends_so_far, 0)   as friends_so_far,
  public.referrals_required()     as friends_needed,
  c.nth_visit                     as referral_earned_on,
  case when c.nth_visit is not null
       then (c.nth_visit + make_interval(months => 2))::date end as referral_expires_on,
  (c.nth_visit is not null)       as referral_earned,

  (v.id is not null)   as is_voided,
  v.detail             as void_reason,
  (a.id is not null)   as is_archived,
  i.issued_by,
  i.created_at,
  lower(i.client_name || ' ' ||
        'WV-' || i.tier || 'M-' || i.branch || '-' || lpad(i.seq::text, 4, '0') || ' ' ||
        coalesce(i.issued_by, '') || ' ' || i.branch || ' ' ||
        coalesce(i.payment_method, '')) as search_text
from public.voucher_issues i
left join counted c              on c.issue_id = i.id
left join public.voucher_events v on v.issue_id = i.id and v.kind = 'voided'
left join public.voucher_events a on a.issue_id = i.id and a.kind = 'archived';

grant select on public.voucher_log to authenticated;

-- ---------------------------------------------------------------------------
-- 5. check it landed
-- ---------------------------------------------------------------------------
--   select main_serial, client_name, paid_aed, payment_method, credit_aed
--     from public.voucher_log order by created_at desc limit 10;
--
-- Expect all 8 rows issued before today to show a payment_method, and paid_aed matching
-- 1000 / 2500 / 4500 by tier.
