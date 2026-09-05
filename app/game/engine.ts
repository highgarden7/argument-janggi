import { automaticEnemyTarget, runAugmentHook } from "./augment-registry";
import { CARD_BY_ID, CARDS, cardActivationKind, restrictionTurnsRemaining, totalCost } from "./catalog";
import { meetsDrawRequirement } from "./draw-requirements";
import {
  GAME_SCHEMA_VERSION,
  DRAFT_CLOCK_MS,
  INITIAL_CLOCK_MS,
  MOVE_INCREMENT_MS,
  PIECE_LABEL,
  RULESET_VERSION,
  derivePhase,
  migrateGameState,
  opponent,
  sameSquare,
} from "./model";
import type {
  Card,
  CardState,
  DraftSlot,
  Formation,
  GameCommand,
  GameEvent,
  GameState,
  GameTransition,
  MoveRecord,
  OwnedCard,
  PalaceStructure,
  Piece,
  PieceType,
  Restriction,
  Side,
  Square,
} from "./model";
import { projectGameView } from "./projection";
import { finishAction } from "./turn-pipeline";

export { CARD_BY_ID, CARDS, DRAFT_CLOCK_MS, GAME_SCHEMA_VERSION, INITIAL_CLOCK_MS, MOVE_INCREMENT_MS, PIECE_LABEL, RULESET_VERSION, cardActivationKind, migrateGameState, projectGameView, restrictionTurnsRemaining, totalCost };
export type {
  Card,
  CardState,
  Formation,
  GameCommand,
  GameEvent,
  GameState,
  GameTransition,
  MoveRecord,
  OwnedCard,
  PalaceStructure,
  Piece,
  PieceType,
  Restriction,
  Side,
  Square,
} from "./model";

const inside = (x:number,y:number) => x>=0&&x<9&&y>=0&&y<10;
const same = sameSquare;
const PALACE_LINES:Square[][] = [
  [{x:3,y:0},{x:4,y:1},{x:5,y:2}], [{x:5,y:0},{x:4,y:1},{x:3,y:2}],
  [{x:3,y:7},{x:4,y:8},{x:5,y:9}], [{x:5,y:7},{x:4,y:8},{x:3,y:9}],
];
const EXPANDED_PALACE_LINES:Record<Side,Square[][]> = {
  cho: [
    [{x:3,y:0},{x:4,y:1},{x:5,y:2},{x:6,y:3}],
    [{x:5,y:0},{x:4,y:1},{x:3,y:2},{x:2,y:3}],
  ],
  han: [
    [{x:2,y:6},{x:3,y:7},{x:4,y:8},{x:5,y:9}],
    [{x:6,y:6},{x:5,y:7},{x:4,y:8},{x:3,y:9}],
  ],
};
const SANG_PATTERNS = [[0,1,-1,1,-1,1],[0,1,1,1,1,1],[0,-1,-1,-1,-1,-1],[0,-1,1,-1,1,-1],[1,0,1,-1,1,-1],[1,0,1,1,1,1],[-1,0,-1,-1,-1,-1],[-1,0,-1,1,-1,1]];
const inPalace = (side:Side,x:number,y:number) => x>=3&&x<=5&&(side==="cho"?y>=0&&y<=2:y>=7&&y<=9);
const palaceLines = (side:Side,expanded:boolean) => expanded?EXPANDED_PALACE_LINES[side]:PALACE_LINES.filter(line=>inPalace(side,line[0].x,line[0].y));
const inEffectivePalace = (side:Side,x:number,y:number,expanded:boolean) => expanded
  ? x>=2&&x<=6&&(side==="cho"?y>=0&&y<=3:y>=6&&y<=9)
  : inPalace(side,x,y);
const onEffectivePalaceDiagonal = (side:Side,a:Square,b:Square,expanded:boolean) => palaceLines(side,expanded).some(line=>line.some(s=>same(s,a))&&line.some(s=>same(s,b))&&Math.abs(a.x-b.x)===Math.abs(a.y-b.y));

function regularPalaceLineTargets(side:Side):Square[][] {
  const regularRanks=side==="cho"?[0,1,2]:[9,8,7],regularFront=regularRanks.at(-1)!;
  return [
    regularRanks.map(y=>({x:3,y})),
    regularRanks.map(y=>({x:5,y})),
    [3,4,5].map(x=>({x,y:regularFront})),
  ];
}

export function palaceLineTargets(state:GameState,side:Side):Square[][] {
  const expanded=state.cards[side].some(card=>card.cardId==="gwang-gungseong"&&card.state==="active");
  const regularTargets=regularPalaceLineTargets(side);
  if(!expanded)return regularTargets;
  const expandedRanks=side==="cho"?[0,1,2,3]:[9,8,7,6],expandedFront=expandedRanks.at(-1)!,frontFiles=[2,3,4,5,6];
  const expandedTargets:Square[][]=[
    expandedRanks.slice(0,3).map(y=>({x:2,y})),
    expandedRanks.slice(1,4).map(y=>({x:2,y})),
    expandedRanks.slice(0,3).map(y=>({x:6,y})),
    expandedRanks.slice(1,4).map(y=>({x:6,y})),
    frontFiles.slice(0,3).map(x=>({x,y:expandedFront})),
    frontFiles.slice(1,4).map(x=>({x,y:expandedFront})),
    frontFiles.slice(2,5).map(x=>({x,y:expandedFront})),
  ];
  return [...regularTargets,...expandedTargets];
}

const sameLine = (a:Square[],b:Square[]) => a.length===b.length&&(a.every((point,index)=>same(point,b[index]))||a.every((point,index)=>same(point,b[b.length-1-index])));

function segmentIntersectsLine(from:Square,to:Square,points:Square[]):boolean {
  const first=points[0],last=points.at(-1);
  if(!first||!last)return false;
  const epsilon=1e-9;
  if(first.x===last.x){
    const x=first.x,minY=Math.min(first.y,last.y),maxY=Math.max(first.y,last.y);
    if(from.x===to.x)return from.x===x&&Math.max(Math.min(from.y,to.y),minY)<=Math.min(Math.max(from.y,to.y),maxY);
    const t=(x-from.x)/(to.x-from.x);
    if(t < -epsilon || t > 1+epsilon)return false;
    const y=from.y+(to.y-from.y)*t;
    return y>=minY-epsilon&&y<=maxY+epsilon;
  }
  const y=first.y,minX=Math.min(first.x,last.x),maxX=Math.max(first.x,last.x);
  if(from.y===to.y)return from.y===y&&Math.max(Math.min(from.x,to.x),minX)<=Math.min(Math.max(from.x,to.x),maxX);
  const t=(y-from.y)/(to.y-from.y);
  if(t < -epsilon || t > 1+epsilon)return false;
  const x=from.x+(to.x-from.x)*t;
  return x>=minX-epsilon&&x<=maxX+epsilon;
}

function blockedByPalaceStructure(piece:Piece,to:Square,structures:PalaceStructure[],expandedPalaces:Side[]):boolean {
  for(const structure of structures){
    const usesExpandedBoundary=expandedPalaces.includes(structure.side)&&!regularPalaceLineTargets(structure.side).some(candidate=>sameLine(candidate,structure.points));
    const startsInside=inEffectivePalace(structure.side,piece.x,piece.y,usesExpandedBoundary);
    const endsInside=inEffectivePalace(structure.side,to.x,to.y,usesExpandedBoundary);
    if(structure.cardId==="seongbyeok"){
      if(!startsInside&&endsInside&&segmentIntersectsLine(piece,to,structure.points))return true;
      continue;
    }
    if(structure.side===piece.side)continue;
    if(!startsInside&&endsInside&&!segmentIntersectsLine(piece,to,structure.points))return true;
  }
  return false;
}

export type MoveModifiers = { cardIds:string[]; restrictions:Restriction[]; walls:Square[]; palaceStructures?:PalaceStructure[]; expandedPalaces?:Side[]; jeokgi?:Square[]; fullMove:number; lastOwnMove?:MoveRecord; enemyKing?:Square };

function rayMoves(board:Piece[], piece:Piece, directions:Square[], max=99):Square[] {
  const out:Square[]=[];
  for(const d of directions) for(let n=1;n<=max;n++){
    const x=piece.x+d.x*n,y=piece.y+d.y*n; if(!inside(x,y)) break;
    const hit=board.find(p=>!p.captured&&!p.carriedBy&&p.x===x&&p.y===y); if(hit){if(hit.side!==piece.side)out.push({x,y});break;} out.push({x,y});
  }
  return out;
}

/** The Geobukseon passes through enemies, captures up to its durability, and is blocked by allies. */
function geobukseonMoves(board:Piece[],piece:Piece):Square[]{
  const out:Square[]=[];
  const durability=piece.hp??2;
  for(const direction of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]){
    let capturedEnemies=0;
    for(let distance=1;distance<10;distance++){
      const square={x:piece.x+direction.x*distance,y:piece.y+direction.y*distance};
      if(!inside(square.x,square.y))break;
      const hit=board.find(candidate=>!candidate.captured&&!candidate.carriedBy&&same(candidate,square));
      if(hit?.side===piece.side)break;
      if(hit?.id.startsWith("__block-")){out.push(square);break}
      if(hit){
        if(capturedEnemies>=durability)break;
        capturedEnemies+=1;
      }
      out.push(square);
    }
  }
  return out;
}

function piecesStrictlyBetween(pieces:Piece[],piece:Piece,to:Square):Piece[]{
  const dx=Math.sign(to.x-piece.x),dy=Math.sign(to.y-piece.y);
  if(dx!==0&&dy!==0)return[];
  const result:Piece[]=[];
  for(let x=piece.x+dx,y=piece.y+dy;x!==to.x||y!==to.y;x+=dx,y+=dy){
    const hit=pieces.find(candidate=>!candidate.captured&&!candidate.carriedBy&&candidate.x===x&&candidate.y===y);
    if(hit)result.push(hit);
  }
  return result;
}

