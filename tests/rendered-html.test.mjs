import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the Augment Janggi pilot", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>증강 장기 · Augment Janggi<\/title>/);
  assert.match(html, /로컬 2인 시작/);
  assert.match(html, /증강 테스트/);
  assert.match(html, /각종 증강들을 실험해 보세요/);
  assert.match(html, /방 만들기/);
  assert.match(html, /방 참여/);
  assert.match(html, /각자 10분/);
  assert.match(html, /착수마다 3초 추가/);
  assert.match(html, /증강 선택 60초/);
  assert.doesNotMatch(html, /LOCAL TABLE · PILOT 01/);
  assert.doesNotMatch(html, /장기의 익숙한 행마 위에|서로 다른 변칙을 더합니다/);
  assert.doesNotMatch(html, /AUGMENT JANGGI|증강은 시작, 10수, 20수에 선택합니다/);
  assert.doesNotMatch(html, /class="board-shell"/);
  assert.doesNotMatch(html, /게임 모드|AI 대국/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("publishes the project SVG as the browser favicon", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const favicon = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
  assert.match(layout, /icon:\s*\[\{ url: "\/favicon\.svg", type: "image\/svg\+xml" \}\]/);
  assert.match(layout, /shortcut:\s*"\/favicon\.svg"/);
  assert.match(favicon, /<svg[^>]+viewBox="0 0 64 64"/);
  assert.match(favicon, /<title>증강 장기<\/title>/);
});

test("ships the exact 74-card pool and cost distribution", async () => {
  const cards = JSON.parse((await readFile(new URL("../app/game/cards.json", import.meta.url), "utf8")).replace(/^\uFEFF/, ""));
  assert.equal(cards.length, 74);
  assert.equal(cards.reduce((sum, card) => sum + card.cost, 0), 230);
  const byCategory = Object.fromEntries([...Map.groupBy(cards, card => card.category)].map(([key, rows]) => [key, rows.length]));
  assert.deepEqual(byCategory, { TRANSFORM:20, PROMOTION:3, OPENING:7, ACTIVE:7, PALACE:15, ANOMALY:10, RESTRICT:12 });
  const byCost = Object.fromEntries([...Map.groupBy(cards, card => card.cost)].map(([key, rows]) => [key, rows.length]));
  assert.deepEqual(byCost, { 1:1, 1.5:5, 2:8, 2.5:11, 3:14, 3.5:16, 4:14, 4.5:2, 5:3 });
  assert.equal(new Set(cards.map(card => card.id)).size, 74);
});

test("keeps 자유포진 out of every playable and visible card pool", async () => {
  const catalog = await readFile(new URL("../app/game/catalog.ts", import.meta.url), "utf8");
  assert.match(catalog, /DISABLED_CARD_IDS = new Set\(\["jayu-pojin"\]\)/);
  assert.match(catalog, /CARDS = ALL_CARDS\.filter/);
});

