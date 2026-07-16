-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — SCAN-014 Phase 1.1D: canonical key v2 re-key + merge
-- Generated: 2026-07-18
-- Apply in Supabase Dashboard → SQL Editor AFTER reviewing, and BEFORE
-- deploying the matching api/_lib/recognition-memory.js (v2 builder) change —
-- otherwise new v2-keyed scans and old v1 rows coexist as duplicates until
-- this runs. Idempotent — safe to re-run (only key_version=1 rows are
-- processed; a re-run with none left is a no-op).
--
-- Why (Phase 1.1C production shadow finding): the same perfume scanned 3×
-- fragmented into 'v1|beauty|afnan|rare reef' + 'v1|beauty|afnan|rare reef
-- edp' — Stage 2 sometimes emits the concentration suffix. Key v2 strips
-- identity DECORATIONS (fragrance concentrations, sizes, tester) from the
-- folded model part. This migration converts existing v1 rows to v2 and
-- merges rows that collapse to the same v2 key, so learning history is
-- reunified instead of silently orphaned (the version-freeze contract in
-- api/_lib/recognition-memory.js).
--
-- Correctness: v2 is DEFINED as a pure post-processing of the v1 result
-- (decoration strip applied to the already-folded v1 model part). Stored v1
-- keys therefore convert EXACTLY — no re-normalization of raw identity, no
-- drift between JS and SQL. rm_strip_decorations_v2() below is the one
-- sanctioned mirror of stripModelDecorationsV2() in
-- api/_lib/recognition-memory.js; the two are frozen together. Changing the
-- decoration rules means key v3 + a new migration, never an edit here.
--
-- What this migration does:
--   PART 1 — rm_strip_decorations_v2(text): SQL mirror of the v2 strip
--   PART 2 — re-key every key_version=1 row to v2; rows collapsing to an
--            existing v2 key are MERGED: samples re-pointed to the survivor
--            (append-only history preserved — this is a memory_id re-point,
--            not a rewrite), display/candidate refs coalesced, duplicate row
--            deleted, survivor recomputed from the unified ledger.
--   Fail-safes: malformed keys, empty-after-strip, and model==brand results
--   are SKIPPED with a NOTICE and stay at v1 (inert but never corrupted).
--
-- Shadow-mode constraints preserved: no trust logic, pricing, retrieval,
-- confidence, or UI change. Aggregates on merged rows are recomputed from
-- samples — the same numbers the unified history always implied.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — rm_strip_decorations_v2: mirror of stripModelDecorationsV2 (JS)
-- ══════════════════════════════════════════════════════════════════════════════
-- Input is a FOLDED v1 model part (lowercase, single-spaced, alnum tokens).
-- Iteratively strips trailing: concentration phrases ('eau de parfum' as a
-- unit), decoration tokens (edp/edt/edc/parfum/extrait/cologne/tester), and
-- sizes ('100 ml', '100ml', '3 4 oz' — the fold of '3.4oz' —, 'fl oz').
-- Bare numbers are consumed only as part of a size ('no 5' survives).
-- Never returns empty — falls back to the input unchanged.

