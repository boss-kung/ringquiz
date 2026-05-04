import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';

// ── Action type union ────────────────────────────────────────────────────────

type AdminActionName =
  // Question Bank
  | 'list_questions'
  | 'create_question'
  | 'update_question'
  | 'bulk_create_questions'
  | 'move_question'
  | 'publish_question'
  | 'unpublish_question'
  | 'delete_question'
  // Game Sets
  | 'list_game_sets'
  | 'create_game_set'
  | 'update_game_set_name'
  | 'delete_game_set'
  | 'set_active_game_set'
  | 'list_game_set_questions'
  | 'add_question_to_game_set'
  | 'remove_game_set_question'
  | 'update_game_set_question'
  | 'reorder_game_set_questions'
  | 'toggle_game_set_question_enabled';

// ── Shared record shapes ─────────────────────────────────────────────────────

interface AdminQuestionPayload {
  text: string;
  image_url: string;
  mask_storage_path: string;
  circle_radius_ratio: number;
  time_limit_seconds: number;
  max_score: number;
  min_correct_score: number;
  image_width: number;
  image_height: number;
  mask_width: number;
  mask_height: number;
  order_index?: number;
  is_published?: boolean;
  reveal_image_url?: string | null;
}

interface AdminQuestionRecord {
  id: string;
  order_index: number;
  text: string;
  image_url: string;
  circle_radius_ratio: number;
  time_limit_seconds: number;
  max_score: number;
  min_correct_score: number;
  image_width: number | null;
  image_height: number | null;
  reveal_image_url: string | null;
  is_published: boolean;
  created_at: string;
  mask_storage_path: string;
  mask_width: number | null;
  mask_height: number | null;
}

interface GameSetRecord {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  question_count: number;
  enabled_question_count: number;
}

interface GameSetQuestionRecord {
  id: string;
  game_set_id: string;
  question_id: string;
  play_order: number;
  time_limit_seconds: number;
  max_score: number;
  min_correct_score: number;
  circle_radius_ratio: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  question_text: string;
  question_image_url: string;
  question_reveal_image_url: string | null;
  question_image_width: number | null;
  question_image_height: number | null;
}

interface AdminRequest {
  action: AdminActionName;
  // Question Bank
  question_id?: string;
  direction?: 'up' | 'down';
  question?: unknown;
  questions?: unknown;
  // Game Sets
  game_set_id?: string;
  game_set_question_id?: string;
  name?: string;
  play_order?: number;
  time_limit_seconds?: number;
  max_score?: number;
  min_correct_score?: number;
  circle_radius_ratio?: number;
  is_enabled?: boolean;
  ordered_ids?: string[];
}

interface ValidationIssue {
  field: string;
  message: string;
}

const GAME_STATE_ID = '00000000-0000-0000-0000-000000000001';

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const envSecret = Deno.env.get('HOST_SECRET')?.trim();
  if (!envSecret) return error(500, 'server_missing_host_secret');
  const providedSecret = req.headers.get('X-Host-Secret')?.trim();
  if (!providedSecret || providedSecret !== envSecret) {
    return error(401, 'unauthorized');
  }

  const db = getSupabaseAdmin();
  const contentType = req.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('multipart/form-data')) {
      return await handleAssetUpload(req, db);
    }

    let body: AdminRequest;
    try {
      body = await req.json();
    } catch {
      return error(400, 'invalid_json');
    }

    if (!body?.action) return error(400, 'missing_action');
    return await executeAction(body, db);
  } catch (err) {
    console.error('[admin-question-action]', err);
    return error(500, 'internal', err instanceof Error ? err.message : 'Unknown error');
  }
});

// ── Asset upload (multipart) ─────────────────────────────────────────────────

async function handleAssetUpload(
  req: Request,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  const form = await req.formData();
  const action = form.get('action');
  if (action !== 'upload_assets') return error(400, 'unknown_action');

  const imageFile = form.get('image_file');
  const maskFile  = form.get('mask_file');
  const revealFile = form.get('reveal_file');

  if (!(imageFile instanceof File)) return error(400, 'missing_field', 'image_file');
  if (!(maskFile instanceof File))  return error(400, 'missing_field', 'mask_file');
  if (revealFile != null && !(revealFile instanceof File))
    return error(400, 'invalid_field', 'reveal_file');

  const imageWidth  = readFormNumber(form, 'image_width');
  const imageHeight = readFormNumber(form, 'image_height');
  const maskWidth   = readFormNumber(form, 'mask_width');
  const maskHeight  = readFormNumber(form, 'mask_height');

  if ([imageWidth, imageHeight, maskWidth, maskHeight].some((v) => v == null))
    return error(400, 'missing_dimensions', 'image_width, image_height, mask_width, mask_height required');

  if (imageWidth !== maskWidth || imageHeight !== maskHeight)
    return error(400, 'dimension_mismatch', 'Image and mask dimensions must match.');

  const assetId   = crypto.randomUUID();
  const imagePath = `${assetId}${getFileExtension(imageFile.name, '.png')}`;
  const maskPath  = `${assetId}_mask${getFileExtension(maskFile.name, '.png')}`;
  const revealPath = revealFile instanceof File
    ? `${assetId}_reveal${getFileExtension(revealFile.name, '.png')}`
    : null;

  const { error: imageUploadError } = await db.storage
    .from('question-images')
    .upload(imagePath, imageFile, { contentType: imageFile.type || 'image/png', upsert: false });
  if (imageUploadError)
    return error(400, 'upload_failed', `Image upload failed: ${imageUploadError.message}`);

  const { error: maskUploadError } = await db.storage
    .from('question-masks')
    .upload(maskPath, maskFile, { contentType: maskFile.type || 'image/png', upsert: false });
  if (maskUploadError) {
    await db.storage.from('question-images').remove([imagePath]);
    return error(400, 'upload_failed', `Mask upload failed: ${maskUploadError.message}`);
  }

  if (revealPath && revealFile instanceof File) {
    const { error: revealUploadError } = await db.storage
      .from('question-images')
      .upload(revealPath, revealFile, { contentType: revealFile.type || 'image/png', upsert: false });
    if (revealUploadError) {
      await db.storage.from('question-images').remove([imagePath]);
      await db.storage.from('question-masks').remove([maskPath]);
      return error(400, 'upload_failed', `Reveal upload failed: ${revealUploadError.message}`);
    }
  }

  return ok({
    ok: true, action: 'upload_assets',
    image_url: imagePath, mask_storage_path: maskPath,
    reveal_image_url: revealPath,
    image_width: imageWidth!, image_height: imageHeight!,
    mask_width: maskWidth!, mask_height: maskHeight!,
  });
}

