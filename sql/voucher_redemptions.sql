-- Wellness Voucher: what she's used it on
-- Run in Supabase: Dashboard -> SQL Editor -> New Query -> paste -> Run.
-- Project: vlqvefsaxztitcbhirxt
--
-- RUN THESE FIRST, in this order: supabase_roles_setup.sql, voucher_issues_setup.sql,
-- voucher_roles_fix.sql, voucher_referrals.sql, voucher_payment_method.sql. This file needs
-- public.is_admin(uuid) and the voucher_log view those create. Idempotent.
--
-- WHY THIS EXISTS
--   Phorest has no bulk "vouchers redeemed today" report. The only place a redemption shows
--   is a single client's own Voucher History tab, checked one client at a time. This table is
--   the minus Kate types in herself after she has looked that client up, so the log can show
--   a running balance instead of everyone having to repeat that same lookup.
--
-- ONE ROW PER VISIT, NOT PER SERVICE LINE
--   A visit against the voucher is usually several services at once (foils, toner, pedicure,
--   manicure...), one till line each in Phorest. amount_aed is the visit's total against the
--   card and service is free text, e.g. "Full head foils, toner, pedicure, manicure" — this
--   is Kate's own reconciliation record, not a re-creation of Phorest's line-item table.

-- ---------------------------------------------------------------------------
-- 1. one row per time the card was used
-- ---------------------------------------------------------------------------

create table if not exists public.voucher_redemptions (
  id            uuid primary key default gen_random_uuid(),
  issue_id      uuid not null references public.voucher_issues (id) on delete restrict,

  redeemed_on   date not null,
  service       text not null check (length(btrim(service)) between 2 and 300),
  amount_aed    numeric(10,2) not null check (amount_aed > 0),

  recorded_by   text check (recorded_by is null or length(btrim(recorded_by)) <= 60),
  created_at    timestamptz not null default now()
);

create index if not exists voucher_redemptions_issue_idx
  on public.voucher_redemptions (issue_id, redeemed_on);

alter table public.voucher_redemptions enable row level security;
grant select on public.voucher_redemptions to authenticated;
grant insert, delete on public.voucher_redemptions to authenticated;

drop policy if exists voucher_redemptions_select on public.voucher_redemptions;
create policy voucher_redemptions_select on public.voucher_redemptions
  for select to authenticated using (true);

-- ADMIN ONLY, same reasoning as voucher_referrals_insert: this moves money off the card's
-- balance, reception looks, Kate enters it.
drop policy if exists voucher_redemptions_insert on public.voucher_redemptions;
create policy voucher_redemptions_insert on public.voucher_redemptions
  for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    and exists (select 1 from public.voucher_issues i where i.id = issue_id)
    and redeemed_on <= current_date
  );

drop policy if exists voucher_redemptions_delete on public.voucher_redemptions;
create policy voucher_redemptions_delete on public.voucher_redemptions
  for delete to authenticated using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. voucher_log gains redeemed_aed and remaining_aed
--    Same drop-then-create as voucher_referrals.sql and voucher_payment_method.sql: a
--    replaced view can only ADD columns at the end, and this puts them next to credit_aed.
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
),
redeemed as (
  select issue_id, sum(amount_aed) as redeemed_aed
  from public.voucher_redemptions
  group by issue_id
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
  coalesce(red.redeemed_aed, 0) as redeemed_aed,
  (case i.tier when 'D' then 1150 when 'S' then 3000 when 'V' then 5400 end
     - coalesce(red.redeemed_aed, 0)) as remaining_aed,
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
left join redeemed red           on red.issue_id = i.id
left join public.voucher_events v on v.issue_id = i.id and v.kind = 'voided'
left join public.voucher_events a on a.issue_id = i.id and a.kind = 'archived';

grant select on public.voucher_log to authenticated;

-- ---------------------------------------------------------------------------
-- 3. check it landed
-- ---------------------------------------------------------------------------
--   select main_serial, client_name, credit_aed, redeemed_aed, remaining_aed
--     from public.voucher_log order by created_at desc limit 10;
--
-- Expect redeemed_aed 0 and remaining_aed = credit_aed on everything, since no redemptions
-- are logged yet.
