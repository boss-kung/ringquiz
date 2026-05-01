import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';

type AdminQuestionActionName =
  | 'list_questions'
  | 'create_question'
  | 'update_question'
  | 'bulk_create_questions'
  | 'move_question'
  | 'publish_question'
  | 'unpublish_question'
  | 'delete_question';

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

interface AdminQuestionRequest {
  action: AdminQuestionActionName;
  question_id?: string;
  direction?: 'up' | 'down';
  question?: unknown;
  questions?: unknown;
}

interface ValidationIssue {
  field: string;
  message: string;
}

const GAME_STATE_ID = '00000000-0000-0000-0000-000000000001';

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const providedSecret = req.headers.get('X-Host-Secret');
  if (!providedSecret || providedSecret !== Deno.env.get('HOST_SECRET')) {
    return error(401, 'unauthorized');
  }

  const db = getSupabaseAdmin();
  const contentType = req.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('multipart/form-data')) {
      return await handleAssetUpload(req, db);
    }

    let body: AdminQuestionRequest;
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

async function handleAssetUpload(
  req: Request,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  const form = await req.formData();
  const action = form.get('action');
  if (action !== 'upload_assets') {
    return error(400, 'unknown_action');
  }

  const imageFile = form.get('image_file');
  const maskFile = form.get('mask_file');
  const revealFile = form.get('reveal_file');

  if (!(imageFile instanceof File)) return error(400, 'missing_field', 'image_file');
  if (!(maskFile instanceof File)) return error(400, 'missing_field', 'mask_file');
  if (revealFile != null && !(revealFile instanceof File)) return error(400, 'invalid_field', 'reveal_file');

  const imageWidth = readFormNumber(form, 'image_width');
  const imageHeight = readFormNumber(form, 'image_height');
  const maskWidth = readFormNumber(form, 'mask_width');
  const maskHeight = readFormNumber(form, 'mask_height');

  if ([imageWidth, imageHeight, maskWidth, maskHeight].some((value) => value == null)) {
    return error(400, 'missing_dimensions', 'image_width, image_height, mask_width, and mask_height are required');
  }

  if (imageWidth !== maskWidth || imageHeight !== maskHeight) {
    return error(400, 'dimension_mismatch', 'Image and mask dimensions must match.');
  }

  const assetId = crypto.randomUUID();
  const imagePath = `${assetId}${getFileExtension(imageFile.name, '.png')}`;
  const maskPath = `${assetId}_mask${getFileExtension(maskFile.name, '.png')}`;
  const revealPath =
    revealFile instanceof File
      ? `${assetId}_reveal${getFileExtension(revealFile.name, '.png')}`
      : null;

  const { error: imageUploadError } = await db.storage
    .from('question-images')
    .upload(imagePath, imageFile, {
      contentType: imageFile.type || 'image/png',
      upsert: false,
    });

  if (imageUploadError) {
    return error(400, 'upload_failed', `Image upload failed: ${imageUploadError.message}`);
  }

  const { error: maskUploadError } = await db.storage
    .from('question-masks')
    .upload(maskPath, maskFile, {
      contentType: maskFile.type || 'image/png',
      upsert: false,
    });

  if (maskUploadError) {
    await db.storage.from('question-images').remove([imagePath]);
    return error(400, 'upload_failed', `Mask upload failed: ${maskUploadError.message}`);
  }

  if (revealPath && revealFile instanceof File) {
    const { error: revealUploadError } = await db.storage
      .from('question-images')
      .upload(revealPath, revealFile, {
        contentType: revealFile.type || 'image/png',
        upsert: false,
      });

    if (revealUploadError) {
      await db.storage.from('question-images').remove([imagePath]);
      await db.storage.from('question-masks').remove([maskPath]);
      return error(400, 'upload_failed', `Reveal upload failed: ${revealUploadError.message}`);
    }
  }

  return ok({
    ok: true,
    action: 'upload_assets',
    image_url: imagePath,
    mask_storage_path: maskPath,
    reveal_image_url: revealPath,
    image_width: imageWidth!,
    image_height: imageHeight!,
    mask_width: maskWidth!,
    mask_height: maskHeight!,
  });
}

