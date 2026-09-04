export const GAME_SCHEMA_VERSION = 6 as const;
export const RULESET_VERSION = "augment-janggi-pilot-v13" as const;
export const INITIAL_CLOCK_MS = 10 * 60 * 1000;
export const MOVE_INCREMENT_MS = 3 * 1000;
export const DRAFT_CLOCK_MS = 60 * 1000;

export type Side = "cho" | "han";
export type PieceType = "cha" | "po" | "ma" | "sang" | "sa" | "jol" | "gung";
export type Formation = "귀마" | "원앙마" | "면상" | "양귀마";
export type Category = "TRANSFORM" | "PROMOTION" | "OPENING" | "ACTIVE" | "PALACE" | "ANOMALY" | "RESTRICT";
export type CardState = "ready" | "active" | "used" | "inert";
export type GamePhase = "DRAFT" | "ACTION" | "ENDED";
export type EndReason = "capture_king" | "special_victory" | "judgment" | "deathmatch" | "timeout";
export type DraftSlot = 0 | 1 | 2;
export type DrawRequirement =
  | "ANY"
  | "OPENING_SLOT"
  | "OWN_CHA"
  | "OWN_PO"
  | "OWN_MA"
  | "OWN_SANG"
  | "OWN_SA"
  | "OWN_JOL_1"
  | "OWN_JOL_2"
  | "OWN_JOL_3"
  | "OWN_PO_2"
  | "OWN_SA_2"
  | "OWN_MA_AND_SANG"
  | "OWN_MA_AND_JOL"
  | "OWN_CHA_ALLIES_2"
  | "OWN_PIECES_4"
  | "OWN_NONKING_1"
  | "OWN_NONKING_2TYPES"
  | "OWN_NONKING_3"
  | "ENEMY_CHA"
  | "ENEMY_PO"
  | "ENEMY_MA"
  | "ENEMY_JOL"
  | "ENEMY_MA_OR_SANG"
  | "ENEMY_NONKING"
  | "PALACE_EMPTY"
  | "OWN_SA_PALACE_EMPTY"
  | "MY_TERRITORY_EMPTY"
  | "OWN_JOL_ADJACENT_ENEMY"
  | "ENEMY_JOL_ADJACENT";

export type Square = { x: number; y: number };
export type Piece = Square & {
  id: string;
  side: Side;
  type: PieceType;
  captured?: boolean;
  transformCardId?: string;
  captureLockedPly?: number;
  hp?: number;
  growth?: number;
  ammo?: number;
  hidden?: boolean;
  frozen?: number;
  shielded?: number;
  infected?: boolean;
  carriedBy?: string;
  guksaWait?: number;
  guksaRevived?: boolean;
  availablePly?: number;
};

export type Card = {
  id: string;
  name: string;
  hanja?: string;
  category: Category;
  activation: "PASSIVE" | "ACTIVE" | "ON_START";
  basePiece?: PieceType;
  cost: number;
  draw: DrawRequirement;
  duration?: string;
  text: string;
  exclusive?: string[];
};

export type OwnedCard = {
  cardId: string;
  slot: DraftSlot;
  state: CardState;
  targetPieceId?: string;
};

export type Restriction = {
  cardId: string;
  side: Side;
  remaining: number;
  targetPieceId?: string;
  direction?: string;
};

export type PalaceStructure = {
  cardId: "seongbyeok" | "seongmun";
  side: Side;
  points: Square[];
};

export type MyosupuriPlan = {
  cardIndex: number;
  pieceId: string;
  moves: Square[];
};

export type MoveRecord = {
  notation: string;
  side: Side;
  pieceId: string;
  from: Square;
  to: Square;
  capturedId?: string;
  capturedIds?: string[];
};

export type DraftState = {
  side: Side;
  slot: DraftSlot;
  choices: string[];
  queue: Side[];
};

