-- Wellness Voucher: who did the work, on a redemption
-- Run in Supabase: Dashboard -> SQL Editor -> New Query -> paste -> Run.
-- Project: vlqvefsaxztitcbhirxt
--
-- RUN sql/voucher_redemptions.sql FIRST. This just adds one column to the table it creates.
-- Idempotent.
--
-- Nullable, same reasoning as payment_method on voucher_issues (sql/voucher_payment_method.sql):
-- a typo here should not be possible to enforce with a fixed list the way payment method is,
-- since stylists come and go, so it stays free text and required at the form instead of the
-- database. No view change needed — the log reads voucher_redemptions directly for the
-- per-visit list, this column isn't aggregated into voucher_log.

alter table public.voucher_redemptions
  add column if not exists stylist text
    check (stylist is null or length(btrim(stylist)) between 2 and 120);

comment on column public.voucher_redemptions.stylist is
  'Who did the work that visit, e.g. Katie Sanchez. Free text: several staff can share one visit and Phorest names change.';

-- check it landed:
--   select redeemed_on, service, stylist, amount_aed from public.voucher_redemptions order by created_at desc limit 5;