function palaceRayMoves(board:Piece[],piece:Piece,expanded=false):Square[]{
  const out:Square[]=[];
  for(const line of palaceLines(piece.side,expanded)){ const i=line.findIndex(s=>same(s,piece)); if(i<0)continue; for(const step of [-1,1])for(let n=i+step;n>=0&&n<line.length;n+=step){const s=line[n],hit=board.find(p=>!p.captured&&!p.carriedBy&&same(p,s));if(hit){if(hit.side!==piece.side)out.push(s);break}out.push(s)} }
  return out;
}

function gongseongtapMoves(board:Piece[],piece:Piece,expanded=false):Square[]{
  return [...rayMoves(board,piece,[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}],2),...palaceRayMoves(board,piece,expanded).filter(square=>Math.max(Math.abs(square.x-piece.x),Math.abs(square.y-piece.y))<=2)];
}

function cannonRay(board:Piece[],piece:Piece,line:Square[],allowOwnPo:boolean,noScreen:boolean,minScreens=1,maxScreens=1):Square[]{
  const out:Square[]=[]; let screens=0;
  for(const s of line){ const hit=board.find(p=>!p.captured&&!p.carriedBy&&same(p,s));
    if(hit?.id.startsWith("__block-")){if(noScreen||screens>=min&&screens<=max)out.push(s);break}
    if(noScreen){ if(hit){if(hit.side!==piece.side&&hit.type!=="po")out.push(s);break}out.push(s);continue; }
    if(hit){
      if(hit.type==="po"&&!(allowOwnPo&&hit.side===piece.side))break;
      if(screens<minScreens){screens++;continue}
      if(hit.side!==piece.side&&hit.type!=="po")out.push(s);
      if(screens>=maxScreens)break;
      screens++;continue;
    }
    if(screens>=minScreens&&screens<=maxScreens)out.push(s);
  } return out;
}

function cannonMoves(board:Piece[],piece:Piece,mods:MoveModifiers):Square[]{
  const out:Square[]=[]; const allowOwnPo=mods.cardIds.includes("yeonhwanpo"), noScreen=mods.cardIds.includes("chapo-ttegi");const smoke=mods.restrictions.some(r=>r.side===piece.side&&r.cardId==="yeonmak"),heavy=piece.transformCardId==="jungpo";const min=smoke?2:1,max=heavy?2:min;
  for(const d of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]){const line:Square[]=[];for(let n=1;n<10;n++){const s={x:piece.x+d.x*n,y:piece.y+d.y*n};if(!inside(s.x,s.y))break;line.push(s)}out.push(...cannonRay(board,piece,line,allowOwnPo,noScreen,min,max));}
  for(const line of palaceLines(piece.side,mods.cardIds.includes("gwang-gungseong"))){const i=line.findIndex(s=>same(s,piece));if(i===0)out.push(...cannonRay(board,piece,line.slice(1),allowOwnPo,noScreen,min,max));if(i===line.length-1)out.push(...cannonRay(board,piece,line.slice(0,-1).reverse(),allowOwnPo,noScreen,min,max));}
  return out;
}

function yubangMoves(board:Piece[],piece:Piece,expanded=false):Square[]{
  const out:Square[]=[];
  const insidePalace=inEffectivePalace(piece.side,piece.x,piece.y,expanded);
  const directions=insidePalace
    ?[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:1,y:1},{x:1,y:-1},{x:-1,y:1},{x:-1,y:-1}]
    :[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
  for(const direction of directions){
    const square={x:piece.x+direction.x,y:piece.y+direction.y};
    if(!inside(square.x,square.y))continue;
    const diagonal=Math.abs(direction.x)+Math.abs(direction.y)===2;
    if(diagonal&&(!inEffectivePalace(piece.side,square.x,square.y,expanded)||!onEffectivePalaceDiagonal(piece.side,piece,square,expanded)))continue;
    const target=board.find(candidate=>!candidate.captured&&!candidate.carriedBy&&same(candidate,square));
    if(!target||target.side!==piece.side)out.push(square);
  }
  return out;
}

function gwangdaeMoves(board:Piece[],piece:Piece,mods:MoveModifiers):Square[]{
  const adjacent=board.filter(candidate=>!candidate.captured&&!candidate.carriedBy&&candidate.side===piece.side&&candidate.id!==piece.id&&Math.max(Math.abs(candidate.x-piece.x),Math.abs(candidate.y-piece.y))===1);
  if(!adjacent.length)return generatePieceMoves(board,{...piece,transformCardId:undefined},mods);
  return adjacent.flatMap(source=>generatePieceMoves(board,{...piece,type:source.type,transformCardId:undefined},mods));
}

function jeoktomaMoves(board:Piece[],piece:Piece,mods:MoveModifiers):Square[]{
  const out:Square[]=[];
  const maxStraightLength=1+Math.min(2,piece.growth??0);
  const across=piece.side==="cho"?piece.y>=5:piece.y<=4;
  const ignoreLegs=mods.cardIds.includes("chapo-ttegi")||(mods.cardIds.includes("dogang")&&across);
  const doubleLeg=mods.restrictions.some(restriction=>restriction.side===piece.side&&restriction.cardId==="gyeolgak");
  for(const direction of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]){
    const reverseLeg={x:piece.x-direction.x,y:piece.y-direction.y};
    if(!ignoreLegs&&doubleLeg&&board.some(candidate=>!candidate.captured&&!candidate.carriedBy&&same(candidate,reverseLeg)))continue;
    for(let straightLength=1;straightLength<=maxStraightLength;straightLength++){
      const straightSquare={x:piece.x+direction.x*straightLength,y:piece.y+direction.y*straightLength};
      if(!ignoreLegs&&board.some(candidate=>!candidate.captured&&!candidate.carriedBy&&same(candidate,straightSquare)))break;
      for(const turn of [-1,1]){
        const square=direction.x===0
          ?{x:piece.x+turn,y:piece.y+direction.y*(straightLength+1)}
          :{x:piece.x+direction.x*(straightLength+1),y:piece.y+turn};
        if(!inside(square.x,square.y))continue;
        const target=board.find(candidate=>!candidate.captured&&!candidate.carriedBy&&same(candidate,square));
        if(!target||target.side!==piece.side)out.push(square);
      }
    }
  }
  return out;
}

function hungryTigerMoves(board:Piece[],piece:Piece):Square[]{
  return rayMoves(board,piece,[{x:1,y:1},{x:1,y:-1},{x:-1,y:1},{x:-1,y:-1}])
    .filter(square=>board.some(candidate=>!candidate.captured&&!candidate.carriedBy&&candidate.side!==piece.side&&same(candidate,square)));
}

function uibyeongMoves(board:Piece[],piece:Piece,expanded=false):Square[]{
  const growth=Math.min(3,piece.growth??0);
  if(growth>=3)return [...rayMoves(board,piece,[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]),...palaceRayMoves(board,piece,expanded)];
  const forward=piece.side==="cho"?1:-1;
  const directions:Square[]=[{x:-1,y:0},{x:1,y:0},{x:0,y:forward}];
  if(growth>=1)directions.push({x:0,y:-forward});
  if(growth>=2)directions.push({x:-1,y:forward},{x:1,y:forward});
  return directions.flatMap(direction=>{
    const square={x:piece.x+direction.x,y:piece.y+direction.y};
    if(!inside(square.x,square.y))return[];
    const target=board.find(candidate=>!candidate.captured&&!candidate.carriedBy&&same(candidate,square));
    return !target||target.side!==piece.side?[square]:[];
  });
}