export type GameState = {
  schemaVersion: typeof GAME_SCHEMA_VERSION;
  rulesetVersion: typeof RULESET_VERSION;
  revision: number;
  eventSequence: number;
  rngSeed: number;
  phase: GamePhase;
  pieces: Piece[];
  turn: Side;
  clocks: Record<Side, number>;
  draftClockMs: number;
  ply: number;
  fullMove: number;
  winner?: Side;
  endReason?: EndReason;
  cards: Record<Side, OwnedCard[]>;
  draft?: DraftState;
  augments: boolean;
  testMode: boolean;
  moves: MoveRecord[];
  restrictions: Restriction[];
  walls: { x: number; y: number; remaining: number }[];
  palaceStructures: PalaceStructure[];
  traps: (Square & { side: Side })[];
  jeokgi: (Square & { side: Side })[];
  reserves: Record<Side, Piece[]>;
  waitingPieces: Record<Side, Piece[]>;
  myosupuriPlans: Partial<Record<Side, MyosupuriPlan>>;
  deathmatch: boolean;
  deathmatchClock: number;
  formations: Record<Side, Formation>;
};

export type GameCommand =
  | { type: "MOVE_PIECE"; pieceId: string; to: Square }
  | { type: "USE_UIBYEONG_REST"; pieceId: string }
  | { type: "DEPLOY_JANGDOLBAENGI_RESERVE"; reservePieceId: string; to: Square }
  | { type: "DEPLOY_HUNSUKKUN_RESERVE"; reservePieceId: string; to: Square }
  | { type: "PICK_AUGMENT"; cardId: string }
  | { type: "TEST_GRANT_AUGMENT"; side: Side; cardId: string }
  | { type: "USE_AUGMENT"; cardIndex: number; targetPieceId?: string; targetSquare?: Square; targetLine?: Square[]; targetSquares?: Square[] }
  | { type: "ADVANCE_CLOCK"; elapsedMs: number };

export type GameEvent =
  | { type: "PIECE_MOVED"; side: Side; pieceId: string; from: Square; to: Square }
  | { type: "PIECE_CAPTURED"; side: Side; pieceId: string; byPieceId: string }
  | { type: "PIECE_DEPLOYED"; side: Side; pieceId: string; to: Square }
  | { type: "AUGMENT_PICKED"; side: Side; cardId: string; slot: DraftSlot }
  | { type: "TEST_AUGMENT_GRANTED"; side: Side; cardId: string }
  | { type: "AUGMENT_ACTIVATED"; side: Side; cardId: string }
  | { type: "DRAFT_OPENED"; side: Side; slot: DraftSlot }
  | { type: "TURN_CHANGED"; side: Side }
  | { type: "GAME_ENDED"; winner: Side; reason: EndReason };

export type RuleErrorCode =
  | "GAME_ENDED"
  | "WRONG_PHASE"
  | "WRONG_ACTOR"
  | "ILLEGAL_MOVE"
  | "INVALID_DRAFT_PICK"
  | "INVALID_AUGMENT_TARGET"
  | "AUGMENT_UNAVAILABLE";

export type RuleError = { code: RuleErrorCode; message: string };
export type GameTransition = {
  state: GameState;
  events: GameEvent[];
  accepted: boolean;
  error?: RuleError;
};

export const PIECE_LABEL: Record<Side, Record<PieceType, string>> = {
  cho: { cha: "车", po: "包", ma: "马", sang: "象", sa: "士", jol: "卒", gung: "楚" },
  han: { cha: "車", po: "包", ma: "馬", sang: "象", sa: "士", jol: "兵", gung: "漢" },
};

export const PIECE_VALUE: Record<PieceType, number> = {
  cha: 13,
  po: 7,
  ma: 5,
  sang: 3,
  sa: 3,
  jol: 2,
  gung: 0,
};

export const opponent = (side: Side): Side => side === "cho" ? "han" : "cho";
export const squareKey = (square: Square): string => `${square.x},${square.y}`;
export const sameSquare = (a: Square, b: Square): boolean => a.x === b.x && a.y === b.y;