// ── Action router ─────────────────────────────────────────────────────────────

async function executeAction(
  body: AdminRequest,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  switch (body.action) {
    // ── Question Bank ────────────────────────────────────────────────────────
    case 'list_questions':          return listQuestions(db);
    case 'create_question':         return createQuestion(body.question, db);
    case 'update_question':         return updateQuestion(body.question_id, body.question, db);
    case 'bulk_create_questions':   return bulkCreateQuestions(body.questions, db);
    case 'move_question':           return moveQuestion(body.question_id, body.direction, db);
    case 'publish_question':        return setPublishedState(body.question_id, true, db);
    case 'unpublish_question':      return setPublishedState(body.question_id, false, db);
    case 'delete_question':         return deleteQuestion(body.question_id, db);
    // ── Game Sets ────────────────────────────────────────────────────────────
    case 'list_game_sets':          return listGameSets(db);
    case 'create_game_set':         return createGameSet(body.name, db);
    case 'update_game_set_name':    return updateGameSetName(body.game_set_id, body.name, db);
    case 'delete_game_set':         return deleteGameSet(body.game_set_id, db);
    case 'set_active_game_set':     return setActiveGameSet(body.game_set_id, db);
    case 'list_game_set_questions': return listGameSetQuestions(body.game_set_id, db);
    case 'add_question_to_game_set':
      return addQuestionToGameSet(body.game_set_id, body.question_id, db);
    case 'remove_game_set_question':
      return removeGameSetQuestion(body.game_set_question_id, db);
    case 'update_game_set_question':
      return updateGameSetQuestion(body.game_set_question_id, body, db);
    case 'reorder_game_set_questions':
      return reorderGameSetQuestions(body.game_set_id, body.ordered_ids, db);
    case 'toggle_game_set_question_enabled':
      return toggleGameSetQuestionEnabled(body.game_set_question_id, body.is_enabled, db);
    default:
      return error(400, 'unknown_action');
  }
}

// ============================================================================
// QUESTION BANK HANDLERS (unchanged from original)
// ============================================================================

async function listQuestions(db: ReturnType<typeof getSupabaseAdmin>): Promise<Response> {
  const { data, error: queryError } = await db
    .from('questions')
    .select(`
      id, order_index, text, image_url, circle_radius_ratio,
      time_limit_seconds, max_score, min_correct_score,
      image_width, image_height, reveal_image_url, is_published, created_at,
      question_masks!inner(mask_storage_path, mask_width, mask_height)
    `)
    .order('order_index', { ascending: true });

  if (queryError) throw new Error(`Failed to fetch questions: ${queryError.message}`);

  const questions = (data ?? []).map((row: any) => {
    const mask = Array.isArray(row.question_masks) ? row.question_masks[0] : row.question_masks;
    return {
      id: row.id, order_index: row.order_index, text: row.text,
      image_url: row.image_url, circle_radius_ratio: row.circle_radius_ratio,
      time_limit_seconds: row.time_limit_seconds, max_score: row.max_score,
      min_correct_score: row.min_correct_score, image_width: row.image_width,
      image_height: row.image_height, reveal_image_url: row.reveal_image_url,
      is_published: row.is_published, created_at: row.created_at,
      mask_storage_path: mask.mask_storage_path,
      mask_width: mask.mask_width, mask_height: mask.mask_height,
    } satisfies AdminQuestionRecord;
  });

  return ok({ ok: true, action: 'list_questions', questions });
}

async function createQuestion(
  questionInput: unknown,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  const parsed = parseQuestionPayload(questionInput);
  if (!parsed.ok) return error(400, 'invalid_question', parsed.detail);

  const resolvedOrderIndex = await resolveOrderIndex(parsed.question.order_index, undefined, db);
  if (typeof resolvedOrderIndex !== 'number') return resolvedOrderIndex;

  const questionId = crypto.randomUUID();
  const { error: insertQuestionError } = await db.from('questions').insert(
    toQuestionInsert(questionId, parsed.question, resolvedOrderIndex),
  );
  if (insertQuestionError) return mapDbError('create_question', insertQuestionError.message);

  const { error: insertMaskError } = await db.from('question_masks').insert({
    question_id: questionId,
    mask_storage_path: parsed.question.mask_storage_path,
    mask_width: parsed.question.mask_width,
    mask_height: parsed.question.mask_height,
  });

  if (insertMaskError) {
    await db.from('questions').delete().eq('id', questionId);
    return mapDbError('create_question', insertMaskError.message);
  }

  return await fetchSingleQuestion('create_question', questionId, db);
}

async function updateQuestion(
  questionId: string | undefined,
  questionInput: unknown,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!questionId) return error(400, 'missing_field', 'question_id');

  const lockError = await getQuestionLockError(questionId, db,
    'Cannot edit the question currently referenced by the active or finished game. Reset the game first.',
    'question_locked');
  if (lockError) return lockError;

  const parsed = parseQuestionPayload(questionInput);
  if (!parsed.ok) return error(400, 'invalid_question', parsed.detail);

  const resolvedOrderIndex = await resolveOrderIndex(parsed.question.order_index, questionId, db);
  if (typeof resolvedOrderIndex !== 'number') return resolvedOrderIndex;

  const { error: updateQuestionError } = await db
    .from('questions')
    .update(toQuestionUpdate(parsed.question, resolvedOrderIndex))
    .eq('id', questionId);
  if (updateQuestionError) return mapDbError('update_question', updateQuestionError.message);

  const { error: updateMaskError } = await db
    .from('question_masks')
    .update({
      mask_storage_path: parsed.question.mask_storage_path,
      mask_width: parsed.question.mask_width,
      mask_height: parsed.question.mask_height,
    })
    .eq('question_id', questionId);
  if (updateMaskError) return mapDbError('update_question', updateMaskError.message);

  return await fetchSingleQuestion('update_question', questionId, db);
}