/** Pure Janggi move generator. It intentionally performs no self-check filtering. */
export function generatePieceMoves(board:Piece[],piece:Piece,mods:MoveModifiers):Square[]{
  if(piece.captured||piece.frozen&&piece.frozen>0)return[];
  if(mods.walls.length||(mods.jeokgi?.length??0)>0){
    const blockers:Piece[]=[
      ...mods.walls.map((wall,index)=>({id:`__block-wall-${index}`,side:opponent(piece.side),type:"jol" as PieceType,x:wall.x,y:wall.y})),
      ...(mods.jeokgi??[]).map((marker,index)=>({id:`__block-jeokgi-${index}`,side:opponent(piece.side),type:"jol" as PieceType,x:marker.x,y:marker.y})),
    ];
    board=[...blockers,...board];
  }
  const ids=mods.cardIds, out:Square[]=[];
  const expandedPalace=ids.includes("gwang-gungseong");
  const guardsAlive=board.some(p=>!p.captured&&p.side===piece.side&&p.type==="sa");
  const freeKing=piece.type==="gung"&&(ids.includes("hangu")||ids.includes("eorim")||(ids.includes("chulgung")&&!guardsAlive));
  const freeGuard=piece.type==="sa"&&ids.includes("howi-musa");
  if(piece.transformCardId==="yubang") out.push(...yubangMoves(board,piece,expandedPalace));
  else if(piece.transformCardId==="geobukseon") out.push(...geobukseonMoves(board,piece));
  else if(piece.transformCardId==="sindaeryuk") out.push(...rayMoves(board,piece,[{x:1,y:1},{x:1,y:-1},{x:-1,y:1},{x:-1,y:-1}]));
  else if(piece.transformCardId==="horangi") out.push(...hungryTigerMoves(board,piece));
  else if(piece.transformCardId==="gwangdae") out.push(...gwangdaeMoves(board,piece,mods));
  else if(piece.transformCardId==="jeoktoma") out.push(...jeoktomaMoves(board,piece,mods));
  else if(piece.transformCardId==="uibyeong") out.push(...uibyeongMoves(board,piece,expandedPalace));
  else if(piece.transformCardId==="hongipo") out.push(...rayMoves(board,piece,[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]));
  else if(piece.transformCardId==="gongseongtap") out.push(...gongseongtapMoves(board,piece,expandedPalace));
  else if(piece.type==="cha") { out.push(...rayMoves(board,piece,[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}])); out.push(...palaceRayMoves(board,piece,expandedPalace)); if(piece.transformCardId==="jeoncha") for(const d of [{x:1,y:1},{x:1,y:-1},{x:-1,y:1},{x:-1,y:-1}]){const s={x:piece.x+d.x,y:piece.y+d.y};if(inside(s.x,s.y)){const h=board.find(p=>!p.captured&&!p.carriedBy&&same(p,s));if(!h||h.side!==piece.side)out.push(s)}} }
  else if(piece.type==="po") out.push(...cannonMoves(board,piece,mods));
  else if(piece.type==="ma") { const patterns=[[0,1,-1,2],[0,1,1,2],[0,-1,-1,-2],[0,-1,1,-2],[1,0,2,-1],[1,0,2,1],[-1,0,-2,-1],[-1,0,-2,1]]; const doubleLeg=mods.restrictions.some(r=>r.side===piece.side&&r.cardId==="gyeolgak");for(const [lx,ly,dx,dy] of patterns){const leg={x:piece.x+lx,y:piece.y+ly},reverseLeg={x:piece.x-lx,y:piece.y-ly},s={x:piece.x+dx,y:piece.y+dy};const across=piece.side==="cho"?piece.y>=5:piece.y<=4;const ignore=piece.transformCardId==="cheonma"||ids.includes("chapo-ttegi")||(ids.includes("dogang")&&across);if(inside(s.x,s.y)&&(ignore||!board.some(p=>!p.captured&&!p.carriedBy&&(same(p,leg)||(doubleLeg&&same(p,reverseLeg)))))){const h=board.find(p=>!p.captured&&!p.carriedBy&&same(p,s));if(!h||h.side!==piece.side)out.push(s)}} }
  else if(piece.type==="sang") { for(const [a,b,c,d,e,f] of SANG_PATTERNS){const l1={x:piece.x+a,y:piece.y+b},l2={x:piece.x+a+c,y:piece.y+b+d},s={x:piece.x+a+c+e,y:piece.y+b+d+f};const across=piece.side==="cho"?piece.y>=5:piece.y<=4;const blocks=[l1,l2].filter(q=>board.some(p=>!p.captured&&!p.carriedBy&&same(p,q))).length;const ignore=ids.includes("sangatap")||ids.includes("chapo-ttegi")||(ids.includes("dogang")&&across);const allowed=ignore?2:piece.transformCardId==="gwal-sang"?1:0;if(inside(s.x,s.y)&&blocks<=allowed){const h=board.find(p=>!p.captured&&!p.carriedBy&&same(p,s));if(!h||h.side!==piece.side)out.push(s)}} }
  else if(piece.type==="gung"||piece.type==="sa") { if(freeKing||freeGuard&&piece.transformCardId==="howi-musa"){for(const d of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:1,y:1},{x:1,y:-1},{x:-1,y:1},{x:-1,y:-1}]){const s={x:piece.x+d.x,y:piece.y+d.y};if(inside(s.x,s.y)){const h=board.find(p=>!p.captured&&same(p,s));if(!h||h.side!==piece.side)out.push(s)}}} else if(ids.includes("wangcha-haengma")){out.push(...rayMoves(board,piece,[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]).filter(s=>inEffectivePalace(piece.side,s.x,s.y,expandedPalace)),...palaceRayMoves(board,piece,expandedPalace).filter(s=>inEffectivePalace(piece.side,s.x,s.y,expandedPalace)))} else {for(const d of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:1,y:1},{x:1,y:-1},{x:-1,y:1},{x:-1,y:-1}]){const s={x:piece.x+d.x,y:piece.y+d.y};if(inEffectivePalace(piece.side,s.x,s.y,expandedPalace)&&(Math.abs(d.x)+Math.abs(d.y)===1||onEffectivePalaceDiagonal(piece.side,piece,s,expandedPalace))){const h=board.find(p=>!p.captured&&same(p,s));if(!h||h.side!==piece.side)out.push(s)}}} }
  else if(piece.type==="jol") { const forward=piece.side==="cho"?1:-1; const dirs=[{x:-1,y:0},{x:1,y:0},{x:0,y:forward}]; if(piece.transformCardId==="yugyeok-jol")dirs.push({x:0,y:-forward}); for(const d of dirs){const s={x:piece.x+d.x,y:piece.y+d.y};if(inside(s.x,s.y)){const h=board.find(p=>!p.captured&&same(p,s));if(!h||h.side!==piece.side)out.push(s)}} }
  let unique=out.filter((s,i,a)=>{
    if(a.findIndex(q=>same(q,s))!==i||mods.walls.some(w=>same(w,s)))return false;
    if(!(mods.jeokgi??[]).some(marker=>same(marker,s)))return true;
    const target=board.find(candidate=>!candidate.id.startsWith("__block-")&&!candidate.captured&&!candidate.carriedBy&&candidate.side!==piece.side&&same(candidate,s));
    return !!target&&!(piece.type==="po"&&piece.transformCardId!=="hongipo"&&target.type==="po");
  });
  unique=unique.filter(square=>!blockedByPalaceStructure(piece,square,mods.palaceStructures??[],mods.expandedPalaces??[]));
  if(ids.includes("dogang")){unique=unique.filter(s=>piece.side==="cho"&&piece.y>=5?s.y>=5:piece.side==="han"&&piece.y<=4?s.y<=4:true)}
  for(const r of mods.restrictions.filter(r=>r.side===piece.side)){
    if(r.targetPieceId&&r.targetPieceId!==piece.id)continue;
    if(r.cardId==="chadan"&&piece.type==="cha")unique=unique.filter(s=>Math.abs(s.x-piece.x)+Math.abs(s.y-piece.y)<=4);
    if(r.cardId==="geumjok"&&piece.transformCardId!=="yubang"&&(piece.type==="gung"||piece.type==="sa"))unique=unique.filter(s=>s.x===piece.x||s.y===piece.y);
    if(r.cardId==="jingbal"&&piece.type!=="jol")unique=[];
    if(r.cardId==="homyeong"&&r.targetPieceId!==piece.id)unique=[];
    if(r.cardId==="busang"&&r.targetPieceId===piece.id&&mods.lastOwnMove?.pieceId===piece.id)unique=[];
    if(r.cardId==="sucha"&&r.targetPieceId===piece.id&&mods.lastOwnMove?.pieceId===piece.id){const dx=Math.sign(mods.lastOwnMove.to.x-mods.lastOwnMove.from.x),dy=Math.sign(mods.lastOwnMove.to.y-mods.lastOwnMove.from.y);unique=unique.filter(s=>Math.sign(s.x-piece.x)!==dx||Math.sign(s.y-piece.y)!==dy)}
    if(r.cardId==="gullyeong"&&mods.lastOwnMove){const lastPiece=board.find(p=>p.id===mods.lastOwnMove?.pieceId);if(lastPiece?.type===piece.type)unique=[]}
    if(r.cardId==="injil"&&r.targetPieceId===piece.id&&mods.enemyKing){const before=Math.abs(piece.x-mods.enemyKing.x)+Math.abs(piece.y-mods.enemyKing.y);unique=unique.filter(s=>Math.abs(s.x-mods.enemyKing!.x)+Math.abs(s.y-mods.enemyKing!.y)<before)}
  }
  if(piece.infected&&piece.type==="jol"){const forward=piece.side==="cho"?1:-1;unique=unique.filter(s=>s.y-piece.y===forward||(s.y===piece.y&&board.some(p=>!p.captured&&p.side!==piece.side&&same(p,s))))}
  unique=unique.filter(s=>!board.some(p=>!p.captured&&!p.carriedBy&&p.side!==piece.side&&p.shielded&&p.shielded>0&&same(p,s)));
  return unique;
}

/** Back-rank 마·상 order at files 2·3·7·8. The UI labels formations from this table. */
export const FORMATION_BACK_RANK:Record<Formation,[PieceType,PieceType,PieceType,PieceType]>={"귀마":["sang","ma","ma","sang"],"원앙마":["ma","sang","ma","sang"],"면상":["sang","ma","sang","ma"],"양귀마":["ma","sang","sang","ma"]};
function initialPieces(formations:Record<Side,Formation>):Piece[]{ const pieces:Piece[]=[]; let id=0; const add=(side:Side,type:PieceType,x:number,y:number)=>pieces.push({id:`p${++id}`,side,type,x,y});
  for(const side of ["cho","han"] as Side[]){const y=side==="cho"?0:9, back=FORMATION_BACK_RANK[formations[side]];add(side,"cha",0,y);add(side,back[0],1,y);add(side,back[1],2,y);add(side,"sa",3,y);add(side,"sa",5,y);add(side,back[2],6,y);add(side,back[3],7,y);add(side,"cha",8,y);add(side,"gung",4,side==="cho"?1:8);add(side,"po",1,side==="cho"?2:7);add(side,"po",7,side==="cho"?2:7);for(const x of [0,2,4,6,8])add(side,"jol",x,side==="cho"?3:6)} return pieces; }
