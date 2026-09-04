import { totalCost } from "./catalog";
import type { DraftSlot, EndReason, GameState, OwnedCard, Piece, Restriction, Side, Square } from "./model";
import { MOVE_INCREMENT_MS, PIECE_LABEL, PIECE_VALUE, opponent } from "./model";

type ActionResolution = {
  pieces: Piece[];
  cards: Record<Side, OwnedCard[]>;
  reserves?: GameState["reserves"];
  waitingPieces?: GameState["waitingPieces"];
  traps?: GameState["traps"];
  myosupuriPlans?: GameState["myosupuriPlans"];
  mover: Piece;
  captured?: Piece;
  capturedPieces?: Piece[];
  jeokgi?: GameState["jeokgi"];
  from: Square;
  to: Square;
  winner?: Side;
  endReason?: EndReason;
};

type TurnPipelineRuntime = {
  openDraft(state: GameState, side: Side, slot: DraftSlot, queue: Side[]): GameState;
};

const inOwnPalace = (piece: Piece) => piece.x >= 3 && piece.x <= 5 &&
  (piece.side === "cho" ? piece.y >= 0 && piece.y <= 2 : piece.y >= 7 && piece.y <= 9);

function advanceGuksa(state: GameState): GameState {
  const pieces = state.pieces.map((piece) => ({ ...piece }));
  const cards = { cho: state.cards.cho.map((card) => ({ ...card })), han: state.cards.han.map((card) => ({ ...card })) };
  let changed = false;
  for (const guksa of pieces.filter((piece) => !piece.captured && piece.transformCardId === "guksa" && !piece.guksaRevived)) {
    if (!inOwnPalace(guksa)) {
      if (guksa.guksaWait) { guksa.guksaWait = 0; changed = true; }
      continue;
    }
    guksa.guksaWait = Math.min(5, (guksa.guksaWait ?? 0) + 1);
    changed = true;
    if (guksa.guksaWait < 5) continue;
    const fallen = pieces.find((piece) => piece.captured && piece.side === guksa.side && piece.type !== "gung");
    const palaceRanks = guksa.side === "cho" ? [0, 1, 2] : [9, 8, 7];
    const destination = palaceRanks.flatMap((y) => [3, 4, 5].map((x) => ({ x, y }))).find((square) =>
      !pieces.some((piece) => !piece.captured && piece.x === square.x && piece.y === square.y) &&
      !state.walls.some((wall) => wall.x === square.x && wall.y === square.y) &&
      !(state.jeokgi ?? []).some((marker) => marker.side !== guksa.side && marker.x === square.x && marker.y === square.y),
    );
    if (!fallen || !destination) continue;
    fallen.x = destination.x;
    fallen.y = destination.y;
    fallen.captured = false;
    guksa.guksaRevived = true;
    const linked = cards[guksa.side].find((card) => card.targetPieceId === fallen.id && card.state === "inert");
    if (linked) linked.state = "active";
  }
  return changed ? { ...state, pieces, cards } : state;
}

/**
 * The canonical post-action order. All future capture, victory, duration and
 * turn-start hooks should join this pipeline instead of being called by UI code.
 */
