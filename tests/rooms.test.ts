import assert from "node:assert/strict";
import test from "node:test";
import { FORMATION_BACK_RANK, legalMoves } from "../app/game/engine";
import type { GameState, Side } from "../app/game/model";
import type { RoomView } from "../app/game/multiplayer";
import { handleRoomRequest } from "../worker/rooms";

type StoredRoom = Record<string, unknown> & { code: string; revision: number };

class MemoryStatement {
  private values: unknown[] = [];
  constructor(private readonly db: MemoryD1, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() {
    if (!this.sql.startsWith("SELECT * FROM rooms WHERE code = ?")) return null;
    const row = this.db.rooms.get(String(this.values[0]));
    return (row ? structuredClone(row) : null) as T | null;
  }
  async run() {
    if (this.sql.startsWith("INSERT INTO rooms")) {
      const [code, hostTokenHash, hostName, createdAt, updatedAt, expiresAt] = this.values;
      if (this.db.rooms.has(String(code))) throw new Error("duplicate room");
      this.db.rooms.set(String(code), {
        code, host_token_hash: hostTokenHash, guest_token_hash: null, host_name: hostName, guest_name: null,
        side_choice: "random", host_side: null, host_formation: "귀마", guest_formation: "귀마",
        augments: 1, host_ready: 0, guest_ready: 0,
        status: "waiting", game_json: null, match_number: 0, action_started_at: null, revision: 0,
        created_at: createdAt, updated_at: updatedAt, expires_at: expiresAt,
      } as StoredRoom);
      return { meta: { changes: 1 } };
    }

    const update = (codeIndex: number, revisionIndex: number, mutate: (row: StoredRoom) => void) => {
      const code = String(this.values[codeIndex]);
      const row = this.db.rooms.get(code);
      if (!row || row.revision !== this.values[revisionIndex]) return { meta: { changes: 0 } };
      mutate(row);
      row.revision += 1;
      return { meta: { changes: 1 } };
    };

    if (this.sql.startsWith("UPDATE rooms SET guest_token_hash")) return update(4, 5, row => {
      if (row.guest_token_hash !== null) return;
      [row.guest_token_hash, row.guest_name, row.updated_at, row.expires_at] = this.values;
      row.guest_ready = 0;
    });
    if (this.sql.startsWith("UPDATE rooms SET side_choice")) return update(4, 5, row => {
      [row.side_choice, row.augments, row.updated_at, row.expires_at] = this.values;
      row.host_ready = 0;
      row.guest_ready = 0;
    });
    if (this.sql.startsWith("UPDATE rooms SET host_formation") || this.sql.startsWith("UPDATE rooms SET guest_formation")) return update(3, 4, row => {
      const host = this.sql.includes("host_formation");
      row[host ? "host_formation" : "guest_formation"] = this.values[0];
      row[host ? "host_ready" : "guest_ready"] = 0;
      [row.updated_at, row.expires_at] = this.values.slice(1, 3);
    });
    if (this.sql.startsWith("UPDATE rooms SET host_ready") || this.sql.startsWith("UPDATE rooms SET guest_ready")) return update(3, 4, row => {
      row[this.sql.includes("host_ready") ? "host_ready" : "guest_ready"] = this.values[0];
      [row.updated_at, row.expires_at] = this.values.slice(1, 3);
    });
    if (this.sql.startsWith("UPDATE rooms SET host_side")) return update(5, 6, row => {
      [row.host_side, row.game_json, row.action_started_at, row.updated_at, row.expires_at] = this.values;
      row.status = "playing";
      row.match_number = Number(row.match_number) + 1;
    });
    if (this.sql.startsWith("UPDATE rooms SET game_json")) return update(5, 6, row => {
      [row.game_json, row.status, row.action_started_at, row.updated_at, row.expires_at] = this.values;
    });
    if (this.sql.startsWith("UPDATE rooms SET status = 'waiting'")) return update(2, 3, row => {
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
  assert.equal(guestSet.room.host.formation, "면상");

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