export function createGame(formations:Record<Side,Formation>,augments:boolean,seed=0x0a11ce,testMode=false):GameState {
  let state:GameState={schemaVersion:GAME_SCHEMA_VERSION,rulesetVersion:RULESET_VERSION,revision:0,eventSequence:0,rngSeed:seed>>>0,phase:"ACTION",pieces:initialPieces(formations),turn:"cho",clocks:{cho:INITIAL_CLOCK_MS,han:INITIAL_CLOCK_MS},draftClockMs:DRAFT_CLOCK_MS,ply:0,fullMove:0,cards:{cho:[],han:[]},augments,testMode,moves:[],restrictions:[],walls:[],palaceStructures:[],traps:[],jeokgi:[],reserves:{cho:[],han:[]},waitingPieces:{cho:[],han:[]},myosupuriPlans:{},deathmatch:false,deathmatchClock:0,formations};
  if(augments)state=openDraft(state,"cho",0,["han"]);
  return state;
}
export function getModifiers(state:GameState,piece:Piece):MoveModifiers {const restrictions=[...state.restrictions];if(state.cards[opponent(piece.side)].some(card=>card.cardId==="gullyeong"&&card.state==="active"))restrictions.push({cardId:"gullyeong",side:piece.side,remaining:99});return {cardIds:state.cards[piece.side].filter(c=>c.state!=="inert").map(c=>c.cardId),restrictions,walls:state.walls,palaceStructures:state.palaceStructures,expandedPalaces:(["cho","han"] as Side[]).filter(side=>state.cards[side].some(card=>card.cardId==="gwang-gungseong"&&card.state==="active")),jeokgi:(state.jeokgi??[]).filter(marker=>marker.side!==piece.side),fullMove:state.fullMove,lastOwnMove:[...state.moves].reverse().find(m=>m.side===piece.side),enemyKing:state.pieces.find(p=>!p.captured&&p.side!==piece.side&&p.type==="gung")}}

export function isFrozenByMudang(state:GameState,pieceId:string):boolean{
  const target=state.pieces.find(piece=>piece.id===pieceId);
  if(!target||target.captured||target.carriedBy||target.side!==state.turn||state.winner||state.draft)return false;
  return state.pieces.some(mudang=>{
    if(mudang.captured||mudang.carriedBy||mudang.side===target.side||mudang.transformCardId!=="mudang")return false;
    const terrain=[...state.walls,...(state.jeokgi??[]).filter(marker=>marker.side!==mudang.side)];
    return SANG_PATTERNS.some(([a,b,c,d,e,f])=>{
      const first={x:mudang.x+a,y:mudang.y+b},second={x:mudang.x+a+c,y:mudang.y+b+d},destination={x:mudang.x+a+c+e,y:mudang.y+b+d+f};
      if(!same(destination,target))return false;
      return ![first,second].some(square=>terrain.some(block=>same(block,square))||state.pieces.some(piece=>!piece.captured&&!piece.carriedBy&&same(piece,square)));
    });
  });
}

function hongipoBlastSquare(piece:Piece,to:Square):Square|undefined{
  const dx=Math.sign(to.x-piece.x),dy=Math.sign(to.y-piece.y),square={x:to.x+dx,y:to.y+dy};
  return inside(square.x,square.y)?square:undefined;
}

function naesiCanFollow(state:GameState,king:Piece,to:Square):boolean{
  if(king.type!=="gung")return true;
  const follower=state.pieces.find(piece=>!piece.captured&&!piece.carriedBy&&piece.side===king.side&&piece.transformCardId==="naesi");
  if(!follower)return true;
  const square={x:follower.x+to.x-king.x,y:follower.y+to.y-king.y};
  return inside(square.x,square.y)
    &&!state.walls.some(wall=>same(wall,square))
    &&!state.pieces.some(piece=>!piece.captured&&!piece.carriedBy&&piece.id!==king.id&&piece.id!==follower.id&&same(piece,square));
}

function filterTransformTurnCaptures(state:GameState,piece:Piece,moves:Square[]):Square[]{
  if(piece.captureLockedPly!==state.ply)return moves;
  const palaceCaptureException=piece.transformCardId==="hangu";
  return moves.filter(square=>{
    const capturesAtDestination=state.pieces.some(target=>!target.captured&&!target.carriedBy&&target.side!==piece.side&&same(target,square));
    const capturesOnPath=piece.transformCardId==="geobukseon"&&piecesStrictlyBetween(state.pieces,piece,square).some(target=>target.side!==piece.side);
    const blastSquare=piece.transformCardId==="hongipo"?hongipoBlastSquare(piece,square):undefined;
    const capturesBeyond=!!blastSquare&&state.pieces.some(target=>!target.captured&&!target.carriedBy&&target.side!==piece.side&&same(target,blastSquare));
    const burnsAdjacent=piece.transformCardId==="hwacha"&&state.pieces.some(target=>!target.captured&&!target.carriedBy&&target.side!==piece.side&&target.type==="jol"&&Math.abs(target.x-square.x)+Math.abs(target.y-square.y)===1);
    return(!capturesAtDestination&&!capturesOnPath&&!capturesBeyond&&!burnsAdjacent)||palaceCaptureException&&inPalace(piece.side,square.x,square.y);
  });
}

export function legalMoves(state:GameState,pieceId:string){
  const piece=state.pieces.find(candidate=>candidate.id===pieceId);
  const yeokmachaActive=!!piece&&state.cards[piece.side].some(card=>card.cardId==="yeokmacha"&&card.state==="active");
  const ridingHost=piece?.carriedBy?state.pieces.find(host=>!host.captured&&host.id===piece.carriedBy&&host.side===piece.side):undefined;
  const mountedSoldier=!!piece?.carriedBy&&piece.type==="jol"&&yeokmachaActive&&ridingHost?.type==="ma";
  const towerPassenger=!!piece?.carriedBy&&ridingHost?.transformCardId==="gongseongtap";
  // 잠복한 도깨비는 판 위에 없으므로 주인도 움직일 수 없다.
  if(!piece||piece.carriedBy&&!mountedSoldier&&!towerPassenger||piece.side!==state.turn||isFrozenByMudang(state,pieceId))return[];
  if(piece.hidden&&piece.transformCardId==="dokkaebi")return[];
  // 사라진 도깨비가 선 칸은 상대에게 빈 칸으로 취급된다.
  const board=state.pieces.filter(candidate=>!(candidate.hidden&&candidate.transformCardId==="dokkaebi"&&candidate.side!==piece.side));
  let moves=generatePieceMoves(board,piece,getModifiers(state,piece)).filter(square=>naesiCanFollow(state,piece,square));
  const carriedPassenger=piece.transformCardId==="gongseongtap"
    ?state.pieces.find(candidate=>!candidate.captured&&candidate.carriedBy===piece.id)
    :undefined;
  if(piece.transformCardId==="gongseongtap"&&!carriedPassenger){
    for(const ally of state.pieces.filter(candidate=>!candidate.captured&&!candidate.carriedBy&&candidate.side===piece.side&&candidate.id!==piece.id&&candidate.type!=="gung"&&candidate.transformCardId!=="gongseongtap")){
      const boardWithoutAlly=board.filter(candidate=>candidate.id!==ally.id);
      if(generatePieceMoves(boardWithoutAlly,piece,getModifiers(state,piece)).some(square=>same(square,ally)))moves.push({x:ally.x,y:ally.y});
    }
  }else if(!piece.carriedBy&&piece.type!=="gung"&&piece.transformCardId!=="gongseongtap"){
    for(const tower of state.pieces.filter(candidate=>!candidate.captured&&!candidate.carriedBy&&candidate.side===piece.side&&candidate.transformCardId==="gongseongtap"&&!state.pieces.some(passenger=>!passenger.captured&&passenger.carriedBy===candidate.id))){
      const boardWithoutTower=board.filter(candidate=>candidate.id!==tower.id);
      if(generatePieceMoves(boardWithoutTower,piece,getModifiers(state,piece)).some(square=>same(square,tower)))moves.push({x:tower.x,y:tower.y});
    }
  }
  if(piece.type==="jol"&&!piece.carriedBy&&yeokmachaActive){
    for(const horse of state.pieces.filter(candidate=>!candidate.captured&&!candidate.carriedBy&&candidate.side===piece.side&&candidate.type==="ma"&&!state.pieces.some(passenger=>!passenger.captured&&passenger.carriedBy===candidate.id))){
      const boardWithoutHorse=board.filter(candidate=>candidate.id!==horse.id);
      if(generatePieceMoves(boardWithoutHorse,piece,getModifiers(state,piece)).some(square=>same(square,horse)))moves.push({x:horse.x,y:horse.y});
    }
  }
  moves=filterTransformTurnCaptures(state,piece,moves);
  const plan=state.myosupuriPlans[piece.side];
  if(plan){
    if(plan.pieceId!==piece.id||!plan.moves.length)return[];
    moves=moves.filter(square=>same(square,plan.moves[0]));
  }
  return moves.filter((square,index,all)=>all.findIndex(candidate=>same(candidate,square))===index);
}

export function myosupuriPlanningMoves(state:GameState,pieceId:string,planned:Square[]):Square[]{
  const preview:GameState={...state,pieces:state.pieces.map(piece=>({...piece})),myosupuriPlans:{}};
  const mover=preview.pieces.find(piece=>piece.id===pieceId);
  if(!mover||mover.captured||mover.carriedBy||mover.type==="gung"||mover.side!==state.turn&&!state.testMode)return[];
  preview.turn=mover.side;
  for(const square of planned){
    const legal=legalMoves(preview,pieceId);
    if(!legal.some(candidate=>same(candidate,square)))return[];
    const target=preview.pieces.find(piece=>!piece.captured&&!piece.carriedBy&&piece.side!==mover.side&&same(piece,square));
    if(target)target.captured=true;
    mover.x=square.x;mover.y=square.y;preview.ply+=2;
  }
  return legalMoves(preview,pieceId);
}

export function canUseUibyeongRest(state:GameState,pieceId:string):boolean{
  const piece=state.pieces.find(candidate=>candidate.id===pieceId);
  return !!piece&&!piece.captured&&!piece.carriedBy&&piece.side===state.turn&&piece.transformCardId==="uibyeong"&&(piece.growth??0)<3&&!state.winner&&!state.draft
    &&state.cards[piece.side].some(card=>card.cardId==="uibyeong"&&card.state!=="inert"&&card.targetPieceId===piece.id);
}

