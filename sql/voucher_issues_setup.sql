-- Wellness Voucher: issued cards, the log and the per-branch counter
-- Run in Supabase: Dashboard -> SQL Editor -> New Query -> paste -> Run.
-- Project: vlqvefsaxztitcbhirxt
--
-- THIS IS THE CANONICAL FILE. Idempotent, so re-run it any time.
-- STANDALONE. Unlike notes_setup.sql this file needs no prerequisite: it never calls
-- public.is_admin(), because nothing here is UPDATE-able by anybody and so there is no
-- editor-only path to guard. Run it on its own, in any order.
--
-- WHAT THIS IS FOR
--   Reception issues a Wellness Card at the till. Every card she hands out needs a serial
--   that is unique, traceable back to the buyer, and reconcilable against Phorest later.
--   The serial format is specified in docs/VOUCHER-SERIAL-SPEC.md:
--
--       WV-<tier><type>-<branch>-<seq>[-<n>]        e.g. WV-SM-KCA-0042
--
--   One buyer gets ONE sequence number and every card in her set shares it; only the type
--   letter changes. That is why this schema stores one row per BUYER, not one per card:
--   the cards are derived from the row, so they cannot drift out of step with each other.
--
-- WHY THE SEQUENCE IS PER BRANCH
--   Four branches drawing from one shared counter would let two tills both write 0043 on
--   the same afternoon, with nothing to show an error. A counter per branch makes that
--   collision impossible rather than something to be managed. public.voucher_counters
--   holds one row per branch and issue_voucher() takes a row lock on it, so calls at the
--   same branch serialise and calls at different branches never block each other.
--
-- ACCESS
--
--   ANONYMOUS
--     nothing. Not a read, not a call. This was the opposite until 20 August: anon could
--     call issue_voucher() and read the log, on the reasoning that reception stands at a
--     till and should not have to sign in. Two things were wrong with it. The publishable
--     key is in the page source, the page is served from a PUBLIC repository, so "nobody
--     has the path" was never true; and voucher_issues holds client names, which is the one
--     thing in this pack that cannot sit on an open URL. Reception signs in once per machine
--     with the salon account and the session persists.
--
--   SIGNED IN (info@tararosesalon.com at the till, or Kate)
--     may call issue_voucher() and may read the log. Deliberately NOT granted a direct
--     INSERT on voucher_issues: if the browser could insert rows it could also choose its
--     own seq, and the whole uniqueness guarantee would move from the database into a
--     client that a receptionist can open the console on. The function is the only door.
--
--   ADMIN (kate@tararosesalon.com, and info@tararosesalon.com since 21 August)
--     everything above, plus the accounts that may write voucher_events. That policy
--     lives in voucher_roles_fix.sql, because it needs is_admin() and this file is
--     standalone. Nothing here is UPDATE-able by anybody, see below.
--
--   Grants are additive, so EDITING this file does not take back what anon already holds on
--   a database this ran on before. sql/voucher_lockdown.sql does the revoking.
--
-- WHY NOTHING IS UPDATE-ABLE
--   Both later states, "the referral completed" and "this voucher was voided", are recorded
--   as rows in voucher_events rather than as edits to voucher_issues. Append-only means a
--   serial's history can never be quietly rewritten, and it keeps reception on INSERT only,
--   which is all the till account ever gets. It also fits the rule in the spec: a voided
--   voucher retires its number, and gaps are fine.

-- ---------------------------------------------------------------------------
-- 1. the per-branch counter
-- ---------------------------------------------------------------------------

create table if not exists public.voucher_counters (
  branch      text primary key check (branch in ('SAA','KCA','AQ','MC')),
  next_seq    integer not null default 1 check (next_seq > 0),
  updated_at  timestamptz not null default now()
);

-- Seeded for all four branches so issue_voucher() never has to create a row while holding
-- a lock. SAA and KCA are Abu Dhabi, AQ and MC are Dubai.
insert into public.voucher_counters (branch) values ('SAA'),('KCA'),('AQ'),('MC')
  on conflict (branch) do nothing;

alter table public.voucher_counters enable row level security;
grant select on public.voucher_counters to authenticated;
-- No insert/update/delete grant to anyone. Only issue_voucher() touches this table, and it
-- runs as security definer, which bypasses both the grants and the policy below.

