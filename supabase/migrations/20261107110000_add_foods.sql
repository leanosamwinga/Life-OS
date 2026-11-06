-- Life OS — Phase 2C: scan and add foods
--
--   * Pack and serving sizes (grams) from Open Food Facts, for "half pouch · 60 g" style chips.
--     NULL when unknown (e.g. sold in ml) — never guessed.
--   * remembered: "Remember this food" on manual entry (7e). Forgotten foods still back the
--     meal logs that use them but stay out of search and suggestions.
--   * One own food per barcode per user: completing or correcting a scanned product updates
--     your version instead of piling up duplicates. Your version wins over the global cache.

alter table public.foods
  add column pack_g numeric(7, 1) check (pack_g > 0 and pack_g <= 100000),
  add column serving_g numeric(7, 1) check (serving_g > 0 and serving_g <= 10000),
  add column remembered boolean not null default true;

create unique index foods_user_barcode_key
  on public.foods (user_id, barcode)
  where user_id is not null and barcode is not null;
