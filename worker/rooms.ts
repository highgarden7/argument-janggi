import { createGame, migrateGameState, projectGameView, reduceGame } from "../app/game/engine";
import { opponent } from "../app/game/model";
import type { Formation, GameCommand, GameState, Side } from "../app/game/model";
import { MATCH_ACCEPT_MS, MATCH_LOBBY_MS } from "../app/game/multiplayer";
import type { RoomRole, RoomSideChoice, RoomView } from "../app/game/multiplayer";

type RoomEnv = { DB: D1Database };
type RoomRow = {
  code: string;
  host_token_hash: string;
  guest_token_hash: string | null;
  host_name: string;
  guest_name: string | null;
  side_choice: RoomSideChoice;
  host_side: Side | null;
  host_formation: Formation;
  guest_formation: Formation;
  augments: number;
  host_ready: number;
  guest_ready: number;
  status: "matching" | "waiting" | "playing" | "finished";
  game_json: string | null;
  match_number: number;
  action_started_at: number | null;
  revision: number;
  created_at: number;
  updated_at: number;
  expires_at: number;
  is_public: number;
  host_accepted: number;
  guest_accepted: number;
  matched_at: number | null;
};

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/** 매칭된 방은 짧게만 살려 둔다. 수락 20초 + 대기실 60초를 넘기면 정리 대상이다. */
const QUEUE_STALE_MS = 15_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FORMATIONS = new Set<Formation>(["귀마", "원앙마", "면상", "양귀마"]);
const COMMAND_TYPES = new Set([
  "MOVE_PIECE", "USE_UIBYEONG_REST", "DEPLOY_JANGDOLBAENGI_RESERVE", "DEPLOY_HUNSUKKUN_RESERVE",
  "PICK_AUGMENT", "USE_AUGMENT", "RESIGN",
]);

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function body<T>(request: Request): Promise<T | null> {
  try { return await request.json() as T; } catch { return null; }
}

function cleanNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const nickname = value.trim().slice(0, 12);
  return nickname ? nickname : null;
}

