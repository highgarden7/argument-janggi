import type { GameState, Side } from "./model";

/**
 * Creates a player-facing allow-list view. Hidden opponent pieces and another
 * player's private draft choices never reach board/UI consumers.
 */
export function projectGameView(state: GameState, viewer: Side): GameState {
  return {
    schemaVersion: state.schemaVersion,
    rulesetVersion: state.rulesetVersion,
    revision: state.revision,
    eventSequence: state.eventSequence,
    rngSeed: state.rngSeed,
    phase: state.phase,
    pieces: state.pieces
      .filter((piece) => !piece.hidden || piece.side === viewer)
      .map((piece) => ({ ...piece })),
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
    draft: state.draft?.side === viewer
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