async function executeAction(
  body: AdminQuestionRequest,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  switch (body.action) {
    case 'list_questions':
      return listQuestions(db);
    case 'create_question':
      return createQuestion(body.question, db);
    case 'update_question':
      return updateQuestion(body.question_id, body.question, db);
    case 'bulk_create_questions':
      return bulkCreateQuestions(body.questions, db);
    case 'move_question':
      return moveQuestion(body.question_id, body.direction, db);
    case 'publish_question':
      return setPublishedState(body.question_id, true, db);
    case 'unpublish_question':
      return setPublishedState(body.question_id, false, db);
    case 'delete_question':
      return deleteQuestion(body.question_id, db);
    default:
      return error(400, 'unknown_action');
  }
}

async function listQuestions(db: ReturnType<typeof getSupabaseAdmin>): Promise<Response> {
  const { data, error: queryError } = await db
    .from('questions')
    .select(`
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
      reveal_image_url,
      is_published,
      created_at,
      question_masks!inner(mask_storage_path, mask_width, mask_height)
    `)
    .order('order_index', { ascending: true });

  if (queryError) throw new Error(`Failed to fetch questions: ${queryError.message}`);

  const questions = (data ?? []).map((row: any) => {
    const mask = Array.isArray(row.question_masks) ? row.question_masks[0] : row.question_masks;
    return ({
    id: row.id,
    order_index: row.order_index,
    text: row.text,
    image_url: row.image_url,
    circle_radius_ratio: row.circle_radius_ratio,
    time_limit_seconds: row.time_limit_seconds,
    max_score: row.max_score,
    min_correct_score: row.min_correct_score,
    image_width: row.image_width,
    image_height: row.image_height,
    reveal_image_url: row.reveal_image_url,
    is_published: row.is_published,
    created_at: row.created_at,
    mask_storage_path: mask.mask_storage_path,
    mask_width: mask.mask_width,
    mask_height: mask.mask_height,
  });
  }) satisfies AdminQuestionRecord[];

  return ok({
    ok: true,
    action: 'list_questions',
    questions,
  });
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

  const lockError = await getQuestionLockError(questionId, db, 'Cannot edit the question currently referenced by the active or finished game. Reset the game first.', 'question_locked');
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
  if (!Array.isArray(questionsInput) || questionsInput.length === 0) {
    return error(400, 'invalid_questions', 'questions must be a non-empty array');
  }

  const parsedQuestions: AdminQuestionPayload[] = [];
  const seenOrderIndexes = new Map<number, number>();

  for (let index = 0; index < questionsInput.length; index += 1) {
    const parsed = parseQuestionPayload(questionsInput[index]);
    if (!parsed.ok) return error(400, 'invalid_questions', `Row ${index + 1}: ${parsed.detail}`);

    if (parsed.question.order_index != null) {
      const firstSeen = seenOrderIndexes.get(parsed.question.order_index);
      if (firstSeen != null) {
        return error(
          400,
          'duplicate_order_index',
          `Rows ${firstSeen + 1} and ${index + 1} both use order_index ${parsed.question.order_index}`,
        );
      }
      seenOrderIndexes.set(parsed.question.order_index, index);
    }

    parsedQuestions.push(parsed.question);
  }

  const { data: existingQuestions, error: existingError } = await db
    .from('questions')
    .select('order_index')
    .order('order_index', { ascending: false });
  if (existingError) throw new Error(`Failed to inspect existing questions: ${existingError.message}`);

  const usedOrderIndexes = new Set<number>((existingQuestions ?? []).map((row) => row.order_index));
  let nextOrderIndex = (existingQuestions?.[0]?.order_index ?? 0) + 1;

  const questionRows: Array<{
    id: string;
    question: ReturnType<typeof toQuestionInsert>;
    mask: { question_id: string; mask_storage_path: string; mask_width: number; mask_height: number };
  }> = [];

  for (let index = 0; index < parsedQuestions.length; index += 1) {
    const question = parsedQuestions[index];
    const resolvedOrderIndex = question.order_index ?? nextOrderIndex++;

    if (usedOrderIndexes.has(resolvedOrderIndex)) {
      return error(409, 'duplicate_order_index', `Row ${index + 1}: order_index ${resolvedOrderIndex} already exists`);
    }
    usedOrderIndexes.add(resolvedOrderIndex);

    const questionId = crypto.randomUUID();
    questionRows.push({
      id: questionId,
      question: toQuestionInsert(questionId, question, resolvedOrderIndex),
      mask: {
        question_id: questionId,
        mask_storage_path: question.mask_storage_path,
        mask_width: question.mask_width,
        mask_height: question.mask_height,
      },
    });
  }

  const { error: insertQuestionsError } = await db.from('questions').insert(questionRows.map((row) => row.question));
  if (insertQuestionsError) return mapDbError('bulk_create_questions', insertQuestionsError.message);

  const { error: insertMasksError } = await db.from('question_masks').insert(questionRows.map((row) => row.mask));
  if (insertMasksError) {
    await db.from('questions').delete().in('id', questionRows.map((row) => row.id));
    return mapDbError('bulk_create_questions', insertMasksError.message);
  }

  return ok({
    ok: true,
    action: 'bulk_create_questions',
    created_count: questionRows.length,
  });
}

