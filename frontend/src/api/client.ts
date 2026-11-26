export interface BatchSummary {
  id: string;
  batch_code: string;
  product_name: string;
  opening_location_id: string;
  opening_quantity: number;
  dataset_key: string;
  is_practice: boolean;
  shipment_count: number;
  has_active_recall: boolean;
  latest_recall_id: string | null;
}

export interface LocationTraceNode {
  location_id: string;
  location_name: string;
  role: string;
  received: number;
  forwarded: number;
  sold: number;
  remaining: number;
  set_aside: number;
  confirmed_set_aside: boolean;
  has_response: boolean;
  status: string;
}

export interface ShipmentEdge {
  shipment_id: string;
  sender_id: string;
  sender_name: string;
  receiver_id: string;
  receiver_name: string;
  quantity: number;
  accepted_at: string;
}

export interface BatchTraceSummary {
  batch_id: string;
  batch_code: string;
  product_name: string;
  opening_location_id: string;
  opening_quantity: number;
  total_remaining: number;
  total_sold: number;
  total_set_aside: number;
  accounted_total: number;
  discrepancy: number;
  nodes: LocationTraceNode[];
  edges: ShipmentEdge[];
}

export interface TaskResponseRecord {
  response_id: string;
  forwarded_qty: number;
  sold_qty: number;
  remaining_qty: number;
  set_aside_qty: number;
  confirmed_set_aside: boolean;
  discrepancy_reason: string | null;
  revision: number;
  submitted_at?: string;
  updated_at: string;
}

export interface RecallTaskItem {
  task_id: string;
  location_id: string;
  location_name: string;
  role: string;
  status: string;
  access_token: string;
  received: number;
  forwarded: number;
  delivered_at: string;
  acknowledged_at: string | null;
  completed_at: string | null;
  response: TaskResponseRecord | null;
}

export interface RecallOverview {
  id: string;
  batch_id: string;
  batch_code: string;
  product_name: string;
  notice_version: number;
  notice_text: string;
  is_drill: boolean;
  published_at: string;
  total_tasks: number;
  completed_tasks: number;
  discrepancy_tasks: number;
  idempotent_reused?: boolean;
  trace: BatchTraceSummary;
  tasks: RecallTaskItem[];
}

export interface RecallListItem {
  id: string;
  batch_code: string;
  product_name: string;
  notice_version: number;
  is_drill: boolean;
  published_at: string;
  total_tasks: number;
  completed_tasks: number;
}

export interface ScopedTaskView {
  task_id: string;
  recall_id: string;
  batch_code: string;
  product_name: string;
  location_id: string;
  location_name: string;
  role: string;
  status: string;
  banner: string;
  is_drill: boolean;
  notice_version: number;
  notice_text: string;
  received: number;
  forwarded: number;
  acknowledged_at: string | null;
  completed_at: string | null;
  current_response: TaskResponseRecord | null;
}

export interface TaskResponsePayload {
  task_id?: string;
  forwarded_qty?: number;
  sold_qty: number;
  remaining_qty: number;
  set_aside_qty: number;
  confirmed_set_aside: boolean;
  discrepancy_reason?: string | null;
}

export interface TaskResponseResult {
  task_id: string;
  task_status: string;
  idempotent_duplicate: boolean;
  response: TaskResponseRecord;
}

export interface AuditEventItem {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  revision_ref: number | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface JoinStudyResponse {
  session_id: string;
  participant_alias: string;
  identity: string;
  scoped_token: string;
  scenario_id: string;
  is_practice: boolean;
  resumed: boolean;
  banner: string;
}

export interface TaskQrPayload {
  task_id: string;
  location_id: string;
  location_name: string;
  target_url: string;
  is_localhost_warning: boolean;
  banner: string;
  qr_data_url: string;
}

export interface PracticeResetResponse {
  status: string;
  dataset_key: string;
  practice_sessions_deleted: number;
  study_sessions_preserved: number;
  recalls_deleted: number;
}

export interface DrillSessionState {
  session_id: string;
  participant_alias: string;
  identity: string;
  scoped_token: string;
  scenario_id: string;
  banner: string;
  batch_code: string;
  product_name: string;
  location_name: string;
  notice_text: string;
  received: number;
  forwarded: number;
  variant: 'standard' | 'guided' | null;
  is_practice: boolean;
  validity_status: string;
  outcome: string | null;
  attempts: number;
  incorrect_attempts: number;
  exposure_at: string | null;
  started_at: string | null;
  finalized_at: string | null;
  elapsed_seconds: number | null;
  remaining_seconds: number;
  completed_seconds: number | null;
  deadline_seconds: number;
  resumed?: boolean;
  idempotent_duplicate?: boolean;
  late_completion_recorded?: boolean;
}

export interface VariantSummaryStats {
  exposed_n: number;
  success_n: number;
  timeout_n: number;
  abandoned_n: number;
  conversion_rate_pct: number;
  median_completion_seconds: number | null;
  total_incorrect_attempts: number;
}

export interface ExperimentSummaryResponse {
  feature_name: string;
  include_practice: boolean;
  total_sessions: number;
  valid_exposed_n: number;
  excluded_n: number;
  exclusions_by_reason: Record<string, number>;
  variants: {
    standard: VariantSummaryStats;
    guided: VariantSummaryStats;
  };
  outbox: {
    pending: number;
    dispatched: number;
    failed: number;
  };
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const OPERATOR_TOKEN_KEY = 'rr_operator_token';

export function getStoredOperatorToken(): string | null {
  try {
    return sessionStorage.getItem(OPERATOR_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredOperatorToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(OPERATOR_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(OPERATOR_TOKEN_KEY);
    }
  } catch {
    // Ignore storage unavailability in restricted contexts.
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}, authToken?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = authToken === undefined ? getStoredOperatorToken() : authToken;
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, { ...init, headers, credentials: 'include' });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    if (detail && typeof detail === 'object' && 'message' in detail) {
      const obj = detail as { code?: string; message: string };
      throw new ApiError(res.status, obj.code ?? 'API_ERROR', obj.message);
    }
    const msg = typeof detail === 'string' ? detail : `Request failed with status ${res.status}`;
    throw new ApiError(res.status, 'API_ERROR', msg);
  }

