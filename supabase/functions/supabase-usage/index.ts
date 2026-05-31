// supabase-usage — host-only Supabase Free plan usage snapshot.
// Auth: X-Host-Secret header.
//
// Exact project-local values come from Postgres and Storage metadata.
// Billing counters that Supabase only exposes through the platform are fetched
// with SUPABASE_MANAGEMENT_TOKEN when configured.
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import type {
  ErrorResponse,
  SupabaseUsageMetric,
  SupabaseUsageResponse,
  SupabaseUsageStatus,
} from '../_shared/types.ts';

const FREE_LIMITS = {
  databaseBytes: 500 * 1024 * 1024,
  storageBytes: 1024 * 1024 * 1024,
  edgeFunctionInvocations: 500_000,
  realtimeMessages: 2_000_000,
  realtimePeakConnections: 200,
  authMonthlyActiveUsers: 50_000,
} as const;

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const envSecret = Deno.env.get('HOST_SECRET')?.trim();
  if (!envSecret) {
    const body: ErrorResponse = { error: 'server_missing_host_secret' };
    return Response.json(body, { status: 500, headers: corsHeaders });
  }
  const providedSecret = req.headers.get('X-Host-Secret')?.trim();
  if (!providedSecret || providedSecret !== envSecret) {
    await sleep(300);
    const body: ErrorResponse = { error: 'unauthorized' };
    return Response.json(body, { status: 401, headers: corsHeaders });
  }

  try {
    const body = await buildUsageResponse();
    return Response.json(body, { headers: corsHeaders });
  } catch (e) {
    console.error('[supabase-usage]', e);
    const body: ErrorResponse = { error: 'internal', detail: String(e) };
    return Response.json(body, { status: 500, headers: corsHeaders });
  }
});

async function buildUsageResponse(): Promise<SupabaseUsageResponse> {
  const db = getSupabaseAdmin();
  const projectRef = getProjectRef();
  const warnings: string[] = [];

  const [snapshotResult, storageResult] = await Promise.all([
    db.rpc('host_project_usage_snapshot'),
    getStorageUsage(),
  ]);

  const snapshot = normalizeSnapshot(snapshotResult.data);
  if (snapshotResult.error) {
    warnings.push(`อ่านขนาดฐานข้อมูลไม่ได้: ${snapshotResult.error.message}`);
  }
  if (storageResult.error) warnings.push(storageResult.error);

  const management = projectRef
    ? await getManagementUsage(projectRef)
    : { configured: false, ok: false, metrics: {}, note: 'หา project ref จาก SUPABASE_URL ไม่ได้' };

  if (!management.ok) warnings.push(management.note);

  const playerCount = snapshot.players;
  const metrics: SupabaseUsageMetric[] = [
    makeMetric({
      key: 'database_size',
      label: 'Database size',
      used: snapshot.database_size_bytes,
      limit: FREE_LIMITS.databaseBytes,
      unit: 'bytes',
      source: 'live_project',
      note_th: 'ขนาดฐานข้อมูลจริงจาก pg_database_size ของโปรเจกต์นี้',
    }),
    makeMetric({
      key: 'storage_size',
      label: 'Storage size',
      used: storageResult.bytes,
      limit: FREE_LIMITS.storageBytes,
      unit: 'bytes',
      source: 'live_project',
      note_th: 'รวมไฟล์ใน Supabase Storage จาก metadata ของทุก bucket',
    }),
    makeMetric({
      key: 'realtime_peak_connections',
      label: 'Realtime peak connections',
      used: playerCount,
      limit: FREE_LIMITS.realtimePeakConnections,
      unit: 'connections',
      source: 'estimate',
      note_th: 'ใช้จำนวนผู้เล่นที่ join แล้วเป็นตัวแทนขั้นต่ำ; จอ host/display และ tab ซ้ำอาจทำให้ connection จริงสูงกว่านี้',
    }),
    makeMetric({
      key: 'auth_mau',
      label: 'Auth MAU',
      used: management.metrics.authMau ?? null,
      limit: FREE_LIMITS.authMonthlyActiveUsers,
      unit: 'count',
      source: management.metrics.authMau == null ? 'manual' : 'management_api',
      note_th: management.metrics.authMau == null
        ? 'Supabase Management API ไม่ส่งค่านี้กลับมาในสภาพแวดล้อมนี้ ให้ดู Dashboard เป็นค่าจริง'
        : 'จำนวนผู้ใช้ auth รายเดือนจาก Management API',
    }),
    makeMetric({
      key: 'edge_function_invocations',
      label: 'Edge Function invocations',
      used: management.metrics.edgeFunctionInvocations ?? null,
      limit: FREE_LIMITS.edgeFunctionInvocations,
      unit: 'invocations',
      source: management.metrics.edgeFunctionInvocations == null ? 'manual' : 'management_api',
      note_th: management.metrics.edgeFunctionInvocations == null
        ? 'ถ้า Management API ไม่เปิด counter นี้ ให้ดู Usage ใน Supabase Dashboard เป็นค่าจริง'
        : 'จำนวนครั้งที่ Edge Functions ถูกเรียกในรอบที่ API ส่งกลับมา',
    }),
    makeMetric({
      key: 'realtime_messages',
      label: 'Realtime messages',
      used: management.metrics.realtimeMessages ?? null,
      limit: FREE_LIMITS.realtimeMessages,
      unit: 'messages',
      source: management.metrics.realtimeMessages == null ? 'manual' : 'management_api',
      note_th: management.metrics.realtimeMessages == null
        ? 'ค่าจริงอยู่ใน Supabase Dashboard; panel นี้ยังแสดงลิมิตเพื่อเตือนก่อนงาน'
        : 'จำนวนข้อความ Realtime จาก Management API',
    }),
  ];

  return {
    generated_at: new Date().toISOString(),
    project_ref: projectRef,
    plan: 'free',
    billing_window_note_th: 'ลิมิต Free plan เป็นราย billing cycle ของ Supabase; บาง counter ขึ้นกับข้อมูลที่ Management API เปิดให้ token นี้อ่านได้',
    management_api: {
      configured: management.configured,
      ok: management.ok,
      note_th: management.note,
    },
    metrics,
    local_counts: {
      players: snapshot.players,
      questions: snapshot.questions,
      answers: snapshot.answers,
      storage_objects: storageResult.objects,
    },
    warnings,
  };
}