async function moveQuestion(
  questionId: string | undefined,
  direction: 'up' | 'down' | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!questionId) return error(400, 'missing_field', 'question_id');
  if (direction !== 'up' && direction !== 'down') {
    return error(400, 'missing_field', 'direction');
  }

  const lockError = await getQuestionLockError(questionId, db, 'Cannot reorder the question currently referenced by the active or finished game. Reset the game first.', 'question_locked');
  if (lockError) return lockError;

  const { data: current, error: currentError } = await db
    .from('questions')
    .select('id, order_index')
    .eq('id', questionId)
    .single();

  if (currentError || !current) {
    return mapDbError('move_question', currentError?.message ?? 'Question not found');
  }

  const comparator = direction === 'up' ? 'lt' : 'gt';
  const sortAscending = direction === 'up' ? false : true;

  const query = db
    .from('questions')
    .select('id, order_index')
    .order('order_index', { ascending: sortAscending })
    .limit(1);

  const { data: neighbor, error: neighborError } = await (comparator === 'lt'
    ? query.lt('order_index', current.order_index)
    : query.gt('order_index', current.order_index))
    .maybeSingle();

  if (neighborError) {
    throw new Error(`Failed to find neighboring question: ${neighborError.message}`);
  }

  if (!neighbor) {
    return ok({
      ok: true,
      action: 'move_question',
      question: await getQuestionRecord(questionId, db),
    });
  }

  const temporaryOrder = -Math.max(current.order_index, neighbor.order_index, 1);

  const { error: tempError } = await db
    .from('questions')
    .update({ order_index: temporaryOrder })
    .eq('id', current.id);
  if (tempError) return mapDbError('move_question', tempError.message);

  const { error: neighborUpdateError } = await db
    .from('questions')
    .update({ order_index: current.order_index })
    .eq('id', neighbor.id);
  if (neighborUpdateError) return mapDbError('move_question', neighborUpdateError.message);

  const { error: currentUpdateError } = await db
    .from('questions')
    .update({ order_index: neighbor.order_index })
    .eq('id', current.id);
  if (currentUpdateError) return mapDbError('move_question', currentUpdateError.message);

  return ok({
    ok: true,
    action: 'move_question',
    question: await getQuestionRecord(questionId, db),
  });
}