function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requestToken(request: Request): string | null {
  const value = request.headers.get("Authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : null;
}

async function readRoom(db: D1Database, code: string): Promise<RoomRow | null> {
  return db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<RoomRow>();
}

async function authenticate(request: Request, row: RoomRow): Promise<RoomRole | null> {
  const token = requestToken(request);
  if (!token) return null;
  const hash = await hashToken(token);
  if (hash === row.host_token_hash) return "host";
  if (hash === row.guest_token_hash) return "guest";
  return null;
}

function parseGame(row: RoomRow): GameState | undefined {
  if (!row.game_json) return undefined;
  try { return migrateGameState(JSON.parse(row.game_json) as GameState); } catch { return undefined; }
}

function sideFor(row: RoomRow, role: RoomRole): Side | undefined {
  if (!row.host_side) return undefined;
  return role === "host" ? row.host_side : opponent(row.host_side);
}

function advanceClock(row: RoomRow, now: number): { game?: GameState; changed: boolean } {
  const game = parseGame(row);
  if (!game || row.status !== "playing" || game.winner || !row.action_started_at) return { game, changed: false };
  const elapsedMs = Math.max(0, now - row.action_started_at);
  if (!elapsedMs) return { game, changed: false };
  const actor = game.draft?.side ?? game.turn;
  const transition = reduceGame(game, { type: "ADVANCE_CLOCK", elapsedMs }, actor);
  return { game: transition.accepted ? transition.state : game, changed: transition.accepted };
}

function matchDeadline(row: RoomRow, now: number): number | undefined {
  if (!row.is_public || !row.matched_at) return undefined;
  const limit = row.status === "matching" ? MATCH_ACCEPT_MS : row.status === "waiting" ? MATCH_LOBBY_MS : 0;
  return limit ? Math.max(0, row.matched_at + limit - now) : undefined;
}

function roomView(row: RoomRow, role: RoomRole, game = parseGame(row)): RoomView {
  const playerSide = sideFor(row, role);
  const mineAccepted = role === "host" ? !!row.host_accepted : !!row.guest_accepted;
  const theirsAccepted = role === "host" ? !!row.guest_accepted : !!row.host_accepted;
  return {
    code: row.code,
    status: game?.winner ? "finished" : row.status,
    isPublic: !!row.is_public,
    matched: row.status === "matching" && !!row.guest_token_hash,
    accepted: row.is_public ? { mine: mineAccepted, theirs: theirsAccepted } : undefined,
    deadlineMs: matchDeadline(row, Date.now()),
    revision: row.revision,
    matchNumber: row.match_number,
    viewerRole: role,
    playerSide,
    hostSide: row.host_side ?? undefined,
    sideChoice: row.side_choice,
    augments: !!row.augments,
    host: { nickname: row.host_name, ready: !!row.host_ready, formation: role === "host" ? row.host_formation : undefined },
    guest: row.guest_name ? { nickname: row.guest_name, ready: !!row.guest_ready, formation: role === "guest" ? row.guest_formation : undefined } : undefined,
    draftSide: game?.draft?.side,
    game: game && playerSide ? projectGameView(game, playerSide) : undefined,
  };
}

async function persistGame(db: D1Database, row: RoomRow, game: GameState, now: number): Promise<boolean> {
  const status = game.winner ? "finished" : "playing";
  const result = await db.prepare("UPDATE rooms SET game_json = ?, status = ?, action_started_at = ?, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND revision = ?")
    .bind(JSON.stringify(game), status, now, now, now + ROOM_TTL_MS, row.code, row.revision).run();
  return (result.meta.changes ?? 0) === 1;
}

async function createRoom(request: Request, env: RoomEnv): Promise<Response> {
  const payload = await body<{ nickname?: unknown }>(request);
  const nickname = cleanNickname(payload?.nickname);
  if (!nickname) return error("닉네임을 입력하세요.");
  const token = crypto.randomUUID();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeCode();
    try {
      await env.DB.prepare("INSERT INTO rooms (code, host_token_hash, host_name, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(code, tokenHash, nickname, now, now, now + ROOM_TTL_MS).run();
      const row = await readRoom(env.DB, code);
      if (row) return json({ token, room: roomView(row, "host") }, 201);
    } catch (cause) {
      if (attempt === 5) throw cause;
    }
  }
  return error("방 코드를 만들지 못했습니다.", 500);
}

async function joinRoom(request: Request, env: RoomEnv, code: string): Promise<Response> {
  const payload = await body<{ nickname?: unknown }>(request);
  const nickname = cleanNickname(payload?.nickname);
  if (!nickname) return error("닉네임을 입력하세요.");
  const row = await readRoom(env.DB, code);
  if (!row || row.expires_at < Date.now()) return error("존재하지 않거나 만료된 방입니다.", 404);
  if (row.guest_token_hash) return error("이미 두 명이 입장한 방입니다.", 409);
  if (row.status !== "waiting") return error("이미 대국이 시작된 방입니다.", 409);
  const token = crypto.randomUUID();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const result = await env.DB.prepare("UPDATE rooms SET guest_token_hash = ?, guest_name = ?, guest_ready = 0, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND revision = ? AND guest_token_hash IS NULL")
    .bind(tokenHash, nickname, now, now + ROOM_TTL_MS, code, row.revision).run();
  if ((result.meta.changes ?? 0) !== 1) return error("다른 플레이어가 먼저 입장했습니다.", 409);
  const updated = await readRoom(env.DB, code);
  return updated ? json({ token, room: roomView(updated, "guest") }) : error("방을 불러오지 못했습니다.", 500);
}

/** 빠른 대국 방이 수락·대기실 제한시간을 넘겼는지. 넘겼으면 방을 접는다. */
function matchExpired(row: RoomRow, now: number): boolean {
  if (!row.is_public || !row.matched_at) return false;
  if (row.status === "matching") return now > row.matched_at + MATCH_ACCEPT_MS;
  if (row.status === "waiting") return now > row.matched_at + MATCH_LOBBY_MS && !(row.host_ready && row.guest_ready);
  return false;
}

async function getRoom(request: Request, env: RoomEnv, code: string): Promise<Response> {
  let row = await readRoom(env.DB, code);
  if (!row || row.expires_at < Date.now()) return error("존재하지 않거나 만료된 방입니다.", 404);
  const role = await authenticate(request, row);
  if (!role) return error("방 입장 정보가 올바르지 않습니다.", 401);
  const now = Date.now();
  if (matchExpired(row, now)) {
    await env.DB.prepare("DELETE FROM rooms WHERE code = ?").bind(code).run();
    return error("상대가 시간 안에 응하지 않아 매칭이 취소되었습니다.", 404);
  }
  // 대기 중인 빠른 대국 방은 폴링을 심박으로 삼는다. revision은 건드리지 않는다.
  if (row.is_public && row.status === "matching" && !row.guest_token_hash) {
    await env.DB.prepare("UPDATE rooms SET updated_at = ? WHERE code = ?").bind(now, code).run();
  }
  const advanced = advanceClock(row, now);
  const shouldPersist = !!advanced.game && (advanced.game.winner || advanced.game.draft?.side !== parseGame(row)?.draft?.side);
  if (shouldPersist && advanced.game && await persistGame(env.DB, row, advanced.game, now)) row = (await readRoom(env.DB, code)) ?? row;
  return json({ room: roomView(row, role, shouldPersist ? parseGame(row) : advanced.game) });
}

async function updateSettings(request: Request, env: RoomEnv, row: RoomRow, role: RoomRole): Promise<Response> {
  if (role !== "host") return error("방장만 대국 설정을 변경할 수 있습니다.", 403);
  if (row.is_public) return error("빠른 대국은 진영 무작위·증강 사용으로 고정됩니다.", 409);
  if (row.status !== "waiting") return error("대기실에서만 설정을 변경할 수 있습니다.", 409);
  const payload = await body<{ sideChoice?: unknown; augments?: unknown }>(request);
  const sideChoice = payload?.sideChoice;
  if (sideChoice !== "cho" && sideChoice !== "han" && sideChoice !== "random") return error("초·한·무작위 중 하나를 선택하세요.");
  if (typeof payload?.augments !== "boolean") return error("증강 사용 여부를 선택하세요.");
  const now = Date.now();
  await env.DB.prepare("UPDATE rooms SET side_choice = ?, augments = ?, host_ready = 0, guest_ready = 0, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND revision = ?")
    .bind(sideChoice, payload.augments ? 1 : 0, now, now + ROOM_TTL_MS, row.code, row.revision).run();
  const updated = await readRoom(env.DB, row.code);
  return updated ? json({ room: roomView(updated, role) }) : error("방 설정을 저장하지 못했습니다.", 500);
}

/** Each player owns their own formation, so a change only clears that player's ready flag. */
async function updateFormation(request: Request, env: RoomEnv, row: RoomRow, role: RoomRole): Promise<Response> {
  if (row.status !== "waiting") return error("대기실에서만 포진을 변경할 수 있습니다.", 409);
  const payload = await body<{ formation?: unknown }>(request);
  const formation = payload?.formation as Formation;
  if (!FORMATIONS.has(formation)) return error("귀마·원앙마·면상·양귀마 중 하나를 선택하세요.");
  const column = role === "host" ? "host_formation" : "guest_formation";
  const readyColumn = role === "host" ? "host_ready" : "guest_ready";
  const now = Date.now();
  const result = await env.DB.prepare(`UPDATE rooms SET ${column} = ?, ${readyColumn} = 0, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND revision = ?`)
    .bind(formation, now, now + ROOM_TTL_MS, row.code, row.revision).run();
  if ((result.meta.changes ?? 0) !== 1) return error("방 상태가 갱신되었습니다. 다시 시도하세요.", 409);
  const updated = await readRoom(env.DB, row.code);
  return updated ? json({ room: roomView(updated, role) }) : error("포진을 저장하지 못했습니다.", 500);
}

async function setReady(request: Request, env: RoomEnv, row: RoomRow, role: RoomRole): Promise<Response> {
  if (row.status !== "waiting") return error("이미 대국이 시작되었습니다.", 409);
  const payload = await body<{ ready?: unknown }>(request);
  if (typeof payload?.ready !== "boolean") return error("준비 상태가 올바르지 않습니다.");
  const column = role === "host" ? "host_ready" : "guest_ready";
  const now = Date.now();
  const result = await env.DB.prepare(`UPDATE rooms SET ${column} = ?, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND revision = ?`)
    .bind(payload.ready ? 1 : 0, now, now + ROOM_TTL_MS, row.code, row.revision).run();
  if ((result.meta.changes ?? 0) !== 1) return error("준비 상태가 갱신되었습니다. 다시 시도하세요.", 409);
  let updated = await readRoom(env.DB, row.code);
  if (!updated) return error("방을 불러오지 못했습니다.", 500);
  if (updated.host_ready && updated.guest_ready && updated.guest_name) {
    const hostSide: Side = updated.side_choice === "random" ? (crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? "cho" : "han") : updated.side_choice;
    const formations: Record<Side, Formation> = hostSide === "cho"
      ? { cho: updated.host_formation, han: updated.guest_formation }
      : { cho: updated.guest_formation, han: updated.host_formation };
    const game = createGame(formations, !!updated.augments, randomSeed());
    // 수락 표시는 대국이 시작될 때 비워 두고, 끝난 뒤 재대결 합의에 다시 쓴다.
    const started = await env.DB.prepare("UPDATE rooms SET host_side = ?, status = 'playing', game_json = ?, match_number = match_number + 1, action_started_at = ?, host_accepted = 0, guest_accepted = 0, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND revision = ? AND host_ready = 1 AND guest_ready = 1")
      .bind(hostSide, JSON.stringify(game), now, now, now + ROOM_TTL_MS, updated.code, updated.revision).run();
    if ((started.meta.changes ?? 0) === 1) updated = (await readRoom(env.DB, row.code)) ?? updated;
  }
  return json({ room: roomView(updated, role) });
}

async function submitCommand(request: Request, env: RoomEnv, row: RoomRow, role: RoomRole): Promise<Response> {
  if (row.status !== "playing") return error("현재 진행 중인 대국이 없습니다.", 409);
  const payload = await body<{ expectedRevision?: unknown; command?: GameCommand }>(request);
  if (!Number.isInteger(payload?.expectedRevision) || payload?.expectedRevision !== row.revision) return error("상대의 행동이 먼저 반영되었습니다. 판을 새로 불러옵니다.", 409);
  if (!payload?.command || !COMMAND_TYPES.has(payload.command.type)) return error("지원하지 않는 대국 명령입니다.");
  const actor = sideFor(row, role);
  if (!actor) return error("진영이 아직 결정되지 않았습니다.", 409);
  const now = Date.now();
  const advanced = advanceClock(row, now).game;
  if (!advanced) return error("대국 상태를 불러오지 못했습니다.", 500);
  if (advanced.winner) {
    await persistGame(env.DB, row, advanced, now);
    const updated = (await readRoom(env.DB, row.code)) ?? row;
    return json({ room: roomView(updated, role) }, 409);
  }
  const transition = reduceGame(advanced, payload.command, actor);
  if (!transition.accepted) return error(transition.error?.message ?? "지금은 실행할 수 없습니다.");
  if (!await persistGame(env.DB, row, transition.state, now)) return error("상대의 행동이 먼저 반영되었습니다. 판을 새로 불러옵니다.", 409);
  const updated = (await readRoom(env.DB, row.code)) ?? row;
  return json({ room: roomView(updated, role) });
}

async function returnToLobby(env: RoomEnv, row: RoomRow, role: RoomRole): Promise<Response> {
  if (row.status !== "finished" && !parseGame(row)?.winner) return error("대국이 끝난 뒤 대기실로 돌아갈 수 있습니다.", 409);
  const now = Date.now();
  await env.DB.prepare("UPDATE rooms SET status = 'waiting', host_side = NULL, host_ready = 0, guest_ready = 0, game_json = NULL, action_started_at = NULL, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND revision = ?")
    .bind(now, now + ROOM_TTL_MS, row.code, row.revision).run();
  const updated = await readRoom(env.DB, row.code);
  return updated ? json({ room: roomView(updated, role) }) : error("대기실로 돌아가지 못했습니다.", 500);
}

/**
 * 빠른 대국. 대기 중인 공개 방이 있으면 바로 들어가고, 없으면 새 공개 방을 만들어 기다린다.
 * 대기열을 따로 두지 않고 `is_public` 방 자체를 큐로 쓰므로 상태가 하나뿐이다.
 */
async function quickMatch(request: Request, env: RoomEnv): Promise<Response> {
  const payload = await body<{ nickname?: unknown }>(request);
  const nickname = cleanNickname(payload?.nickname);
  if (!nickname) return error("닉네임을 입력하세요.");
  const now = Date.now();
  await sweepStaleRooms(env.DB, now);

  // 먼저 기다리고 있던 방부터 채운다. 조건부 UPDATE라 동시에 눌러도 한 명만 들어간다.
  const waiting = await env.DB.prepare(
    "SELECT * FROM rooms WHERE is_public = 1 AND status = 'matching' AND guest_token_hash IS NULL AND updated_at > ? ORDER BY created_at ASC LIMIT 5",
  ).bind(now - QUEUE_STALE_MS).all<RoomRow>();
  const token = crypto.randomUUID();
  const tokenHash = await hashToken(token);
  for (const row of waiting.results ?? []) {
    const claimed = await env.DB.prepare(
      "UPDATE rooms SET guest_token_hash = ?, guest_name = ?, matched_at = ?, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND revision = ? AND guest_token_hash IS NULL AND status = 'matching'",
    ).bind(tokenHash, nickname, now, now, now + ROOM_TTL_MS, row.code, row.revision).run();
    if ((claimed.meta.changes ?? 0) !== 1) continue;
    const updated = await readRoom(env.DB, row.code);
    if (updated) return json({ token, room: roomView(updated, "guest") });
  }

  // 상대가 없으면 내가 대기열이 된다.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeCode();
    try {
      await env.DB.prepare(
        "INSERT INTO rooms (code, host_token_hash, host_name, status, is_public, side_choice, augments, created_at, updated_at, expires_at) VALUES (?, ?, ?, 'matching', 1, 'random', 1, ?, ?, ?)",
      ).bind(code, tokenHash, nickname, now, now, now + ROOM_TTL_MS).run();
      const row = await readRoom(env.DB, code);
      if (row) return json({ token, room: roomView(row, "host") }, 201);
    } catch (cause) {
      if (attempt === 5) throw cause;
    }
  }
  return error("대기열에 들어가지 못했습니다.", 500);
}