function makeMetric(input: Omit<SupabaseUsageMetric, 'percent' | 'status'>): SupabaseUsageMetric {
  const percent = input.used != null && input.limit != null && input.limit > 0
    ? Math.min(999, (input.used / input.limit) * 100)
    : null;
  return { ...input, percent, status: usageStatus(percent) };
}

function usageStatus(percent: number | null): SupabaseUsageStatus {
  if (percent == null) return 'unknown';
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warning';
  return 'ok';
}

function normalizeSnapshot(value: unknown): {
  database_size_bytes: number | null;
  players: number;
  questions: number;
  answers: number;
} {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    database_size_bytes: toNumber(record.database_size_bytes),
    players: toNumber(record.players) ?? 0,
    questions: toNumber(record.questions) ?? 0,
    answers: toNumber(record.answers) ?? 0,
  };
}

async function getStorageUsage(): Promise<{ bytes: number; objects: number; error: string | null }> {
  const db = getSupabaseAdmin();
  let from = 0;
  const pageSize = 1000;
  let bytes = 0;
  let objects = 0;

  while (true) {
    const { data, error } = await db
      .schema('storage')
      .from('objects')
      .select('metadata')
      .range(from, from + pageSize - 1);

    if (error) return { bytes, objects, error: `อ่าน Storage metadata ไม่ได้: ${error.message}` };
    const rows = (data ?? []) as Array<{ metadata: unknown }>;
    for (const row of rows) {
      const metadata = row.metadata && typeof row.metadata === 'object'
        ? row.metadata as Record<string, unknown>
        : {};
      bytes += toNumber(metadata.size) ?? 0;
      objects += 1;
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return { bytes, objects, error: null };
}

async function getManagementUsage(projectRef: string): Promise<{
  configured: boolean;
  ok: boolean;
  note: string;
  metrics: {
    authMau?: number;
    edgeFunctionInvocations?: number;
    realtimeMessages?: number;
  };
}> {
  const token = Deno.env.get('SUPABASE_MANAGEMENT_TOKEN')?.trim();
  if (!token) {
    return {
      configured: false,
      ok: false,
      note: 'ยังไม่ได้ตั้ง SUPABASE_MANAGEMENT_TOKEN จึงอ่าน billing counters จริงจาก Supabase Platform ไม่ได้',
      metrics: {},
    };
  }

  const metrics: Record<string, number> = {};
  const functionIds = await listFunctionIds(projectRef, token);
  const attempts = await Promise.allSettled([
    fetchUsageEndpoint(projectRef, token, 'usage.api-counts'),
    fetchUsageEndpoint(projectRef, token, 'usage.api-requests-count'),
    ...functionIds.map((functionId) => fetchFunctionStats(projectRef, token, functionId)),
  ]);

  for (const attempt of attempts) {
    if (attempt.status !== 'fulfilled' || !attempt.value) continue;
    mergeManagementMetrics(metrics, attempt.value);
  }

  const hasAny = Object.keys(metrics).length > 0;
  return {
    configured: true,
    ok: hasAny,
    note: hasAny
      ? 'เชื่อมต่อ Management API แล้ว; counter ที่ Supabase ส่งกลับมาถูกนำมาแสดงใน panel'
      : 'เชื่อมต่อ Management API ได้ไม่ครบ หรือ endpoint usage ไม่ส่ง counter ที่ต้องใช้กลับมา ให้ตรวจ token permission และดู Dashboard ประกอบ',
    metrics,
  };
}

async function fetchUsageEndpoint(projectRef: string, token: string, endpoint: string): Promise<unknown | null> {
  const interval = endpoint === 'usage.api-requests-count' ? '' : '?interval=1day';
  const url = `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/${endpoint}${interval}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    console.warn('[supabase-usage] management endpoint failed', endpoint, res.status, await res.text());
    return null;
  }
  return await res.json();
}

async function listFunctionIds(projectRef: string, token: string): Promise<string[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/functions`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    console.warn('[supabase-usage] list functions failed', res.status, await res.text());
    return [];
  }
  const payload = await res.json();
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => item && typeof item === 'object' ? (item as Record<string, unknown>).id : null)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

async function fetchFunctionStats(projectRef: string, token: string, functionId: string): Promise<unknown | null> {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/functions.combined-stats?interval=1day&function_id=${encodeURIComponent(functionId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    console.warn('[supabase-usage] function stats failed', functionId, res.status, await res.text());
    return null;
  }
  return { function_invocations: sumLikelyFunctionInvocations(await res.json()) };
}

function mergeManagementMetrics(metrics: Record<string, number>, payload: unknown) {
  const records = flattenRecords(payload);
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const numeric = toNumber(value);
      if (numeric == null) continue;
      const normalized = key.toLowerCase();
      if (normalized.includes('function') && (normalized.includes('invocation') || normalized.includes('request'))) {
        metrics.edgeFunctionInvocations = (metrics.edgeFunctionInvocations ?? 0) + numeric;
      }
      if (normalized.includes('realtime') && (normalized.includes('message') || normalized.includes('request'))) {
        metrics.realtimeMessages = (metrics.realtimeMessages ?? 0) + numeric;
      }
      if ((normalized.includes('mau') || normalized.includes('monthly_active')) && normalized.includes('auth')) {
        metrics.authMau = Math.max(metrics.authMau ?? 0, numeric);
      }
    }
  }
}

function sumLikelyFunctionInvocations(payload: unknown): number {
  let total = 0;
  for (const record of flattenRecords(payload)) {
    for (const [key, value] of Object.entries(record)) {
      const normalized = key.toLowerCase();
      if (!normalized.includes('invocation') && !normalized.includes('request') && !normalized.includes('count')) continue;
      total += toNumber(value) ?? 0;
    }
  }
  return total;
}

function flattenRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenRecords(item));
  }
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const nested = Object.values(record).flatMap((item) => flattenRecords(item));
  return [record, ...nested];
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getProjectRef(): string | null {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  if (!url) return null;
  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match?.[1] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