drop policy if exists voucher_counters_select on public.voucher_counters;
create policy voucher_counters_select on public.voucher_counters
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. one row per buyer
-- ---------------------------------------------------------------------------

create table if not exists public.voucher_issues (
  id              uuid primary key default gen_random_uuid(),
  branch          text not null check (branch in ('SAA','KCA','AQ','MC')),
  seq             integer not null check (seq > 0),
  tier            text not null check (tier in ('D','S','V')),

  client_name     text not null check (length(btrim(client_name)) between 2 and 120),
  client_contact  text check (client_contact is null or length(btrim(client_contact)) <= 60),

  purchase_date   date not null,
  -- Denormalised on purpose. The tier's validity is 6/9/12 months today, but if a tier's
  -- terms are ever changed mid-campaign, a card already in a client's hand keeps the expiry
  -- it was printed with. Recomputing from tier + purchase_date would silently rewrite it.
  main_expires_on   date not null,
  friend_expires_on date not null,

  issued_by       text check (issued_by is null or length(btrim(issued_by)) <= 60),
  created_at      timestamptz not null default now(),

  -- The uniqueness guarantee, held by the database rather than by the browser.
  unique (branch, seq)
);

comment on table public.voucher_issues is
  'One row per Wellness Voucher buyer. Card serials are derived: WV-<tier><type>-<branch>-<seq>. See docs/VOUCHER-SERIAL-SPEC.md';
comment on column public.voucher_issues.branch is
  'The branch that ISSUED the card, not where it is valid. The offer is emirate-wide. Saadiyat sales are SAA even though the Stripe payment lands under KCA.';

create index if not exists voucher_issues_branch_seq_idx on public.voucher_issues (branch, seq desc);
create index if not exists voucher_issues_created_idx    on public.voucher_issues (created_at desc);
create index if not exists voucher_issues_name_idx       on public.voucher_issues (lower(client_name));

alter table public.voucher_issues enable row level security;
grant select on public.voucher_issues to authenticated;
-- INSERT is intentionally NOT granted. issue_voucher() is the only way in; see the header.

drop policy if exists voucher_issues_select on public.voucher_issues;
create policy voucher_issues_select on public.voucher_issues
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3. what happened to a voucher afterwards, append-only
-- ---------------------------------------------------------------------------

create table if not exists public.voucher_events (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references public.voucher_issues (id) on delete restrict,
  kind        text not null check (kind in ('referral_completed','voided','note')),

  -- Set on referral_completed. The referral clock starts when the third new client has
  -- visited AND paid (public.referrals_required() in voucher_referrals.sql), which is why
  -- the R card cannot be printed at the till: on the day of sale this date does not exist
  -- yet.
  effective_on  date,
  expires_on    date,

  detail      text check (detail is null or length(btrim(detail)) <= 500),
  recorded_by text check (recorded_by is null or length(btrim(recorded_by)) <= 60),
  created_at  timestamptz not null default now(),

  -- A voucher can only complete its referral once, and can only be voided once.
  -- 'note' is unconstrained so the same voucher can carry several.
  constraint voucher_events_dates check (
    kind <> 'referral_completed' or (effective_on is not null and expires_on is not null)
  )
);

create unique index if not exists voucher_events_one_referral
  on public.voucher_events (issue_id) where kind = 'referral_completed';
create unique index if not exists voucher_events_one_void
  on public.voucher_events (issue_id) where kind = 'voided';
create index if not exists voucher_events_issue_idx on public.voucher_events (issue_id, created_at desc);

alter table public.voucher_events enable row level security;
grant select on public.voucher_events to authenticated;

drop policy if exists voucher_events_select on public.voucher_events;
create policy voucher_events_select on public.voucher_events
  for select to authenticated using (true);