async function bulkCreateQuestions(
  questionsInput: unknown,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!Array.isArray(questionsInput) || questionsInput.length === 0)
    return error(400, 'invalid_questions', 'questions must be a non-empty array');

  const parsedQuestions: AdminQuestionPayload[] = [];
  const seenOrderIndexes = new Map<number, number>();

  for (let i = 0; i < questionsInput.length; i++) {
    const parsed = parseQuestionPayload(questionsInput[i]);
    if (!parsed.ok) return error(400, 'invalid_questions', `Row ${i + 1}: ${parsed.detail}`);

    if (parsed.question.order_index != null) {
      const firstSeen = seenOrderIndexes.get(parsed.question.order_index);
      if (firstSeen != null)
        return error(400, 'duplicate_order_index',
          `Rows ${firstSeen + 1} and ${i + 1} both use order_index ${parsed.question.order_index}`);
      seenOrderIndexes.set(parsed.question.order_index, i);
    }
    parsedQuestions.push(parsed.question);
  }

  const { data: existingQuestions, error: existingError } = await db
    .from('questions').select('order_index').order('order_index', { ascending: false });
  if (existingError) throw new Error(`Failed to inspect existing questions: ${existingError.message}`);

  const usedOrderIndexes = new Set<number>((existingQuestions ?? []).map((r) => r.order_index));
  let nextOrderIndex = (existingQuestions?.[0]?.order_index ?? 0) + 1;

  const questionRows: Array<{
    id: string;
    question: ReturnType<typeof toQuestionInsert>;
    mask: { question_id: string; mask_storage_path: string; mask_width: number; mask_height: number };
  }> = [];

  for (let i = 0; i < parsedQuestions.length; i++) {
    const q = parsedQuestions[i];
    const resolvedOrderIndex = q.order_index ?? nextOrderIndex++;

    if (usedOrderIndexes.has(resolvedOrderIndex))
      return error(409, 'duplicate_order_index', `Row ${i + 1}: order_index ${resolvedOrderIndex} already exists`);
    usedOrderIndexes.add(resolvedOrderIndex);

    const questionId = crypto.randomUUID();
    questionRows.push({
      id: questionId,
      question: toQuestionInsert(questionId, q, resolvedOrderIndex),
      mask: { question_id: questionId, mask_storage_path: q.mask_storage_path, mask_width: q.mask_width, mask_height: q.mask_height },
    });
  }

  const { error: insertQuestionsError } = await db.from('questions').insert(questionRows.map((r) => r.question));
  if (insertQuestionsError) return mapDbError('bulk_create_questions', insertQuestionsError.message);

  const { error: insertMasksError } = await db.from('question_masks').insert(questionRows.map((r) => r.mask));
  if (insertMasksError) {
    await db.from('questions').delete().in('id', questionRows.map((r) => r.id));
    return mapDbError('bulk_create_questions', insertMasksError.message);
  }

  return ok({ ok: true, action: 'bulk_create_questions', created_count: questionRows.length });
}

async function moveQuestion(
  questionId: string | undefined,
  direction: 'up' | 'down' | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!questionId) return error(400, 'missing_field', 'question_id');
  if (direction !== 'up' && direction !== 'down') return error(400, 'missing_field', 'direction');

  const lockError = await getQuestionLockError(questionId, db,
    'Cannot reorder the question currently referenced by the active or finished game. Reset the game first.',
    'question_locked');
  if (lockError) return lockError;

  const { data: current, error: currentError } = await db
    .from('questions').select('id, order_index').eq('id', questionId).single();
  if (currentError || !current) return mapDbError('move_question', currentError?.message ?? 'Question not found');

  const comparator = direction === 'up' ? 'lt' : 'gt';
  const sortAscending = direction !== 'up';
  const query = db.from('questions').select('id, order_index').order('order_index', { ascending: sortAscending }).limit(1);
  const { data: neighbor, error: neighborError } = await (
    comparator === 'lt' ? query.lt('order_index', current.order_index) : query.gt('order_index', current.order_index)
  ).maybeSingle();

  if (neighborError) throw new Error(`Failed to find neighboring question: ${neighborError.message}`);
  if (!neighbor) return ok({ ok: true, action: 'move_question', question: await getQuestionRecord(questionId, db) });

  const temporaryOrder = -Math.max(current.order_index, neighbor.order_index, 1);
  const { error: tempError } = await db.from('questions').update({ order_index: temporaryOrder }).eq('id', current.id);
  if (tempError) return mapDbError('move_question', tempError.message);

  const { error: neighborUpdateError } = await db.from('questions').update({ order_index: current.order_index }).eq('id', neighbor.id);
  if (neighborUpdateError) return mapDbError('move_question', neighborUpdateError.message);

  const { error: currentUpdateError } = await db.from('questions').update({ order_index: neighbor.order_index }).eq('id', current.id);
  if (currentUpdateError) return mapDbError('move_question', currentUpdateError.message);

  return ok({ ok: true, action: 'move_question', question: await getQuestionRecord(questionId, db) });
}

async function setPublishedState(
  questionId: string | undefined,
  isPublished: boolean,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!questionId) return error(400, 'missing_field', 'question_id');

  if (!isPublished) {
    const lockError = await getQuestionLockError(questionId, db,
      'Cannot unpublish the question currently referenced by the active or finished game. Reset the game first.',
      'question_locked');
    if (lockError) return lockError;
  }

  const { error: updateError } = await db.from('questions').update({ is_published: isPublished }).eq('id', questionId);
  if (updateError) return mapDbError(isPublished ? 'publish_question' : 'unpublish_question', updateError.message);

  return await fetchSingleQuestion(isPublished ? 'publish_question' : 'unpublish_question', questionId, db);
}

