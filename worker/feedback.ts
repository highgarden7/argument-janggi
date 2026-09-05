/** Anonymous issue/suggestion box, reviewed via /admin with a shared password. */
type FeedbackEnv = { DB: D1Database };
type FeedbackRow = { id: number; title: string; content: string; created_at: number };

const ADMIN_PASSWORD = "Admin123!";
const TITLE_MAX = 80;
const CONTENT_MAX = 4000;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function body<T>(request: Request): Promise<T | null> {
  try { return await request.json() as T; } catch { return null; }
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, max);
  return text ? text : null;
}

function isAdmin(request: Request): boolean {
  return request.headers.get("X-Admin-Password") === ADMIN_PASSWORD;
}

async function createFeedback(request: Request, env: FeedbackEnv): Promise<Response> {
  const payload = await body<{ title?: unknown; content?: unknown }>(request);
  const title = cleanText(payload?.title, TITLE_MAX);
  const content = cleanText(payload?.content, CONTENT_MAX);
  if (!title) return error("제목을 입력하세요.");
  if (!content) return error("내용을 입력하세요.");
  await env.DB.prepare("INSERT INTO feedback (title, content, created_at) VALUES (?, ?, ?)")
    .bind(title, content, Date.now()).run();
  return json({ ok: true }, 201);
}

async function listFeedback(request: Request, env: FeedbackEnv): Promise<Response> {
  if (!isAdmin(request)) return error("비밀번호가 올바르지 않습니다.", 401);
  const { results } = await env.DB.prepare("SELECT * FROM feedback ORDER BY created_at DESC").all<FeedbackRow>();
  return json({
    items: (results ?? []).map((row) => ({ id: row.id, title: row.title, content: row.content, createdAt: row.created_at })),
  });
}

export async function handleFeedbackRequest(request: Request, env: FeedbackEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/feedback" && request.method === "POST") return createFeedback(request, env);
  if (url.pathname === "/api/admin/feedback" && request.method === "GET") return listFeedback(request, env);
  if (url.pathname === "/api/feedback" || url.pathname === "/api/admin/feedback") return error("지원하지 않는 요청입니다.", 405);
  return null;
}