-- NO INSERT POLICY HERE, ON PURPOSE, AND DO NOT PUT ONE BACK.
--
-- This file used to grant anon INSERT and accept any of the three kinds, which meant anyone
-- reaching the public site could mark a voucher VOIDED, and a voided voucher is one
-- reception refuses at the desk. voucher_roles_fix.sql fixed that. But this file describes
-- itself as idempotent and safe to re-run, so re-running it after the fix put the hole
-- straight back and nothing said so. A grant cannot be un-granted by a file that keeps
-- granting it.
--
-- So the write side of voucher_events lives in exactly one place now:
-- sql/voucher_roles_fix.sql, admin only. With no insert policy, RLS refuses every insert,
-- which is the correct state for this file to leave behind on its own.
drop policy if exists voucher_events_insert on public.voucher_events;

-- ---------------------------------------------------------------------------
-- 4. the only door in
-- ---------------------------------------------------------------------------

create or replace function public.issue_voucher(
  p_branch         text,
  p_tier           text,
  p_client_name    text,
  p_purchase_date  date,
  p_client_contact text default null,
  p_issued_by      text default null
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

  -- A future date is almost always a mistyped year, and a serial issued against one cannot
  -- be corrected afterwards because nothing here is UPDATE-able.
  if p_purchase_date > current_date + 1 then
    raise exception 'purchase date % is in the future', p_purchase_date;
  end if;

  -- The campaign's own window (Decision 13 and the campaign dates). Both dates are also in
  -- T.CAMPAIGN in shared/voucher-card.js, which is where the page checks them so a typo
  -- costs a sentence instead of a round trip. This is the check that actually refuses.
  --
  -- The floor is not a launch date, it is a mistyped-year catch: 2025 and 2016 are the
  -- realistic slips at a keyboard and both land outside it.
  if p_purchase_date > date '2026-10-31' then
    raise exception 'purchases closed on 31 October 2026, % is after that', p_purchase_date;
  end if;
  if p_purchase_date < date '2026-01-01' then
    raise exception 'purchase date % is before this campaign, check the year', p_purchase_date;
  end if;

  -- THE ATOMIC BIT. UPDATE takes a row lock on this branch's counter, so two tills at the
  -- same branch queue instead of both reading 43. A different branch locks a different row
  -- and is never delayed. Rolled-back transactions leave a gap in the sequence, which the
  -- spec allows: gaps are fine, a reused number is not.
  update public.voucher_counters
     set next_seq = next_seq + 1, updated_at = now()
   where branch = p_branch
  returning next_seq - 1 into v_seq;

  if v_seq is null then
    raise exception 'no counter row for branch %, re-run sql/voucher_issues_setup.sql', p_branch;
  end if;

  insert into public.voucher_issues (
    branch, seq, tier, client_name, client_contact,
    purchase_date, main_expires_on, friend_expires_on, issued_by
  ) values (
    p_branch, v_seq, p_tier, btrim(p_client_name), nullif(btrim(coalesce(p_client_contact,'')), ''),
    p_purchase_date,
    (p_purchase_date + make_interval(months => v_months))::date,
    (p_purchase_date + make_interval(months => 2))::date,
    nullif(btrim(coalesce(p_issued_by,'')), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.issue_voucher(text,text,text,date,text,text) from public;
revoke all on function public.issue_voucher(text,text,text,date,text,text) from anon;
grant execute on function public.issue_voucher(text,text,text,date,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. the log is NOT defined here, and must not be put back
-- ---------------------------------------------------------------------------
--
-- This file used to define public.voucher_log, and so does voucher_referrals.sql. Two files
-- defining one view is the trap voucher_roles_fix.sql section 3 already describes, and this
-- was the third copy of it, missed when that one was fixed.
--
-- It does not fail quietly, which is the one good thing about it. voucher_referrals.sql adds
-- referral_aed, friends_so_far, friends_needed, is_archived and search_text, and Postgres
-- will not let CREATE OR REPLACE VIEW remove columns, so re-running this file on a live
-- database stopped with:
--
--     ERROR: 42P16: cannot drop columns from view
--
-- The whole script rolls back on that, so nothing else in this file lands either, which is
-- how a schema change and a security change can both silently not happen.
--
-- sql/voucher_referrals.sql is the ONLY file that defines the view, and it drops and
-- recreates rather than replacing, for the same column-order reason. Run it after this one.
-- If the log page says referral tracking is not set up, that is this, and re-running
-- voucher_referrals.sql is the whole fix.
