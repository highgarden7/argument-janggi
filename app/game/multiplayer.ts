import type { GameCommand, GameState, Side } from "./model";

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
  host: { nickname: string; ready: boolean };
  guest?: { nickname: string; ready: boolean };
  draftSide?: Side;
  game?: GameState;
};

export type RoomSession = { code: string; token: string };
export type RoomCommandBody = { expectedRevision: number; command: GameCommand };