async function deleteQuestion(
  questionId: string | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!questionId) return error(400, 'missing_field', 'question_id');

  const lockError = await getQuestionLockError(questionId, db,
    'Cannot delete the question currently referenced by the active or finished game.',
    'question_in_use');
  if (lockError) return lockError;

  const { data: question, error: fetchError } = await db
    .from('questions')
    .select('order_index, image_url, reveal_image_url, question_masks!inner(mask_storage_path)')
    .eq('id', questionId)
    .single();
  if (fetchError) return mapDbError('delete_question', fetchError.message);

  const { error: deleteError } = await db.from('questions').delete().eq('id', questionId);
  if (deleteError) return mapDbError('delete_question', deleteError.message);

  await compactQuestionOrderIndexes((question as any).order_index, db);

  const imagePaths = [(question as any).image_url];
  if ((question as any).reveal_image_url) imagePaths.push((question as any).reveal_image_url);
  await db.storage.from('question-images').remove(imagePaths);

  const maskRow = Array.isArray((question as any).question_masks)
    ? (question as any).question_masks[0]
    : (question as any).question_masks;
  await db.storage.from('question-masks').remove([maskRow.mask_storage_path]);

  return ok({ ok: true, action: 'delete_question' });
}

// ============================================================================
// GAME SET HANDLERS
// ============================================================================

async function listGameSets(db: ReturnType<typeof getSupabaseAdmin>): Promise<Response> {
  const { data, error: queryError } = await db
    .from('game_sets')
    .select('id, name, status, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (queryError) throw new Error(`Failed to list game sets: ${queryError.message}`);

  // Fetch question counts per game set
  const gameSets: GameSetRecord[] = await Promise.all(
    (data ?? []).map(async (gs: any) => {
      const { count: total } = await db
        .from('game_set_questions')
        .select('id', { count: 'exact', head: true })
        .eq('game_set_id', gs.id);

      const { count: enabled } = await db
        .from('game_set_questions')
        .select('id', { count: 'exact', head: true })
        .eq('game_set_id', gs.id)
        .eq('is_enabled', true);

      return {
        id: gs.id, name: gs.name, status: gs.status,
        created_at: gs.created_at, updated_at: gs.updated_at,
        question_count: total ?? 0,
        enabled_question_count: enabled ?? 0,
      };
    }),
  );

  return ok({ ok: true, action: 'list_game_sets', game_sets: gameSets });
}

async function createGameSet(
  name: string | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!name?.trim()) return error(400, 'missing_field', 'name');

  const { data, error: insertError } = await db
    .from('game_sets')
    .insert({ name: name.trim(), status: 'draft' })
    .select('id, name, status, created_at, updated_at')
    .single();

  if (insertError) throw new Error(`Failed to create game set: ${insertError.message}`);

  const gameSet: GameSetRecord = {
    id: data!.id, name: data!.name, status: data!.status,
    created_at: data!.created_at, updated_at: data!.updated_at,
    question_count: 0, enabled_question_count: 0,
  };

  return ok({ ok: true, action: 'create_game_set', game_set: gameSet });
}

async function updateGameSetName(
  gameSetId: string | undefined,
  name: string | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!gameSetId) return error(400, 'missing_field', 'game_set_id');
  if (!name?.trim()) return error(400, 'missing_field', 'name');

  const { error: updateError } = await db
    .from('game_sets')
    .update({ name: name.trim() })
    .eq('id', gameSetId);

  if (updateError) throw new Error(`Failed to update game set: ${updateError.message}`);

  return await fetchGameSetRecord('update_game_set_name', gameSetId, db);
}

async function deleteGameSet(
  gameSetId: string | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!gameSetId) return error(400, 'missing_field', 'game_set_id');

  // Prevent deleting the active game set
  const { data: gs } = await db
    .from('game_state')
    .select('active_game_set_id, status')
    .eq('id', GAME_STATE_ID)
    .single<{ active_game_set_id: string | null; status: string }>();

  if (gs?.active_game_set_id === gameSetId && gs?.status !== 'waiting') {
    return error(409, 'game_set_in_use', 'Cannot delete the active game set while a game is running. Reset the game first.');
  }

  // If this is the active game set, clear it from game_state
  if (gs?.active_game_set_id === gameSetId) {
    await db.from('game_state').update({ active_game_set_id: null, current_game_set_question_id: null }).eq('id', GAME_STATE_ID);
  }

  const { error: deleteError } = await db.from('game_sets').delete().eq('id', gameSetId);
  if (deleteError) throw new Error(`Failed to delete game set: ${deleteError.message}`);

  return ok({ ok: true, action: 'delete_game_set' });
}

async function setActiveGameSet(
  gameSetId: string | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!gameSetId) return error(400, 'missing_field', 'game_set_id');

  // Verify the game set exists
  const { data: gs, error: gsErr } = await db
    .from('game_sets')
    .select('id, name, status')
    .eq('id', gameSetId)
    .single<{ id: string; name: string; status: string }>();

  if (gsErr || !gs) return error(404, 'not_found', 'Game set not found');

  // Check it has at least one enabled question
  const { count: enabledCount, error: countErr } = await db
    .from('game_set_questions')
    .select('id', { count: 'exact', head: true })
    .eq('game_set_id', gameSetId)
    .eq('is_enabled', true);

  if (countErr) throw new Error(`Failed to count game set questions: ${countErr.message}`);
  if ((enabledCount ?? 0) === 0)
    return error(400, 'empty_game_set', 'Cannot activate a game set with no enabled questions.');

  // Check game is in waiting state before switching active set
  const { data: gameState } = await db
    .from('game_state')
    .select('status')
    .eq('id', GAME_STATE_ID)
    .single<{ status: string }>();

  if (gameState && gameState.status !== 'waiting' && gameState.status !== 'ended') {
    return error(409, 'game_running', 'Cannot change the active game set while a game is running. Reset the game first.');
  }

  // Deactivate any currently active game set
  await db.from('game_sets').update({ status: 'draft' }).eq('status', 'active');

  // Activate the new game set
  await db.from('game_sets').update({ status: 'active' }).eq('id', gameSetId);

  // Update game_state
  await db.from('game_state')
    .update({
      active_game_set_id: gameSetId,
      current_question_id: null,
      current_question_index: null,
      current_game_set_question_id: null,
    })
    .eq('id', GAME_STATE_ID);

  return await fetchGameSetRecord('set_active_game_set', gameSetId, db);
}