  return data as T;
}

export async function operatorLogin(secret: string): Promise<{ token: string; role: string; expires_at: string }> {
  const result = await apiFetch<{ token: string; role: string; expires_at: string }>(
    '/api/operator/login',
    { method: 'POST', body: JSON.stringify({ secret }) },
    null,
  );
  setStoredOperatorToken(result.token);
  return result;
}

export async function operatorMe(): Promise<{ actor: string; role: string; expires_at: string }> {
  return apiFetch('/api/operator/me');
}

export async function listBatches(datasetKey?: string): Promise<BatchSummary[]> {
  const query = datasetKey ? `?dataset_key=${encodeURIComponent(datasetKey)}` : '';
  const data = await apiFetch<{ batches: BatchSummary[] }>(`/api/batches${query}`);
  return data.batches;
}

export async function getBatchTrace(batchCode: string): Promise<BatchTraceSummary> {
  return apiFetch<BatchTraceSummary>(`/api/batches/${encodeURIComponent(batchCode)}/trace`);
}

export async function listRecalls(): Promise<RecallListItem[]> {
  const data = await apiFetch<{ recalls: RecallListItem[] }>('/api/recalls');
  return data.recalls;
}

export async function getRecall(recallId: string): Promise<RecallOverview> {
  return apiFetch<RecallOverview>(`/api/recalls/${encodeURIComponent(recallId)}`);
}

export async function publishRecall(payload: {
  batch_code: string;
  notice_text?: string;
  notice_version?: number;
  is_drill?: boolean;
}): Promise<RecallOverview> {
  return apiFetch<RecallOverview>('/api/recalls', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getScopedTask(accessToken: string): Promise<ScopedTaskView> {
  return apiFetch<ScopedTaskView>(`/api/tasks/${encodeURIComponent(accessToken)}`, {}, null);
}

export async function submitTaskResponse(
  accessToken: string,
  payload: TaskResponsePayload,
): Promise<TaskResponseResult> {
  return apiFetch<TaskResponseResult>(
    `/api/tasks/${encodeURIComponent(accessToken)}/response`,
    { method: 'POST', body: JSON.stringify(payload) },
    null,
  );
}

export async function getTaskAudit(taskId: string): Promise<AuditEventItem[]> {
  const data = await apiFetch<{ events: AuditEventItem[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/audit`,
  );
  return data.events;
}

export async function joinStudy(existingToken?: string | null, isPractice = false): Promise<JoinStudyResponse> {
  return apiFetch<JoinStudyResponse>(
    '/api/join',
    {
      method: 'POST',
      body: JSON.stringify({
        existing_token: existingToken ?? null,
        is_practice: isPractice,
      }),
    },
    null,
  );
}

export async function getTaskQr(taskId: string, baseUrl?: string): Promise<TaskQrPayload> {
  const params = new URLSearchParams({ format: 'json' });
  if (baseUrl) params.set('base_url', baseUrl);
  return apiFetch<TaskQrPayload>(`/api/tasks/${encodeURIComponent(taskId)}/qr?${params.toString()}`);
}

export async function resetPracticeFixture(): Promise<PracticeResetResponse> {
  return apiFetch<PracticeResetResponse>('/api/practice/reset', { method: 'POST' });
}

export async function startDrillSession(scopedToken: string): Promise<DrillSessionState> {
  return apiFetch<DrillSessionState>(
    `/api/sessions/${encodeURIComponent(scopedToken)}/start`,
    { method: 'POST' },
    null,
  );
}

export async function acknowledgeSessionRendered(scopedToken: string): Promise<DrillSessionState> {
  return apiFetch<DrillSessionState>(
    `/api/sessions/${encodeURIComponent(scopedToken)}/rendered`,
    { method: 'POST' },
    null,
  );
}

export async function submitDrillSession(
  scopedToken: string,
  payload: TaskResponsePayload,
): Promise<DrillSessionState> {
  return apiFetch<DrillSessionState>(
    `/api/sessions/${encodeURIComponent(scopedToken)}/submit`,
    { method: 'POST', body: JSON.stringify(payload) },
    null,
  );
}

export async function getExperimentSummary(includePractice = false): Promise<ExperimentSummaryResponse> {
  return apiFetch<ExperimentSummaryResponse>(
    `/api/experiments/summary?include_practice=${includePractice ? 'true' : 'false'}`,
  );
}

export async function dispatchExperimentOutbox(): Promise<{
  attempted: number;
  dispatched: number;
  failed: number;
  pending_remaining: number;
}> {
  return apiFetch('/api/experiments/outbox/dispatch', { method: 'POST' });
}

export async function downloadExperimentCsv(includePractice = false): Promise<string> {
  const token = getStoredOperatorToken();
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(
    `/api/experiments/export.csv?include_practice=${includePractice ? 'true' : 'false'}`,
    { headers, credentials: 'include' },
  );
  if (!res.ok) {
    throw new ApiError(res.status, 'EXPORT_FAILED', 'Operator sign-in required to export CSV.');
  }
  return res.text();
}
