import type { Formation, GameCommand, GameState, Side } from "./model";

export type RoomSideChoice = Side | "random";
/** `matching`은 빠른 대국에서 상대를 찾는 중이거나 양쪽 수락을 기다리는 상태다. */
export type RoomStatus = "matching" | "waiting" | "playing" | "finished";
export type RoomRole = "host" | "guest";

/** 수락 제한시간과 대기실 노쇼 제한시간. 클라이언트가 남은 초를 그려 준다. */
export const MATCH_ACCEPT_MS = 20_000;
export const MATCH_LOBBY_MS = 60_000;

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
  /** 빠른 대국으로 만들어진 방. 매칭 화면을 띄울지 판단한다. */
  isPublic?: boolean;
  /** 상대를 찾아 양쪽 수락을 기다리는 중인지. */
  matched?: boolean;
  accepted?: { mine: boolean; theirs: boolean };
  /** 수락 또는 대기실 준비까지 남은 밀리초. */
  deadlineMs?: number;
};

export type RoomSession = { code: string; token: string };
export type RoomCommandBody = { expectedRevision: number; command: GameCommand };
