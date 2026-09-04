import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "public");

async function names(folder) {
  return (await readdir(path.join(publicRoot, folder))).sort();
}

test("ships artwork only through the requested public directories", async () => {
  await access(path.join(publicRoot, "board", "board.svg"));
  assert.equal((await names("cards")).length, 74);
  assert.equal((await names("effects")).length, 14);
  assert.equal((await names("pieces")).filter(file => !file.endsWith(".sprite.svg")).length, 60);
  await access(path.join(publicRoot, "ui", "used-stamp.svg"));

  const cards = JSON.parse((await readFile(path.join(root, "app", "game", "cards.json"), "utf8")).replace(/^\uFEFF/, ""));
  assert.deepEqual(await names("cards"), cards.map(card => `${card.id}.svg`).sort());
});

test("all public artwork is self-contained SVG", async () => {
  for (const folder of ["board", "cards", "effects", "pieces", "ui"]) {
    for (const file of await names(folder)) {
      assert.match(file, /\.svg$/);
      const svg = await readFile(path.join(publicRoot, folder, file), "utf8");
      assert.match(svg, /^<svg\b/);
      assert.doesNotMatch(svg, /<script\b|<foreignObject\b|(?:href|src)=["']https?:/i);
    }
  }
});

test("renderer uses root-relative paths for the four asset families", async () => {
  const paths = await readFile(path.join(root, "app", "art-assets.ts"), "utf8");
  assert.match(paths, /"\/board\/board\.svg"/);
  assert.match(paths, /`\/cards\/\$\{cardId\}\.svg`/);
  assert.match(paths, /`\/pieces\/\$\{piece\.side\}/);
  assert.match(paths, /`\/effects\/\$\{side\}/);
  assert.match(paths, /"\/ui\/used-stamp\.svg"/);
  assert.doesNotMatch(paths, /\/janggi-art-v7\/|\/art\//);
});

test("Sindaeryuk renders with the dedicated Bishop pieces", async () => {
  const paths = await readFile(path.join(root, "app", "art-assets.ts"), "utf8");
  assert.match(paths, /sindaeryuk:\s*"bisyop"/);
  await access(path.join(publicRoot, "pieces", "cho-t-bisyop.svg"));
  await access(path.join(publicRoot, "pieces", "han-t-bisyop.svg"));
});