export function jangdolbaengiDropTargets(state:GameState,side:Side):Square[]{
  if(!state.reserves[side].length||!state.pieces.some(piece=>!piece.captured&&!piece.carriedBy&&piece.side===side&&piece.transformCardId==="jangdolbaengi"))return[];
  const expanded=state.cards[side].some(card=>card.cardId==="gwang-gungseong"&&card.state==="active");
  const files=expanded?[2,3,4,5,6]:[3,4,5],ranks=expanded?(side==="cho"?[0,1,2,3]:[6,7,8,9]):(side==="cho"?[0,1,2]:[7,8,9]);
  return ranks.flatMap(y=>files.map(x=>({x,y}))).filter(square=>
    !state.pieces.some(piece=>!piece.captured&&!piece.carriedBy&&same(piece,square))&&
    !state.walls.some(wall=>same(wall,square))&&
    !(state.jeokgi??[]).some(marker=>marker.side!==side&&same(marker,square)),
  );
}

function seededRandom(seed:number){let value=seed>>>0||0x9e3779b9;return()=>{value^=value<<13;value^=value>>>17;value^=value<<5;return(value>>>0)/4294967296}}
function weightedPick(pool:Card[],used:Set<string>,random:()=>number){const choices=pool.filter(c=>!used.has(c.id));const total=choices.reduce((n,c)=>n+(c.cost<=2.5?9:14-c.cost*2),0);let r=random()*total;for(const c of choices){r-=c.cost<=2.5?9:14-c.cost*2;if(r<=0)return c}return choices[0]}
/** 한 선택 화면에 함께 오르지 않는 조합. 대국 전체에는 둘 다 등장할 수 있다. */
export const DRAFT_SET_EXCLUSIVE_GROUPS:string[][]=[["hangu","yubang"]];
export function drawCards(state:GameState,side:Side,slot:DraftSlot):string[]{const held=new Set([...state.cards.cho,...state.cards.han].map(c=>c.cardId));const own=state.cards[side].map(c=>CARD_BY_ID[c.cardId]);const pool=CARDS.filter(c=>!held.has(c.id)&&meetsDrawRequirement({state,side,slot,movesFor:(piece)=>generatePieceMoves(state.pieces,piece,getModifiers(state,piece))},c.draw)&&!own.some(h=>h.exclusive?.includes(c.id)||c.exclusive?.includes(h.id)));const random=seededRandom(state.rngSeed^(side==="cho"?0x43484f:0x48414e)^(slot+1)*0x45d9f3b^state.fullMove);const target=[2,3,3.5][slot];let best:Card[]=[];let gap=99;for(let attempt=0;attempt<3;attempt++){const set:Card[]=[];const used=new Set<string>();while(set.length<3&&used.size<pool.length){const c=weightedPick(pool,used,random);if(!c)break;used.add(c.id);for(const group of DRAFT_SET_EXCLUSIVE_GROUPS)if(group.includes(c.id))for(const peer of group)used.add(peer);set.push(c)}const g=Math.abs(set.reduce((n,c)=>n+c.cost,0)/Math.max(1,set.length)-target);if(g<gap){best=set;gap=g}if(g<1)break}return best.map(c=>c.id)}

function openDraft(state:GameState,side:Side,slot:DraftSlot,queue:Side[]):GameState{return{...state,phase:"DRAFT",draftClockMs:DRAFT_CLOCK_MS,draft:{side,slot,choices:drawCards(state,side,slot),queue}}}

export function transformTargetType(card:Card):PieceType|undefined {
  if(card.category==="TRANSFORM")return card.basePiece;
  if(card.id==="sindaeryuk")return "po";
  return undefined;
}

export function ownPieceTargetType(card:Card):PieceType|undefined {
  return transformTargetType(card)??(card.id==="jingbyeong"?"jol":undefined);
}

export type AugmentPieceTarget = { side:"own"|"enemy"; type?:PieceType; excludeKing?:boolean; allowTransformed?:boolean };
export function augmentPieceTarget(card:Card):AugmentPieceTarget|undefined {
  const transformed=transformTargetType(card);
  if(transformed)return{side:"own",type:transformed};
  if(card.id==="jingbyeong")return{side:"own",type:"jol"};
  if(card.id==="maesu")return{side:"enemy",type:"jol",allowTransformed:true};
  if(card.id==="amhaeng-eosa")return{side:"own",type:"jol",allowTransformed:true};
  if(card.id==="hunsukkun"||card.id==="myosupuri")return{side:"own",excludeKing:true,allowTransformed:true};
  return undefined;
}

function emptySquares(state:GameState,squares:Square[]):Square[]{
  return squares.filter(square=>
    !state.pieces.some(piece=>!piece.captured&&!piece.carriedBy&&same(piece,square))&&
    !state.walls.some(wall=>same(wall,square))&&
    !state.traps.some(trap=>same(trap,square))&&
    !(state.jeokgi??[]).some(marker=>same(marker,square)),
  );
}

export function trapTargets(state:GameState,side:Side):Square[]{
  const files=[3,4,5],ranks=side==="cho"?[0,1,2]:[7,8,9];
  return emptySquares(state,ranks.flatMap(y=>files.map(x=>({x,y}))));
}

export function hunsukkunDropTargets(state:GameState,side:Side):Square[]{
  if(!state.waitingPieces[side].some(piece=>(piece.availablePly??0)<=state.ply))return[];
  const ranks=side==="cho"?[0,1,2,3,4]:[5,6,7,8,9];
  return emptySquares(state,ranks.flatMap(y=>Array.from({length:9},(_,x)=>({x,y}))));
}

function acquire(state:GameState,side:Side,cardId:string,slot:0|1|2):GameState {
  const card=CARD_BY_ID[cardId],needsTransformTarget=!!transformTargetType(card);
  const owned:OwnedCard={cardId,slot,state:needsTransformTarget||card.activation==="ACTIVE"?"ready":card.activation==="ON_START"?"used":"active"};
  const cards={...state.cards,[side]:[...state.cards[side],owned]},next={...state,cards};
  return runAugmentHook(next,"onAcquire",{side,card});
}
function applyDraftPick(state:GameState,cardId:string):GameState {if(!state.draft||!state.draft.choices.includes(cardId))return state;let next=acquire(state,state.draft.side,cardId,state.draft.slot);const [head,...rest]=state.draft.queue;if(head){next=openDraft(next,head,state.draft.slot,rest)}else next={...next,draft:undefined,phase:"ACTION"};return next}

function applyPowiConversions(pieces:Piece[],cards:Record<Side,OwnedCard[]>,preferredSide:Side):{winner?:Side;changed:boolean}{
  let winner:Side|undefined,changed=false;
  const sides=[preferredSide,opponent(preferredSide)];
  for(const side of sides){
    if(!cards[side].some(card=>card.cardId==="powi"&&card.state==="active"))continue;
    const enemies=pieces.filter(piece=>!piece.captured&&!piece.carriedBy&&piece.side!==side);
    for(const target of enemies){
      const blocked=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}].filter(direction=>{
        const square={x:target.x+direction.x,y:target.y+direction.y};
        return !inside(square.x,square.y)||pieces.some(piece=>!piece.captured&&!piece.carriedBy&&piece.side===side&&same(piece,square));
      }).length;
      if(blocked<3)continue;
      target.side=side;changed=true;
      if(target.type==="gung")winner=side;
    }
  }
  return{winner,changed};
}

function expireBrokenMyosupuri(state:GameState):GameState{
  const plan=state.myosupuriPlans[state.turn];
  if(!plan||plan.moves.length&&legalMoves(state,plan.pieceId).some(square=>same(square,plan.moves[0])))return state;
  const cards={cho:state.cards.cho.map(card=>({...card})),han:state.cards.han.map(card=>({...card}))};
  if(cards[state.turn][plan.cardIndex])cards[state.turn][plan.cardIndex].state="used";
  const myosupuriPlans={...state.myosupuriPlans};delete myosupuriPlans[state.turn];
  return{...state,cards,myosupuriPlans};
}