/** 매칭된 뒤 양쪽이 시작을 누르면 대기실로 넘어간다. 한쪽이라도 안 누르면 열리지 않는다. */
async function acceptMatch(env: RoomEnv, row: RoomRow, role: RoomRole): Promise<Response> {
  if (!row.is_public) return error("빠른 대국 방이 아닙니다.", 409);
  if (row.status !== "matching") return error("이미 지난 매칭입니다.", 409);
  if (!row.guest_token_hash) return error("아직 상대를 찾는 중입니다.", 409);
  const now = Date.now();
  if (row.matched_at && now > row.matched_at + MATCH_ACCEPT_MS) return error("수락 시간이 지났습니다.", 409);
  // 각자 자기 표시만 세우므로 revision을 걸지 않는다. 양쪽이 같은 순간에 눌러도 둘 다 기록된다.
  const column = role === "host" ? "host_accepted" : "guest_accepted";
  await env.DB.prepare(
    `UPDATE rooms SET ${column} = 1, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND status = 'matching' AND ${column} = 0`,
  ).bind(now, now + ROOM_TTL_MS, row.code).run();
  let updated = await readRoom(env.DB, row.code);
  if (!updated) return error("방을 불러오지 못했습니다.", 500);
  if (updated.status === "matching" && updated.host_accepted && updated.guest_accepted) {
    // 대기실 시계는 이때부터 다시 센다. 노쇼 정리는 matched_at 기준이다.
    await env.DB.prepare(
      "UPDATE rooms SET status = 'waiting', matched_at = ?, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND status = 'matching'",
    ).bind(now, now, now + ROOM_TTL_MS, updated.code).run();
    updated = (await readRoom(env.DB, row.code)) ?? updated;
  }
  return json({ room: roomView(updated, role) });
}

