import assert from "node:assert/strict";
import test from "node:test";
import { FORMATION_BACK_RANK, legalMoves } from "../app/game/engine";
import type { GameState, Side } from "../app/game/model";
import type { RoomView } from "../app/game/multiplayer";
import { handleRoomRequest } from "../worker/rooms";

type StoredRoom = Record<string, unknown> & { code: string; revision: number };

function blankRoom(code: unknown, hostTokenHash: unknown, hostName: unknown, createdAt: unknown, updatedAt: unknown, expiresAt: unknown) {
  return {
    code, host_token_hash: hostTokenHash, guest_token_hash: null, host_name: hostName, guest_name: null,
    side_choice: "random", host_side: null, host_formation: "귀마", guest_formation: "귀마",
    augments: 1, host_ready: 0, guest_ready: 0,
    status: "waiting", game_json: null, match_number: 0, action_started_at: null, revision: 0,
    created_at: createdAt, updated_at: updatedAt, expires_at: expiresAt,
    is_public: 0, host_accepted: 0, guest_accepted: 0, matched_at: null,
  };
}

function update(db: MemoryD1, values: unknown[], codeIndex: number, revisionIndex: number, mutate: (row: StoredRoom) => void) {
  const row = db.rooms.get(String(values[codeIndex]));
  if (!row || row.revision !== values[revisionIndex]) return { meta: { changes: 0 } };
  mutate(row);
  row.revision += 1;
  return { meta: { changes: 1 } };
}