function applyMovePiece(state:GameState,pieceId:string,to:Square):GameState {
  if(state.winner||state.draft)return state;
  const requestedPiece=state.pieces.find(piece=>piece.id===pieceId);
  if(!requestedPiece||!legalMoves(state,pieceId).some(square=>same(square,to)))return state;
  const pieces=state.pieces.map(piece=>({...piece}));
  const cards={cho:state.cards.cho.map(card=>({...card})),han:state.cards.han.map(card=>({...card}))};
  const reserves={cho:state.reserves.cho.map(piece=>({...piece})),han:state.reserves.han.map(piece=>({...piece}))};
  const traps=state.traps.map(trap=>({...trap}));
  let myosupuriPlans={...state.myosupuriPlans};
  const mover=pieces.find(piece=>piece.id===pieceId)!;
  const from={x:mover.x,y:mover.y};
  // 잠복한 도깨비는 판 위에 없는 것으로 본다. 잡히지도, 휩쓸리지도 않는다.
  const away=(candidate:Piece)=>!!candidate.hidden&&candidate.transformCardId==="dokkaebi"&&candidate.side!==mover.side;
  const swept=mover.transformCardId==="geobukseon"?piecesStrictlyBetween(pieces,mover,to).filter(piece=>piece.side!==mover.side&&!away(piece)):[];
  const carriedPassenger=pieces.find(piece=>!piece.captured&&piece.carriedBy===mover.id);
  const yeokmachaActive=cards[mover.side].some(card=>card.cardId==="yeokmacha"&&card.state==="active");
  const ridingHost=mover.carriedBy?pieces.find(piece=>!piece.captured&&piece.id===mover.carriedBy):undefined;
  const dismounts=!!ridingHost&&(ridingHost.transformCardId==="gongseongtap"||mover.type==="jol"&&ridingHost.type==="ma"&&yeokmachaActive);
  const boardingHorse=mover.type==="jol"&&!mover.carriedBy&&yeokmachaActive?pieces.find(piece=>!piece.captured&&!piece.carriedBy&&piece.side===mover.side&&piece.type==="ma"&&same(piece,to)&&!pieces.some(passenger=>!passenger.captured&&passenger.carriedBy===piece.id)):undefined;
  const boardingTower=!mover.carriedBy&&mover.type!=="gung"&&mover.transformCardId!=="gongseongtap"?pieces.find(piece=>!piece.captured&&!piece.carriedBy&&piece.side===mover.side&&piece.transformCardId==="gongseongtap"&&same(piece,to)&&!pieces.some(passenger=>!passenger.captured&&passenger.carriedBy===piece.id)):undefined;
  const boardingTarget=mover.transformCardId==="gongseongtap"&&!carriedPassenger?pieces.find(piece=>!piece.captured&&!piece.carriedBy&&piece.side===mover.side&&piece.id!==mover.id&&piece.type!=="gung"&&piece.transformCardId!=="gongseongtap"&&same(piece,to)):undefined;
  const capturedPieces:Piece[]=[];
  let winner:Side|undefined,endReason:GameState["endReason"],jeokgi=[...(state.jeokgi??[])];
  const stashCaptured=(target:Piece)=>{if(mover.transformCardId!=="jangdolbaengi"||target.side===mover.side||target.type==="gung"||reserves[mover.side].length>=2)return;reserves[mover.side].push({id:`${target.id}-jangdol-${state.revision}-${capturedPieces.length}`,side:mover.side,type:target.type,x:-1,y:-1})};
  const completeCapture=(target:Piece)=>{target.captured=true;capturedPieces.push(target);stashCaptured(target);for(const passenger of pieces.filter(p=>!p.captured&&p.carriedBy===target.id)){if(target.type==="ma"&&passenger.type==="jol"&&cards[target.side].some(card=>card.cardId==="yeokmacha"&&card.state==="active")){passenger.captured=true;passenger.carriedBy=undefined;capturedPieces.push(passenger);stashCaptured(passenger)}else passenger.carriedBy=undefined}const linked=cards[target.side].find(c=>c.targetPieceId===target.id);if(linked&&linked.state!=="used")linked.state=linked.cardId==="myosupuri"?"used":"inert";if(target.type==="gung"&&!cards[target.side].some(c=>c.cardId==="suryeom-cheongjeong")){winner=mover.side;endReason="capture_king"}};
  for(const target of swept)completeCapture(target);
  const captured=pieces.find(p=>!p.captured&&!p.carriedBy&&!away(p)&&p.side!==mover.side&&same(p,to));let captureCompleted=false;if(captured){if((captured.hp||1)>1)captured.hp=(captured.hp||1)-1;else{completeCapture(captured);captureCompleted=true}}
  const destinationStillDefended=captureCompleted&&pieces.some(p=>!p.captured&&!p.carriedBy&&!away(p)&&p.side!==mover.side&&same(p,to));
  const arrived=!captured||captureCompleted&&!destinationStillDefended;
  if(arrived){
    mover.x=to.x;
    mover.y=to.y;
    if(dismounts)mover.carriedBy=undefined;
    else if(boardingHorse)mover.carriedBy=boardingHorse.id;
    else if(boardingTower)mover.carriedBy=boardingTower.id;
    if(carriedPassenger){carriedPassenger.x=to.x;carriedPassenger.y=to.y}
    else if(boardingTarget)boardingTarget.carriedBy=mover.id;
  }
  if(mover.transformCardId==="hongipo"&&arrived){const blastSquare=hongipoBlastSquare({...mover,x:from.x,y:from.y},to);const blastTarget=blastSquare&&pieces.find(p=>!p.captured&&!p.carriedBy&&!away(p)&&p.side!==mover.side&&same(p,blastSquare));if(blastTarget)completeCapture(blastTarget)}
  if(mover.transformCardId==="hwacha"&&arrived){for(const target of pieces.filter(p=>!p.captured&&!p.carriedBy&&!away(p)&&p.side!==mover.side&&p.type==="jol"&&Math.abs(p.x-to.x)+Math.abs(p.y-to.y)===1))completeCapture(target)}
  if(mover.type==="gung"&&arrived){const follower=pieces.find(p=>!p.captured&&!p.carriedBy&&p.side===mover.side&&p.transformCardId==="naesi");if(follower){follower.x+=to.x-from.x;follower.y+=to.y-from.y}}
  if(mover.transformCardId==="yubang"&&arrived){jeokgi=jeokgi.filter(marker=>marker.side!==mover.side||!same(marker,from));const ownMarkers=jeokgi.filter(marker=>marker.side===mover.side);if(ownMarkers.length>=3){const oldest=ownMarkers[0],index=jeokgi.indexOf(oldest);jeokgi.splice(index,1)}jeokgi.push({...from,side:mover.side})}
  if(mover.transformCardId==="jeoktoma"&&captureCompleted)mover.growth=Math.min(2,(mover.growth||0)+1);
  if(mover.transformCardId==="geobukseon"&&capturedPieces.length){mover.hp=Math.max(0,(mover.hp??2)-capturedPieces.length);if(mover.hp===0){mover.captured=true;const linked=cards[mover.side].find(c=>c.targetPieceId===mover.id);if(linked&&linked.state!=="used")linked.state="inert"}}
  const gaebyeong=cards[mover.side].find(card=>card.cardId==="gaebyeong"&&card.state==="active");
  if(gaebyeong&&mover.type==="jol"&&captureCompleted&&captured&&captured.type!=="cha"&&captured.type!=="gung"){mover.type=captured.type;mover.transformCardId=undefined;gaebyeong.state="used"}
  if(mover.type==="gung"&&captureCompleted&&captured&&captured.type!=="gung"&&cards[mover.side].some(card=>card.cardId==="oksae"&&card.state==="active")){
    const ranks=mover.side==="cho"?[0,1,2]:[9,8,7],destination=ranks.flatMap(y=>[3,4,5].map(x=>({x,y}))).find(square=>!pieces.some(piece=>!piece.captured&&!piece.carriedBy&&same(piece,square))&&!traps.some(trap=>same(trap,square)));
    if(destination){captured.side=mover.side;captured.transformCardId=undefined;captured.captured=false;captured.x=destination.x;captured.y=destination.y}
  }
  const trapIndex=arrived?traps.findIndex(trap=>trap.side!==mover.side&&same(trap,mover)):-1;
  if(trapIndex>=0){const [trap]=traps.splice(trapIndex,1);if(!mover.captured){mover.captured=true;capturedPieces.push(mover)}if(mover.type==="gung"){winner=trap.side;endReason="special_victory"}}
  if(!mover.captured){const encircled=applyPowiConversions(pieces,cards,mover.side);if(encircled.winner){winner=encircled.winner;endReason="special_victory"}}
  const myosupuri=myosupuriPlans[mover.side];
  if(myosupuri?.pieceId===mover.id&&myosupuri.moves.length&&same(myosupuri.moves[0],to)){
    const remaining=myosupuri.moves.slice(1);
    if(remaining.length)myosupuriPlans={...myosupuriPlans,[mover.side]:{...myosupuri,moves:remaining}};
    else{myosupuriPlans={...myosupuriPlans};delete myosupuriPlans[mover.side];if(cards[mover.side][myosupuri.cardIndex])cards[mover.side][myosupuri.cardIndex].state="used"}
  }
  const reachedEnemyBackRank=(mover.side==="cho"&&mover.y===9)||(mover.side==="han"&&mover.y===0);
  const kingHasBackRankVictory=mover.type==="gung"&&(mover.transformCardId==="hangu"||mover.transformCardId==="yubang"||cards[mover.side].some(c=>c.cardId==="eorim"));
  if(!winner&&arrived&&reachedEnemyBackRank&&kingHasBackRankVictory){winner=mover.side;endReason="special_victory"}
  if(!winner&&arrived&&reachedEnemyBackRank&&cards[mover.side].some(card=>card.cardId==="amhaeng-eosa"&&card.state==="active"&&card.targetPieceId===mover.id)){winner=mover.side;endReason="special_victory"}
  for(const side of ["cho","han"] as Side[])if(capturedPieces.some(target=>target.side===side&&target.type==="sa")&&cards[side].some(c=>c.cardId==="suryeom-cheongjeong")&&!pieces.some(p=>!p.captured&&p.side===side&&p.type==="sa")){winner=mover.side;endReason="special_victory"}
  if(mover.transformCardId==="hongipo") {mover.ammo=(mover.ammo||1)-1;if(mover.ammo<=0)mover.captured=true}
  return expireBrokenMyosupuri(finishAction(state,{pieces,cards,reserves,traps,myosupuriPlans,mover,captured,capturedPieces,jeokgi,from,to,winner,endReason},{openDraft}));
}

function applyUibyeongRest(state:GameState,pieceId:string):GameState{
  if(!canUseUibyeongRest(state,pieceId))return state;
  const pieces=state.pieces.map(piece=>({...piece}));
  const cards={cho:state.cards.cho.map(card=>({...card})),han:state.cards.han.map(card=>({...card}))};
  const mover=pieces.find(piece=>piece.id===pieceId)!;
  const from={x:mover.x,y:mover.y};
  mover.growth=Math.min(3,(mover.growth??0)+1);
  return finishAction(state,{pieces,cards,mover,from,to:from},{openDraft});
}