async function listGameSetQuestions(
  gameSetId: string | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!gameSetId) return error(400, 'missing_field', 'game_set_id');

  const { data, error: queryError } = await db
    .from('game_set_questions')
    .select(`
      id, game_set_id, question_id, play_order,
      time_limit_seconds, max_score, min_correct_score, circle_radius_ratio,
      is_enabled, created_at, updated_at,
      questions!inner(text, image_url, reveal_image_url, image_width, image_height)
    `)
    .eq('game_set_id', gameSetId)
    .order('play_order', { ascending: true });

  if (queryError) throw new Error(`Failed to list game set questions: ${queryError.message}`);

  const gameSetQuestions: GameSetQuestionRecord[] = (data ?? []).map((row: any) => {
    const q = Array.isArray(row.questions) ? row.questions[0] : row.questions;
    return {
      id: row.id,
      game_set_id: row.game_set_id,
      question_id: row.question_id,
      play_order: row.play_order,
      time_limit_seconds: row.time_limit_seconds,
      max_score: row.max_score,
      min_correct_score: row.min_correct_score,
      circle_radius_ratio: row.circle_radius_ratio,
      is_enabled: row.is_enabled,
      created_at: row.created_at,
      updated_at: row.updated_at,
      question_text: q?.text ?? '',
      question_image_url: q?.image_url ?? '',
      question_reveal_image_url: q?.reveal_image_url ?? null,
      question_image_width: q?.image_width ?? null,
      question_image_height: q?.image_height ?? null,
    };
  });

  return ok({ ok: true, action: 'list_game_set_questions', game_set_questions: gameSetQuestions });
}

async function addQuestionToGameSet(
  gameSetId: string | undefined,
  questionId: string | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!gameSetId)   return error(400, 'missing_field', 'game_set_id');
  if (!questionId)  return error(400, 'missing_field', 'question_id');

  // Verify game set exists
  const { data: gs, error: gsErr } = await db.from('game_sets').select('id').eq('id', gameSetId).single();
  if (gsErr || !gs) return error(404, 'not_found', 'Game set not found');

  // Fetch bank question defaults to snapshot
  const { data: bankQ, error: bankQErr } = await db
    .from('questions')
    .select('time_limit_seconds, max_score, min_correct_score, circle_radius_ratio')
    .eq('id', questionId)
    .single<{ time_limit_seconds: number; max_score: number; min_correct_score: number; circle_radius_ratio: number }>();

  if (bankQErr || !bankQ) return error(404, 'not_found', 'Question not found in bank');

  // Determine next play_order
  const { data: maxOrderRow } = await db
    .from('game_set_questions')
    .select('play_order')
    .eq('game_set_id', gameSetId)
    .order('play_order', { ascending: false })
    .limit(1)
    .maybeSingle<{ play_order: number }>();

  const nextPlayOrder = (maxOrderRow?.play_order ?? 0) + 1;

  const { data: inserted, error: insertError } = await db
    .from('game_set_questions')
    .insert({
      game_set_id: gameSetId,
      question_id: questionId,
      play_order: nextPlayOrder,
      // Snapshot values copied from bank defaults at add time
      time_limit_seconds: bankQ.time_limit_seconds,
      max_score: bankQ.max_score,
      min_correct_score: bankQ.min_correct_score,
      circle_radius_ratio: bankQ.circle_radius_ratio,
      is_enabled: true,
    })
    .select('id')
    .single<{ id: string }>();

  if (insertError) throw new Error(`Failed to add question to game set: ${insertError.message}`);

  return await fetchGameSetQuestion('add_question_to_game_set', inserted!.id, db);
}

async function removeGameSetQuestion(
  gameSetQuestionId: string | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!gameSetQuestionId) return error(400, 'missing_field', 'game_set_question_id');

  // Get its game_set_id and play_order for compaction
  const { data: gsq, error: fetchErr } = await db
    .from('game_set_questions')
    .select('game_set_id, play_order')
    .eq('id', gameSetQuestionId)
    .single<{ game_set_id: string; play_order: number }>();

  if (fetchErr || !gsq) return error(404, 'not_found', 'Game set question not found');

  // Check it's not the current active game set question
  const { data: gameState } = await db
    .from('game_state')
    .select('current_game_set_question_id, status')
    .eq('id', GAME_STATE_ID)
    .single<{ current_game_set_question_id: string | null; status: string }>();

  if (gameState?.current_game_set_question_id === gameSetQuestionId && gameState?.status !== 'waiting') {
    return error(409, 'question_in_use', 'Cannot remove the currently active question. Reset the game first.');
  }

  const { error: deleteError } = await db
    .from('game_set_questions')
    .delete()
    .eq('id', gameSetQuestionId);

  if (deleteError) throw new Error(`Failed to remove game set question: ${deleteError.message}`);

  // Compact play_order within this game set
  await compactGameSetPlayOrder(gsq.game_set_id, gsq.play_order, db);

  return ok({ ok: true, action: 'remove_game_set_question' });
}

