-- Tab intelligence is a third kind of cached AI artefact: one generation fills the briefing,
-- KPI notes, table reads, recommendations, outlook and the insight-rail signals for a tab.
alter table public.atlas_ai_cache drop constraint if exists atlas_ai_cache_kind_check;
alter table public.atlas_ai_cache
  add constraint atlas_ai_cache_kind_check check (kind in ('signals', 'report', 'intelligence'));
