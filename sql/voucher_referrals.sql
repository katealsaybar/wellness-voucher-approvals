-- Wellness Voucher: counting the friends, so the referral credit unlocks itself
-- Run in Supabase: Dashboard -> SQL Editor -> New Query -> paste -> Run.
-- Project: vlqvefsaxztitcbhirxt
--
-- RUN THESE FIRST, in this order: supabase_roles_setup.sql, voucher_issues_setup.sql,
-- voucher_roles_fix.sql. This file needs public.is_admin(uuid) from the first one.
-- Idempotent.
--
-- THE RULE, and where it comes from
--   Kate settled it on 19 August and it is written in three places in the pack: the referral
--   credit is earned when "the third new client has visited and paid, not booked", and it
--   then runs two months from that date on its own clock.
--
--   Note the public Terms do NOT say three. They say "the required number of new clients".
--   The team knows the number and the client does not, which is the shape of a dispute at
--   the desk. That is a copy fix, not a schema one, but it belongs next to this rule.
--
-- THREE ON EVERY TIER, INCLUDING DIP YOUR TOES
--   Checked against the pack rather than reasoned about here, because the pack settles it in
--   five places: the reception and core-team cheat sheets, the floor memo,
--   docs/VOUCHER-SERIAL-SPEC.md, and the decision table in index.html, which records it as
--   Kate, 19 August. Three.
--
--   The consequence is worth writing down so nobody later reads it as a fault. Dip Your Toes
--   ships ONE gift card and still needs three friends, so two of her three arrive holding
--   nothing that ties them to her, and are recorded with gift_serial null. That is why
--   gift_serial is nullable and why the log's own field says "if she had one". It is not a
--   miscount and it must not be made required. What still holds the count together on that
--   tier is voucher_referrals_no_double_count, which stops the same friend being entered
--   twice to reach three.
--
--   Still undefined anywhere: what makes a client NEW. New to that branch or new to Tara
--   Rose, and whether someone who last came three years ago counts. This schema records who
--   was counted and who said so, so that when the rule is written down the history can be
--   read against it. It deliberately does not invent the rule.
--
-- WHY COUNT RATHER THAN RECORD A COMPLETION
--   The first version had reception record a 'referral_completed' event by hand once she
--   judged the third friend had qualified. That stores a conclusion, so a miscount is
--   invisible afterwards and cannot be undone without an argument about what was counted.
--   Storing the friends instead makes the conclusion derivable: the third row IS the
--   completion, its date IS the start of the clock, and a friend added in error can be
--   walked back to a visible list of three names.

-- ---------------------------------------------------------------------------
-- 1. the rule, in one place
-- ---------------------------------------------------------------------------

-- A function rather than a literal 3 scattered through the view, so if the number ever
-- changes there is exactly one line to change and every historic row is recomputed with it.
--
-- The view depends on this function, so the view has to go first. It is recreated in section
-- 3 of this same file, which is the only place it is ever defined.
--
-- BOTH signatures are dropped. A per-tier referrals_required(text) existed briefly, on the
-- reasoning in the header, before the pack was checked. If it was ever run, this removes it,
-- so the file lands the same way whichever state the database is in.
drop view if exists public.voucher_log;
drop function if exists public.referrals_required(text);
drop function if exists public.referrals_required();

create or replace function public.referrals_required()
returns integer language sql immutable as $$ select 3 $$;

-- ---------------------------------------------------------------------------
-- 2. one row per friend who came in and paid
-- ---------------------------------------------------------------------------

create table if not exists public.voucher_referrals (
  id            uuid primary key default gen_random_uuid(),
  issue_id      uuid not null references public.voucher_issues (id) on delete restrict,

  friend_name   text not null check (length(btrim(friend_name)) between 2 and 120),

  -- Set when she arrived holding one of the buyer's AED 100 cards. That card already carries
  -- the buyer's sequence, so it identifies the referrer with nothing asked of anybody. This
  -- is the whole reason the gift card and the referral are the same trail.
  gift_serial   text check (gift_serial is null or gift_serial ~ '^WV-[DSV]G-(SAA|KCA|AQ|MC)-[0-9]{4}-[1-5]$'),

  -- The day she VISITED AND PAID. Not the day she booked, and not the day she was added
  -- here. The clock in the pack starts from this date, so it is entered, never defaulted.
  visited_on    date not null,

  recorded_by   text check (recorded_by is null or length(btrim(recorded_by)) <= 60),
  note          text check (note is null or length(btrim(note)) <= 300),
  created_at    timestamptz not null default now()
);

