import type { Piece, Side } from "./game/engine";

export const BOARD_ART = "/board/board.svg";

const TRANSFORM_ART_IDS = new Set([
  "gwal-sang",
  "yugyeok-jol",
  "howi-musa",
  "jeoncha",
  "cheonma",
  "jungpo",
  "gongseongtap",
  "geobukseon",
  "miljeong",
  "hwacha",
  "hongipo",
  "dokkaebi",
  "jeoktoma",
  "mudang",
  "horangi",
  "gwangdae",
  "uibyeong",
  "jangdolbaengi",
  "naesi",
  "guksa",
  "hangu",
  "yubang",
]);

const TRANSFORM_ART_ALIASES: Record<string, string> = {
  sindaeryuk: "bisyop",
};

export function cardArtPath(cardId: string): string {
  return `/cards/${cardId}.svg`;
}

/** 소유자에게만 드러나는 지정의 전용 아트. 상대 시야에서는 이 값이 지워져 평범한 기물로 보인다. */
const SECRET_ART_IDS = new Set(["amhaeng-eosa"]);

export function pieceArtPath(piece: Pick<Piece, "side" | "type" | "transformCardId" | "secretCardId">): string {
  if (piece.transformCardId && TRANSFORM_ART_ALIASES[piece.transformCardId]) {
    return `/pieces/${piece.side}-t-${TRANSFORM_ART_ALIASES[piece.transformCardId]}.svg`;
  }
  if (piece.transformCardId && TRANSFORM_ART_IDS.has(piece.transformCardId)) {
    return `/pieces/${piece.side}-t-${piece.transformCardId}.svg`;
  }
  if (piece.secretCardId && SECRET_ART_IDS.has(piece.secretCardId)) {
    return `/pieces/${piece.side}-t-${piece.secretCardId}.svg`;
  }
  return `/pieces/${piece.side}-${piece.type}.svg`;
}

export function effectArtPath(effect: "bind" | "freeze" | "infect" | "jeokgi" | "river" | "trap", side: Side): string {
  return `/effects/${side}-${effect}.svg`;
}

export const WALL_ART = "/effects/wall.svg";
export const USED_STAMP_ART = "/ui/used-stamp.svg";
