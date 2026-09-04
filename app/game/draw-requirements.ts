import type { DrawRequirement, DraftSlot, GameState, Piece, PieceType, Side, Square } from "./model";
import { opponent, sameSquare } from "./model";

type RequirementContext = {
  state: GameState;
  side: Side;
  slot: DraftSlot;
  movesFor(piece: Piece): Square[];
};

type RequirementRule = (context: RequirementContext) => boolean;

function alive(state: GameState, side: Side, type?: PieceType): Piece[] {
  return state.pieces.filter((piece) => !piece.captured && piece.side === side && (!type || piece.type === type));
}

function hasEmptySquare(state: GameState, squares: Square[]): boolean {
  return squares.some((square) => !state.pieces.some((piece) => !piece.captured && sameSquare(piece, square)));
}

function palaceSquares(side: Side): Square[] {
  return Array.from({ length: 9 }, (_, index) => ({
    x: 3 + index % 3,
    y: (side === "cho" ? 0 : 7) + Math.floor(index / 3),
  }));
}

function territorySquares(side: Side): Square[] {
  const ranks = side === "cho" ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9];
  return ranks.flatMap((y) => Array.from({ length: 9 }, (_, x) => ({ x, y })));
}

export const DRAW_REQUIREMENT_RULES: Record<DrawRequirement, RequirementRule> = {
  ANY: () => true,
  OPENING_SLOT: ({ slot }) => slot === 0,
  OWN_CHA: ({ state, side }) => alive(state, side, "cha").length > 0,
  OWN_PO: ({ state, side }) => alive(state, side, "po").length > 0,
  OWN_MA: ({ state, side }) => alive(state, side, "ma").length > 0,
  OWN_SANG: ({ state, side }) => alive(state, side, "sang").length > 0,
  OWN_SA: ({ state, side }) => alive(state, side, "sa").length > 0,
  OWN_JOL_1: ({ state, side }) => alive(state, side, "jol").length >= 1,
  OWN_JOL_2: ({ state, side }) => alive(state, side, "jol").length >= 2,
  OWN_JOL_3: ({ state, side }) => alive(state, side, "jol").length >= 3,
  OWN_PO_2: ({ state, side }) => alive(state, side, "po").length >= 2,
  OWN_SA_2: ({ state, side }) => alive(state, side, "sa").length >= 2,
  OWN_MA_AND_SANG: ({ state, side }) => alive(state, side, "ma").length > 0 && alive(state, side, "sang").length > 0,
  OWN_MA_AND_JOL: ({ state, side }) => alive(state, side, "ma").length > 0 && alive(state, side, "jol").length > 0,
  OWN_CHA_ALLIES_2: ({ state, side }) => alive(state, side, "cha").length > 0 && alive(state, side).length >= 3,
  OWN_PIECES_4: ({ state, side }) => alive(state, side).length >= 4,
  OWN_NONKING_1: ({ state, side }) => alive(state, side).some((piece) => piece.type !== "gung"),
  OWN_NONKING_2TYPES: ({ state, side }) => new Set(alive(state, side).filter((piece) => piece.type !== "gung").map((piece) => piece.type)).size >= 2,
  OWN_NONKING_3: ({ state, side }) => alive(state, side).filter((piece) => piece.type !== "gung").length >= 3,
  ENEMY_CHA: ({ state, side }) => alive(state, opponent(side), "cha").length > 0,
  ENEMY_PO: ({ state, side }) => alive(state, opponent(side), "po").length > 0,
  ENEMY_MA: ({ state, side }) => alive(state, opponent(side), "ma").length > 0,
  ENEMY_JOL: ({ state, side }) => alive(state, opponent(side), "jol").length > 0,
  ENEMY_MA_OR_SANG: ({ state, side }) => alive(state, opponent(side), "ma").length + alive(state, opponent(side), "sang").length > 0,
  ENEMY_NONKING: ({ state, side }) => alive(state, opponent(side)).some((piece) => piece.type !== "gung"),
  PALACE_EMPTY: ({ state, side }) => hasEmptySquare(state, palaceSquares(side)),
  OWN_SA_PALACE_EMPTY: ({ state, side }) => alive(state, side, "sa").length > 0 && hasEmptySquare(state, palaceSquares(side)),
  MY_TERRITORY_EMPTY: ({ state, side }) => hasEmptySquare(state, territorySquares(side)),
  OWN_JOL_ADJACENT_ENEMY: ({ state, side, movesFor }) => alive(state, side, "jol").some((soldier) =>
    movesFor(soldier).some((square) => alive(state, opponent(side)).some((piece) => sameSquare(piece, square))),
  ),
  ENEMY_JOL_ADJACENT: ({ state, side }) => alive(state, opponent(side), "jol").some((soldier) =>
    alive(state, side).some((piece) => Math.abs(soldier.x - piece.x) + Math.abs(soldier.y - piece.y) === 1),
  ),
};

export function meetsDrawRequirement(context: RequirementContext, requirement: DrawRequirement): boolean {
  return DRAW_REQUIREMENT_RULES[requirement](context);
}