class MemoryStatement {
  private values: unknown[] = [];
  constructor(private readonly db: MemoryD1, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() {
    if (!this.sql.startsWith("SELECT * FROM rooms WHERE code = ?")) return null;
    const row = this.db.rooms.get(String(this.values[0]));
    return (row ? structuredClone(row) : null) as T | null;
  }
  async all<T>() {
    // 빠른 대국이 대기 중인 공개 방을 훑는 질의만 지원한다.
    if (!this.sql.startsWith("SELECT * FROM rooms WHERE is_public = 1")) return { results: [] as T[] };
    const since = Number(this.values[0]);
    const results = [...this.db.rooms.values()]
      .filter(row => row.is_public === 1 && row.status === "matching" && row.guest_token_hash === null && Number(row.updated_at) > since)
      .sort((a, b) => Number(a.created_at) - Number(b.created_at))
      .slice(0, 5)
      .map(row => structuredClone(row));
    return { results: results as T[] };
  }
  async run() {
    if (this.sql.startsWith("INSERT INTO rooms (code, host_token_hash, host_name, status, is_public")) {
      const [code, hostTokenHash, hostName, createdAt, updatedAt, expiresAt] = this.values;
      if (this.db.rooms.has(String(code))) throw new Error("duplicate room");
      this.db.rooms.set(String(code), {
        ...blankRoom(code, hostTokenHash, hostName, createdAt, updatedAt, expiresAt),
        status: "matching", is_public: 1,
      } as StoredRoom);
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("INSERT INTO rooms")) {
      const [code, hostTokenHash, hostName, createdAt, updatedAt, expiresAt] = this.values;
      if (this.db.rooms.has(String(code))) throw new Error("duplicate room");
      this.db.rooms.set(String(code), blankRoom(code, hostTokenHash, hostName, createdAt, updatedAt, expiresAt) as StoredRoom);
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM rooms WHERE code = ? AND revision = ?")) {
      const row = this.db.rooms.get(String(this.values[0]));
      if (!row || row.revision !== this.values[1] || row.guest_token_hash !== null || row.status !== "matching") return { meta: { changes: 0 } };
      this.db.rooms.delete(String(this.values[0]));
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM rooms WHERE code = ?")) {
      const existed = this.db.rooms.delete(String(this.values[0]));
      return { meta: { changes: existed ? 1 : 0 } };
    }
    if (this.sql.startsWith("DELETE FROM rooms")) return { meta: { changes: 0 } };
    if (this.sql.startsWith("UPDATE rooms SET updated_at = ? WHERE code = ?")) {
      const row = this.db.rooms.get(String(this.values[1]));
      if (row) row.updated_at = this.values[0];
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith("UPDATE rooms SET guest_token_hash = ?, guest_name = ?, matched_at")) return update(this.db, this.values, 5, 6, row => {
      if (row.guest_token_hash !== null || row.status !== "matching") return;
      [row.guest_token_hash, row.guest_name, row.matched_at, row.updated_at, row.expires_at] = this.values;
    });
    if (this.sql.startsWith("UPDATE rooms SET host_accepted") || this.sql.startsWith("UPDATE rooms SET guest_accepted")) return update(this.db, this.values, 2, 3, row => {
      row[this.sql.includes("host_accepted") ? "host_accepted" : "guest_accepted"] = 1;
      [row.updated_at, row.expires_at] = this.values;
    });
    if (this.sql.startsWith("UPDATE rooms SET status = 'waiting', matched_at")) return update(this.db, this.values, 3, 4, row => {
      if (row.status !== "matching") return;
      [row.matched_at, row.updated_at, row.expires_at] = this.values;
      row.status = "waiting";
    });
    // 재대결 합의: 빠른 대국 방을 친선전과 같은 자유 설정 대기실로 되돌린다.
    if (this.sql.startsWith("UPDATE rooms SET status = 'waiting', is_public = 0")) return update(this.db, this.values, 2, 3, row => {
      [row.updated_at, row.expires_at] = this.values;
      Object.assign(row, {
        status: "waiting", is_public: 0, host_side: null, host_ready: 0, guest_ready: 0,
        host_accepted: 0, guest_accepted: 0, game_json: null, action_started_at: null, matched_at: null,
      });
    });

    if (this.sql.startsWith("UPDATE rooms SET guest_token_hash")) return update(this.db, this.values, 4, 5, row => {
      if (row.guest_token_hash !== null) return;
      [row.guest_token_hash, row.guest_name, row.updated_at, row.expires_at] = this.values;
      row.guest_ready = 0;
    });
    if (this.sql.startsWith("UPDATE rooms SET side_choice")) return update(this.db, this.values, 4, 5, row => {
      [row.side_choice, row.augments, row.updated_at, row.expires_at] = this.values;
      row.host_ready = 0;
      row.guest_ready = 0;
    });
    if (this.sql.startsWith("UPDATE rooms SET host_formation") || this.sql.startsWith("UPDATE rooms SET guest_formation")) return update(this.db, this.values, 3, 4, row => {
      const host = this.sql.includes("host_formation");
      row[host ? "host_formation" : "guest_formation"] = this.values[0];
      row[host ? "host_ready" : "guest_ready"] = 0;
      [row.updated_at, row.expires_at] = this.values.slice(1, 3);
    });
    if (this.sql.startsWith("UPDATE rooms SET host_ready") || this.sql.startsWith("UPDATE rooms SET guest_ready")) return update(this.db, this.values, 3, 4, row => {
      row[this.sql.includes("host_ready") ? "host_ready" : "guest_ready"] = this.values[0];
      [row.updated_at, row.expires_at] = this.values.slice(1, 3);
    });
    if (this.sql.startsWith("UPDATE rooms SET host_side")) return update(this.db, this.values, 5, 6, row => {
      [row.host_side, row.game_json, row.action_started_at, row.updated_at, row.expires_at] = this.values;
      row.status = "playing";
      row.match_number = Number(row.match_number) + 1;
      row.host_accepted = 0;
      row.guest_accepted = 0;
    });
    if (this.sql.startsWith("UPDATE rooms SET game_json")) return update(this.db, this.values, 5, 6, row => {
      [row.game_json, row.status, row.action_started_at, row.updated_at, row.expires_at] = this.values;
    });
    if (this.sql.startsWith("UPDATE rooms SET status = 'waiting'")) return update(this.db, this.values, 2, 3, row => {
      [row.updated_at, row.expires_at] = this.values;
      row.status = "waiting";
      row.host_side = null;
      row.host_ready = 0;
      row.guest_ready = 0;
      row.game_json = null;
      row.action_started_at = null;
    });
    throw new Error(`Unhandled SQL: ${this.sql}`);
  }
}

class MemoryD1 {
  rooms = new Map<string, StoredRoom>();
  prepare(sql: string) { return new MemoryStatement(this, sql); }
  async batch(statements: MemoryStatement[]) { return Promise.all(statements.map(statement => statement.run())); }
}

async function api(db: MemoryD1, path: string, method = "GET", token?: string, payload?: unknown) {
  const response = await handleRoomRequest(new Request(`https://game.test${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { "Content-Type": "application/json" } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  }), { DB: db as unknown as D1Database });
  assert.ok(response);
  return response;
}

test("room host and guest can configure, ready, play, and return for a rematch", async () => {
  const db = new MemoryD1();
  const createdResponse = await api(db, "/api/rooms", "POST", undefined, { nickname: "방장" });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { token: string; room: RoomView };
  assert.match(created.room.code, /^[A-Z2-9]{6}$/);

  const joinedResponse = await api(db, `/api/rooms/${created.room.code}/join`, "POST", undefined, { nickname: "참가자" });
  const joined = await joinedResponse.json() as { token: string; room: RoomView };
  assert.equal(joined.room.viewerRole, "guest");

  const forbidden = await api(db, `/api/rooms/${created.room.code}/settings`, "PATCH", joined.token, { sideChoice: "han", augments: false });
  assert.equal(forbidden.status, 403);

  const settingsResponse = await api(db, `/api/rooms/${created.room.code}/settings`, "PATCH", created.token, { sideChoice: "han", augments: false });
  const settings = await settingsResponse.json() as { room: RoomView };
  assert.equal(settings.room.sideChoice, "han");
  assert.equal(settings.room.augments, false);

  await api(db, `/api/rooms/${created.room.code}/ready`, "POST", created.token, { ready: true });
  const startedResponse = await api(db, `/api/rooms/${created.room.code}/ready`, "POST", joined.token, { ready: true });
  const started = await startedResponse.json() as { room: RoomView };
  assert.equal(started.room.status, "playing");
  assert.equal(started.room.playerSide, "cho");
  assert.equal(started.room.hostSide, "han");
  assert.equal(started.room.matchNumber, 1);
  assert.ok(started.room.game);

  const game = started.room.game as GameState;
  const piece = game.pieces.find(candidate => !candidate.captured && candidate.side === "cho" && legalMoves(game, candidate.id).length > 0);
  assert.ok(piece);
  const destination = legalMoves(game, piece.id)[0];
  const movedResponse = await api(db, `/api/rooms/${created.room.code}/command`, "POST", joined.token, {
    expectedRevision: started.room.revision,
    command: { type: "MOVE_PIECE", pieceId: piece.id, to: destination },
  });
  assert.equal(movedResponse.status, 200);
  const moved = await movedResponse.json() as { room: RoomView };
  assert.equal(moved.room.game?.turn, "han");
  assert.equal(moved.room.game?.moves.length, 1);

  const tooEarly = await api(db, `/api/rooms/${created.room.code}/lobby`, "POST", joined.token);
  assert.equal(tooEarly.status, 409);

  const stored = db.rooms.get(created.room.code)!;
  const finishedGame = JSON.parse(String(stored.game_json)) as GameState;
  finishedGame.winner = "cho";
  stored.game_json = JSON.stringify(finishedGame);
  stored.status = "finished";
  const lobbyResponse = await api(db, `/api/rooms/${created.room.code}/lobby`, "POST", joined.token);
  const lobby = await lobbyResponse.json() as { room: RoomView };
  assert.equal(lobby.room.status, "waiting");
  assert.equal(lobby.room.game, undefined);
  assert.equal(lobby.room.host.ready, false);
  assert.equal(lobby.room.guest?.ready, false);
});

test("each player picks their own formation and it reaches the started board", async () => {
  const db = new MemoryD1();
  const created = await (await api(db, "/api/rooms", "POST", undefined, { nickname: "방장" })).json() as { token: string; room: RoomView };
  const code = created.room.code;
  const joined = await (await api(db, `/api/rooms/${code}/join`, "POST", undefined, { nickname: "참가자" })).json() as { token: string; room: RoomView };
  assert.equal(created.room.host.formation, "귀마");

  const rejected = await api(db, `/api/rooms/${code}/formation`, "PATCH", joined.token, { formation: "없는포진" });
  assert.equal(rejected.status, 400);

  await api(db, `/api/rooms/${code}/settings`, "PATCH", created.token, { sideChoice: "cho", augments: false });
  const hostSet = await (await api(db, `/api/rooms/${code}/formation`, "PATCH", created.token, { formation: "면상" })).json() as { room: RoomView };
  assert.equal(hostSet.room.host.formation, "면상");
  // 참가자도 자기 포진은 직접 정한다. 방 설정과 달리 방장 전용이 아니다.
  const guestSet = await (await api(db, `/api/rooms/${code}/formation`, "PATCH", joined.token, { formation: "양귀마" })).json() as { room: RoomView };
  assert.equal(guestSet.room.guest?.formation, "양귀마");
  // 상대 포진은 대국 시작 전까지 응답에 실리지 않는다.
  assert.equal(guestSet.room.host.formation, undefined);
  assert.equal(hostSet.room.guest?.formation, undefined);

  // 포진을 바꾸면 본인 준비가 풀린다.
  await api(db, `/api/rooms/${code}/ready`, "POST", created.token, { ready: true });
  const changed = await (await api(db, `/api/rooms/${code}/formation`, "PATCH", created.token, { formation: "귀마" })).json() as { room: RoomView };
  assert.equal(changed.room.status, "waiting");
  assert.equal(changed.room.host.ready, false);

  // 상대 준비 상태는 건드리지 않는다.
  await api(db, `/api/rooms/${code}/ready`, "POST", joined.token, { ready: true });
  const again = await (await api(db, `/api/rooms/${code}/formation`, "PATCH", created.token, { formation: "귀마" })).json() as { room: RoomView };
  assert.equal(again.room.guest?.ready, true);
  assert.equal(again.room.host.ready, false);

  const started = await (await api(db, `/api/rooms/${code}/ready`, "POST", created.token, { ready: true })).json() as { room: RoomView };
  assert.equal(started.room.status, "playing");
  assert.equal(started.room.hostSide, "cho");
  const game = started.room.game as GameState;
  const backRank = (side: Side, y: number) => [1, 2, 6, 7].map(x => game.pieces.find(piece => piece.side === side && piece.x === x && piece.y === y)!.type);
  assert.deepEqual(backRank("cho", 0), FORMATION_BACK_RANK["귀마"]);
  assert.deepEqual(backRank("han", 9), FORMATION_BACK_RANK["양귀마"]);
});

test("quick match pairs two players and needs both to accept before the lobby opens", async () => {
  const db = new MemoryD1();
  const firstResponse = await api(db, "/api/rooms/quick", "POST", undefined, { nickname: "먼저" });
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json() as { token: string; room: RoomView };
  assert.equal(first.room.status, "matching");
  assert.equal(first.room.matched, false, "혼자 있을 때는 아직 매칭이 아니다");
  assert.equal(first.room.isPublic, true);

  // 두 번째 사람은 새 방을 만들지 않고 기다리던 방에 들어간다.
  const secondResponse = await api(db, "/api/rooms/quick", "POST", undefined, { nickname: "나중" });
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json() as { token: string; room: RoomView };
  assert.equal(second.room.code, first.room.code, "대기 중인 방으로 이어진다");
  assert.equal(second.room.viewerRole, "guest");
  assert.equal(second.room.matched, true, "상대를 찾은 상태다");
  assert.equal(db.rooms.size, 1, "방이 하나만 만들어진다");

  // 진영 무작위·증강 사용은 고정이라 방장도 바꿀 수 없다.
  const locked = await api(db, `/api/rooms/${first.room.code}/settings`, "PATCH", first.token, { sideChoice: "cho", augments: false });
  assert.equal(locked.status, 409);

  // 한쪽만 수락하면 대기실이 열리지 않는다.
  const halfResponse = await api(db, `/api/rooms/${first.room.code}/accept`, "POST", first.token);
  const half = await halfResponse.json() as { room: RoomView };
  assert.equal(half.room.status, "matching", "한 명만 눌렀을 때는 아직 매칭 화면이다");
  assert.deepEqual(half.room.accepted, { mine: true, theirs: false });

  const openedResponse = await api(db, `/api/rooms/${first.room.code}/accept`, "POST", second.token);
  const opened = await openedResponse.json() as { room: RoomView };
  assert.equal(opened.room.status, "waiting", "양쪽이 누르면 대기실이 열린다");
  assert.equal(opened.room.sideChoice, "random", "진영은 무작위로 고정된다");
  assert.equal(opened.room.augments, true, "증강은 항상 켜져 있다");

  // 대기실에서는 기존 흐름 그대로 포진을 고르고 준비하면 대국이 시작된다.
  await api(db, `/api/rooms/${first.room.code}/ready`, "POST", first.token, { ready: true });
  const startedResponse = await api(db, `/api/rooms/${first.room.code}/ready`, "POST", second.token, { ready: true });
  const started = await startedResponse.json() as { room: RoomView };
  assert.equal(started.room.status, "playing");
});

test("quick match keeps waiting players separate from friendly rooms", async () => {
  const db = new MemoryD1();
  // 친선전 방은 공개 대기열에 노출되지 않는다.
  const friendly = await (await api(db, "/api/rooms", "POST", undefined, { nickname: "친선" })).json() as { token: string; room: RoomView };
  assert.equal(friendly.room.isPublic, false);

  const quick = await (await api(db, "/api/rooms/quick", "POST", undefined, { nickname: "빠른" })).json() as { token: string; room: RoomView };
  assert.notEqual(quick.room.code, friendly.room.code, "친선전 방에는 매칭되지 않는다");
  assert.equal(db.rooms.size, 2);

  // 대기 중 취소하면 방이 사라져 다른 사람이 걸려들지 않는다.
  const cancelled = await api(db, `/api/rooms/${quick.room.code}/cancel`, "POST", quick.token);
  assert.equal(cancelled.status, 200);
  assert.equal(db.rooms.has(quick.room.code), false, "대기열에서 방이 지워진다");
  assert.equal(db.rooms.has(friendly.room.code), true, "친선전 방은 그대로 남는다");
});

test("declining a found match removes the room for both players", async () => {
  const db = new MemoryD1();
  const host = await (await api(db, "/api/rooms/quick", "POST", undefined, { nickname: "방장" })).json() as { token: string; room: RoomView };
  const guest = await (await api(db, "/api/rooms/quick", "POST", undefined, { nickname: "참가자" })).json() as { token: string; room: RoomView };
  assert.equal(guest.room.matched, true);

  const declined = await api(db, `/api/rooms/${host.room.code}/cancel`, "POST", guest.token);
  assert.equal(declined.status, 200);
  assert.equal(db.rooms.size, 0, "거절하면 방이 접힌다");

  // 남은 쪽의 폴링은 404를 받아 로비로 돌아간다.
  const gone = await api(db, `/api/rooms/${host.room.code}`, "GET", host.token);
  assert.equal(gone.status, 404);
});

test("quick match rematch needs both sides and reopens a freely configurable lobby", async () => {
  const db = new MemoryD1();
  const host = await (await api(db, "/api/rooms/quick", "POST", undefined, { nickname: "방장" })).json() as { token: string; room: RoomView };
  const guest = await (await api(db, "/api/rooms/quick", "POST", undefined, { nickname: "참가자" })).json() as { token: string; room: RoomView };
  const code = host.room.code;
  await api(db, `/api/rooms/${code}/accept`, "POST", host.token);
  await api(db, `/api/rooms/${code}/accept`, "POST", guest.token);
  await api(db, `/api/rooms/${code}/ready`, "POST", host.token, { ready: true });
  const started = await (await api(db, `/api/rooms/${code}/ready`, "POST", guest.token, { ready: true })).json() as { room: RoomView };
  assert.equal(started.room.status, "playing");

  // 대국이 끝나기 전에는 재대결을 요청할 수 없다.
  assert.equal((await api(db, `/api/rooms/${code}/rematch`, "POST", host.token)).status, 409);

  const resigned = await (await api(db, `/api/rooms/${code}/command`, "POST", host.token, {
    expectedRevision: started.room.revision, command: { type: "RESIGN" },
  })).json() as { room: RoomView };
  assert.equal(resigned.room.status, "finished");

  // 한쪽만 요청하면 아직 열리지 않는다.
  const half = await (await api(db, `/api/rooms/${code}/rematch`, "POST", host.token)).json() as { room: RoomView };
  assert.equal(half.room.status, "finished", "상대가 응답할 때까지 기다린다");
  assert.deepEqual(half.room.accepted, { mine: true, theirs: false });

  const reopened = await (await api(db, `/api/rooms/${code}/rematch`, "POST", guest.token)).json() as { room: RoomView };
  assert.equal(reopened.room.status, "waiting", "양쪽이 원하면 대기실이 열린다");
  assert.equal(reopened.room.isPublic, false, "친선전과 같은 자유 설정 방이 된다");

  // 이제 진영과 증강을 다시 고를 수 있다.
  const settings = await (await api(db, `/api/rooms/${code}/settings`, "PATCH", host.token, { sideChoice: "cho", augments: false })).json() as { room: RoomView };
  assert.equal(settings.room.sideChoice, "cho");
  assert.equal(settings.room.augments, false);
  const formation = await (await api(db, `/api/rooms/${code}/formation`, "PATCH", guest.token, { formation: "면상" })).json() as { room: RoomView };
  assert.equal(formation.room.guest?.formation, "면상");
});