test("wires the room-code multiplayer flow to the D1-backed worker", async () => {
  const app = await readFile(new URL("../app/GameApp.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/rooms.ts", import.meta.url), "utf8");
  const hosting = JSON.parse(await readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"));
  assert.match(app, /ONLINE ROOM/);
  assert.match(app, /방장 진영/);
  assert.match(app, /준비 완료/);
  assert.match(app, /방 대기실로/);
  assert.match(worker, /\/api\/rooms/);
  assert.match(worker, /projectGameView/);
  assert.match(worker, /expectedRevision/);
  assert.equal(hosting.d1, "DB");
});

test("movement generator intentionally omits self-check filtering", async () => {
  const engine = await readFile(new URL("../app/game/engine.ts", import.meta.url), "utf8");
  const model = await readFile(new URL("../app/game/model.ts", import.meta.url), "utf8");
  assert.match(engine, /Pure Janggi move generator/);
  assert.doesNotMatch(engine, /isInCheck|checkmate|selfCheck/);
  assert.match(model, /export type GameState/);
  assert.match(engine, /export function reduceGame/);
});

test("costs render as full and clipped half-star emoji instead of decimals", async () => {
  const app = await readFile(new URL("../app/GameApp.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/art.css", import.meta.url), "utf8");
  assert.match(app, /function StarCost/);
  assert.match(app, />⭐<\/span>/);
  assert.match(app, /className="half-star"/);
  assert.doesNotMatch(app, /cost\.toFixed\(1\)/);
  assert.doesNotMatch(app, /totalCost\([^)]*\)\.toFixed\(1\)/);
  assert.match(styles, /\.half-star\s*\{/);
});

test("used augments render the supplied stamp above a muted card", async () => {
  const app = await readFile(new URL("../app/GameApp.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/art.css", import.meta.url), "utf8");
  assert.match(app, /owned\.state==="used"/);
  assert.match(app, /className="used-stamp" viewBox="0 0 187 110"/);
  assert.match(app, /href=\{USED_STAMP_ART\}/);
  assert.match(app, /사용됨/);
  assert.match(styles, /\.augment-summary\.used > \*\s*\{[^}]*grayscale\(\.75\) opacity\(\.5\)/);
  assert.match(styles, /\.augment-summary\.used::before\s*\{[^}]*rgba\(250, 246, 236, \.62\)/);
  assert.match(styles, /\.augment-summary\.used \.used-stamp\s*\{[^}]*width: 50%/);
});

test("mobile layouts preserve native vertical page and modal scrolling", async () => {
  const app = await readFile(new URL("../app/GameApp.tsx", import.meta.url), "utf8");
  const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const product = await readFile(new URL("../app/product.css", import.meta.url), "utf8");
  const art = await readFile(new URL("../app/art.css", import.meta.url), "utf8");
  assert.match(globals, /html\{[^}]*overflow-y:auto/);
  assert.match(globals, /body\{[^}]*overflow-y:visible/);
  assert.match(globals, /\.lobby-shell\{[\s\S]*?display:block;[\s\S]*?min-height:100dvh;[\s\S]*?overflow:visible/);
  assert.match(globals, /\.lobby-layout\{margin:0 auto;align-content:start\}/);
  assert.match(app, /className="mobile-nav-menu"/);
  assert.match(app, /function AugmentDetailModal/);
  assert.match(app, /aria-haspopup="dialog"/);
  assert.match(app, /aria-label="증강 설명 닫기"/);
  assert.match(app, /className="augment-detail-dismiss"/);
  assert.match(app, /function CardBadges/);
  assert.doesNotMatch(app, /STATE_LABEL|augment-kind-badge|state-badge/);
  assert.doesNotMatch(app, /<details className=.*augment-summary/);
  assert.match(app, /className="augment-thumb"/);
  assert.match(app, /className="public-augment-thumb"/);
  assert.match(app, /game\.pieces\.filter\(piece=>!piece\.captured&&piece\.carriedBy\)/);
  assert.match(app, /mountLabel=host\?\.transformCardId==="gongseongtap"\?"공성탑":"역마차"/);
  assert.doesNotMatch(app, /대상 지정됨/);
  assert.match(app, /function CardDescription/);
  assert.match(app, /className="transform-lead"/);
  assert.match(app, /function HistoryModal/);
  assert.match(app, /function snapshotAtMove/);
  assert.match(app, /modal:"history"/);
  assert.match(app, /id="augment-panel"/);
  assert.doesNotMatch(app, /className="panel-heading"><span>공개 증강/);
  assert.match(product, /\.mobile-nav-menu\{position:relative;display:block/);
  assert.match(product, /\.draft-cards\{[^}]*grid-auto-flow:column[^}]*scroll-snap-type:x mandatory/);
  assert.match(product, /\.draft-cards\{[^}]*grid-auto-columns:minmax\(220px,78%\)/);
  assert.match(product, /\.draft-cards \.card-tile\{[^}]*grid-template-columns:82px minmax\(0,1fr\)/);
  assert.match(product, /\.draft-cards \.card-art\{[^}]*width:82px/);
  assert.match(globals, /\.player-strip\.han\{grid-column:1;grid-row:1\}/);
  assert.match(globals, /\.player-strip\.cho\{grid-column:2;grid-row:1\}/);
  assert.match(globals, /\.table-area,\.board-shell,\.board-shell svg\{touch-action:pan-y\}/);
  assert.match(globals, /\.game-layout\{display:block;min-height:0;overflow:visible\}/);
  assert.match(product, /\.modal-backdrop\{[^}]*overflow:hidden[^}]*touch-action:pan-y/);
  assert.match(product, /\.modal\{[^}]*max-height:min\(calc\(100dvh - 16px\),720px\)[^}]*overflow-y:auto[^}]*touch-action:pan-y/);
  assert.match(product, /\.deck-modal\{height:auto\}/);
  assert.match(art, /\.piece\s*\{[^}]*touch-action:\s*pan-y/);
  assert.match(art, /\.augment-detail-backdrop\s*\{[^}]*z-index: 40/);
  assert.match(art, /\.augment-detail-modal\s*\{[^}]*width: min\(520px, 100%\)/);
  assert.match(art, /\.all-augments\s*\{[^}]*display: block;[^}]*overflow: visible/);
  assert.match(art, /\.augment-roster \+ \.augment-roster\s*\{[^}]*border-top: 1px solid[^}]*border-left: 0/);
  assert.match(app, /kind:"piece"\|"myosupuri"\|"wall"\|"trap"\|"palace-line"/);
  assert.match(app, /card&&augmentPieceTarget\(card\)[^\n]+kind:"piece"/);
  assert.match(app, /을 설치할 내 궁성 안 빈칸/);
  assert.match(app, /3수 확정/);
  assert.match(app, /setTimeout\(\(\)=>dispatch\(\{type:"NOTICE"\}\),1_000\)/);
  assert.match(app, /targetSquare:s/);
  assert.match(app, /targetLine:line/);
  const palacePieceLayer = app.indexOf("{visiblePieces.map");
  const palaceHitLayer = app.indexOf('key={`palace-line-hit-${index}`}');
  assert.ok(palacePieceLayer >= 0 && palaceHitLayer > palacePieceLayer, "palace line hit targets must render above pieces");
  assert.match(app, /window\.matchMedia\("\(max-width: 720px\)"\)/);
  assert.match(app, /setPreviewLineIndex\(index\)/);
  assert.match(app, /선택한 위치에 설치할까요\?/);
  assert.match(app, /설치 확정/);
  assert.match(art, /\.mobile-palace-confirm\s*\{\s*display: none/);
  assert.match(art, /@media \(max-width: 720px\)[\s\S]*?\.mobile-palace-confirm\s*\{[^}]*position: fixed[^}]*top: 50%[^}]*left: 50%[^}]*transform: translate\(-50%, -50%\)/);
  assert.match(app, /function TestAugmentModal/);
  assert.match(app, /function JangdolbaengiReserve/);
  assert.match(app, /className="jangdol-reserve"/);
  assert.match(app, /DEPLOY_JANGDOLBAENGI_RESERVE/);
  assert.match(app, /placingReserve=/);
  assert.match(art, /\.reserve-drop-target\s*\{/);
  assert.match(art, /\.jangdol-reserve button\.selected\s*\{/);
  assert.match(app, /TEST_GRANT_AUGMENT/);
  assert.match(app, /className="lobby-test"/);
  assert.match(art, /\.test-mode-toolbar\s*\{/);
  assert.match(art, /\.augment-summary-heading > span\s*\{[^}]*display: flex/);
  assert.match(art, /\.activation-badge\.active\s*\{/);
  assert.match(art, /\.activation-badge\.passive\s*\{/);
  assert.match(art, /\.restriction-turns-badge\s*\{/);
  assert.match(app, /\{remaining\}수남음/);
  assert.match(art, /\.transform-detail\s*\{[^}]*border-top:/);
});