/** 대기 중 취소. 상대가 이미 들어왔다면 취소 대신 매칭 화면을 그대로 유지한다. */
async function cancelMatch(env: RoomEnv, row: RoomRow, role: RoomRole): Promise<Response> {
  if (!row.is_public || row.status !== "matching") return error("취소할 수 있는 대기열이 아닙니다.", 409);
  if (role === "host" && !row.guest_token_hash) {
    const removed = await env.DB.prepare(
      "DELETE FROM rooms WHERE code = ? AND revision = ? AND guest_token_hash IS NULL AND status = 'matching'",
    ).bind(row.code, row.revision).run();
    if ((removed.meta.changes ?? 0) === 1) return json({ cancelled: true });
    const updated = await readRoom(env.DB, row.code);
    return updated ? json({ room: roomView(updated, role) }) : json({ cancelled: true });
  }
  // 매칭이 성사된 뒤의 이탈은 방을 접고 남은 쪽이 다시 큐를 타게 한다.
  await env.DB.prepare("DELETE FROM rooms WHERE code = ?").bind(row.code).run();
  return json({ cancelled: true });
}

/**
 * 빠른 대국의 재대결. 양쪽이 요청하면 친선전과 같은 자유 설정 대기실로 바뀐다.
 * 이때 `is_public`을 내려 진영·증강을 다시 고를 수 있게 하고 노쇼 시계도 뗀다.
 */