-- The same friend cannot be counted twice against one buyer. Names are a weak key, but
-- double-counting one friend to reach three is the likely error and this catches it. A real
-- second friend with the same name is rare enough to be worth a note in the note column.
create unique index if not exists voucher_referrals_no_double_count
  on public.voucher_referrals (issue_id, lower(btrim(friend_name)));

-- A given gift card can only bring its friend in once.
create unique index if not exists voucher_referrals_one_per_gift_card
  on public.voucher_referrals (gift_serial) where gift_serial is not null;

create index if not exists voucher_referrals_issue_idx
  on public.voucher_referrals (issue_id, visited_on);

alter table public.voucher_referrals enable row level security;
grant select on public.voucher_referrals to authenticated;
grant insert, delete on public.voucher_referrals to authenticated;

drop policy if exists voucher_referrals_select on public.voucher_referrals;
create policy voucher_referrals_select on public.voucher_referrals
  for select to authenticated using (true);

-- ADMIN ONLY, matching the instruction that salon staff look and Kate is the only one who
-- changes anything. Worth knowing what that costs: a referral is earned at the desk, in
-- front of the client, and reception cannot record it. Every one waits for Kate.
--
-- If reception should record them herself, drop the is_admin() line and leave the rest.
-- That is the whole change. Think about it first: this table awards money. The till is no
-- longer open to anyone with the path, but the salon account is shared, so "signed in" and
-- "a named person" are still not the same thing.
drop policy if exists voucher_referrals_insert on public.voucher_referrals;
create policy voucher_referrals_insert on public.voucher_referrals
  for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    and exists (select 1 from public.voucher_issues i where i.id = issue_id)
    and visited_on <= current_date
  );

-- Delete rather than an append-only correction, because a miscounted friend is a typo, not
-- a history worth keeping, and three names is small enough to just be right.
drop policy if exists voucher_referrals_delete on public.voucher_referrals;
create policy voucher_referrals_delete on public.voucher_referrals
  for delete to authenticated using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. the view, with the referral state derived
-- ---------------------------------------------------------------------------

-- DROP then CREATE, not CREATE OR REPLACE. Postgres will only let a replaced view ADD
-- columns at the END: inserting one in the middle, or reordering, fails with
-- "cannot change name of view column". This file puts referral_aed before client_name, so
-- replacing in place is refused. Nothing in the database depends on this view, the pages
-- query it at runtime, so dropping it costs nothing.
drop view if exists public.voucher_log;
create view public.voucher_log as
with counted as (
  select
    r.issue_id,
    count(*) as friends_so_far,
    -- The date the Nth friend came in, which is the day the clock starts. NULL until the
    -- target is reached, which is exactly the condition for "the R card cannot be printed".
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
  case i.tier when 'D' then 1150 when 'S' then 3000 when 'V' then 5400 end as credit_aed,
  case i.tier when 'D' then 1    when 'S' then 3    when 'V' then 5    end as friend_cards,
  -- Superseded by sql/voucher_redemptions.sql, which is what's actually live. Kept in step
  -- with it anyway: flat 50 since 18 Sep, see the note there.
  50 as referral_aed,
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
        coalesce(i.issued_by, '') || ' ' || i.branch) as search_text
from public.voucher_issues i
left join counted c              on c.issue_id = i.id
left join public.voucher_events v on v.issue_id = i.id and v.kind = 'voided'
left join public.voucher_events a on a.issue_id = i.id and a.kind = 'archived';

grant select on public.voucher_log to authenticated;

-- ---------------------------------------------------------------------------
-- 4. check it landed
-- ---------------------------------------------------------------------------
--   select main_serial, client_name, friends_so_far, friends_needed,
--          referral_earned, referral_earned_on, referral_expires_on
--     from public.voucher_log order by created_at desc limit 5;
--
-- Expect friends_so_far 0, friends_needed 3, referral_earned false on everything so far.