function applyJangdolbaengiDrop(state:GameState,reservePieceId:string,to:Square):GameState{
  const reserveIndex=state.reserves[state.turn].findIndex(piece=>piece.id===reservePieceId);
  if(reserveIndex<0||!jangdolbaengiDropTargets(state,state.turn).some(square=>same(square,to)))return state;
  const pieces=state.pieces.map(piece=>({...piece})),cards={cho:state.cards.cho.map(card=>({...card})),han:state.cards.han.map(card=>({...card}))};
  const reserves={cho:state.reserves.cho.map(piece=>({...piece})),han:state.reserves.han.map(piece=>({...piece}))};
  const [stored]=reserves[state.turn].splice(reserveIndex,1),mover:Piece={...stored,x:to.x,y:to.y,captured:false,carriedBy:undefined};
  pieces.push(mover);
  return finishAction(state,{pieces,cards,reserves,mover,from:to,to},{openDraft});
}

function applyHunsukkunDrop(state:GameState,reservePieceId:string,to:Square):GameState{
  const waitingIndex=state.waitingPieces[state.turn].findIndex(piece=>piece.id===reservePieceId&&(piece.availablePly??0)<=state.ply);
  if(waitingIndex<0||!hunsukkunDropTargets(state,state.turn).some(square=>same(square,to)))return state;
  const pieces=state.pieces.map(piece=>({...piece})),cards={cho:state.cards.cho.map(card=>({...card})),han:state.cards.han.map(card=>({...card}))};
  const waitingPieces={cho:state.waitingPieces.cho.map(piece=>({...piece})),han:state.waitingPieces.han.map(piece=>({...piece}))};
  const [stored]=waitingPieces[state.turn].splice(waitingIndex,1),mover:Piece={...stored,x:to.x,y:to.y,captured:false,carriedBy:undefined,availablePly:undefined};
  pieces.push(mover);
  return finishAction(state,{pieces,cards,waitingPieces,mover,from:to,to},{openDraft});
}

function applyActivateCard(state:GameState,side:Side,index:number,targetPieceId?:string,targetSquare?:Square,targetLine?:Square[],targetSquares?:Square[]):GameState {
  const owned=state.cards[side][index],card=owned&&CARD_BY_ID[owned.cardId];
  if(!card||owned.state!=="ready"||state.turn!==side&&!state.testMode)return state;
  const transformType=transformTargetType(card);
  if(transformType&&targetPieceId){
    const pieces=state.pieces.map(piece=>({...piece})),target=pieces.find(piece=>piece.id===targetPieceId)!;
    target.transformCardId=card.id;
    target.captureLockedPly=state.ply;
    if(card.id==="geobukseon")target.hp=2;
    if(card.id==="gongseongtap")target.hp=2;
    if(card.id==="jeoktoma")target.growth=0;
    if(card.id==="uibyeong")target.growth=0;
    if(card.id==="guksa"){target.guksaWait=0;target.guksaRevived=false}
    if(card.id==="hongipo")target.ammo=3;
    // 도깨비는 변신 직후에는 판 위에 남고, 착수한 뒤에야 한 턴 사라진다.
    if(card.id==="miljeong")target.hidden=true;
    const cards={...state.cards,[side]:state.cards[side].map((row,i)=>i===index?{...row,state:"used" as CardState,targetPieceId}:row)};
    return {...state,pieces,cards,deathmatchClock:state.deathmatch?0:state.deathmatchClock};
  }
  if(card.id==="hunsukkun"&&targetPieceId){
    const target=state.pieces.find(piece=>piece.id===targetPieceId)!;
    const stored={...target,x:-1,y:-1,availablePly:state.ply+1};
    const pieces=state.pieces.filter(piece=>piece.id!==targetPieceId).map(piece=>({...piece}));
    const waitingPieces={cho:state.waitingPieces.cho.map(piece=>({...piece})),han:state.waitingPieces.han.map(piece=>({...piece}))};
    waitingPieces[side].push(stored);
    const cards={...state.cards,[side]:state.cards[side].map((row,i)=>i===index?{...row,state:"used" as CardState,targetPieceId}:row)};
    return {...state,pieces,waitingPieces,cards,deathmatchClock:state.deathmatch?0:state.deathmatchClock};
  }
  if(card.id==="myosupuri"&&targetPieceId&&targetSquares){
    const cards={...state.cards,[side]:state.cards[side].map((row,i)=>i===index?{...row,state:"active" as CardState,targetPieceId}:row)};
    return {...state,cards,myosupuriPlans:{...state.myosupuriPlans,[side]:{cardIndex:index,pieceId:targetPieceId,moves:targetSquares.map(square=>({...square}))}},deathmatchClock:state.deathmatch?0:state.deathmatchClock};
  }
  if(card.id==="amhaeng-eosa"&&targetPieceId){
    const cards={...state.cards,[side]:state.cards[side].map((row,i)=>i===index?{...row,state:"active" as CardState,targetPieceId}:row)};
    return {...state,cards,deathmatchClock:state.deathmatch?0:state.deathmatchClock};
  }
  if(card.id==="hamjeong"&&targetSquare){
    const cards={...state.cards,[side]:state.cards[side].map((row,i)=>i===index?{...row,state:"used" as CardState}:row)};
    return {...state,cards,traps:[...state.traps,{...targetSquare,side}],deathmatchClock:state.deathmatch?0:state.deathmatchClock};
  }
  const enemy=opponent(side),manualTarget=["jingbyeong","maesu"].includes(card.id),target=manualTarget?state.pieces.find(piece=>piece.id===targetPieceId):automaticEnemyTarget(state,side,card);const restrictions=[...state.restrictions];if(card.category==="RESTRICT")restrictions.push({cardId:card.id,side:enemy,remaining:Number(card.duration?.match(/\d+/)?.[0]||99),targetPieceId:["busang","sucha","talyeong","yeokbyeong","injil","homyeong"].includes(card.id)?target?.id:undefined});const remainsActive=card.category==="RESTRICT"&&card.duration!=="영구"&&!!card.duration?.match(/\d+/);const cards={...state.cards,[side]:state.cards[side].map((c,i)=>i===index?{...c,state:remainsActive?"active" as CardState:"used" as CardState}:c)};const next={...state,restrictions,cards,deathmatchClock:state.deathmatch?0:state.deathmatchClock};return runAugmentHook(next,"onActivate",{side,card,targetPieceId:target?.id,targetSquare,targetLine});
}

function rejected(state:GameState,code:NonNullable<GameTransition["error"]>["code"],message:string):GameTransition {
  return {state,events:[],accepted:false,error:{code,message}};
}

function stampTransition(previous:GameState,next:GameState,events:GameEvent[]):GameTransition {
  const state:GameState={
    ...next,
    schemaVersion:GAME_SCHEMA_VERSION,
    rulesetVersion:RULESET_VERSION,
    revision:previous.revision+1,
    eventSequence:previous.eventSequence+events.length,
    phase:derivePhase(next),
  };
  return {state,events,accepted:true};
}

