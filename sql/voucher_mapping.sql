-- Wellness Voucher: the Confidence Mapping gate on the Home Ritual Kit card
-- Run in Supabase: Dashboard -> SQL Editor -> New Query -> paste -> Run.
-- Project: vlqvefsaxztitcbhirxt
--
-- RETIRED FROM THE PAGES, 25 AUGUST. Belle's call from the desk: the kit card now ships in
-- the client's file from day one and carries the mapping condition itself, on its back and
-- on the cover, so the tickbox is gone from the log and nothing gates on mapping_confirmed
-- any more. This file stays because databases it ran on carry the column and the event kind,
-- and the rows written while the gate ran are the record of it. Do not run it on a fresh
-- database, and do not rebuild the tickbox from it without reading the K card comment in
-- shared/voucher-card.js first.
--
-- RUN ORDER. This one goes LAST, after voucher_referrals.sql, because it redefines
-- public.voucher_log and that view has to be built on top of the referral columns rather
-- than instead of them:
--   supabase_roles_setup -> voucher_issues_setup -> voucher_roles_fix -> voucher_referrals
--   -> voucher_mapping -> voucher_lockdown
--
-- WHAT THIS IS FOR
--   The kit cannot be issued until the client has done her Confidence Mapping: the kit is
--   matched to her there. That has been policy since the automations were written, and until
--   now it lived only in an email sequence, which is to say nowhere the person handing the
--   card over would see it. The card itself now says so and carries the QR, but a sentence on
--   a card does not stop the card being sent.
--
--   So the log gets a tickbox, and the tickbox writes a row here. Until it exists, the kit
--   card cannot be saved on its own and is left out of her file. Whoever ticks it is saying
--   they have seen her answers in the info@ inbox, which is where the quiz delivers them.
--
-- WHY AN EVENT AND NOT A COLUMN ON voucher_issues
--   Same reason as the referral and the void. voucher_issues is append-only and nothing on it
--   is UPDATE-able by anybody, so a later state is a row in voucher_events or it is nothing.
--   It also means the answer to "who let this kit out, and when" is recorded rather than
--   inferred, which a boolean column could never tell you.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   It does not check that a mapping actually happened. Nothing here can: the answers land in
--   an inbox, not in this database. This records a HUMAN saying they looked. That is the same
--   standing as the referral count, where a receptionist confirms a friend visited and paid.

-- ---------------------------------------------------------------------------
-- 1. 'mapping_confirmed' becomes a kind
-- ---------------------------------------------------------------------------
-- The full list is restated rather than appended to, because a check constraint cannot be
-- extended in place. Keep this in step with voucher_roles_fix.sql, which holds the same list
-- in its insert policy: the two disagreeing is how a kind becomes writable but not storable.

alter table public.voucher_events drop constraint if exists voucher_events_kind_check;
alter table public.voucher_events
  add constraint voucher_events_kind_check
  check (kind in ('referral_completed','voided','archived','mapping_confirmed','note'));

-- One confirmation per voucher, same guard as the referral, the void and the archive.
-- Ticking twice is a double-click, not a second mapping.
create unique index if not exists voucher_events_one_mapping
  on public.voucher_events (issue_id) where kind = 'mapping_confirmed';

-- ---------------------------------------------------------------------------
-- 2. let an admin write it
-- ---------------------------------------------------------------------------
-- Replaces the policy from voucher_roles_fix.sql with the same policy plus the new kind.
-- Note what is still NOT here: no email is named. Who is an admin is a row in
-- public.profiles, so adding an editor stays sql/supabase_roles_setup.sql.

drop policy if exists voucher_events_insert       on public.voucher_events;
drop policy if exists voucher_events_insert_admin on public.voucher_events;

create policy voucher_events_insert_admin on public.voucher_events
  for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    and kind in ('referral_completed','voided','archived','mapping_confirmed','note')
    and exists (select 1 from public.voucher_issues i where i.id = issue_id)
  );

-- ---------------------------------------------------------------------------
-- 3. put it on the log view
-- ---------------------------------------------------------------------------
-- REBUILT IN FULL, not altered. public.voucher_log is defined in voucher_referrals.sql and
-- the comment there is emphatic about why two files must not both own it: whichever ran last
-- used to win, and running the wrong one second silently dropped the referral columns with no
-- error anywhere. This file now owns the view, it carries every column voucher_referrals.sql
-- produced, and the three added at the end are the only difference. If the view changes
-- again, it changes HERE, and voucher_referrals.sql keeps its version for the run order to
-- work on a fresh database.

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

  -- The three new ones. mapping_confirmed is what the page gates the kit card on; the other
  -- two are so the tickbox can say who ticked it and when, rather than just sitting ticked.
  (m.id is not null)   as mapping_confirmed,
  m.created_at         as mapping_confirmed_at,
  m.recorded_by        as mapping_confirmed_by,
  i.issued_by,
  i.created_at,
  lower(i.client_name || ' ' ||
        'WV-' || i.tier || 'M-' || i.branch || '-' || lpad(i.seq::text, 4, '0') || ' ' ||
        coalesce(i.issued_by, '') || ' ' || i.branch) as search_text
from public.voucher_issues i
left join counted c              on c.issue_id = i.id
left join public.voucher_events v on v.issue_id = i.id and v.kind = 'voided'
left join public.voucher_events a on a.issue_id = i.id and a.kind = 'archived'
left join public.voucher_events m on m.issue_id = i.id and m.kind = 'mapping_confirmed';

grant select on public.voucher_log to authenticated;

-- ---------------------------------------------------------------------------
-- 4. check it landed
-- ---------------------------------------------------------------------------
--   select main_serial, client_name, friends_so_far, friends_needed, referral_earned,
--          mapping_confirmed, mapping_confirmed_by, mapping_confirmed_at
--     from public.voucher_log order by created_at desc limit 5;
--
-- friends_so_far and friends_needed must still be there. If they are not, this file was run
-- before voucher_referrals.sql and referrals_required() did not exist yet: run that one, then
-- this one again.