async function requestRematch(env: RoomEnv, row: RoomRow, role: RoomRole): Promise<Response> {
  if (!row.is_public) return error("빠른 대국 방이 아닙니다.", 409);
  if (row.status !== "finished" && !parseGame(row)?.winner) return error("대국이 끝난 뒤 재대결을 요청할 수 있습니다.", 409);
  const now = Date.now();
  // 수락과 마찬가지로 자기 표시만 세운다. 동시에 눌러도 한쪽이 밀려나지 않는다.
  const column = role === "host" ? "host_accepted" : "guest_accepted";
  await env.DB.prepare(
    `UPDATE rooms SET ${column} = 1, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND status = ? AND ${column} = 0`,
  ).bind(now, now + ROOM_TTL_MS, row.code, row.status).run();
  let updated = await readRoom(env.DB, row.code);
  if (!updated) return error("방을 불러오지 못했습니다.", 500);
  if (updated.status === row.status && updated.host_accepted && updated.guest_accepted) {
    await env.DB.prepare(
      "UPDATE rooms SET status = 'waiting', is_public = 0, host_side = NULL, host_ready = 0, guest_ready = 0, host_accepted = 0, guest_accepted = 0, game_json = NULL, action_started_at = NULL, matched_at = NULL, updated_at = ?, expires_at = ?, revision = revision + 1 WHERE code = ? AND status = ?",
    ).bind(now, now + ROOM_TTL_MS, updated.code, row.status).run();
    updated = (await readRoom(env.DB, row.code)) ?? updated;
  }
  return json({ room: roomView(updated, role) });
}