/** The only public state-transition entry point used by the application UI. */
export function reduceGame(state:GameState,command:GameCommand,actor:Side):GameTransition {
  if(state.winner||state.phase==="ENDED")return rejected(state,"GAME_ENDED","이미 종료된 대국입니다.");

  // 기권은 자기 차례가 아니어도, 증강 선택 중에도 낼 수 있다.
  if(command.type==="RESIGN"){
    return stampTransition(state,{...state,winner:opponent(actor),endReason:"resign",draft:undefined},[]);
  }

  if(command.type==="ADVANCE_CLOCK"){
    const elapsedMs=Math.max(0,Math.floor(command.elapsedMs));
    const activeSide=state.draft?.side??state.turn;
    if(activeSide!==actor)return rejected(state,"WRONG_ACTOR","현재 시간을 사용 중인 플레이어가 아닙니다.");
    if(!Number.isFinite(elapsedMs)||elapsedMs===0)return stampTransition(state,state,[]);
    if(state.draft){
      const draftClockMs=Math.max(0,state.draftClockMs-elapsedMs);
      if(draftClockMs>0)return stampTransition(state,{...state,draftClockMs},[]);
      const cardId=state.draft.choices[0];
      if(!cardId)return rejected(state,"INVALID_DRAFT_PICK","선택할 수 있는 증강이 없습니다.");
      const slot=state.draft.slot,next=applyDraftPick({...state,draftClockMs:0},cardId);
      const events:GameEvent[]=[{type:"AUGMENT_PICKED",side:actor,cardId,slot}];
      if(next.draft)events.push({type:"DRAFT_OPENED",side:next.draft.side,slot:next.draft.slot});
      return stampTransition(state,next,events);
    }
    const remaining=Math.max(0,state.clocks[actor]-elapsedMs);
    const clocks={...state.clocks,[actor]:remaining};
    if(remaining>0)return stampTransition(state,{...state,clocks},[]);
    const winner=opponent(actor);
    return stampTransition(state,{...state,clocks,winner,endReason:"timeout"},[{type:"GAME_ENDED",winner,reason:"timeout"}]);
  }

  if(command.type==="PICK_AUGMENT"){
    if(!state.draft||state.phase!=="DRAFT")return rejected(state,"WRONG_PHASE","현재는 증강을 선택할 단계가 아닙니다.");
    if(state.draft.side!==actor)return rejected(state,"WRONG_ACTOR","현재 드래프트 차례가 아닙니다.");
    if(!state.draft.choices.includes(command.cardId))return rejected(state,"INVALID_DRAFT_PICK","제시된 증강만 선택할 수 있습니다.");
    const slot=state.draft.slot,next=applyDraftPick(state,command.cardId);
    const events:GameEvent[]=[{type:"AUGMENT_PICKED",side:actor,cardId:command.cardId,slot}];
    if(next.draft)events.push({type:"DRAFT_OPENED",side:next.draft.side,slot:next.draft.slot});
    return stampTransition(state,next,events);
  }

  if(command.type==="TEST_GRANT_AUGMENT"){
    if(!state.testMode)return rejected(state,"AUGMENT_UNAVAILABLE","테스트 모드에서만 증강을 직접 추가할 수 있습니다.");
    if(actor!==state.turn)return rejected(state,"WRONG_ACTOR","현재 차례의 플레이어가 증강을 추가해야 합니다.");
    if(!CARD_BY_ID[command.cardId])return rejected(state,"AUGMENT_UNAVAILABLE","존재하지 않는 증강입니다.");
    if(state.cards[command.side].some(owned=>owned.cardId===command.cardId))return rejected(state,"AUGMENT_UNAVAILABLE","이미 추가한 증강입니다.");
    const slot=Math.min(2,state.cards[command.side].length) as DraftSlot;
    const next=acquire(state,command.side,command.cardId,slot);
    return stampTransition(state,next,[{type:"TEST_AUGMENT_GRANTED",side:command.side,cardId:command.cardId}]);
  }

  if(state.phase!=="ACTION"||state.draft)return rejected(state,"WRONG_PHASE","현재는 기물을 움직이거나 증강을 사용할 수 없습니다.");
  if(state.turn!==actor&&!(state.testMode&&command.type==="USE_AUGMENT"))return rejected(state,"WRONG_ACTOR","현재 차례의 플레이어만 행동할 수 있습니다.");

  if(command.type==="USE_UIBYEONG_REST"){
    if(!canUseUibyeongRest(state,command.pieceId))return rejected(state,"INVALID_AUGMENT_TARGET","성장시킬 의병 기물을 선택하세요.");
    const piece=state.pieces.find(candidate=>candidate.id===command.pieceId)!;
    const from={x:piece.x,y:piece.y},next=applyUibyeongRest(state,command.pieceId);
    const events:GameEvent[]=[{type:"PIECE_MOVED",side:actor,pieceId:piece.id,from,to:from}];
    if(next.draft&&!state.draft)events.push({type:"DRAFT_OPENED",side:next.draft.side,slot:next.draft.slot});
    if(next.turn!==state.turn)events.push({type:"TURN_CHANGED",side:next.turn});
    if(next.winner&&next.endReason)events.push({type:"GAME_ENDED",winner:next.winner,reason:next.endReason});
    return stampTransition(state,next,events);
  }

  if(command.type==="DEPLOY_JANGDOLBAENGI_RESERVE"){
    const stored=state.reserves[actor].find(piece=>piece.id===command.reservePieceId);
    if(!stored||!jangdolbaengiDropTargets(state,actor).some(square=>same(square,command.to)))return rejected(state,"INVALID_AUGMENT_TARGET","잡은 기물을 놓을 내 궁성 안 빈칸을 선택하세요.");
    const next=applyJangdolbaengiDrop(state,command.reservePieceId,command.to);
    const events:GameEvent[]=[{type:"PIECE_DEPLOYED",side:actor,pieceId:stored.id,to:command.to}];
    if(next.draft&&!state.draft)events.push({type:"DRAFT_OPENED",side:next.draft.side,slot:next.draft.slot});
    if(next.turn!==state.turn)events.push({type:"TURN_CHANGED",side:next.turn});
    return stampTransition(state,next,events);
  }

  if(command.type==="DEPLOY_HUNSUKKUN_RESERVE"){
    const stored=state.waitingPieces[actor].find(piece=>piece.id===command.reservePieceId&&(piece.availablePly??0)<=state.ply);
    if(!stored||!hunsukkunDropTargets(state,actor).some(square=>same(square,command.to)))return rejected(state,"INVALID_AUGMENT_TARGET","대기 기물을 놓을 내 진영 빈칸을 선택하세요.");
    const next=applyHunsukkunDrop(state,command.reservePieceId,command.to);
    const events:GameEvent[]=[{type:"PIECE_DEPLOYED",side:actor,pieceId:stored.id,to:command.to}];
    if(next.draft&&!state.draft)events.push({type:"DRAFT_OPENED",side:next.draft.side,slot:next.draft.slot});
    if(next.turn!==state.turn)events.push({type:"TURN_CHANGED",side:next.turn});
    return stampTransition(state,next,events);
  }

  if(command.type==="USE_AUGMENT"){
    const owned=state.cards[actor][command.cardIndex];
    if(!owned||owned.state!=="ready")return rejected(state,"AUGMENT_UNAVAILABLE","지금 사용할 수 없는 증강입니다.");
    const card=CARD_BY_ID[owned.cardId],pieceTarget=augmentPieceTarget(card);
    if(pieceTarget){
      const target=state.pieces.find(piece=>piece.id===command.targetPieceId);
      const expectedSide=pieceTarget.side==="own"?actor:opponent(actor);
      const invalid=!target||target.captured||target.carriedBy||target.side!==expectedSide||(pieceTarget.type&&target.type!==pieceTarget.type)||(pieceTarget.excludeKing&&target.type==="gung")||(!pieceTarget.allowTransformed&&!!target.transformCardId);
      const adjacent=card.id!=="maesu"||!!target&&state.pieces.some(piece=>!piece.captured&&!piece.carriedBy&&piece.side===actor&&Math.abs(piece.x-target.x)+Math.abs(piece.y-target.y)===1);
      if(invalid||!adjacent){
        return rejected(state,"INVALID_AUGMENT_TARGET",card.id==="maesu"?"내 기물과 인접한 상대 졸·병을 선택하세요.":card.id==="jingbyeong"?"징병할 내 졸·병을 선택하세요.":card.id==="amhaeng-eosa"?"암행어사로 지정할 내 졸·병을 선택하세요.":card.id==="hunsukkun"?"대기시킬 내 기물을 선택하세요.":card.id==="myosupuri"?"묘수풀이를 적용할 내 기물을 선택하세요.":`변신시킬 ${PIECE_LABEL[actor][pieceTarget.type!]} 기물을 선택하세요.`);
      }
    }
    if(card.id==="myosupuri"){
      const moves=command.targetSquares??[];
      const valid=moves.length===3&&moves.every((square,index)=>myosupuriPlanningMoves(state,command.targetPieceId!,moves.slice(0,index)).some(candidate=>same(candidate,square)));
      if(!valid)return rejected(state,"INVALID_AUGMENT_TARGET","선택한 기물의 합법적인 행마 3수를 순서대로 지정하세요.");
    }
    if(card.id==="hamjeong"){
      const square=command.targetSquare;
      if(!square||!trapTargets(state,actor).some(candidate=>same(candidate,square)))return rejected(state,"INVALID_AUGMENT_TARGET","함정을 설치할 내 궁성 안 빈칸을 선택하세요.");
    }
    if(card.id==="bangbyeok"){
      const square=command.targetSquare;
      const unavailable=!square||!inside(square.x,square.y)||state.walls.some(wall=>same(wall,square))||(state.jeokgi??[]).some(marker=>same(marker,square))||state.pieces.some(piece=>!piece.captured&&!piece.carriedBy&&same(piece,square));
      if(unavailable)return rejected(state,"INVALID_AUGMENT_TARGET","방벽을 세울 빈 교차점을 선택하세요.");
    }
    if(card.id==="seongbyeok"||card.id==="seongmun"){
      const line=command.targetLine;
      if(!line||!palaceLineTargets(state,actor).some(candidate=>sameLine(candidate,line)))return rejected(state,"INVALID_AUGMENT_TARGET",`${card.name}으로 지정할 궁성 직선을 선택하세요.`);
    }
    const next=applyActivateCard(state,actor,command.cardIndex,command.targetPieceId,command.targetSquare,command.targetLine,command.targetSquares);
    return stampTransition(state,next,[{type:"AUGMENT_ACTIVATED",side:actor,cardId:owned.cardId}]);
  }

  const piece=state.pieces.find((row)=>row.id===command.pieceId);
  if(!piece||piece.side!==actor||!legalMoves(state,command.pieceId).some((square)=>same(square,command.to))){
    return rejected(state,"ILLEGAL_MOVE","선택한 기물은 그 위치로 이동할 수 없습니다.");
  }
  const next=applyMovePiece(state,command.pieceId,command.to);
  const move=next.moves.at(-1);
  const movedPieceId=move?.pieceId??command.pieceId;
  const events:GameEvent[]=[{type:"PIECE_MOVED",side:actor,pieceId:movedPieceId,from:move?.from??{x:piece.x,y:piece.y},to:command.to}];
  for(const capturedId of move?.capturedIds??(move?.capturedId?[move.capturedId]:[])){
    events.push({type:"PIECE_CAPTURED",side:actor,pieceId:capturedId,byPieceId:movedPieceId});
  }
  if(next.draft&&!state.draft)events.push({type:"DRAFT_OPENED",side:next.draft.side,slot:next.draft.slot});
  if(next.turn!==state.turn)events.push({type:"TURN_CHANGED",side:next.turn});
  if(next.winner&&next.endReason)events.push({type:"GAME_ENDED",winner:next.winner,reason:next.endReason});
  return stampTransition(state,next,events);
}

/** Compatibility helpers for engine callers while the command API is adopted. */
export function chooseDraft(state:GameState,cardId:string):GameState {
  return reduceGame(state,{type:"PICK_AUGMENT",cardId},state.draft?.side??state.turn).state;
}

export function movePiece(state:GameState,pieceId:string,to:Square):GameState {
  return reduceGame(state,{type:"MOVE_PIECE",pieceId,to},state.turn).state;
}

export function activateCard(state:GameState,side:Side,index:number,targetPieceId?:string,targetSquare?:Square,targetLine?:Square[]):GameState {
  return reduceGame(state,{type:"USE_AUGMENT",cardIndex:index,targetPieceId,targetSquare,targetLine},side).state;
}
