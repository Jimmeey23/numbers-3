-- The one "Generate with AI" run now produces a whole tab briefing — narrative, metric notes,
-- section notes, recommendations, risks, outlook and follow-up questions — alongside the
-- signal cards. It is cached under its own kind so a briefing is never confused for signals.
alter table public.atlas_ai_cache drop constraint if exists atlas_ai_cache_kind_check;
alter table public.atlas_ai_cache add constraint atlas_ai_cache_kind_check
  check (kind in ('signals', 'report', 'briefing'));
