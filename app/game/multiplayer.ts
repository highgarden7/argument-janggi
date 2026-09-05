import type { Formation, GameCommand, GameState, Side } from "./model";

export type RoomSideChoice = Side | "random";
export type RoomStatus = "waiting" | "playing" | "finished";
export type RoomRole = "host" | "guest";

export type RoomView = {
  code: string;
  status: RoomStatus;
  revision: number;
  matchNumber: number;
  viewerRole: RoomRole;
  playerSide?: Side;
  hostSide?: Side;
  sideChoice: RoomSideChoice;
  augments: boolean;
  /** `formation`은 본인 것만 채워진다. 상대 포진은 대국이 시작될 때까지 감춘다. */
  host: { nickname: string; ready: boolean; formation?: Formation };
  guest?: { nickname: string; ready: boolean; formation?: Formation };
  draftSide?: Side;
  game?: GameState;
};

export type RoomSession = { code: string; token: string };
export type RoomCommandBody = { expectedRevision: number; command: GameCommand };
