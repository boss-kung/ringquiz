-- =============================================================================
-- V1 Question Data Entry Template
-- Fill in one block per question. Run in Supabase Studio SQL editor.
-- Upload image and mask files to their buckets BEFORE running this SQL.
--
-- File naming convention:
--   question-images/{question_id}.jpg  (or .png)
--   question-masks/{question_id}_mask.png
--
-- Mask format: PNG, RGBA.
--   White + opaque, or vivid yellow + opaque = correct zone.
--   Black or transparent = incorrect zone.
--
-- image_width and image_height should match the actual pixel dimensions.
-- mask_width and mask_height must equal image_width and image_height.
-- =============================================================================

-- ── QUESTION 1 ────────────────────────────────────────────────────────────────

INSERT INTO questions (
  id,
  order_index,
  text,
  image_url,
  circle_radius_ratio,
  time_limit_seconds,
  max_score,
  min_correct_score,
  image_width,
  image_height,
  reveal_image_url,    -- set to NULL in V1; optional in V3+
  is_published
) VALUES (
  'aaaaaaaa-0001-0000-0000-000000000001',  -- replace with gen_random_uuid() output
  1,
  'Question text goes here?',
  'aaaaaaaa-0001-0000-0000-000000000001.jpg',   -- filename in question-images bucket
  0.08,    -- circle radius = 8% of image width
  30,      -- 30-second time limit
  1000,    -- max score (answered instantly)
  100,     -- min score (answered at last second)
  800,     -- image pixel width
  600,     -- image pixel height
  NULL,
  TRUE
);

INSERT INTO question_masks (
  question_id,
  mask_storage_path,
  mask_width,
  mask_height
) VALUES (
  'aaaaaaaa-0001-0000-0000-000000000001',
  'aaaaaaaa-0001-0000-0000-000000000001_mask.png',
  800,  -- must match image_width
  600   -- must match image_height
);

-- ── QUESTION 2 ────────────────────────────────────────────────────────────────

-- (duplicate block above and change values)


-- =============================================================================
-- Verification after insert
-- =============================================================================
-- SELECT q.id, q.order_index, q.text, q.image_url, qm.mask_storage_path
-- FROM questions q
-- JOIN question_masks qm ON qm.question_id = q.id
-- ORDER BY q.order_index;
--
-- SELECT COUNT(*) FROM questions;       -- should equal number of questions loaded
-- SELECT COUNT(*) FROM question_masks;  -- should equal number of questions loaded
