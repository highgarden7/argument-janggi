import rawCards from "./cards.json";
import type { Card, GameState, Side } from "./model";

const ALL_CARDS = rawCards as Card[];
export const DISABLED_CARD_IDS = new Set(["jayu-pojin"]);
export const CARDS = ALL_CARDS.filter((card) => !DISABLED_CARD_IDS.has(card.id));
export const CARD_BY_ID = Object.fromEntries(ALL_CARDS.map((card) => [card.id, card])) as Record<string, Card>;
const DIRECT_USE_PERMANENT_RESTRICTIONS = new Set(["busang", "sucha", "talyeong", "yeokbyeong"]);

export function cardActivationKind(card: Card): "ACTIVE" | "PASSIVE" {
  if (card.category === "RESTRICT" && card.duration === "영구" && !DIRECT_USE_PERMANENT_RESTRICTIONS.has(card.id)) return "PASSIVE";
  return card.activation === "ACTIVE" ? "ACTIVE" : "PASSIVE";
}

export function restrictionTurnsRemaining(state: GameState, cardId: string): number | undefined {
  const card = CARD_BY_ID[cardId];
  if (card?.category !== "RESTRICT" || card.duration === "영구" || !card.duration?.match(/\d+/)) return undefined;
  return state.restrictions.find((restriction) => restriction.cardId === cardId && restriction.remaining > 0)?.remaining;
}

export function totalCost(state: GameState, side: Side): number {
  return state.cards[side].reduce((sum, owned) => sum + CARD_BY_ID[owned.cardId].cost, 0);
}