async function updateGameSetQuestion(
  gameSetQuestionId: string | undefined,
  fields: Pick<AdminRequest, 'time_limit_seconds' | 'max_score' | 'min_correct_score' | 'circle_radius_ratio'>,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!gameSetQuestionId) return error(400, 'missing_field', 'game_set_question_id');

  const issues: ValidationIssue[] = [];
  const patch: Record<string, unknown> = {};

  if (fields.time_limit_seconds !== undefined) {
    if (!Number.isInteger(fields.time_limit_seconds) || fields.time_limit_seconds < 1)
      issues.push({ field: 'time_limit_seconds', message: 'Must be a positive integer.' });
    else patch.time_limit_seconds = fields.time_limit_seconds;
  }
  if (fields.max_score !== undefined) {
    if (!Number.isInteger(fields.max_score) || fields.max_score < 0)
      issues.push({ field: 'max_score', message: 'Must be a non-negative integer.' });
    else patch.max_score = fields.max_score;
  }
  if (fields.min_correct_score !== undefined) {
    if (!Number.isInteger(fields.min_correct_score) || fields.min_correct_score < 0)
      issues.push({ field: 'min_correct_score', message: 'Must be a non-negative integer.' });
    else patch.min_correct_score = fields.min_correct_score;
  }
  if (fields.circle_radius_ratio !== undefined) {
    const r = fields.circle_radius_ratio;
    if (typeof r !== 'number' || r <= 0 || r > 0.5)
      issues.push({ field: 'circle_radius_ratio', message: 'Must be > 0 and ≤ 0.5.' });
    else patch.circle_radius_ratio = r;
  }

  if (issues.length > 0)
    return error(400, 'validation_error', issues.map((i) => `${i.field}: ${i.message}`).join(' '));

  // Cross-field validation
  if (patch.min_correct_score !== undefined && patch.max_score !== undefined &&
      (patch.min_correct_score as number) > (patch.max_score as number)) {
    return error(400, 'validation_error', 'min_correct_score must not exceed max_score');
  }

  if (Object.keys(patch).length === 0) return error(400, 'no_fields', 'No fields to update');

  const { error: updateError } = await db
    .from('game_set_questions')
    .update(patch)
    .eq('id', gameSetQuestionId);

  if (updateError) throw new Error(`Failed to update game set question: ${updateError.message}`);

  return await fetchGameSetQuestion('update_game_set_question', gameSetQuestionId, db);
}

async function reorderGameSetQuestions(
  gameSetId: string | undefined,
  orderedIds: string[] | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!gameSetId) return error(400, 'missing_field', 'game_set_id');
  if (!Array.isArray(orderedIds) || orderedIds.length === 0)
    return error(400, 'missing_field', 'ordered_ids');

  // Assign play_order sequentially according to client-provided order.
  // Use negative temporaries first to avoid UNIQUE constraint violations.
  for (let i = 0; i < orderedIds.length; i++) {
    await db.from('game_set_questions')
      .update({ play_order: -(i + 1) })
      .eq('id', orderedIds[i])
      .eq('game_set_id', gameSetId);
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await db.from('game_set_questions')
      .update({ play_order: i + 1 })
      .eq('id', orderedIds[i])
      .eq('game_set_id', gameSetId);
  }

  return ok({ ok: true, action: 'reorder_game_set_questions' });
}

async function toggleGameSetQuestionEnabled(
  gameSetQuestionId: string | undefined,
  isEnabled: boolean | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!gameSetQuestionId) return error(400, 'missing_field', 'game_set_question_id');
  if (typeof isEnabled !== 'boolean') return error(400, 'missing_field', 'is_enabled');

  const { error: updateError } = await db
    .from('game_set_questions')
    .update({ is_enabled: isEnabled })
    .eq('id', gameSetQuestionId);

  if (updateError) throw new Error(`Failed to toggle game set question: ${updateError.message}`);

  return await fetchGameSetQuestion('toggle_game_set_question_enabled', gameSetQuestionId, db);
}

// ============================================================================
// QUESTION BANK HELPERS (unchanged from original)
// ============================================================================

