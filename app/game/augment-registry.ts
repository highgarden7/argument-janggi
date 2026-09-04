import type { Card, GameState, Piece, PieceType, Side, Square } from "./model";
import { opponent, squareKey } from "./model";

export type AugmentHook = "onAcquire" | "onActivate";
export type AugmentContext = {
  side: Side;
  card: Card;
  targetPieceId?: string;
  targetSquare?: Square;
  targetLine?: Square[];
};
export type AugmentHandler = (state: GameState, context: AugmentContext) => GameState;
export type AugmentDefinition = Partial<Record<AugmentHook, AugmentHandler>>;

function firstPiece(pieces: Piece[], side: Side, type?: PieceType): Piece | undefined {
  return pieces.find((piece) => !piece.captured && piece.side === side && piece.type !== "gung" && (!type || piece.type === type));
}

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
    onActivate: (state, { side }) => {
      const pieces = clonePieces(state);
      const piece = firstPiece(pieces, side);
      if (piece) piece.shielded = 1;
      return { ...state, pieces };
    },
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
  jaribakkum: {
    onActivate: (state, { side }) => {
      const pieces = clonePieces(state);
      const own = pieces.filter((piece) => !piece.captured && piece.side === side && piece.type !== "gung");
      const first = own[0];
      const second = own.find((piece) => piece.type !== first?.type);
      if (first && second) {
        const position = { x: first.x, y: first.y };
        first.x = second.x;
        first.y = second.y;
        second.x = position.x;
        second.y = position.y;
      }
      return { ...state, pieces };
    },
  },
  "sungan-idong": {
    onActivate: (state, { side }) => {
      const pieces = clonePieces(state);
      const piece = firstPiece(pieces, side);
      const occupied = new Set(pieces.filter((row) => !row.captured).map(squareKey));
      if (piece) {
        outer: for (let y = 0; y < 10; y += 1) {
          for (let x = 0; x < 9; x += 1) {
            if (!occupied.has(squareKey({ x, y }))) {
              piece.x = x;
              piece.y = y;
              break outer;
            }
          }
        }
      }
      return { ...state, pieces };
    },
  },
  buhwal: {
    onActivate: (state, { side }) => {
      const pieces = clonePieces(state);
      const piece = pieces.find((row) => row.captured && row.side === side && row.type !== "gung");
      const occupied = new Set(pieces.filter((row) => !row.captured).map(squareKey));
      const ranks = side === "cho" ? [0, 1, 2, 3, 4] : [9, 8, 7, 6, 5];
      if (piece) {
        outer: for (const y of ranks) {
          for (let x = 0; x < 9; x += 1) {
            if (!occupied.has(squareKey({ x, y }))) {
              piece.x = x;
              piece.y = y;
              piece.captured = false;
              break outer;
            }
          }
        }
      }
      return { ...state, pieces };
    },
  },
  daeyeok: {
    onActivate: (state, { side }) => {
      const pieces = clonePieces(state);
      const king = pieces.find((piece) => !piece.captured && piece.side === side && piece.type === "gung");
      const guard = pieces.find((piece) => !piece.captured && piece.side === side && piece.type === "sa");
      if (king && guard) {
        const position = { x: king.x, y: king.y };
        king.x = guard.x;
        king.y = guard.y;
        guard.x = position.x;
        guard.y = position.y;
      }
      return { ...state, pieces };
    },
  },
  bonghwa: { onActivate: moveKingToFirstOpenSquare },
  cheondo: { onActivate: moveKingToFirstOpenSquare },
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

function moveKingToFirstOpenSquare(state: GameState, context: AugmentContext): GameState {
  const { side, card } = context;
  const pieces = clonePieces(state);
  const king = pieces.find((piece) => !piece.captured && piece.side === side && piece.type === "gung");
  const occupied = new Set(pieces.filter((piece) => !piece.captured).map(squareKey));
  const ranks = card.id === "bonghwa"
    ? side === "cho" ? [0, 1, 2] : [7, 8, 9]
    : side === "cho" ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9];
  if (king) {
    outer: for (const y of ranks) {
      const minX = card.id === "bonghwa" ? 3 : 0;
      const maxX = card.id === "bonghwa" ? 5 : 8;
      for (let x = minX; x <= maxX; x += 1) {
        if (!occupied.has(squareKey({ x, y }))) {
          king.x = x;
          king.y = y;
          break outer;
        }
      }
    }
  }
  return { ...state, pieces };
}

export function runAugmentHook(state: GameState, hook: AugmentHook, context: AugmentContext): GameState {
  return AUGMENT_REGISTRY[context.card.id]?.[hook]?.(state, context) ?? state;
}

export function automaticEnemyTarget(state: GameState, side: Side, card: Card): Piece | undefined {
  const enemy = opponent(side);
  const type = card.draw === "ENEMY_CHA" ? "cha"
    : card.draw === "ENEMY_PO" ? "po"
      : card.draw === "ENEMY_MA" ? "ma"
        : card.draw === "ENEMY_JOL" ? "jol"
          : undefined;
  return firstPiece(state.pieces, enemy, type);
}
