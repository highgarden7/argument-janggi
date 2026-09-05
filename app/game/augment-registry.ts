import type { Card, GameState, Piece, Side, Square } from "./model";
import { squareKey } from "./model";

export type AugmentHook = "onAcquire" | "onActivate";
export type AugmentContext = {
  side: Side;
  card: Card;
  targetPieceId?: string;
  /** 위치를 맞바꾸는 증강이 고른 기물 두 개. */
  targetPieceIds?: string[];
  targetSquare?: Square;
  targetLine?: Square[];
};
export type AugmentHandler = (state: GameState, context: AugmentContext) => GameState;
export type AugmentDefinition = Partial<Record<AugmentHook, AugmentHandler>>;

function clonePieces(state: GameState): Piece[] {
  return state.pieces.map((piece) => ({ ...piece }));
}

function transformKing(state: GameState, context: AugmentContext): GameState {
  return {
    ...state,
    pieces: state.pieces.map((piece) =>
      !piece.captured && piece.side === context.side && piece.type === "gung"
        ? { ...piece, transformCardId: context.card.id, captureLockedPly: state.ply + (state.turn === context.side ? 0 : 1) }
        : piece,
    ),
  };
}

/**
 * Runtime behavior for exceptional cards. Most cards remain data-only and are
 * interpreted by movement/restriction rules. New exceptional cards register
 * one isolated handler here instead of extending the game reducer.
 */
export const AUGMENT_REGISTRY: Record<string, AugmentDefinition> = {
  hangu: { onAcquire: transformKing },
  yubang: { onAcquire: transformKing },
  gibyeongdae: {
    onAcquire: (state, { side }) => ({
      ...state,
      pieces: state.pieces.map((piece) =>
        !piece.captured && piece.side === side && piece.type === "sang" ? { ...piece, type: "ma" } : piece,
      ),
    }),
  },
  sangatap: {
    onAcquire: (state, { side }) => ({
      ...state,
      pieces: state.pieces.map((piece) =>
        !piece.captured && piece.side === side && piece.type === "ma" ? { ...piece, type: "sang" } : piece,
      ),
    }),
  },
  "chapo-ttegi": {
    onAcquire: (state, { side }) => {
      let removedCha = false;
      let removedPo = false;
      return {
        ...state,
        pieces: state.pieces.map((piece) => {
          if (!piece.captured && piece.side === side && piece.type === "cha" && !removedCha) {
            removedCha = true;
            return { ...piece, captured: true };
          }
          if (!piece.captured && piece.side === side && piece.type === "po" && !removedPo) {
            removedPo = true;
            return { ...piece, captured: true };
          }
          return piece;
        }),
      };
    },
  },
  jeungwonbyeong: {
    onAcquire: (state, { side }) => {
      const occupied = new Set(state.pieces.filter((piece) => !piece.captured).map(squareKey));
      const ranks = side === "cho" ? [2, 3] : [6, 7];
      for (const y of ranks) {
        for (let x = 0; x < 9; x += 1) {
          if (!occupied.has(squareKey({ x, y }))) {
            return {
              ...state,
              pieces: [...state.pieces, { id: `p${state.pieces.length + 1}`, side, type: "jol", x, y }],
            };
          }
        }
      }
      return state;
    },
  },
  yeokjeon: {
    onActivate: (state) => ({
      ...state,
      pieces: state.pieces.map((piece) => ({ ...piece, x: 8 - piece.x, y: 9 - piece.y })),
    }),
  },
  jingbyeong: {
    onActivate: (state, { side, targetPieceId }) => ({
      ...state,
      pieces: state.pieces.map((piece) =>
        piece.id === targetPieceId && !piece.captured && piece.side === side && piece.type === "jol"
          ? { ...piece, type: "sang" }
          : piece,
      ),
    }),
  },
  eunsin: {
    onActivate: (state, { targetPieceId }) => ({
      ...state,
      pieces: state.pieces.map((piece) => piece.id === targetPieceId ? { ...piece, shielded: 1 } : piece),
    }),
  },
  gyeolbak: {
    onActivate: (state, { targetPieceId }) => ({
      ...state,
      pieces: state.pieces.map((piece) => piece.id === targetPieceId ? { ...piece, frozen: 2 } : piece),
    }),
  },
  yeokbyeong: {
    onActivate: (state, { targetPieceId }) => ({
      ...state,
      pieces: state.pieces.map((piece) => piece.id === targetPieceId ? { ...piece, infected: true } : piece),
    }),
  },
  maesu: {
    onActivate: (state, { side, targetPieceId }) => ({
      ...state,
      pieces: state.pieces.map((piece) => piece.id === targetPieceId ? { ...piece, side } : piece),
    }),
  },
  jaribakkum: { onActivate: swapChosenPieces },
  "sungan-idong": {
    onActivate: (state, { targetPieceId, targetSquare }) => targetSquare
      ? {
        ...state,
        pieces: state.pieces.map((piece) =>
          piece.id === targetPieceId ? { ...piece, x: targetSquare.x, y: targetSquare.y } : piece,
        ),
      }
      : state,
  },
  buhwal: {
    onActivate: (state, { targetPieceId, targetSquare }) => targetSquare
      ? {
        ...state,
        pieces: state.pieces.map((piece) =>
          piece.id === targetPieceId
            ? { ...piece, x: targetSquare.x, y: targetSquare.y, captured: false, carriedBy: undefined }
            : piece,
        ),
      }
      : state,
  },
  daeyeok: { onActivate: swapChosenPieces },
  bonghwa: { onActivate: moveKingToChosenSquare },
  cheondo: { onActivate: moveKingToChosenSquare },
  bangbyeok: {
    onActivate: (state, { targetSquare }) => targetSquare
      ? { ...state, walls: [...state.walls, { ...targetSquare, remaining: 6 }] }
      : state,
  },
  seongbyeok: { onActivate: addPalaceStructure },
  seongmun: { onActivate: addPalaceStructure },
};

function addPalaceStructure(state: GameState, { side, card, targetLine }: AugmentContext): GameState {
  if (!targetLine || (card.id !== "seongbyeok" && card.id !== "seongmun")) return state;
  return {
    ...state,
    palaceStructures: [
      ...state.palaceStructures,
      { cardId: card.id, side, points: targetLine.map((point) => ({ ...point })) },
    ],
  };
}

/** 플레이어가 고른 기물 두 개의 좌표를 맞바꾼다. 유효성은 엔진이 이미 검증했다. */
function swapChosenPieces(state: GameState, { targetPieceIds }: AugmentContext): GameState {
  const [firstId, secondId] = targetPieceIds ?? [];
  const pieces = clonePieces(state);
  const first = pieces.find((piece) => piece.id === firstId);
  const second = pieces.find((piece) => piece.id === secondId);
  if (!first || !second) return state;
  const position = { x: first.x, y: first.y };
  first.x = second.x;
  first.y = second.y;
  second.x = position.x;
  second.y = position.y;
  return { ...state, pieces };
}

function moveKingToChosenSquare(state: GameState, { side, targetSquare }: AugmentContext): GameState {
  if (!targetSquare) return state;
  return {
    ...state,
    pieces: state.pieces.map((piece) =>
      !piece.captured && piece.side === side && piece.type === "gung"
        ? { ...piece, x: targetSquare.x, y: targetSquare.y }
        : piece,
    ),
  };
}

export function runAugmentHook(state: GameState, hook: AugmentHook, context: AugmentContext): GameState {
  return AUGMENT_REGISTRY[context.card.id]?.[hook]?.(state, context) ?? state;
}
