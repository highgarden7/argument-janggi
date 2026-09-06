import type { GameState, Side } from "./model";

/**
 * Creates a player-facing allow-list view. Hidden opponent pieces never reach
 * board/UI consumers. Draft candidates are shared with both players by design,
 * so each side can follow the opponent's augment pick as it happens.
 */
export function projectGameView(state: GameState, viewer: Side): GameState {
  return {
    schemaVersion: state.schemaVersion,
    rulesetVersion: state.rulesetVersion,
    revision: state.revision,
    eventSequence: state.eventSequence,
    rngSeed: state.rngSeed,
    phase: state.phase,
    // 암행어사 같은 은밀한 지정은 소유자에게만 실어 보낸다. 상대에게는 평범한 기물로 보인다.
    pieces: state.pieces
      .filter((piece) => !piece.hidden || piece.side === viewer)
      .map((piece) => piece.side === viewer ? { ...piece } : { ...piece, secretCardId: undefined }),
    turn: state.turn,
    clocks: { ...state.clocks },
    draftClockMs: state.draftClockMs,
    ply: state.ply,
    fullMove: state.fullMove,
    winner: state.winner,
    endReason: state.endReason,
    cards: {
      cho: state.cards.cho.map((card) => ({ ...card })),
      han: state.cards.han.map((card) => ({ ...card })),
    },
    draft: state.draft
      ? { ...state.draft, choices: [...state.draft.choices], queue: [...state.draft.queue] }
      : undefined,
    augments: state.augments,
    moves: state.moves.map((move) => ({ ...move, from: { ...move.from }, to: { ...move.to } })),
    restrictions: state.restrictions.map((restriction) => ({ ...restriction })),
    walls: state.walls.map((wall) => ({ ...wall })),
    palaceStructures: state.palaceStructures.map((structure) => ({ ...structure, points: structure.points.map((point) => ({ ...point })) })),
    traps: state.traps.map((trap) => ({ ...trap })),
    jeokgi: state.jeokgi.map((marker) => ({ ...marker })),
    reserves: {
      cho: state.reserves.cho.map((piece) => ({ ...piece })),
      han: state.reserves.han.map((piece) => ({ ...piece })),
    },
    waitingPieces: {
      cho: state.waitingPieces.cho.map((piece) => ({ ...piece })),
      han: state.waitingPieces.han.map((piece) => ({ ...piece })),
    },
    myosupuriPlans: Object.fromEntries(Object.entries(state.myosupuriPlans).map(([side, plan]) => [side, plan ? { ...plan, moves: plan.moves.map((square) => ({ ...square })) } : plan])),
    deathmatch: state.deathmatch,
    deathmatchClock: state.deathmatchClock,
    formations: { ...state.formations },
  };
}