export function finishAction(
  state: GameState,
  resolution: ActionResolution,
  runtime: TurnPipelineRuntime,
): GameState {
  const { pieces, cards, mover, captured, capturedPieces = [], from, to } = resolution;
  const reserves={cho:(resolution.reserves??state.reserves).cho.map((piece)=>({...piece})),han:(resolution.reserves??state.reserves).han.map((piece)=>({...piece}))};
  const waitingPieces={cho:(resolution.waitingPieces??state.waitingPieces).cho.map((piece)=>({...piece})),han:(resolution.waitingPieces??state.waitingPieces).han.map((piece)=>({...piece}))};
  let { winner, endReason } = resolution;
  const nextTurn = opponent(state.turn);

  for (const piece of pieces) {
    if (piece.side === mover.side && piece.frozen && piece.frozen > 0) piece.frozen -= 1;
    if (piece.side === nextTurn && piece.shielded && piece.shielded > 0) piece.shielded -= 1;
  }

  for (const restriction of state.restrictions.filter(
    (row) => row.cardId === "talyeong" && row.side === mover.side,
  )) {
    const piece = pieces.find((row) => row.id === restriction.targetPieceId && !row.captured);
    if (!piece) continue;
    const nextY = piece.y + (piece.side === "cho" ? -1 : 1);
    if (nextY < 0 || nextY > 9) piece.captured = true;
    else if (!pieces.some((row) => !row.captured && row.id !== piece.id && row.x === piece.x && row.y === nextY)) {
      piece.y = nextY;
    }
  }

  for(const side of ["cho","han"] as Side[])if(!pieces.some((piece)=>!piece.captured&&piece.side===side&&piece.transformCardId==="jangdolbaengi"))reserves[side]=[];

  const notation = `${state.ply + 1}. ${PIECE_LABEL[mover.side][mover.type]} ${String.fromCharCode(97 + from.x)}${from.y + 1}–${String.fromCharCode(97 + to.x)}${to.y + 1}${captured || capturedPieces.length ? " ×" : ""}`;
  const ply = state.ply + 1;
  const fullMove = Math.floor(ply / 2);
  const restrictions: Restriction[] = [];
  for(const row of state.restrictions){
    const nextRow=row.side===mover.side?{...row,remaining:row.remaining-1}:{...row};
    if(nextRow.remaining>0){restrictions.push(nextRow);continue}
    const owner=opponent(row.side),owned=cards[owner].find(card=>card.cardId===row.cardId&&card.state==="active");
    if(owned)owned.state="used";
  }

  let next: GameState = {
    ...state,
    pieces,
    cards,
    reserves,
    waitingPieces,
    traps: resolution.traps ?? state.traps,
    myosupuriPlans: resolution.myosupuriPlans ?? state.myosupuriPlans,
    jeokgi: resolution.jeokgi ?? state.jeokgi,
    turn: nextTurn,
    clocks: { ...state.clocks, [mover.side]: state.clocks[mover.side] + MOVE_INCREMENT_MS },
    ply,
    fullMove,
    winner,
    endReason,
    moves: [
      ...state.moves,
      {
        notation,
        side: mover.side,
        pieceId: mover.id,
        from,
        to,
        capturedId: captured?.captured ? captured.id : undefined,
        capturedIds: capturedPieces.map((piece) => piece.id),
      },
    ],
    walls: state.walls.map((wall) => ({ ...wall, remaining: wall.remaining - 1 })).filter((wall) => wall.remaining > 1),
    restrictions,
    deathmatchClock: state.deathmatch
      ? mover.type === "jol" || captured || capturedPieces.length ? 0 : state.deathmatchClock + (nextTurn === "cho" ? 1 : 0)
      : 0,
  };

  if (nextTurn === "cho") next = advanceGuksa(next);

  if (!winner && fullMove >= 50) {
    const choCost = totalCost(next, "cho");
    const hanCost = totalCost(next, "han");
    if (choCost !== hanCost) {
      winner = choCost < hanCost ? "cho" : "han";
      endReason = "judgment";
      next = { ...next, winner, endReason };
    } else {
      next = { ...next, deathmatch: true };
    }
  }

  if (!next.winner && next.deathmatch && next.deathmatchClock >= 8) {
    const score = (side: Side) => next.pieces
      .filter((piece) => !piece.captured && piece.side === side)
      .reduce((sum, piece) => sum + PIECE_VALUE[piece.type], 0);
    const choScore = score("cho");
    const hanScore = score("han");
    next = {
      ...next,
      winner: choScore === hanScore ? mover.side : choScore > hanScore ? "cho" : "han",
      endReason: "deathmatch",
    };
  }

  if (
    !next.winner &&
    next.augments &&
    nextTurn === "cho" &&
    (fullMove === 10 || fullMove === 20) &&
    state.fullMove !== fullMove
  ) {
    const slot = (fullMove === 10 ? 1 : 2) as 1 | 2;
    next = runtime.openDraft(next, "cho", slot, ["han"]);
  }

  return next;
}