/** 수락을 안 하거나 대기실에서 준비하지 않고 사라진 방을 걷어낸다. */
async function sweepStaleRooms(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM rooms WHERE is_public = 1 AND status = 'matching' AND guest_token_hash IS NULL AND updated_at <= ?").bind(now - QUEUE_STALE_MS),
    db.prepare("DELETE FROM rooms WHERE is_public = 1 AND status = 'matching' AND matched_at IS NOT NULL AND matched_at <= ?").bind(now - MATCH_ACCEPT_MS),
    db.prepare("DELETE FROM rooms WHERE is_public = 1 AND status = 'waiting' AND matched_at IS NOT NULL AND matched_at <= ? AND (host_ready = 0 OR guest_ready = 0)").bind(now - MATCH_LOBBY_MS),
    db.prepare("DELETE FROM rooms WHERE expires_at <= ?").bind(now),
  ]);
}

export async function handleRoomRequest(request: Request, env: RoomEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/rooms" && request.method === "POST") return createRoom(request, env);
  if (url.pathname === "/api/rooms/quick" && request.method === "POST") return quickMatch(request, env);
  const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|settings|formation|ready|command|lobby|accept|cancel|rematch))?$/i);
  if (!match) return url.pathname.startsWith("/api/rooms") ? error("요청한 방 기능을 찾을 수 없습니다.", 404) : null;
  const code = match[1].toUpperCase();
  const action = match[2];
  if (action === "join" && request.method === "POST") return joinRoom(request, env, code);
  const row = await readRoom(env.DB, code);
  if (!row || row.expires_at < Date.now()) return error("존재하지 않거나 만료된 방입니다.", 404);
  const role = await authenticate(request, row);
  if (!role) return error("방 입장 정보가 올바르지 않습니다.", 401);
  if (!action && request.method === "GET") return getRoom(request, env, code);
  if (action === "settings" && request.method === "PATCH") return updateSettings(request, env, row, role);
  if (action === "formation" && request.method === "PATCH") return updateFormation(request, env, row, role);
  if (action === "ready" && request.method === "POST") return setReady(request, env, row, role);
  if (action === "command" && request.method === "POST") return submitCommand(request, env, row, role);
  if (action === "lobby" && request.method === "POST") return returnToLobby(env, row, role);
  if (action === "accept" && request.method === "POST") return acceptMatch(env, row, role);
  if (action === "cancel" && request.method === "POST") return cancelMatch(env, row, role);
  if (action === "rematch" && request.method === "POST") return requestRematch(env, row, role);
  return error("지원하지 않는 요청입니다.", 405);
}