export function derivePhase(state: Pick<GameState, "winner" | "draft">): GamePhase {
  if (state.winner) return "ENDED";
  if (state.draft) return "DRAFT";
  return "ACTION";
}

/** Upgrades device-local saves produced by older pilot builds. */
export function migrateGameState(input: GameState | Record<string, unknown>): GameState {
  const legacy = input as Partial<GameState>;
  const migrated = {
    ...legacy,
    schemaVersion: GAME_SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    revision: legacy.revision ?? 0,
    eventSequence: legacy.eventSequence ?? 0,
    rngSeed: legacy.rngSeed ?? 0x0a11ce,
  } as GameState;
  migrated.jeokgi = migrated.jeokgi ?? [];
  migrated.traps = migrated.traps ?? [];
  migrated.reserves = migrated.reserves ?? { cho: [], han: [] };
  migrated.reserves = {
    cho: (migrated.reserves.cho ?? []).map((piece) => ({ ...piece })),
    han: (migrated.reserves.han ?? []).map((piece) => ({ ...piece })),
  };
  migrated.waitingPieces = migrated.waitingPieces ?? { cho: [], han: [] };
  migrated.waitingPieces = {
    cho: (migrated.waitingPieces.cho ?? []).map((piece) => ({ ...piece })),
    han: (migrated.waitingPieces.han ?? []).map((piece) => ({ ...piece })),
  };
  migrated.myosupuriPlans = migrated.myosupuriPlans ?? {};
  migrated.palaceStructures = migrated.palaceStructures ?? [];
  migrated.palaceStructures = migrated.palaceStructures.map((structure) => ({
    ...structure,
    points: structure.points.slice(0, 3).map((point) => ({ ...point })),
  }));
  migrated.clocks = migrated.clocks ?? { cho: INITIAL_CLOCK_MS, han: INITIAL_CLOCK_MS };
  migrated.draftClockMs = migrated.draftClockMs ?? DRAFT_CLOCK_MS;
  migrated.testMode = migrated.testMode ?? false;
  migrated.pieces = migrated.pieces.map((piece) => {
    if (piece.transformCardId === "geobukseon") {
      return { ...piece, hp: Math.min(piece.hp ?? 2, 2) };
    }
    if (piece.transformCardId === "jeoktoma") {
      return { ...piece, growth: Math.min(piece.growth ?? 0, 2) };
    }
    if (piece.type !== "gung" || piece.transformCardId) return piece;
    const kingTransform = migrated.cards[piece.side].find((owned) =>
      owned.state !== "inert" && (owned.cardId === "hangu" || owned.cardId === "yubang"),
    );
    return kingTransform ? { ...piece, transformCardId: kingTransform.cardId } : piece;
  });
  migrated.pieces = migrated.pieces.map((piece) => ({ ...piece }));
  migrated.cards = {
    cho: migrated.cards.cho.map((card) => migrated.pieces.some((piece) =>
      piece.id === card.targetPieceId && piece.transformCardId === card.cardId,
    ) ? { ...card, state: "used" } : { ...card }),
    han: migrated.cards.han.map((card) => migrated.pieces.some((piece) =>
      piece.id === card.targetPieceId && piece.transformCardId === card.cardId,
    ) ? { ...card, state: "used" } : { ...card }),
  };
  for (const side of ["cho", "han"] as Side[]) {
    if (!migrated.cards[side].some((card) => card.cardId === "yeokmacha" && card.state === "active")) continue;
    for (const horse of migrated.pieces.filter((piece) => !piece.captured && piece.side === side && piece.type === "ma" && piece.carriedBy)) {
      const soldier = migrated.pieces.find((piece) => !piece.captured && piece.side === side && piece.type === "jol" && piece.id === horse.carriedBy);
      if (!soldier) continue;
      horse.carriedBy = undefined;
      soldier.carriedBy = horse.id;
      soldier.x = horse.x;
      soldier.y = horse.y;
    }
  }
  migrated.phase = derivePhase(migrated);
  return migrated;
}