CREATE OR REPLACE FUNCTION public.rm_strip_decorations_v2(p_model text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_out    text := p_model;
  v_next   text;
  v_tmp    text;
  v_tokens text[];
  v_n      int;
  v_j      int;
  v_saw_number boolean;
BEGIN
  IF v_out IS NULL OR v_out = '' THEN
    RETURN p_model;
  END IF;

  LOOP
    v_next := v_out;

    -- Multi-token concentration phrases (accept only non-empty results).
    v_tmp := trim(regexp_replace(v_next, '\s+eau de (parfum|toilette|cologne)$', ''));
    IF v_tmp <> '' AND v_tmp <> v_next THEN v_next := v_tmp; END IF;
    v_tmp := trim(regexp_replace(v_next, '\s+eau fraiche$', ''));
    IF v_tmp <> '' AND v_tmp <> v_next THEN v_next := v_tmp; END IF;
    v_tmp := trim(regexp_replace(v_next, '\s+extrait de parfum$', ''));
    IF v_tmp <> '' AND v_tmp <> v_next THEN v_next := v_tmp; END IF;

    v_tokens := string_to_array(v_next, ' ');

    -- Trailing single-token decorations.
    WHILE array_length(v_tokens, 1) > 1
      AND v_tokens[array_length(v_tokens, 1)]
          IN ('edp', 'edt', 'edc', 'parfum', 'extrait', 'cologne', 'tester')
    LOOP
      v_tokens := v_tokens[1:array_length(v_tokens, 1) - 1];
    END LOOP;

    -- Trailing sizes.
    LOOP
      v_n := array_length(v_tokens, 1);
      EXIT WHEN v_n IS NULL OR v_n <= 1;
      IF v_tokens[v_n] ~ '^(ml|g|l|oz)$' THEN
        v_j := v_n - 1;
        IF v_tokens[v_n] = 'oz' AND v_tokens[v_j] = 'fl' THEN
          v_j := v_j - 1;
        END IF;
        v_saw_number := false;
        WHILE v_j >= 1 AND v_tokens[v_j] ~ '^\d+$' LOOP
          v_j := v_j - 1;
          v_saw_number := true;
        END LOOP;
        IF v_saw_number AND v_j >= 1 THEN
          v_tokens := v_tokens[1:v_j];
        ELSE
          EXIT; -- unit with no number ("solid gold g") — not a size
        END IF;
      ELSIF v_tokens[v_n] ~ '^\d+(ml|g|l|oz)$' THEN
        v_tokens := v_tokens[1:v_n - 1];
      ELSE
        EXIT;
      END IF;
    END LOOP;

    v_next := array_to_string(v_tokens, ' ');
    EXIT WHEN v_next = v_out;
    v_out := v_next;
  END LOOP;

  IF v_out = '' THEN
    RETURN p_model;
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.rm_strip_decorations_v2(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rm_strip_decorations_v2(text) TO service_role;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — re-key v1 rows to v2, merging rows that collapse to one identity
-- ══════════════════════════════════════════════════════════════════════════════
-- Survivor policy: rows are processed oldest-first, so the earliest-created
-- row under a collapsing identity keeps its id (and its origin — the samples
-- carry the complete history either way).

DO $$
DECLARE
  r          RECORD;
  v_parts    text[];
  v_model2   text;
  v_new_key  text;
  v_survivor uuid;
BEGIN
  FOR r IN
    SELECT * FROM recognition_memory
    WHERE key_version = 1
    ORDER BY created_at ASC, id ASC
  LOOP
    v_parts := string_to_array(r.canonical_key, '|');
    IF array_length(v_parts, 1) <> 4 OR v_parts[1] <> 'v1' THEN
      RAISE NOTICE '[rekey-v2] skip malformed key: %', r.canonical_key;
      CONTINUE;
    END IF;

    v_model2 := rm_strip_decorations_v2(v_parts[4]);
    -- Fail-safes mirroring the JS builder: empty model and model==brand are
    -- degenerate identities — leave those rows at v1 (inert, never matched,
    -- never corrupted).
    IF v_model2 IS NULL OR v_model2 = '' OR v_model2 = v_parts[3] THEN
      RAISE NOTICE '[rekey-v2] skip fail-safe: %', r.canonical_key;
      CONTINUE;
    END IF;

    v_new_key := 'v2|' || v_parts[2] || '|' || v_parts[3] || '|' || v_model2;

    SELECT id INTO v_survivor FROM recognition_memory WHERE canonical_key = v_new_key;

    IF v_survivor IS NULL THEN
      UPDATE recognition_memory
      SET canonical_key = v_new_key, key_version = 2
      WHERE id = r.id;
      RAISE NOTICE '[rekey-v2] rekeyed: % -> %', r.canonical_key, v_new_key;
    ELSE
      -- MERGE into the survivor: unify the ledger first, then the row.
      UPDATE recognition_memory_samples
      SET memory_id = v_survivor
      WHERE memory_id = r.id;

      UPDATE recognition_memory s
      SET display_name        = COALESCE(s.display_name,        r.display_name),
          display_name_hebrew = COALESCE(s.display_name_hebrew, r.display_name_hebrew),
          subcategory         = COALESCE(s.subcategory,         r.subcategory),
          candidate_id        = COALESCE(s.candidate_id,        r.candidate_id),
          promoted_product_id = COALESCE(s.promoted_product_id, r.promoted_product_id),
          first_seen          = LEAST(s.first_seen, r.first_seen)
      WHERE s.id = v_survivor;

      DELETE FROM recognition_memory WHERE id = r.id;
      PERFORM memory_recompute(v_survivor);
      RAISE NOTICE '[rekey-v2] merged: % -> % (survivor %)', r.canonical_key, v_new_key, v_survivor;
    END IF;
  END LOOP;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — Verify (run manually after applying)
-- ══════════════════════════════════════════════════════════════════════════════
-- -- No v1 rows should remain (except NOTICE'd fail-safe skips):
-- SELECT canonical_key FROM recognition_memory WHERE key_version = 1;
-- -- The production pair must now be ONE row holding ALL its samples:
-- SELECT m.canonical_key, m.origin, derive_memory_state(m.*) AS state,
--        (SELECT COUNT(*) FROM recognition_memory_samples s
--          WHERE s.memory_id = m.id AND s.sample_type = 'ai_observation') AS observations
-- FROM recognition_memory m WHERE m.canonical_key LIKE 'v2|beauty|afnan|%';
-- -- Spot-check the mirror:
-- SELECT rm_strip_decorations_v2('rare reef edp');        -- 'rare reef'
-- SELECT rm_strip_decorations_v2('no 5');                 -- 'no 5' (unchanged)
-- SELECT rm_strip_decorations_v2('sauvage elixir');       -- 'sauvage elixir' (unchanged)