async function setPublishedState(
  questionId: string | undefined,
  isPublished: boolean,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!questionId) return error(400, 'missing_field', 'question_id');

  if (!isPublished) {
    const lockError = await getQuestionLockError(questionId, db, 'Cannot unpublish the question currently referenced by the active or finished game. Reset the game first.', 'question_locked');
    if (lockError) return lockError;
  }

  const { error: updateError } = await db
    .from('questions')
    .update({ is_published: isPublished })
    .eq('id', questionId);

  if (updateError) return mapDbError(isPublished ? 'publish_question' : 'unpublish_question', updateError.message);

  return await fetchSingleQuestion(isPublished ? 'publish_question' : 'unpublish_question', questionId, db);
}

async function deleteQuestion(
  questionId: string | undefined,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  if (!questionId) return error(400, 'missing_field', 'question_id');

  const lockError = await getQuestionLockError(questionId, db, 'Cannot delete the question currently referenced by the active or finished game.', 'question_in_use');
  if (lockError) return lockError;

  const { data: question, error: fetchError } = await db
    .from('questions')
    .select(`
      order_index,
      image_url,
      reveal_image_url,
      question_masks!inner(mask_storage_path)
    `)
    .eq('id', questionId)
    .single();
  if (fetchError) return mapDbError('delete_question', fetchError.message);

  const { error: deleteError } = await db
    .from('questions')
    .delete()
    .eq('id', questionId);
  if (deleteError) return mapDbError('delete_question', deleteError.message);

  await compactQuestionOrderIndexes((question as { order_index: number }).order_index, db);

  const imagePaths = [question.image_url];
  if (question.reveal_image_url) imagePaths.push(question.reveal_image_url);
  await db.storage.from('question-images').remove(imagePaths);
  const maskRow = Array.isArray((question as any).question_masks)
    ? (question as any).question_masks[0]
    : (question as any).question_masks;
  await db.storage.from('question-masks').remove([maskRow.mask_storage_path]);

  return ok({
    ok: true,
    action: 'delete_question',
  });
}