async function compactQuestionOrderIndexes(
  deletedOrderIndex: number,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<void> {
  const { data: remaining, error: remainingError } = await db
    .from('questions')
    .select('id, order_index')
    .gt('order_index', deletedOrderIndex)
    .order('order_index', { ascending: true });

  if (remainingError) throw new Error(`Compact order failed: ${remainingError.message}`);
  if (!remaining || remaining.length === 0) return;

  for (let i = 0; i < remaining.length; i++) {
    await db.from('questions').update({ order_index: -(deletedOrderIndex + i + 1) }).eq('id', remaining[i].id);
  }
  for (let i = 0; i < remaining.length; i++) {
    await db.from('questions').update({ order_index: deletedOrderIndex + i }).eq('id', remaining[i].id);
  }
}

async function fetchSingleQuestion(
  action: AdminActionName,
  questionId: string,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  return ok({ ok: true, action, question: await getQuestionRecord(questionId, db) });
}

async function getQuestionRecord(
  questionId: string,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<AdminQuestionRecord> {
  const { data, error: fetchError } = await db
    .from('questions')
    .select(`
      id, order_index, text, image_url, circle_radius_ratio,
      time_limit_seconds, max_score, min_correct_score,
      image_width, image_height, reveal_image_url, is_published, created_at,
      question_masks!inner(mask_storage_path, mask_width, mask_height)
    `)
    .eq('id', questionId)
    .single();

  if (fetchError || !data) throw new Error(fetchError?.message ?? 'Failed to fetch question');

  const mask = Array.isArray((data as any).question_masks)
    ? (data as any).question_masks[0]
    : (data as any).question_masks;

  return {
    id: data.id, order_index: data.order_index, text: data.text,
    image_url: data.image_url, circle_radius_ratio: data.circle_radius_ratio,
    time_limit_seconds: data.time_limit_seconds, max_score: data.max_score,
    min_correct_score: data.min_correct_score, image_width: data.image_width,
    image_height: data.image_height, reveal_image_url: data.reveal_image_url,
    is_published: data.is_published, created_at: data.created_at,
    mask_storage_path: mask.mask_storage_path,
    mask_width: mask.mask_width, mask_height: mask.mask_height,
  } satisfies AdminQuestionRecord;
}

async function getQuestionLockError(
  questionId: string,
  db: ReturnType<typeof getSupabaseAdmin>,
  message: string,
  code: string,
): Promise<Response | null> {
  const { data: gameState, error: gameStateError } = await db
    .from('game_state')
    .select('status, current_question_id')
    .eq('id', GAME_STATE_ID)
    .single();

  if (gameStateError) throw new Error(`Failed to inspect game state: ${gameStateError.message}`);

  if (gameState.current_question_id === questionId && gameState.status !== 'waiting') {
    return error(409, code, message);
  }
  return null;
}

// ============================================================================
// GAME SET HELPERS
// ============================================================================

async function fetchGameSetRecord(
  action: AdminActionName,
  gameSetId: string,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  const { data, error: fetchError } = await db
    .from('game_sets')
    .select('id, name, status, created_at, updated_at')
    .eq('id', gameSetId)
    .single<{ id: string; name: string; status: string; created_at: string; updated_at: string }>();

  if (fetchError || !data) throw new Error(`Failed to fetch game set: ${fetchError?.message}`);

  const { count: total } = await db.from('game_set_questions')
    .select('id', { count: 'exact', head: true }).eq('game_set_id', gameSetId);
  const { count: enabled } = await db.from('game_set_questions')
    .select('id', { count: 'exact', head: true }).eq('game_set_id', gameSetId).eq('is_enabled', true);

  const gameSet: GameSetRecord = {
    id: data.id, name: data.name, status: data.status,
    created_at: data.created_at, updated_at: data.updated_at,
    question_count: total ?? 0,
    enabled_question_count: enabled ?? 0,
  };

  return ok({ ok: true, action, game_set: gameSet });
}

async function fetchGameSetQuestion(
  action: AdminActionName,
  gsqId: string,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  const { data, error: fetchError } = await db
    .from('game_set_questions')
    .select(`
      id, game_set_id, question_id, play_order,
      time_limit_seconds, max_score, min_correct_score, circle_radius_ratio,
      is_enabled, created_at, updated_at,
      questions!inner(text, image_url, reveal_image_url, image_width, image_height)
    `)
    .eq('id', gsqId)
    .single();

  if (fetchError || !data) throw new Error(`Failed to fetch game set question: ${fetchError?.message}`);

  const q = Array.isArray((data as any).questions) ? (data as any).questions[0] : (data as any).questions;

  const gsq: GameSetQuestionRecord = {
    id: data.id, game_set_id: data.game_set_id, question_id: data.question_id,
    play_order: data.play_order, time_limit_seconds: data.time_limit_seconds,
    max_score: data.max_score, min_correct_score: data.min_correct_score,
    circle_radius_ratio: data.circle_radius_ratio, is_enabled: data.is_enabled,
    created_at: data.created_at, updated_at: data.updated_at,
    question_text: q?.text ?? '', question_image_url: q?.image_url ?? '',
    question_reveal_image_url: q?.reveal_image_url ?? null,
    question_image_width: q?.image_width ?? null, question_image_height: q?.image_height ?? null,
  };

  return ok({ ok: true, action, game_set_question: gsq });
}

async function compactGameSetPlayOrder(
  gameSetId: string,
  deletedPlayOrder: number,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<void> {
  const { data: remaining, error: remainingError } = await db
    .from('game_set_questions')
    .select('id, play_order')
    .eq('game_set_id', gameSetId)
    .gt('play_order', deletedPlayOrder)
    .order('play_order', { ascending: true });

  if (remainingError) throw new Error(`Compact play_order failed: ${remainingError.message}`);
  if (!remaining || remaining.length === 0) return;

  for (let i = 0; i < remaining.length; i++) {
    await db.from('game_set_questions').update({ play_order: -(deletedPlayOrder + i) }).eq('id', remaining[i].id);
  }
  for (let i = 0; i < remaining.length; i++) {
    await db.from('game_set_questions').update({ play_order: deletedPlayOrder + i }).eq('id', remaining[i].id);
  }
}

// ============================================================================
// PARSING + VALIDATION HELPERS (unchanged from original)
// ============================================================================

function parseQuestionPayload(input: unknown):
  | { ok: true; question: AdminQuestionPayload }
  | { ok: false; detail: string } {
  if (!isPlainObject(input)) return { ok: false, detail: 'Question must be an object.' };

  const issues: ValidationIssue[] = [];
  const text             = readString(input, 'text', 'Question text', issues);
  const imageUrl         = readString(input, 'image_url', 'Image URL', issues);
  const maskStoragePath  = readString(input, 'mask_storage_path', 'Mask storage path', issues);
  const revealImageUrl   = readOptionalString(input, 'reveal_image_url', 'Reveal image URL', issues);
  const circleRadiusRatio = readNumber(input, 'circle_radius_ratio', 'Circle radius ratio', issues, { min: 0.0001, max: 0.5 });
  const timeLimitSeconds = readNumber(input, 'time_limit_seconds', 'Time limit', issues, { integer: true, min: 1 });
  const maxScore         = readNumber(input, 'max_score', 'Max score', issues, { integer: true, min: 1 });
  const minCorrectScore  = readNumber(input, 'min_correct_score', 'Minimum correct score', issues, { integer: true, min: 0 });
  const imageWidth       = readNumber(input, 'image_width', 'Image width', issues, { integer: true, min: 1 });
  const imageHeight      = readNumber(input, 'image_height', 'Image height', issues, { integer: true, min: 1 });
  const maskWidth        = readNumber(input, 'mask_width', 'Mask width', issues, { integer: true, min: 1 });
  const maskHeight       = readNumber(input, 'mask_height', 'Mask height', issues, { integer: true, min: 1 });
  const orderIndex       = readNumber(input, 'order_index', 'Order index', issues, { optional: true, integer: true, min: 1 });

  let isPublished = true;
  if ('is_published' in input && input.is_published != null) {
    if (typeof input.is_published !== 'boolean') {
      issues.push({ field: 'is_published', message: 'Published must be true or false.' });
    } else {
      isPublished = input.is_published;
    }
  }

  if (maxScore != null && minCorrectScore != null && minCorrectScore > maxScore)
    issues.push({ field: 'min_correct_score', message: 'Minimum correct score must not exceed max score.' });
  if (imageWidth != null && maskWidth != null && imageWidth !== maskWidth)
    issues.push({ field: 'mask_width', message: 'Mask width must match image width.' });
  if (imageHeight != null && maskHeight != null && imageHeight !== maskHeight)
    issues.push({ field: 'mask_height', message: 'Mask height must match image height.' });

  if (issues.length > 0 || text == null || imageUrl == null || maskStoragePath == null ||
      circleRadiusRatio == null || timeLimitSeconds == null || maxScore == null ||
      minCorrectScore == null || imageWidth == null || imageHeight == null ||
      maskWidth == null || maskHeight == null) {
    return { ok: false, detail: issues.map((i) => `${i.field}: ${i.message}`).join(' ') };
  }

  return {
    ok: true,
    question: {
      text, image_url: imageUrl, mask_storage_path: maskStoragePath,
      reveal_image_url: revealImageUrl, circle_radius_ratio: circleRadiusRatio,
      time_limit_seconds: timeLimitSeconds, max_score: maxScore,
      min_correct_score: minCorrectScore, image_width: imageWidth,
      image_height: imageHeight, mask_width: maskWidth, mask_height: maskHeight,
      is_published: isPublished,
      ...(orderIndex != null ? { order_index: orderIndex } : {}),
    },
  };
}

async function resolveOrderIndex(
  requestedOrderIndex: number | undefined,
  currentQuestionId: string | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<number | Response> {
  if (requestedOrderIndex != null) {
    const { data, error: existingError } = await db
      .from('questions').select('id').eq('order_index', requestedOrderIndex).maybeSingle();
    if (existingError) throw new Error(`Failed to verify order_index: ${existingError.message}`);
    if (data && data.id !== currentQuestionId)
      return error(409, 'duplicate_order_index', `order_index ${requestedOrderIndex} already exists`);
    return requestedOrderIndex;
  }

  if (currentQuestionId) {
    const { data, error: preserveOrderError } = await db
      .from('questions').select('order_index').eq('id', currentQuestionId).single();
    if (preserveOrderError) throw new Error(`Failed to preserve order_index: ${preserveOrderError.message}`);
    return data.order_index;
  }

  const { data, error: nextOrderError } = await db
    .from('questions').select('order_index').order('order_index', { ascending: false }).limit(1).maybeSingle();
  if (nextOrderError) throw new Error(`Failed to determine next order_index: ${nextOrderError.message}`);
  return (data?.order_index ?? 0) + 1;
}

function toQuestionInsert(questionId: string, question: AdminQuestionPayload, orderIndex: number) {
  return {
    id: questionId, order_index: orderIndex, text: question.text,
    image_url: question.image_url, circle_radius_ratio: question.circle_radius_ratio,
    time_limit_seconds: question.time_limit_seconds, max_score: question.max_score,
    min_correct_score: question.min_correct_score, image_width: question.image_width,
    image_height: question.image_height, reveal_image_url: question.reveal_image_url ?? null,
    is_published: question.is_published ?? true,
  };
}

function toQuestionUpdate(question: AdminQuestionPayload, orderIndex: number) {
  return {
    order_index: orderIndex, text: question.text, image_url: question.image_url,
    circle_radius_ratio: question.circle_radius_ratio, time_limit_seconds: question.time_limit_seconds,
    max_score: question.max_score, min_correct_score: question.min_correct_score,
    image_width: question.image_width, image_height: question.image_height,
    reveal_image_url: question.reveal_image_url ?? null, is_published: question.is_published ?? true,
  };
}

function mapDbError(action: AdminActionName, message: string): Response {
  if (message.includes('questions_order_unique'))
    return error(409, 'duplicate_order_index', 'That order index is already in use.', action);
  if (message.includes('violates foreign key constraint'))
    return error(409, 'question_in_use', 'Question is referenced by game data.', action);
  return error(400, 'database_error', message, action);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(input: Record<string, unknown>, field: string, label: string, issues: ValidationIssue[]): string | null {
  const value = input[field];
  if (typeof value !== 'string') { issues.push({ field, message: `${label} must be a string.` }); return null; }
  const trimmed = value.trim();
  if (!trimmed) { issues.push({ field, message: `${label} must not be empty.` }); return null; }
  return trimmed;
}

function readOptionalString(input: Record<string, unknown>, field: string, label: string, issues: ValidationIssue[]): string | null {
  const value = input[field];
  if (value == null || value === '') return null;
  if (typeof value !== 'string') { issues.push({ field, message: `${label} must be a string.` }); return null; }
  return value.trim() || null;
}

function readNumber(
  input: Record<string, unknown>,
  field: string,
  label: string,
  issues: ValidationIssue[],
  options?: { optional?: boolean; integer?: boolean; min?: number; max?: number },
): number | null {
  const value = input[field];
  if (value == null || value === '') {
    if (options?.optional) return null;
    issues.push({ field, message: `${label} is required.` });
    return null;
  }
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) { issues.push({ field, message: `${label} must be a valid number.` }); return null; }
  if (options?.integer && !Number.isInteger(parsed)) { issues.push({ field, message: `${label} must be an integer.` }); return null; }
  if (options?.min != null && parsed < options.min) issues.push({ field, message: `${label} must be at least ${options.min}.` });
  if (options?.max != null && parsed > options.max) issues.push({ field, message: `${label} must be at most ${options.max}.` });
  return parsed;
}

function readFormNumber(form: FormData, key: string): number | null {
  const value = form.get(key);
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getFileExtension(fileName: string, fallback: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match ? `.${match[1].toLowerCase()}` : fallback;
}

function ok(body: Record<string, unknown>): Response {
  return Response.json(body, { headers: corsHeaders });
}

function error(
  status: number,
  code: string,
  detail?: string,
  action?: AdminActionName,
): Response {
  return Response.json(
    { ok: false, error: code, ...(detail ? { detail } : {}), ...(action ? { action } : {}) },
    { status, headers: corsHeaders },
  );
}
