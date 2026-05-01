# Storage Policy Reference

## Buckets

Two buckets must be created in the Supabase dashboard before the migration runs.

| Bucket | Setting | Rationale |
|---|---|---|
| `question-images` | **Public = true** | Question images are shown to all players. Direct CDN URLs, no auth required. |
| `question-masks` | **Public = false** | Mask files must never reach player browsers. Private at infrastructure level. |

## question-images (public)

**Dashboard:** Storage → New Bucket → Name: `question-images` → Public: ON

All files in this bucket are readable without authentication via direct URL:
```
https://<project>.supabase.co/storage/v1/object/public/question-images/<filename>
```

The SQL migration applies this RLS policy:
```sql
CREATE POLICY "public_read_question_images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'question-images');
```

File naming convention:
```
question-images/{question_id}.jpg     -- question background image
question-images/{question_id}_reveal.png  -- optional reveal overlay (if used in V3+)
```

Upload: In V1, files are uploaded manually via Supabase Studio or CLI.
In V3+, the host upload UI sends files through a host-action Edge Function
using the service role key.

## question-masks (private)

**Dashboard:** Storage → New Bucket → Name: `question-masks` → Public: OFF

No public URL exists for any file in this bucket.
The private bucket setting blocks all access at the Supabase infrastructure level.

No permissive RLS policy is created for this bucket.
The absence of a permissive policy means RLS default-deny applies as a second layer.

Edge Functions access mask files using the service role client (`SUPABASE_SERVICE_ROLE_KEY`),
which bypasses storage RLS entirely. The service role key is never exposed to browsers.

File naming convention:
```
question-masks/{question_id}_mask.png
```

Upload: In V1, mask files are uploaded manually via Supabase Studio or the CLI:
```bash
supabase storage cp ./masks/q1_mask.png ss:///question-masks/q1-uuid-here_mask.png
```

After upload, insert the reference row:
```sql
INSERT INTO question_masks (question_id, mask_storage_path, mask_width, mask_height)
VALUES ('<question_id>', '<question_id>_mask.png', 800, 600);
```

## Security verification steps

Run these checks before the event:

1. **Direct URL blocked:**
   ```bash
   curl -I "https://<project>.supabase.co/storage/v1/object/question-masks/test.png"
   # Expect: 400 or 403. Never 200.
   ```

2. **Signed URL generation blocked from client:**
   A browser client using the anon key cannot call `storage.createSignedUrl` for
   `question-masks` files — the private bucket rejects the request regardless of RLS.

3. **question_masks table returns no rows:**
   ```sql
   -- Run as anon role (use Supabase client with anon key, not Studio)
   SELECT * FROM question_masks;
   -- Expect: 0 rows (RLS USING (false) filters all rows)
   ```

4. **export-results response has no mask fields:**
   ```bash
   curl -H "X-Host-Secret: $HOST_SECRET" .../export-results | jq 'keys'
   # Expect: ["answers", "exported_at", "leaderboard", "players"]
   # Must NOT contain: "masks", "mask_storage_path", or any mask-related key
   ```