async function compactQuestionOrderIndexes(
  deletedOrderIndex: number,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<void> {
  const { data: remainingQuestions, error: remainingError } = await db
    .from('questions')
    .select('id, order_index')
    .gt('order_index', deletedOrderIndex)
    .order('order_index', { ascending: true });

  if (remainingError) {
    throw new Error(`Failed to compact question order indexes: ${remainingError.message}`);
  }

  if (!remainingQuestions || remainingQuestions.length === 0) return;

  for (let index = 0; index < remainingQuestions.length; index += 1) {
    const row = remainingQuestions[index];
    const temporaryOrderIndex = -(deletedOrderIndex + index + 1);
    const { error: tempError } = await db
      .from('questions')
      .update({ order_index: temporaryOrderIndex })
      .eq('id', row.id);

    if (tempError) {
      throw new Error(`Failed to reserve temporary order_index during compaction: ${tempError.message}`);
    }
  }

  for (let index = 0; index < remainingQuestions.length; index += 1) {
    const row = remainingQuestions[index];
    const nextOrderIndex = deletedOrderIndex + index;
    const { error: finalError } = await db
      .from('questions')
      .update({ order_index: nextOrderIndex })
      .eq('id', row.id);

    if (finalError) {
      throw new Error(`Failed to finalize compacted order_index: ${finalError.message}`);
    }
  }
}

async function fetchSingleQuestion(
  action: AdminQuestionActionName,
  questionId: string,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<Response> {
  return ok({
    ok: true,
    action,
    question: await getQuestionRecord(questionId, db),
  });
}

async function getQuestionRecord(
  questionId: string,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<AdminQuestionRecord> {
  const { data, error: fetchError } = await db
    .from('questions')
    .select(`
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
      reveal_image_url,
      is_published,
      created_at,
      question_masks!inner(mask_storage_path, mask_width, mask_height)
    `)
    .eq('id', questionId)
    .single();

  if (fetchError || !data) throw new Error(fetchError?.message ?? 'Failed to fetch question');

  const mask = Array.isArray((data as any).question_masks)
    ? (data as any).question_masks[0]
    : (data as any).question_masks;

  return {
    id: data.id,
    order_index: data.order_index,
    text: data.text,
    image_url: data.image_url,
    circle_radius_ratio: data.circle_radius_ratio,
    time_limit_seconds: data.time_limit_seconds,
    max_score: data.max_score,
    min_correct_score: data.min_correct_score,
    image_width: data.image_width,
    image_height: data.image_height,
    reveal_image_url: data.reveal_image_url,
    is_published: data.is_published,
    created_at: data.created_at,
    mask_storage_path: mask.mask_storage_path,
    mask_width: mask.mask_width,
    mask_height: mask.mask_height,
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

function parseQuestionPayload(input: unknown):
  | { ok: true; question: AdminQuestionPayload }
  | { ok: false; detail: string } {
  if (!isPlainObject(input)) return { ok: false, detail: 'Question must be an object.' };

  const issues: ValidationIssue[] = [];
  const text = readString(input, 'text', 'Question text', issues);
  const imageUrl = readString(input, 'image_url', 'Image URL', issues);
  const maskStoragePath = readString(input, 'mask_storage_path', 'Mask storage path', issues);
  const revealImageUrl = readOptionalString(input, 'reveal_image_url', 'Reveal image URL', issues);
  const circleRadiusRatio = readNumber(input, 'circle_radius_ratio', 'Circle radius ratio', issues, { min: 0.0001, max: 0.5 });
  const timeLimitSeconds = readNumber(input, 'time_limit_seconds', 'Time limit', issues, { integer: true, min: 1 });
  const maxScore = readNumber(input, 'max_score', 'Max score', issues, { integer: true, min: 1 });
  const minCorrectScore = readNumber(input, 'min_correct_score', 'Minimum correct score', issues, { integer: true, min: 0 });
  const imageWidth = readNumber(input, 'image_width', 'Image width', issues, { integer: true, min: 1 });
  const imageHeight = readNumber(input, 'image_height', 'Image height', issues, { integer: true, min: 1 });
  const maskWidth = readNumber(input, 'mask_width', 'Mask width', issues, { integer: true, min: 1 });
  const maskHeight = readNumber(input, 'mask_height', 'Mask height', issues, { integer: true, min: 1 });
  const orderIndex = readNumber(input, 'order_index', 'Order index', issues, { optional: true, integer: true, min: 1 });

  let isPublished = true;
  if ('is_published' in input && input.is_published != null) {
    if (typeof input.is_published !== 'boolean') {
      issues.push({ field: 'is_published', message: 'Published must be true or false.' });
    } else {
      isPublished = input.is_published;
    }
  }

  if (maxScore != null && minCorrectScore != null && minCorrectScore > maxScore) {
    issues.push({ field: 'min_correct_score', message: 'Minimum correct score must not exceed max score.' });
  }
  if (imageWidth != null && maskWidth != null && imageWidth !== maskWidth) {
    issues.push({ field: 'mask_width', message: 'Mask width must match image width.' });
  }
  if (imageHeight != null && maskHeight != null && imageHeight !== maskHeight) {
    issues.push({ field: 'mask_height', message: 'Mask height must match image height.' });
  }

  if (
    issues.length > 0 ||
    text == null || imageUrl == null || maskStoragePath == null ||
    circleRadiusRatio == null || timeLimitSeconds == null || maxScore == null ||
    minCorrectScore == null || imageWidth == null || imageHeight == null ||
    maskWidth == null || maskHeight == null
  ) {
    return { ok: false, detail: issues.map((issue) => `${issue.field}: ${issue.message}`).join(' ') };
  }

  return {
    ok: true,
    question: {
      text,
      image_url: imageUrl,
      mask_storage_path: maskStoragePath,
      reveal_image_url: revealImageUrl,
      circle_radius_ratio: circleRadiusRatio,
      time_limit_seconds: timeLimitSeconds,
      max_score: maxScore,
      min_correct_score: minCorrectScore,
      image_width: imageWidth,
      image_height: imageHeight,
      mask_width: maskWidth,
      mask_height: maskHeight,
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
      .from('questions')
      .select('id')
      .eq('order_index', requestedOrderIndex)
      .maybeSingle();

    if (existingError) throw new Error(`Failed to verify order_index: ${existingError.message}`);
    if (data && data.id !== currentQuestionId) {
      return error(409, 'duplicate_order_index', `order_index ${requestedOrderIndex} already exists`);
    }
    return requestedOrderIndex;
  }

  if (currentQuestionId) {
    const { data, error: preserveOrderError } = await db
      .from('questions')
      .select('order_index')
      .eq('id', currentQuestionId)
      .single();
    if (preserveOrderError) throw new Error(`Failed to preserve order_index: ${preserveOrderError.message}`);
    return data.order_index;
  }

  const { data, error: nextOrderError } = await db
    .from('questions')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (nextOrderError) throw new Error(`Failed to determine next order_index: ${nextOrderError.message}`);
  return (data?.order_index ?? 0) + 1;
}

function toQuestionInsert(questionId: string, question: AdminQuestionPayload, orderIndex: number) {
  return {
    id: questionId,
    order_index: orderIndex,
    text: question.text,
    image_url: question.image_url,
    circle_radius_ratio: question.circle_radius_ratio,
    time_limit_seconds: question.time_limit_seconds,
    max_score: question.max_score,
    min_correct_score: question.min_correct_score,
    image_width: question.image_width,
    image_height: question.image_height,
    reveal_image_url: question.reveal_image_url ?? null,
    is_published: question.is_published ?? true,
  };
}

function toQuestionUpdate(question: AdminQuestionPayload, orderIndex: number) {
  return {
    order_index: orderIndex,
    text: question.text,
    image_url: question.image_url,
    circle_radius_ratio: question.circle_radius_ratio,
    time_limit_seconds: question.time_limit_seconds,
    max_score: question.max_score,
    min_correct_score: question.min_correct_score,
    image_width: question.image_width,
    image_height: question.image_height,
    reveal_image_url: question.reveal_image_url ?? null,
    is_published: question.is_published ?? true,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  input: Record<string, unknown>,
  field: string,
  label: string,
  issues: ValidationIssue[],
): string | null {
  const value = input[field];
  if (typeof value !== 'string') {
    issues.push({ field, message: `${label} must be a string.` });
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    issues.push({ field, message: `${label} must not be empty.` });
    return null;
  }
  return trimmed;
}

function readOptionalString(
  input: Record<string, unknown>,
  field: string,
  label: string,
  issues: ValidationIssue[],
): string | null {
  const value = input[field];
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    issues.push({ field, message: `${label} must be a string.` });
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
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
  if (!Number.isFinite(parsed)) {
    issues.push({ field, message: `${label} must be a valid number.` });
    return null;
  }
  if (options?.integer && !Number.isInteger(parsed)) {
    issues.push({ field, message: `${label} must be an integer.` });
    return null;
  }
  if (options?.min != null && parsed < options.min) {
    issues.push({ field, message: `${label} must be at least ${options.min}.` });
  }
  if (options?.max != null && parsed > options.max) {
    issues.push({ field, message: `${label} must be at most ${options.max}.` });
  }
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

function mapDbError(action: AdminQuestionActionName, message: string): Response {
  if (message.includes('questions_order_unique')) {
    return error(409, 'duplicate_order_index', 'That order index is already in use.', action);
  }
  if (message.includes('violates foreign key constraint')) {
    return error(409, 'question_in_use', 'Question is already referenced by game data.', action);
  }
  return error(400, 'database_error', message, action);
}

function ok(body: Record<string, unknown>): Response {
  return Response.json(body, { headers: corsHeaders });
}

function error(
  status: number,
  code: string,
  detail?: string,
  action?: AdminQuestionActionName,
): Response {
  return Response.json(
    {
      ok: false,
      error: code,
      ...(detail ? { detail } : {}),
      ...(action ? { action } : {}),
    },
    { status, headers: corsHeaders },
  );
}
