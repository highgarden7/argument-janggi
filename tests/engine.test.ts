import assert from "node:assert/strict";
import test from "node:test";
import { pieceArtPath } from "../app/art-assets";
import { DRAFT_CLOCK_MS, INITIAL_CLOCK_MS, MOVE_INCREMENT_MS, Piece, canUseUibyeongRest, cardActivationKind, createGame, generatePieceMoves, hunsukkunDropTargets, isFrozenByMudang, jangdolbaengiDropTargets, legalMoves, migrateGameState, movePiece, myosupuriPlanningMoves, palaceLineTargets, projectGameView, reduceGame, restrictionTurnsRemaining, totalCost, trapTargets } from "../app/game/engine";
import { DRAW_REQUIREMENT_RULES } from "../app/game/draw-requirements";
import cards from "../app/game/cards.json";

const mods = { cardIds:[], restrictions:[], walls:[], fullMove:0 };
const has = (moves:{x:number;y:number}[],x:number,y:number) => moves.some(s=>s.x===x&&s.y===y);
const IMPLEMENTED_MOVEMENT_TRANSFORMS = [
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
  "jangdolbaengi",
  "naesi",
  "guksa",
  "uibyeong",
  "sindaeryuk",
].sort();

test("each player starts with ten minutes and a completed turn adds three seconds", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  assert.deepEqual(state.clocks,{cho:INITIAL_CLOCK_MS,han:INITIAL_CLOCK_MS});
  state=reduceGame(state,{type:"ADVANCE_CLOCK",elapsedMs:10_000},"cho").state;
  const piece=state.pieces.find(candidate=>candidate.side==="cho"&&legalMoves(state,candidate.id).length)!;
  const destination=legalMoves(state,piece.id)[0];
  const moved=reduceGame(state,{type:"MOVE_PIECE",pieceId:piece.id,to:destination},"cho");
  assert.equal(moved.accepted,true);
  assert.equal(moved.state.clocks.cho,INITIAL_CLOCK_MS-10_000+MOVE_INCREMENT_MS);
  assert.equal(moved.state.clocks.han,INITIAL_CLOCK_MS);
});

test("running out of the main clock loses the game", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const result=reduceGame(state,{type:"ADVANCE_CLOCK",elapsedMs:INITIAL_CLOCK_MS},"cho");
  assert.equal(result.accepted,true);
  assert.equal(result.state.clocks.cho,0);
  assert.equal(result.state.winner,"han");
  assert.equal(result.state.endReason,"timeout");
  assert.deepEqual(result.events.at(-1),{type:"GAME_ENDED",winner:"han",reason:"timeout"});
});

test("each draft player receives a separate sixty-second clock and timeout auto-picks", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},true,77);
  const firstChoice=state.draft!.choices[0];
  const almost=reduceGame(state,{type:"ADVANCE_CLOCK",elapsedMs:DRAFT_CLOCK_MS-1_000},"cho").state;
  assert.equal(almost.draftClockMs,1_000);
  assert.deepEqual(almost.clocks,{cho:INITIAL_CLOCK_MS,han:INITIAL_CLOCK_MS});
  const expired=reduceGame(almost,{type:"ADVANCE_CLOCK",elapsedMs:1_000},"cho");
  assert.equal(expired.accepted,true);
  assert.equal(expired.state.cards.cho[0].cardId,firstChoice);
  assert.equal(expired.state.draft?.side,"han");
  assert.equal(expired.state.draftClockMs,DRAFT_CLOCK_MS);
  assert.equal(expired.events[0]?.type,"AUGMENT_PICKED");
});

test("manually picking an augment resets the next player's draft clock", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},true,78);
  state=reduceGame(state,{type:"ADVANCE_CLOCK",elapsedMs:12_345},"cho").state;
  const picked=reduceGame(state,{type:"PICK_AUGMENT",cardId:state.draft!.choices[0]},"cho");
  assert.equal(picked.state.draft?.side,"han");
  assert.equal(picked.state.draftClockMs,DRAFT_CLOCK_MS);
});

test("test mode starts from the normal position and grants any augment at any time", () => {
  const normal=createGame({cho:"귀마",han:"원앙마"},false,81);
  let state=createGame({cho:"귀마",han:"원앙마"},false,81,true);
  assert.equal(state.testMode,true);
  assert.equal(state.draft,undefined);
  assert.deepEqual(state.clocks,normal.clocks);
  assert.deepEqual(state.pieces,normal.pieces);

  const passive=reduceGame(state,{type:"TEST_GRANT_AUGMENT",side:"han",cardId:"gwang-gungseong"},"cho");
  assert.equal(passive.accepted,true);
  assert.deepEqual(passive.state.cards.han[0],{cardId:"gwang-gungseong",slot:0,state:"active"});
  assert.deepEqual(passive.events,[{type:"TEST_AUGMENT_GRANTED",side:"han",cardId:"gwang-gungseong"}]);
  state=passive.state;

  const granted=reduceGame(state,{type:"TEST_GRANT_AUGMENT",side:"han",cardId:"cheonma"},"cho");
  assert.equal(granted.accepted,true);
  const horse=granted.state.pieces.find(piece=>piece.side==="han"&&piece.type==="ma")!;
  const activated=reduceGame(granted.state,{type:"USE_AUGMENT",cardIndex:1,targetPieceId:horse.id},"han");
  assert.equal(activated.accepted,true);
  assert.equal(activated.state.pieces.find(piece=>piece.id===horse.id)?.transformCardId,"cheonma");
  assert.equal(activated.state.turn,"cho");

  const duplicate=reduceGame(activated.state,{type:"TEST_GRANT_AUGMENT",side:"han",cardId:"cheonma"},"cho");
  assert.equal(duplicate.accepted,false);
});

test("normal games reject direct test augment grants", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const result=reduceGame(state,{type:"TEST_GRANT_AUGMENT",side:"cho",cardId:"cheonma"},"cho");
  assert.equal(result.accepted,false);
  assert.equal(result.error?.code,"AUGMENT_UNAVAILABLE");
});

test("test mode can plan Myosupuri for the side that is not currently moving", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false,91,true);
  state=reduceGame(state,{type:"TEST_GRANT_AUGMENT",side:"han",cardId:"myosupuri"},"cho").state;
  const piece=state.pieces.find(candidate=>candidate.side==="han"&&candidate.type==="ma")!;
  const planned:{x:number;y:number}[]=[];
  for(let index=0;index<3;index++)planned.push(myosupuriPlanningMoves(state,piece.id,planned)[0]);
  const activated=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetPieceId:piece.id,targetSquares:planned},"han");
  assert.equal(activated.accepted,true);
  assert.equal(activated.state.myosupuriPlans.han?.moves.length,3);
});

test("every selectable movement transform has an explicit behavior fixture", () => {
  const expected=cards
    .filter(card=>card.category==="TRANSFORM"||card.id==="sindaeryuk")
    .map(card=>card.id)
    .sort();
  assert.deepEqual(IMPLEMENTED_MOVEMENT_TRANSFORMS,expected);
});

test("every manually targeted transform is classified as active", () => {
  const targeted=cards.filter(card=>card.category==="TRANSFORM"||card.id==="sindaeryuk");
  assert.equal(targeted.length,21);
  for(const card of targeted)assert.equal(card.activation,"ACTIVE",card.id);
});

test("direct-use palace and anomaly augments wait for manual activation", () => {
  const activeCardIds=["hunsukkun","amhaeng-eosa","seongbyeok","seongmun"];
  let state=createGame({cho:"귀마",han:"원앙마"},false,82,true);

  for(const cardId of activeCardIds){
    assert.equal(cards.find(card=>card.id===cardId)?.activation,"ACTIVE",cardId);
    const granted=reduceGame(state,{type:"TEST_GRANT_AUGMENT",side:"cho",cardId},"cho");
    assert.equal(granted.accepted,true,cardId);
    assert.equal(granted.state.cards.cho.at(-1)?.state,"ready",cardId);
    state=granted.state;
  }
});

test("restriction badges preserve direct-use permanent actives and remaining turns", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  state.restrictions=[
    {cardId:"gyeolgak",side:"han",remaining:3},
    {cardId:"busang",side:"han",remaining:99,targetPieceId:"p1"},
  ];
  for(const cardId of ["busang","sucha","talyeong","yeokbyeong"]){
    assert.equal(cards.find(card=>card.id===cardId)?.activation,"ACTIVE",cardId);
    assert.equal(cardActivationKind(cards.find(card=>card.id===cardId)!),"ACTIVE",cardId);
  }
  assert.equal(cardActivationKind(cards.find(card=>card.id==="gyeolgak")!),"ACTIVE");
  assert.equal(cardActivationKind(cards.find(card=>card.id==="gullyeong")!),"PASSIVE");
  assert.equal(restrictionTurnsRemaining(state,"gyeolgak"),3);
  assert.equal(restrictionTurnsRemaining(state,"busang"),undefined);
  assert.equal(restrictionTurnsRemaining(state,"gullyeong"),undefined);
});

test("every transform description names the source piece and transformed piece", () => {
  for(const card of cards.filter(card=>card.category==="TRANSFORM")){
    assert.match(card.text,/^내 .+[을를] .+(?:으로|로) 바꿉니다\./,card.id);
    assert.match(card.text,new RegExp(card.name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),card.id);
  }
  assert.equal(cards.find(card=>card.id==="cheonma")?.text,"내 마를 천마로 바꿉니다. 천마는 멱을 무시합니다.");
  assert.match(cards.find(card=>card.id==="mudang")!.text,/^내 상을 무당으로 바꿉니다\./);
});

test("every selectable movement transform activates on its declared base piece", () => {
  for(const cardId of IMPLEMENTED_MOVEMENT_TRANSFORMS){
    const card=cards.find(candidate=>candidate.id===cardId)!;
    const state=createGame({cho:"귀마",han:"원앙마"},false);
    state.cards.cho=[{cardId,slot:0,state:"ready"}];
    const targetType=card.id==="sindaeryuk"?"po":card.basePiece!;
    const target=state.pieces.find(piece=>piece.side==="cho"&&piece.type===targetType)!;
    const result=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetPieceId:target.id},"cho");
    assert.equal(result.accepted,true,cardId);
    assert.equal(result.state.cards.cho[0].state,"used",cardId);
    assert.equal(result.state.pieces.find(piece=>piece.id===target.id)?.transformCardId,cardId,cardId);
    assert.equal(result.state.pieces.find(piece=>piece.id===target.id)?.captureLockedPly,state.ply,cardId);
  }
});

test("horse and elephant respect their blocking legs", () => {
  const horse:Piece={id:"h",side:"cho",type:"ma",x:4,y:4};
  const blocker:Piece={id:"b",side:"cho",type:"jol",x:4,y:5};
  const horseMoves=generatePieceMoves([horse,blocker],horse,mods);
  assert.equal(has(horseMoves,3,6),false);
  assert.equal(has(horseMoves,5,6),false);
  assert.equal(has(horseMoves,6,5),true);
  const elephant:Piece={id:"e",side:"cho",type:"sang",x:4,y:3};
  const diagonalBlocker:Piece={id:"d",side:"cho",type:"jol",x:3,y:5};
  assert.equal(has(generatePieceMoves([elephant,diagonalBlocker],elephant,mods),2,6),false);
});

test("cannon needs exactly one non-cannon screen and cannot capture cannon", () => {
  const cannon:Piece={id:"c",side:"cho",type:"po",x:0,y:0};
  const screen:Piece={id:"s",side:"cho",type:"jol",x:0,y:2};
  const target:Piece={id:"t",side:"han",type:"cha",x:0,y:5};
  let moves=generatePieceMoves([cannon,screen,target],cannon,mods);
  assert.equal(has(moves,0,1),false);
  assert.equal(has(moves,0,3),true);
  assert.equal(has(moves,0,5),true);
  moves=generatePieceMoves([cannon,{...screen,type:"po"},target],cannon,mods);
  assert.equal(has(moves,0,5),false);
  moves=generatePieceMoves([cannon,screen,{...target,type:"po"}],cannon,mods);
  assert.equal(has(moves,0,5),false);
});

test("king capture ends the game without check or self-check filtering", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const choRook=state.pieces.find(p=>p.side==="cho"&&p.type==="cha")!;
  const hanKing=state.pieces.find(p=>p.side==="han"&&p.type==="gung")!;
  state.pieces=state.pieces.map(p=>p.id===choRook.id?{...p,x:4,y:7,captured:false}:p.id===hanKing.id?{...p,x:4,y:8,captured:false}:({...p,captured:true}));
  const next=movePiece(state,choRook.id,{x:4,y:8});
  assert.equal(next.winner,"cho");
  assert.equal(next.endReason,"capture_king");
});

test("an inert transform card keeps its judgment cost", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  state.cards.cho=[{cardId:"cheonma",slot:0,state:"inert",targetPieceId:"gone"}];
  assert.equal(totalCost(state,"cho"),2.5);
});

test("transform augments wait for and apply to the chosen matching piece", () => {
  const draft=createGame({cho:"귀마",han:"원앙마"},true,77);
  draft.draft!.choices=["cheonma"];
  const picked=reduceGame(draft,{type:"PICK_AUGMENT",cardId:"cheonma"},"cho");
  assert.equal(picked.accepted,true);
  assert.equal(picked.state.cards.cho[0].state,"ready");
  assert.equal(picked.state.pieces.some(piece=>piece.transformCardId==="cheonma"),false);

  const state=createGame({cho:"귀마",han:"원앙마"},false);
  state.cards.cho=[{cardId:"cheonma",slot:0,state:"ready"}];
  const horses=state.pieces.filter(piece=>piece.side==="cho"&&piece.type==="ma");
  const rook=state.pieces.find(piece=>piece.side==="cho"&&piece.type==="cha")!;
  const rejected=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetPieceId:rook.id},"cho");
  assert.equal(rejected.accepted,false);
  assert.equal(rejected.error?.code,"INVALID_AUGMENT_TARGET");

  const chosen=horses[1];
  const activated=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetPieceId:chosen.id},"cho");
  assert.equal(activated.accepted,true);
  assert.equal(activated.state.cards.cho[0].state,"used");
  assert.equal(activated.state.cards.cho[0].targetPieceId,chosen.id);
  assert.equal(activated.state.pieces.find(piece=>piece.id===chosen.id)?.transformCardId,"cheonma");
  assert.equal(activated.state.pieces.find(piece=>piece.id===horses[0].id)?.transformCardId,undefined);

  const enemy=activated.state.pieces.find(piece=>piece.side==="han"&&piece.type==="jol")!;
  enemy.x=5;
  enemy.y=2;
  assert.equal(has(legalMoves(activated.state,chosen.id),5,2),false);
  assert.equal(has(legalMoves(activated.state,chosen.id),8,1),true);
  assert.equal(has(legalMoves({...activated.state,ply:activated.state.ply+1},chosen.id),5,2),true);
});

test("Jingbyeong waits for a selected own soldier and promotes only that soldier", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  state.cards.cho=[{cardId:"jingbyeong",slot:0,state:"ready"}];
  const soldiers=state.pieces.filter(piece=>piece.side==="cho"&&piece.type==="jol");
  const enemy=state.pieces.find(piece=>piece.side==="han"&&piece.type==="jol")!;

  const missing=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0},"cho");
  assert.equal(missing.accepted,false);
  assert.equal(missing.error?.code,"INVALID_AUGMENT_TARGET");
  assert.equal(missing.state.cards.cho[0].state,"ready");

  const invalid=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetPieceId:enemy.id},"cho");
  assert.equal(invalid.accepted,false);
  assert.equal(invalid.error?.code,"INVALID_AUGMENT_TARGET");

  const chosen=soldiers[1];
  const activated=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetPieceId:chosen.id},"cho");
  assert.equal(activated.accepted,true);
  assert.equal(activated.state.cards.cho[0].state,"used");
  assert.equal(activated.state.pieces.find(piece=>piece.id===chosen.id)?.type,"sang");
  assert.equal(activated.state.pieces.find(piece=>piece.id===soldiers[0].id)?.type,"jol");
});

test("Hangu and Yubang acquisition applies the dedicated king artwork", () => {
  for(const cardId of ["hangu","yubang"]){
    const draft=createGame({cho:"귀마",han:"원앙마"},true,91);
    draft.draft!.choices=[cardId];
    const picked=reduceGame(draft,{type:"PICK_AUGMENT",cardId},"cho");
    const king=picked.state.pieces.find(piece=>piece.side==="cho"&&piece.type==="gung")!;
    assert.equal(king.transformCardId,cardId);
    assert.equal(king.captureLockedPly,draft.ply);
    assert.equal(pieceArtPath(king),`/pieces/cho-t-${cardId}.svg`);
  }
});

test("only Hangu discloses the palace capture exception", () => {
  assert.match(cards.find(card=>card.id==="hangu")!.text,/변신한 직후에도 궁성 안의 상대 기물을 잡을 수 있습니다/);
  assert.doesNotMatch(cards.find(card=>card.id==="yubang")!.text,/변신한 직후/);
});

test("newly transformed Hangu keeps its palace capture exception while Yubang does not", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const insideEnemy:Piece={id:"inside",side:"han",type:"jol",x:3,y:2};
  const outsideEnemy:Piece={id:"outside",side:"han",type:"jol",x:4,y:3};

  const hangu:Piece={id:"hangu",side:"cho",type:"gung",transformCardId:"hangu",x:4,y:2,captureLockedPly:state.ply};
  state.cards.cho=[{cardId:"hangu",slot:0,state:"active",targetPieceId:hangu.id}];
  state.pieces=[hangu,insideEnemy,outsideEnemy];
  assert.equal(has(legalMoves(state,hangu.id),3,2),true);
  assert.equal(has(legalMoves(state,hangu.id),4,3),false);

  const yubang:Piece={...hangu,id:"yubang",transformCardId:"yubang"};
  state.cards.cho=[{cardId:"yubang",slot:0,state:"active",targetPieceId:yubang.id}];
  state.pieces=[yubang,insideEnemy,outsideEnemy];
  assert.equal(has(legalMoves(state,yubang.id),3,2),false);
  assert.equal(has(legalMoves(state,yubang.id),4,3),false);
  assert.equal(has(legalMoves({...state,ply:state.ply+1},yubang.id),4,3),true);
});

test("Yubang follows palace lines inside and moves one orthogonal step outside", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const king:Piece={id:"king",side:"cho",type:"gung",transformCardId:"yubang",x:4,y:1};
  state.pieces=[king];
  assert.equal(has(legalMoves(state,king.id),3,0),true);
  assert.equal(has(legalMoves(state,king.id),3,1),true);

  king.x=4; king.y=2;
  assert.equal(has(legalMoves(state,king.id),4,3),true);
  assert.equal(has(legalMoves(state,king.id),3,3),false);

  king.x=4; king.y=3;
  assert.equal(has(legalMoves(state,king.id),5,3),true);
  assert.equal(has(legalMoves(state,king.id),5,4),false);
});

test("Yubang leaves at most three jeokgi markers in FIFO order", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  state.pieces=[{id:"king",side:"cho",type:"gung",transformCardId:"yubang",x:4,y:2}];
  for(const to of [{x:4,y:3},{x:5,y:3},{x:5,y:4},{x:6,y:4}]){
    const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:"king",to},"cho");
    assert.equal(result.accepted,true);
    state={...result.state,turn:"cho"};
  }
  assert.deepEqual(state.jeokgi,[
    {x:4,y:3,side:"cho"},
    {x:5,y:3,side:"cho"},
    {x:5,y:4,side:"cho"},
  ]);
});

test("Yubang wins immediately on reaching the enemy back rank for either side", () => {
  for(const side of ["cho","han"] as const){
    const state=createGame({cho:"귀마",han:"원앙마"},false);
    const fromY=side==="cho"?8:1,toY=side==="cho"?9:0;
    state.turn=side;
    state.pieces=[{id:"king",side,type:"gung",transformCardId:"yubang",x:4,y:fromY}];
    const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:"king",to:{x:4,y:toY}},side);
    assert.equal(result.accepted,true);
    assert.equal(result.state.winner,side);
    assert.equal(result.state.endReason,"special_victory");
    assert.equal(result.events.at(-1)?.type,"GAME_ENDED");
  }
});

test("Hangu retains the same enemy back-rank victory condition", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const king:Piece={id:"king",side:"cho",type:"gung",transformCardId:"hangu",x:4,y:8};
  state.pieces=[king];
  state.cards.cho=[{cardId:"hangu",slot:0,state:"active",targetPieceId:king.id}];
  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:king.id,to:{x:4,y:9}},"cho");
  assert.equal(result.accepted,true);
  assert.equal(result.state.winner,"cho");
  assert.equal(result.state.endReason,"special_victory");
});

test("enemy jeokgi blocks empty entry and passage but permits capturing its occupant", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const rook:Piece={id:"rook",side:"han",type:"cha",x:4,y:5};
  state.turn="han";
  state.jeokgi=[{x:4,y:3,side:"cho"}];
  state.pieces=[rook];
  let moves=legalMoves(state,rook.id);
  assert.equal(has(moves,4,4),true);
  assert.equal(has(moves,4,3),false);
  assert.equal(has(moves,4,2),false);

  const target:Piece={id:"target",side:"cho",type:"jol",x:4,y:3};
  state.pieces=[rook,target];
  moves=legalMoves(state,rook.id);
  assert.equal(has(moves,4,3),true);
  assert.equal(has(moves,4,2),false);
  const captured=reduceGame(state,{type:"MOVE_PIECE",pieceId:rook.id,to:{x:4,y:3}},"han");
  assert.equal(captured.accepted,true);
  assert.equal(captured.state.pieces.find(piece=>piece.id===target.id)?.captured,true);
  assert.deepEqual(captured.state.pieces.find(piece=>piece.id===rook.id),{...rook,x:4,y:3});
});

test("own jeokgi never blocks movement", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const rook:Piece={id:"rook",side:"cho",type:"cha",x:4,y:5};
  state.jeokgi=[{x:4,y:3,side:"cho"}];
  state.pieces=[rook];
  assert.equal(has(legalMoves(state,rook.id),4,2),true);
});

test("movement transform variants preserve and extend their base movement", () => {
  const active=(...cardIds:string[])=>({...mods,cardIds});

  const wideElephant:Piece={id:"wide",side:"cho",type:"sang",transformCardId:"gwal-sang",x:4,y:3};
  const oneBlocker:Piece={id:"block",side:"cho",type:"jol",x:4,y:4};
  assert.equal(has(generatePieceMoves([wideElephant,oneBlocker],wideElephant,mods),2,6),true);

  const raider:Piece={id:"raider",side:"cho",type:"jol",transformCardId:"yugyeok-jol",x:4,y:4};
  assert.equal(has(generatePieceMoves([raider],raider,mods),4,3),true);

  const escort:Piece={id:"escort",side:"cho",type:"sa",transformCardId:"howi-musa",x:4,y:3};
  assert.equal(has(generatePieceMoves([escort],escort,active("howi-musa")),5,4),true);

  const tank:Piece={id:"tank",side:"cho",type:"cha",transformCardId:"jeoncha",x:4,y:4};
  assert.equal(has(generatePieceMoves([tank],tank,mods),5,5),true);

  const heavyCannon:Piece={id:"heavy",side:"cho",type:"po",transformCardId:"jungpo",x:0,y:0};
  const screens:Piece[]=[1,3].map((y,index)=>({id:`screen-${index}`,side:"cho",type:"jol",x:0,y}));
  assert.equal(has(generatePieceMoves([heavyCannon,...screens],heavyCannon,mods),0,4),true);

  const spy:Piece={id:"spy",side:"cho",type:"cha",transformCardId:"miljeong",x:4,y:4};
  assert.equal(has(generatePieceMoves([spy],spy,mods),4,8),true);

  const fireCart:Piece={id:"fire",side:"cho",type:"po",transformCardId:"hwacha",x:0,y:0};
  assert.equal(has(generatePieceMoves([fireCart,screens[0]],fireCart,mods),0,2),true);

  const goblin:Piece={id:"goblin",side:"cho",type:"ma",transformCardId:"dokkaebi",x:4,y:4};
  assert.equal(has(generatePieceMoves([goblin],goblin,mods),5,6),true);

  for(const transformCardId of ["jangdolbaengi"]){
    const soldier:Piece={id:transformCardId,side:"cho",type:"jol",transformCardId,x:4,y:4};
    assert.equal(has(generatePieceMoves([soldier],soldier,mods),4,5),true);
  }

  const adviser:Piece={id:"adviser",side:"cho",type:"sa",transformCardId:"guksa",x:4,y:1};
  assert.equal(has(generatePieceMoves([adviser],adviser,mods),4,2),true);
});

test("Uibyeong costs 3 stars and gains its staged movement after resting", () => {
  const card=cards.find(candidate=>candidate.id==="uibyeong")!;
  assert.equal(card.name,"의병");
  assert.equal(card.cost,3);
  assert.match(card.text,/즉시 제자리에서 한 턴/);

  const soldier:Piece={id:"soldier",side:"cho",type:"jol",transformCardId:"uibyeong",x:4,y:4,growth:0};
  let moves=generatePieceMoves([soldier],soldier,mods);
  assert.equal(has(moves,4,3),false);
  assert.equal(has(moves,3,5),false);

  soldier.growth=1;
  moves=generatePieceMoves([soldier],soldier,mods);
  assert.equal(has(moves,4,3),true);
  assert.equal(has(moves,3,5),false);

  soldier.growth=2;
  moves=generatePieceMoves([soldier],soldier,mods);
  assert.equal(has(moves,3,5),true);
  assert.equal(has(moves,5,5),true);

  soldier.growth=3;
  moves=generatePieceMoves([soldier],soldier,mods);
  assert.equal(has(moves,4,9),true);
  assert.equal(has(moves,3,5),false);
});

test("Uibyeong rests in place, consumes a turn, and stops growing after three uses", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  const soldier:Piece={id:"soldier",side:"cho",type:"jol",transformCardId:"uibyeong",x:4,y:4,growth:0};
  state.pieces=[soldier];
  state.cards.cho=[{cardId:"uibyeong",slot:0,state:"active",targetPieceId:soldier.id}];

  for(let growth=1;growth<=3;growth++){
    assert.equal(canUseUibyeongRest(state,soldier.id),true);
    const result=reduceGame(state,{type:"USE_UIBYEONG_REST",pieceId:soldier.id},"cho");
    assert.equal(result.accepted,true);
    const rested=result.state.pieces.find(piece=>piece.id===soldier.id)!;
    assert.deepEqual({x:rested.x,y:rested.y},{x:4,y:4});
    assert.equal(rested.growth,growth);
    assert.equal(result.state.turn,"han");
    assert.deepEqual(result.state.moves.at(-1)?.from,{x:4,y:4});
    assert.deepEqual(result.state.moves.at(-1)?.to,{x:4,y:4});
    state={...result.state,turn:"cho"};
  }

  assert.equal(canUseUibyeongRest(state,soldier.id),false);
  const rejected=reduceGame(state,{type:"USE_UIBYEONG_REST",pieceId:soldier.id},"cho");
  assert.equal(rejected.accepted,false);
  assert.equal(rejected.error?.code,"INVALID_AUGMENT_TARGET");
});

test("Guksa revives one fallen ally after five full moves inside the palace", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  const guksa:Piece={id:"guksa",side:"cho",type:"sa",transformCardId:"guksa",x:4,y:1,guksaWait:0,guksaRevived:false};
  const fallen:Piece={id:"fallen",side:"cho",type:"ma",x:0,y:0,captured:true};
  const choRook:Piece={id:"cho-rook",side:"cho",type:"cha",x:0,y:4};
  const hanRook:Piece={id:"han-rook",side:"han",type:"cha",x:8,y:5};
  state.pieces=[guksa,fallen,choRook,hanRook];
  state.cards.cho=[{cardId:"guksa",slot:0,state:"active",targetPieceId:guksa.id}];

  for(let fullMove=1;fullMove<=5;fullMove++){
    const choTo={x:fullMove%2,y:4};
    let result=reduceGame(state,{type:"MOVE_PIECE",pieceId:choRook.id,to:choTo},"cho");
    assert.equal(result.accepted,true);
    state=result.state;
    const hanTo={x:8-fullMove%2,y:5};
    result=reduceGame(state,{type:"MOVE_PIECE",pieceId:hanRook.id,to:hanTo},"han");
    assert.equal(result.accepted,true);
    state=result.state;
    assert.equal(state.pieces.find(piece=>piece.id===fallen.id)?.captured,fullMove<5);
  }

  const revived=state.pieces.find(piece=>piece.id===fallen.id)!;
  assert.deepEqual({x:revived.x,y:revived.y,captured:revived.captured},{x:3,y:0,captured:false});
  assert.equal(state.pieces.find(piece=>piece.id===guksa.id)?.guksaRevived,true);
  revived.captured=true;
  let result=reduceGame(state,{type:"MOVE_PIECE",pieceId:choRook.id,to:{x:0,y:4}},"cho");
  state=result.state;
  result=reduceGame(state,{type:"MOVE_PIECE",pieceId:hanRook.id,to:{x:8,y:5}},"han");
  assert.equal(result.state.pieces.find(piece=>piece.id===fallen.id)?.captured,true);
});

test("Gullyeong is acquired as a persistent passive restriction", () => {
  const draft=createGame({cho:"귀마",han:"원앙마"},true,81);
  draft.draft!.choices=["gullyeong"];
  const picked=reduceGame(draft,{type:"PICK_AUGMENT",cardId:"gullyeong"},"cho");
  assert.equal(cards.find(card=>card.id==="gullyeong")?.activation,"PASSIVE");
  assert.equal(cards.find(card=>card.id==="gullyeong")?.duration,undefined);
  assert.equal(picked.state.cards.cho[0].state,"active");

  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const first:Piece={id:"first",side:"han",type:"cha",x:0,y:9};
  const second:Piece={id:"second",side:"han",type:"cha",x:8,y:9};
  const soldier:Piece={id:"soldier",side:"han",type:"jol",x:4,y:6};
  state.turn="han";
  state.cards.cho=[{cardId:"gullyeong",slot:0,state:"active"}];
  state.pieces=[first,second,soldier];
  state.moves=[{notation:"차 이동",side:"han",pieceId:first.id,from:{x:0,y:8},to:{x:0,y:9}}];
  assert.deepEqual(legalMoves(state,second.id),[]);
  assert.ok(legalMoves(state,soldier.id).length>0);
});

test("Gongseongtap moves at most two spaces and can move onto an ally to board it", () => {
  assert.match(cards.find(card=>card.id==="gongseongtap")!.text,/최대 2칸/);
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const tower:Piece={id:"tower",side:"cho",type:"cha",transformCardId:"gongseongtap",hp:2,x:4,y:4};
  const passenger:Piece={id:"passenger",side:"cho",type:"ma",x:4,y:6};
  state.pieces=[tower,passenger];

  const moves=legalMoves(state,tower.id);
  assert.equal(has(moves,4,6),true);
  assert.equal(has(moves,4,7),false);

  const boarded=reduceGame(state,{type:"MOVE_PIECE",pieceId:tower.id,to:{x:4,y:6}},"cho").state;
  assert.equal(boarded.pieces.find(piece=>piece.id===passenger.id)?.carriedBy,tower.id);
  const transported=reduceGame({...boarded,turn:"cho"},{type:"MOVE_PIECE",pieceId:tower.id,to:{x:6,y:6}},"cho").state;
  assert.deepEqual(transported.pieces.find(piece=>piece.id===passenger.id),{...passenger,x:6,y:6,carriedBy:tower.id});
});

test("Jangdolbaengi stores captured pieces and deploys one into an empty own-palace point", () => {
  assert.match(cards.find(card=>card.id==="jangdolbaengi")!.text,/내 궁성 안 빈칸/);
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const merchant:Piece={id:"merchant",side:"cho",type:"jol",transformCardId:"jangdolbaengi",x:4,y:4};
  const enemyHorse:Piece={id:"enemy-horse",side:"han",type:"ma",x:4,y:5};
  state.pieces=[merchant,enemyHorse];
  state.cards.cho=[{cardId:"jangdolbaengi",slot:0,state:"active",targetPieceId:merchant.id}];

  const captured=reduceGame(state,{type:"MOVE_PIECE",pieceId:merchant.id,to:{x:4,y:5}},"cho");
  assert.equal(captured.accepted,true);
  assert.equal(captured.state.reserves.cho.length,1);
  assert.deepEqual({side:captured.state.reserves.cho[0].side,type:captured.state.reserves.cho[0].type},{side:"cho",type:"ma"});
  assert.equal(has(jangdolbaengiDropTargets({...captured.state,turn:"cho"},"cho"),3,0),true);
  assert.equal(has(jangdolbaengiDropTargets({...captured.state,turn:"cho"},"cho"),2,2),false);

  const reservePieceId=captured.state.reserves.cho[0].id;
  const deployed=reduceGame({...captured.state,turn:"cho"},{type:"DEPLOY_JANGDOLBAENGI_RESERVE",reservePieceId,to:{x:3,y:0}},"cho");
  assert.equal(deployed.accepted,true);
  assert.equal(deployed.state.reserves.cho.length,0);
  assert.ok(deployed.state.pieces.some(piece=>piece.id===reservePieceId&&!piece.captured&&piece.side==="cho"&&piece.type==="ma"&&piece.x===3&&piece.y===0));
  assert.equal(deployed.state.turn,"han");
  assert.equal(deployed.events[0]?.type,"PIECE_DEPLOYED");
});

test("Jangdolbaengi holds at most two pieces and loses its cargo when captured", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  const merchant:Piece={id:"merchant",side:"cho",type:"jol",transformCardId:"jangdolbaengi",x:4,y:3};
  const victims:Piece[]=[4,5,6].map((y,index)=>({id:`victim-${index}`,side:"han",type:index===0?"ma":index===1?"sang":"cha",x:4,y}));
  state.pieces=[merchant,...victims];
  state.cards.cho=[{cardId:"jangdolbaengi",slot:0,state:"active",targetPieceId:merchant.id}];
  for(const y of [4,5,6])state=reduceGame({...state,turn:"cho"},{type:"MOVE_PIECE",pieceId:merchant.id,to:{x:4,y}},"cho").state;
  assert.equal(state.reserves.cho.length,2);

  const attacker:Piece={id:"attacker",side:"han",type:"cha",x:4,y:8};
  state={...state,turn:"han",pieces:[...state.pieces,attacker]};
  const destroyed=reduceGame(state,{type:"MOVE_PIECE",pieceId:attacker.id,to:{x:4,y:6}},"han");
  assert.equal(destroyed.accepted,true);
  assert.equal(destroyed.state.pieces.find(piece=>piece.id===merchant.id)?.captured,true);
  assert.equal(destroyed.state.reserves.cho.length,0);
});

test("Gwang Gungseong expands Jangdolbaengi deployment to the expanded own palace", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  state.pieces=[{id:"merchant",side:"cho",type:"jol",transformCardId:"jangdolbaengi",x:4,y:4}];
  state.cards.cho=[{cardId:"jangdolbaengi",slot:0,state:"active",targetPieceId:"merchant"},{cardId:"gwang-gungseong",slot:1,state:"active"}];
  state.reserves.cho=[{id:"cargo",side:"cho",type:"cha",x:-1,y:-1}];
  assert.equal(has(jangdolbaengiDropTargets(state,"cho"),2,3),true);
});

test("an allied non-king can use its own movement to board an empty Gongseongtap", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const tower:Piece={id:"tower",side:"cho",type:"cha",transformCardId:"gongseongtap",hp:2,x:4,y:4};
  const passenger:Piece={id:"passenger",side:"cho",type:"ma",x:2,y:3};
  state.pieces=[tower,passenger];

  assert.equal(has(legalMoves(state,passenger.id),4,4),true);
  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:passenger.id,to:{x:4,y:4}},"cho");
  assert.equal(result.accepted,true);
  assert.deepEqual(result.state.pieces.find(piece=>piece.id===tower.id),tower);
  assert.deepEqual(result.state.pieces.find(piece=>piece.id===passenger.id),{...passenger,x:4,y:4,carriedBy:tower.id});
});

test("Gongseongtap transports its passenger while the passenger can be selected to dismount", () => {
  const overlapState=createGame({cho:"귀마",han:"원앙마"},false);
  const tower:Piece={id:"tower",side:"cho",type:"cha",transformCardId:"gongseongtap",hp:2,x:4,y:4};
  const soldier:Piece={id:"soldier",side:"cho",type:"jol",x:4,y:4,carriedBy:tower.id};
  overlapState.pieces=[tower,soldier];

  const overlap=reduceGame(overlapState,{type:"MOVE_PIECE",pieceId:tower.id,to:{x:4,y:5}},"cho");
  assert.equal(overlap.accepted,true);
  assert.deepEqual(overlap.state.pieces.find(piece=>piece.id===tower.id),{...tower,x:4,y:5});
  assert.deepEqual(overlap.state.pieces.find(piece=>piece.id===soldier.id),{...soldier,x:4,y:5});
  assert.equal(overlap.state.moves.at(-1)?.pieceId,tower.id);

  const dismountState=createGame({cho:"귀마",han:"원앙마"},false);
  const horse:Piece={id:"horse",side:"cho",type:"ma",x:4,y:4,carriedBy:tower.id};
  const enemy:Piece={id:"enemy",side:"han",type:"jol",x:5,y:6};
  dismountState.pieces=[tower,horse,enemy];
  assert.equal(has(legalMoves(dismountState,tower.id),5,6),false);
  assert.equal(has(legalMoves(dismountState,horse.id),5,6),true);
  const dismounted=reduceGame(dismountState,{type:"MOVE_PIECE",pieceId:horse.id,to:{x:5,y:6}},"cho");
  assert.equal(dismounted.accepted,true);
  assert.deepEqual(dismounted.state.pieces.find(piece=>piece.id===tower.id),tower);
  assert.deepEqual(dismounted.state.pieces.find(piece=>piece.id===horse.id),{...horse,x:5,y:6,carriedBy:undefined});
  assert.equal(dismounted.state.pieces.find(piece=>piece.id===enemy.id)?.captured,true);
  assert.equal(dismounted.state.moves.at(-1)?.pieceId,horse.id);
  assert.equal(dismounted.events[0]?.type,"PIECE_MOVED");
  assert.equal(dismounted.events[0]&&"pieceId" in dismounted.events[0]?dismounted.events[0].pieceId:undefined,horse.id);
});

test("a Gongseongtap passenger survives when the tower is destroyed", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const tower:Piece={id:"tower",side:"cho",type:"cha",transformCardId:"gongseongtap",hp:1,x:4,y:4};
  const passenger:Piece={id:"passenger",side:"cho",type:"ma",x:4,y:4,carriedBy:tower.id};
  const attacker:Piece={id:"attacker",side:"han",type:"cha",x:4,y:6};
  state.turn="han";
  state.pieces=[tower,passenger,attacker];

  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:attacker.id,to:{x:4,y:4}},"han");
  assert.equal(result.state.pieces.find(piece=>piece.id===tower.id)?.captured,true);
  assert.deepEqual(result.state.pieces.find(piece=>piece.id===passenger.id),{...passenger,carriedBy:undefined});
  assert.deepEqual(result.state.pieces.find(piece=>piece.id===attacker.id),attacker);
});

test("Hongipo moves without a screen, pierces one square, and spends ammunition", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const cannon:Piece={id:"cannon",side:"cho",type:"po",transformCardId:"hongipo",ammo:3,x:0,y:0};
  const landing:Piece={id:"landing",side:"han",type:"jol",x:0,y:3};
  const beyond:Piece={id:"beyond",side:"han",type:"ma",x:0,y:4};
  state.pieces=[cannon,landing,beyond];

  assert.equal(has(legalMoves(state,cannon.id),0,2),true);
  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:cannon.id,to:{x:0,y:3}},"cho");
  assert.equal(result.state.pieces.find(piece=>piece.id===landing.id)?.captured,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===beyond.id)?.captured,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===cannon.id)?.ammo,2);
});

test("Hongipo ruptures after its third shot and cannot pierce-capture on its transform turn", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const cannon:Piece={id:"cannon",side:"cho",type:"po",transformCardId:"hongipo",captureLockedPly:state.ply,ammo:1,x:0,y:0};
  const target:Piece={id:"target",side:"han",type:"jol",x:0,y:4};
  state.pieces=[cannon,target];
  assert.equal(has(legalMoves(state,cannon.id),0,3),false);
  const unlocked={...state,ply:state.ply+1};
  assert.equal(has(legalMoves(unlocked,cannon.id),0,3),true);
  const result=reduceGame(unlocked,{type:"MOVE_PIECE",pieceId:cannon.id,to:{x:0,y:3}},"cho");
  assert.equal(result.state.pieces.find(piece=>piece.id===target.id)?.captured,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===cannon.id)?.captured,true);
});

test("Hungry Tiger can only move to a diagonal capture", () => {
  const tiger:Piece={id:"tiger",side:"cho",type:"sang",transformCardId:"horangi",x:4,y:4};
  const prey:Piece={id:"prey",side:"han",type:"jol",x:7,y:7};
  const ally:Piece={id:"ally",side:"cho",type:"jol",x:2,y:2};
  const moves=generatePieceMoves([tiger,prey,ally],tiger,mods);
  assert.equal(has(moves,7,7),true);
  assert.equal(has(moves,5,5),false);
  assert.equal(has(moves,1,1),false);
});

test("Mudang keeps elephant movement and freezes every enemy in its unblocked range", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const shaman:Piece={id:"shaman",side:"cho",type:"sang",transformCardId:"mudang",x:4,y:3};
  const frozen:Piece={id:"frozen",side:"han",type:"jol",x:2,y:6};
  state.turn="han";
  state.pieces=[shaman,frozen];
  assert.equal(has(generatePieceMoves(state.pieces,shaman,mods),2,6),true);
  assert.equal(isFrozenByMudang(state,frozen.id),true);
  assert.deepEqual(legalMoves(state,frozen.id),[]);

  const blocker:Piece={id:"blocker",side:"cho",type:"jol",x:4,y:4};
  state.pieces=[shaman,frozen,blocker];
  assert.equal(isFrozenByMudang(state,frozen.id),false);
  assert.ok(legalMoves(state,frozen.id).length>0);
});

test("a piece frozen by Mudang remains capturable", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const shaman:Piece={id:"shaman",side:"cho",type:"sang",transformCardId:"mudang",x:4,y:3};
  const frozen:Piece={id:"frozen",side:"han",type:"jol",x:2,y:6};
  const rook:Piece={id:"rook",side:"cho",type:"cha",x:2,y:4};
  state.pieces=[shaman,frozen,rook];
  assert.equal(has(legalMoves(state,rook.id),2,6),true);
  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:rook.id,to:{x:2,y:6}},"cho");
  assert.equal(result.accepted,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===frozen.id)?.captured,true);
});

test("newly transformed Hungry Tiger waits until a later turn before capturing", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const tiger:Piece={id:"tiger",side:"cho",type:"sang",transformCardId:"horangi",captureLockedPly:state.ply,x:4,y:4};
  const prey:Piece={id:"prey",side:"han",type:"jol",x:7,y:7};
  state.pieces=[tiger,prey];
  assert.equal(has(legalMoves(state,tiger.id),7,7),false);
  assert.equal(has(legalMoves({...state,ply:state.ply+1},tiger.id),7,7),true);
});

test("Gwangdae borrows adjacent movement and falls back to ordinary soldier movement", () => {
  const clown:Piece={id:"clown",side:"cho",type:"jol",transformCardId:"gwangdae",x:4,y:4};
  const rook:Piece={id:"rook",side:"cho",type:"cha",x:4,y:5};
  assert.equal(has(generatePieceMoves([clown,rook],clown,mods),8,4),true);
  assert.equal(has(generatePieceMoves([clown],clown,mods),4,5),true);
  assert.equal(has(generatePieceMoves([clown],clown,mods),4,3),false);
});

test("Jeoktoma cumulatively adds longer horse moves over two growth stages", () => {
  const horse:Piece={id:"horse",side:"cho",type:"ma",transformCardId:"jeoktoma",growth:0,x:4,y:4};
  let moves=generatePieceMoves([horse],horse,mods);
  assert.equal(has(moves,6,5),true);
  assert.equal(has(moves,7,5),false);
  assert.equal(has(moves,8,5),false);

  horse.growth=1;
  moves=generatePieceMoves([horse],horse,mods);
  assert.equal(has(moves,6,5),true);
  assert.equal(has(moves,7,5),true);
  assert.equal(has(moves,8,5),false);

  horse.growth=2;
  moves=generatePieceMoves([horse],horse,mods);
  assert.equal(has(moves,6,5),true);
  assert.equal(has(moves,7,5),true);
  assert.equal(has(moves,8,5),true);
});

test("Jeoktoma obeys its horse leg and blocks only longer paths at later obstacles", () => {
  const horse:Piece={id:"horse",side:"cho",type:"ma",transformCardId:"jeoktoma",growth:2,x:4,y:4};
  const firstLeg:Piece={id:"first-leg",side:"cho",type:"jol",x:5,y:4};
  const firstBlocked=generatePieceMoves([horse,firstLeg],horse,mods);
  assert.equal(has(firstBlocked,6,5),false);
  assert.equal(has(firstBlocked,7,5),false);
  assert.equal(has(firstBlocked,8,5),false);

  const secondLeg:Piece={id:"second-leg",side:"cho",type:"jol",x:6,y:4};
  const laterBlocked=generatePieceMoves([horse,secondLeg],horse,mods);
  assert.equal(has(laterBlocked,6,5),true);
  assert.equal(has(laterBlocked,7,5),false);
  assert.equal(has(laterBlocked,8,5),false);
});

test("Jeoktoma grows after captures but never exceeds two growth stages", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const horse:Piece={id:"horse",side:"cho",type:"ma",transformCardId:"jeoktoma",growth:0,x:4,y:4};
  const target:Piece={id:"target",side:"han",type:"jol",x:6,y:5};
  state.pieces=[horse,target];
  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:horse.id,to:{x:6,y:5}},"cho");
  assert.equal(result.state.pieces.find(piece=>piece.id===target.id)?.captured,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===horse.id)?.growth,1);

  const cappedState=createGame({cho:"귀마",han:"원앙마"},false);
  const cappedHorse:Piece={...horse,growth:2};
  const cappedTarget:Piece={...target};
  cappedState.pieces=[cappedHorse,cappedTarget];
  const capped=reduceGame(cappedState,{type:"MOVE_PIECE",pieceId:cappedHorse.id,to:{x:6,y:5}},"cho");
  assert.equal(capped.state.pieces.find(piece=>piece.id===cappedHorse.id)?.growth,2);
  assert.equal(cards.find(card=>card.id==="jeoktoma")?.cost,4);
  assert.match(cards.find(card=>card.id==="jeoktoma")?.text??"",/최대 2회/);
});

test("Naesi follows the king by the same displacement and blocks impossible paired moves", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const king:Piece={id:"king",side:"cho",type:"gung",x:4,y:1};
  const attendant:Piece={id:"attendant",side:"cho",type:"sa",transformCardId:"naesi",x:3,y:0};
  state.pieces=[king,attendant];
  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:king.id,to:{x:4,y:2}},"cho");
  assert.deepEqual(result.state.pieces.find(piece=>piece.id===attendant.id),{...attendant,x:3,y:1});

  const blocker:Piece={id:"blocker",side:"cho",type:"jol",x:3,y:1};
  state.pieces=[king,attendant,blocker];
  assert.equal(has(legalMoves(state,king.id),4,2),false);
});

test("Sindaeryuk transforms a cannon into an unlimited diagonal slider without screens", () => {
  assert.equal(cards.find(card=>card.id==="sindaeryuk")?.activation,"ACTIVE");
  const bishop:Piece={id:"bishop",side:"cho",type:"po",transformCardId:"sindaeryuk",x:4,y:4};
  const blocker:Piece={id:"blocker",side:"cho",type:"jol",x:6,y:6};
  const moves=generatePieceMoves([bishop,blocker],bishop,mods);
  assert.equal(has(moves,5,5),true);
  assert.equal(has(moves,7,7),false);
  assert.equal(has(moves,4,5),false);
});

test("Hungry Tiger is exposed under its new card name", () => {
  assert.equal(cards.find(card=>card.id==="horangi")?.name,"굶주린 호랑이");
});

test("Geobukseon passes through enemies but stops at allies and cannot capture beyond its durability", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const ship:Piece={id:"ship",side:"cho",type:"cha",transformCardId:"geobukseon",hp:2,x:0,y:0};
  const enemies:Piece[]=[2,4,6].map((y,index)=>({id:`enemy-${index}`,side:"han",type:"jol",x:0,y}));
  const ally:Piece={id:"ally",side:"cho",type:"jol",x:0,y:8};
  state.pieces=[ship,...enemies,ally];

  const moves=legalMoves(state,ship.id);
  assert.equal(has(moves,0,3),true);
  assert.equal(has(moves,0,5),true);
  assert.equal(has(moves,0,6),false);
  assert.equal(has(moves,0,7),false);
  assert.equal(has(moves,0,8),false);
});

test("Geobukseon exact captures consume one durability", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const ship:Piece={id:"ship",side:"cho",type:"cha",transformCardId:"geobukseon",hp:2,x:0,y:0};
  const enemy:Piece={id:"enemy",side:"han",type:"jol",x:0,y:2};
  state.pieces=[ship,enemy];

  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:ship.id,to:{x:0,y:2}},"cho");
  assert.equal(result.accepted,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===enemy.id)?.captured,true);
  assert.deepEqual(result.state.pieces.find(piece=>piece.id===ship.id),{...ship,x:0,y:2,hp:1});
});

test("Geobukseon spends one durability per passed enemy and sinks at zero", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const ship:Piece={id:"ship",side:"cho",type:"cha",transformCardId:"geobukseon",hp:2,x:0,y:0};
  const first:Piece={id:"first",side:"han",type:"jol",x:0,y:2};
  const second:Piece={id:"second",side:"han",type:"ma",x:0,y:4};
  state.pieces=[ship,first,second];
  state.cards.cho=[{cardId:"geobukseon",slot:0,state:"active",targetPieceId:ship.id}];

  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:ship.id,to:{x:0,y:5}},"cho");
  assert.equal(result.accepted,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===first.id)?.captured,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===second.id)?.captured,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===ship.id)?.hp,0);
  assert.equal(result.state.pieces.find(piece=>piece.id===ship.id)?.captured,true);
  assert.equal(result.state.cards.cho[0].state,"inert");
  assert.deepEqual(result.state.moves.at(-1)?.capturedIds,[first.id,second.id]);
  assert.deepEqual(result.events.filter(event=>event.type==="PIECE_CAPTURED").map(event=>event.pieceId),[first.id,second.id]);
});

test("newly transformed Geobukseon cannot sweep-capture on the activation turn", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const ship:Piece={id:"ship",side:"cho",type:"cha",transformCardId:"geobukseon",captureLockedPly:state.ply,hp:2,x:0,y:0};
  const enemy:Piece={id:"enemy",side:"han",type:"jol",x:0,y:2};
  state.pieces=[ship,enemy];

  assert.equal(has(legalMoves(state,ship.id),0,1),true);
  assert.equal(has(legalMoves(state,ship.id),0,3),false);
  assert.equal(has(legalMoves({...state,ply:state.ply+1},ship.id),0,3),true);
});

test("the command reducer validates actors and emits domain events", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false,1234);
  const soldier=state.pieces.find(p=>p.side==="cho"&&p.type==="jol"&&p.x===0)!;
  const command={type:"MOVE_PIECE" as const,pieceId:soldier.id,to:{x:0,y:4}};
  const rejected=reduceGame(state,command,"han");
  assert.equal(rejected.accepted,false);
  assert.equal(rejected.error?.code,"WRONG_ACTOR");
  const accepted=reduceGame(state,command,"cho");
  assert.equal(accepted.accepted,true);
  assert.equal(accepted.state.revision,1);
  assert.equal(accepted.state.phase,"ACTION");
  assert.deepEqual(accepted.events.map(event=>event.type),["PIECE_MOVED","TURN_CHANGED"]);
});

test("draft offers are reproducible from a stored seed", () => {
  const first=createGame({cho:"귀마",han:"원앙마"},true,98765);
  const second=createGame({cho:"귀마",han:"원앙마"},true,98765);
  assert.deepEqual(first.draft?.choices,second.draft?.choices);
  assert.equal(first.phase,"DRAFT");
});

test("later augment drafts open after the 10th and 20th full moves", () => {
  for(const [milestone,slot] of [[10,1],[20,2]] as const){
    const state=createGame({cho:"귀마",han:"원앙마"},false,12345+milestone);
    state.augments=true;
    state.turn="han";
    state.ply=milestone*2-1;
    state.fullMove=milestone-1;
    const soldier=state.pieces.find(piece=>piece.side==="han"&&piece.type==="jol"&&piece.x===0)!;
    const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:soldier.id,to:{x:0,y:5}},"han");
    assert.equal(result.accepted,true);
    assert.equal(result.state.fullMove,milestone);
    assert.equal(result.state.phase,"DRAFT");
    assert.equal(result.state.draft?.slot,slot);
    assert.equal(result.state.draft?.side,"cho");
    assert.deepEqual(result.state.draft?.queue,["han"]);
  }
});

test("augment drafts do not open on the former 15th and 30th milestones", () => {
  for(const milestone of [15,30]){
    const state=createGame({cho:"귀마",han:"원앙마"},false);
    state.augments=true;
    state.turn="han";
    state.ply=milestone*2-1;
    state.fullMove=milestone-1;
    const soldier=state.pieces.find(piece=>piece.side==="han"&&piece.type==="jol"&&piece.x===0)!;
    const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:soldier.id,to:{x:0,y:5}},"han");
    assert.equal(result.accepted,true);
    assert.equal(result.state.phase,"ACTION");
    assert.equal(result.state.draft,undefined);
  }
});

test("every card draw requirement has a registered rule", () => {
  const requirements=new Set(cards.map(card=>card.draw));
  for(const requirement of requirements)assert.ok(requirement in DRAW_REQUIREMENT_RULES,requirement);
});

test("Gwang Gungseong extends palace movement and diagonal rays", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const guard:Piece={id:"guard",side:"cho",type:"sa",x:3,y:2};
  state.pieces=[guard];
  assert.equal(has(legalMoves(state,guard.id),2,3),false);
  state.cards.cho=[{cardId:"gwang-gungseong",slot:0,state:"active"}];
  assert.equal(has(legalMoves(state,guard.id),2,3),true);

  const rook:Piece={id:"rook",side:"cho",type:"cha",x:3,y:0};
  state.pieces=[rook];
  assert.equal(has(legalMoves(state,rook.id),6,3),true);
});

test("Seongbyeok and Seongmun always target three connected palace vertices", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const regular=palaceLineTargets(state,"cho");
  assert.equal(regular.length,3);
  assert.equal(regular.every(line=>line.length===3),true);

  state.cards.cho=[{cardId:"seongmun",slot:0,state:"ready"}];
  const regularActivation=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetLine:regular[2]},"cho");
  assert.equal(regularActivation.accepted,true);
  assert.deepEqual(regularActivation.state.palaceStructures,[{cardId:"seongmun",side:"cho",points:regular[2]}]);

  state.cards.cho=[
    {cardId:"gwang-gungseong",slot:0,state:"active"},
    {cardId:"seongbyeok",slot:1,state:"ready"},
  ];
  const expanded=palaceLineTargets(state,"cho");
  assert.equal(expanded.length,10);
  assert.equal(expanded.every(line=>line.length===3),true);
  assert.deepEqual(expanded.slice(0,3),regular);

  const missing=reduceGame(state,{type:"USE_AUGMENT",cardIndex:1},"cho");
  assert.equal(missing.accepted,false);
  assert.equal(missing.error?.code,"INVALID_AUGMENT_TARGET");

  const activated=reduceGame(state,{type:"USE_AUGMENT",cardIndex:1,targetLine:expanded[0]},"cho");
  assert.equal(activated.accepted,true);
  assert.deepEqual(activated.state.palaceStructures,[{cardId:"seongbyeok",side:"cho",points:expanded[0]}]);
  assert.equal(activated.state.cards.cho[1].state,"used");

  const outerState=createGame({cho:"귀마",han:"원앙마"},false);
  outerState.cards.cho=[
    {cardId:"gwang-gungseong",slot:0,state:"active"},
    {cardId:"seongmun",slot:1,state:"ready"},
  ];
  const outerTargets=palaceLineTargets(outerState,"cho");
  const outerActivation=reduceGame(outerState,{type:"USE_AUGMENT",cardIndex:1,targetLine:outerTargets[3]},"cho");
  assert.equal(outerActivation.accepted,true);
  assert.deepEqual(outerActivation.state.palaceStructures,[{cardId:"seongmun",side:"cho",points:outerTargets[3]}]);
});

test("Seongbyeok blocks entry but permits exit while Seongmun admits enemies only through its selected line", () => {
  const wallState=createGame({cho:"귀마",han:"원앙마"},false);
  const insideRook:Piece={id:"inside",side:"cho",type:"cha",x:4,y:1};
  const outsideRook:Piece={id:"outside",side:"han",type:"cha",x:1,y:1};
  wallState.pieces=[insideRook,outsideRook];
  wallState.palaceStructures=[{cardId:"seongbyeok",side:"cho",points:palaceLineTargets(wallState,"cho")[0]}];
  assert.equal(has(legalMoves(wallState,insideRook.id),2,1),true);
  wallState.turn="han";
  assert.equal(has(legalMoves(wallState,outsideRook.id),3,1),false);

  const gateState=createGame({cho:"귀마",han:"원앙마"},false);
  const king:Piece={id:"king",side:"cho",type:"gung",x:4,y:1};
  const throughGate:Piece={id:"through-gate",side:"han",type:"cha",x:1,y:1};
  const throughWall:Piece={id:"through-wall",side:"han",type:"cha",x:4,y:4};
  gateState.pieces=[king,throughGate,throughWall];
  gateState.turn="han";
  gateState.palaceStructures=[{cardId:"seongmun",side:"cho",points:palaceLineTargets(gateState,"cho")[0]}];
  assert.equal(has(legalMoves(gateState,throughGate.id),4,1),true);
  assert.equal(has(legalMoves(gateState,throughWall.id),4,1),false);

  const expandedInnerWall=createGame({cho:"귀마",han:"원앙마"},false);
  expandedInnerWall.cards.cho=[{cardId:"gwang-gungseong",slot:0,state:"active"}];
  const innerWall=palaceLineTargets(expandedInnerWall,"cho")[0];
  const innerDefender:Piece={id:"inner-defender",side:"cho",type:"cha",x:4,y:1};
  const expandedInvader:Piece={id:"expanded-invader",side:"han",type:"cha",x:2,y:1};
  expandedInnerWall.pieces=[innerDefender,expandedInvader];
  expandedInnerWall.palaceStructures=[{cardId:"seongbyeok",side:"cho",points:innerWall}];
  assert.equal(has(legalMoves(expandedInnerWall,innerDefender.id),2,1),true);
  expandedInnerWall.turn="han";
  assert.equal(has(legalMoves(expandedInnerWall,expandedInvader.id),3,1),false);
});

test("Hwacha burns every adjacent enemy soldier after landing", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const fireCart:Piece={id:"fire",side:"cho",type:"po",transformCardId:"hwacha",x:0,y:0};
  const screen:Piece={id:"screen",side:"cho",type:"jol",x:0,y:1};
  const victim:Piece={id:"victim",side:"han",type:"jol",x:1,y:3};
  const diagonal:Piece={id:"diagonal",side:"han",type:"jol",x:1,y:4};
  const nonSoldier:Piece={id:"rook",side:"han",type:"cha",x:0,y:4};
  state.pieces=[fireCart,screen,victim,diagonal,nonSoldier];
  state.cards.cho=[{cardId:"hwacha",slot:0,state:"active",targetPieceId:fireCart.id}];
  fireCart.captureLockedPly=state.ply;
  assert.equal(has(legalMoves(state,fireCart.id),0,3),false);
  fireCart.captureLockedPly=undefined;
  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:fireCart.id,to:{x:0,y:3}},"cho");
  assert.equal(result.accepted,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===victim.id)?.captured,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===diagonal.id)?.captured,undefined);
  assert.equal(result.state.pieces.find(piece=>piece.id===nonSoldier.id)?.captured,undefined);
});

test("Bangbyeok requires and uses the selected empty intersection", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  state.cards.cho=[{cardId:"bangbyeok",slot:0,state:"ready"}];
  const missing=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0},"cho");
  assert.equal(missing.accepted,false);
  assert.equal(missing.error?.code,"INVALID_AUGMENT_TARGET");

  const occupied=state.pieces.find(piece=>!piece.captured)!;
  const rejected=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetSquare:{x:occupied.x,y:occupied.y}},"cho");
  assert.equal(rejected.accepted,false);

  const placed=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetSquare:{x:4,y:4}},"cho");
  assert.equal(placed.accepted,true);
  assert.deepEqual(placed.state.walls,[{x:4,y:4,remaining:6}]);
  assert.equal(placed.state.cards.cho[0].state,"used");
});

test("Yeokmacha lets a soldier board a horse, ride with horse movement, and dismount", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  const horse:Piece={id:"horse",side:"cho",type:"ma",x:5,y:4};
  const soldier:Piece={id:"soldier",side:"cho",type:"jol",x:4,y:4};
  state.pieces=[horse,soldier];
  state.cards.cho=[{cardId:"yeokmacha",slot:0,state:"active"}];
  assert.equal(has(legalMoves(state,soldier.id),5,4),true);
  assert.equal(has(legalMoves(state,horse.id),4,4),false);
  state=reduceGame(state,{type:"MOVE_PIECE",pieceId:soldier.id,to:{x:5,y:4}},"cho").state;
  assert.equal(state.pieces.find(piece=>piece.id===soldier.id)?.carriedBy,horse.id);

  state.turn="cho";
  state=reduceGame(state,{type:"MOVE_PIECE",pieceId:horse.id,to:{x:6,y:6}},"cho").state;
  assert.deepEqual(state.pieces.filter(piece=>piece.id===horse.id||piece.id===soldier.id).map(piece=>[piece.x,piece.y]),[[6,6],[6,6]]);

  state.turn="cho";
  assert.equal(has(legalMoves(state,soldier.id),6,7),true);
  state=reduceGame(state,{type:"MOVE_PIECE",pieceId:soldier.id,to:{x:6,y:7}},"cho").state;
  assert.equal(state.pieces.find(piece=>piece.id===soldier.id)?.carriedBy,undefined);
  assert.deepEqual({x:state.pieces.find(piece=>piece.id===horse.id)!.x,y:state.pieces.find(piece=>piece.id===horse.id)!.y},{x:6,y:6});

  const host:Piece={id:"host",side:"cho",type:"ma",x:5,y:7};
  const mountedSoldier:Piece={id:"mounted",side:"cho",type:"jol",x:5,y:7,carriedBy:host.id};
  const enemyRook:Piece={id:"enemy-rook",side:"han",type:"cha",x:5,y:9};
  const captureState={...createGame({cho:"귀마",han:"원앙마"},false),turn:"han" as const,pieces:[host,mountedSoldier,enemyRook],cards:{cho:[{cardId:"yeokmacha",slot:0 as const,state:"active" as const}],han:[]}};
  const captured=reduceGame(captureState,{type:"MOVE_PIECE",pieceId:enemyRook.id,to:{x:5,y:7}},"han");
  assert.equal(captured.accepted,true);
  assert.equal(captured.state.pieces.find(piece=>piece.id===host.id)?.captured,true);
  assert.equal(captured.state.pieces.find(piece=>piece.id===mountedSoldier.id)?.captured,true);
});

test("Gaebyeong stays passive until a soldier captures an eligible piece", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const soldier:Piece={id:"soldier",side:"cho",type:"jol",x:4,y:4};
  const horse:Piece={id:"horse",side:"han",type:"ma",x:4,y:5};
  state.pieces=[soldier,horse];
  state.cards.cho=[{cardId:"gaebyeong",slot:0,state:"active"}];
  assert.equal(cards.find(card=>card.id==="gaebyeong")?.activation,"PASSIVE");
  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:soldier.id,to:{x:4,y:5}},"cho");
  assert.equal(result.accepted,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===soldier.id)?.type,"ma");
  assert.equal(result.state.cards.cho[0].state,"used");
});

test("Hamjeong installs on a selected empty palace point and captures the first enemy entrant", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  state.cards.cho=[{cardId:"hamjeong",slot:0,state:"ready"}];
  assert.equal(has(trapTargets(state,"cho"),4,0),true);
  const missing=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0},"cho");
  assert.equal(missing.accepted,false);
  state=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetSquare:{x:4,y:0}},"cho").state;
  assert.deepEqual(state.traps,[{x:4,y:0,side:"cho"}]);
  const invader:Piece={id:"invader",side:"han",type:"cha",x:4,y:3};
  state={...state,turn:"han",pieces:[invader]};
  const triggered=reduceGame(state,{type:"MOVE_PIECE",pieceId:invader.id,to:{x:4,y:0}},"han");
  assert.equal(triggered.accepted,true);
  assert.equal(triggered.state.pieces.find(piece=>piece.id===invader.id)?.captured,true);
  assert.deepEqual(triggered.state.traps,[]);
});

test("Maesu changes only the selected adjacent enemy soldier to the user's side", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const own:Piece={id:"own",side:"cho",type:"jol",x:4,y:4};
  const target:Piece={id:"target",side:"han",type:"jol",x:5,y:4};
  const other:Piece={id:"other",side:"han",type:"jol",x:8,y:8};
  state.pieces=[own,target,other];
  state.cards.cho=[{cardId:"maesu",slot:0,state:"ready"}];
  assert.equal(reduceGame(state,{type:"USE_AUGMENT",cardIndex:0},"cho").accepted,false);
  const result=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetPieceId:target.id},"cho");
  assert.equal(result.accepted,true);
  assert.equal(result.state.pieces.find(piece=>piece.id===target.id)?.side,"cho");
  assert.equal(result.state.pieces.find(piece=>piece.id===other.id)?.side,"han");
});

test("Myosupuri records three moves, enforces them in order, and becomes used after the third", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  const rook:Piece={id:"rook",side:"cho",type:"cha",x:0,y:0};
  state.pieces=[rook];
  state.cards.cho=[{cardId:"myosupuri",slot:0,state:"ready"}];
  const plan=[{x:0,y:1},{x:0,y:2},{x:0,y:3}];
  state=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetPieceId:rook.id,targetSquares:plan},"cho").state;
  assert.equal(state.cards.cho[0].state,"active");
  assert.deepEqual(legalMoves(state,rook.id),[plan[0]]);
  for(const square of plan)state=reduceGame({...state,turn:"cho"},{type:"MOVE_PIECE",pieceId:rook.id,to:square},"cho").state;
  assert.equal(state.cards.cho[0].state,"used");
  assert.equal(state.myosupuriPlans.cho,undefined);
});

test("Myosupuri ends in place when an opponent breaks the next planned path", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  const rook:Piece={id:"rook",side:"cho",type:"cha",x:0,y:0};
  const blocker:Piece={id:"blocker",side:"han",type:"jol",x:1,y:2};
  state.pieces=[rook,blocker];
  state.cards.cho=[{cardId:"myosupuri",slot:0,state:"ready"}];
  const plan=[{x:0,y:1},{x:0,y:3},{x:0,y:4}];
  state=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetPieceId:rook.id,targetSquares:plan},"cho").state;
  state=reduceGame(state,{type:"MOVE_PIECE",pieceId:rook.id,to:plan[0]},"cho").state;
  state=reduceGame(state,{type:"MOVE_PIECE",pieceId:blocker.id,to:{x:0,y:2}},"han").state;
  assert.equal(state.turn,"cho");
  assert.equal(state.cards.cho[0].state,"used");
  assert.equal(state.myosupuriPlans.cho,undefined);
  assert.deepEqual({x:state.pieces.find(piece=>piece.id===rook.id)!.x,y:state.pieces.find(piece=>piece.id===rook.id)!.y},{x:0,y:1});
});

test("Hunsukkun stores a selected piece and deploys it later by consuming a turn", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  const horse=state.pieces.find(piece=>piece.side==="cho"&&piece.type==="ma")!;
  state.cards.cho=[{cardId:"hunsukkun",slot:0,state:"ready"}];
  state=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetPieceId:horse.id},"cho").state;
  assert.equal(state.pieces.some(piece=>piece.id===horse.id),false);
  assert.equal(state.waitingPieces.cho[0].id,horse.id);
  assert.equal(reduceGame(state,{type:"DEPLOY_HUNSUKKUN_RESERVE",reservePieceId:horse.id,to:{x:4,y:0}},"cho").accepted,false);
  state={...state,ply:state.ply+2,turn:"cho"};
  assert.equal(has(hunsukkunDropTargets(state,"cho"),4,0),true);
  const deployed=reduceGame(state,{type:"DEPLOY_HUNSUKKUN_RESERVE",reservePieceId:horse.id,to:{x:4,y:0}},"cho");
  assert.equal(deployed.accepted,true);
  assert.equal(deployed.state.waitingPieces.cho.length,0);
  assert.equal(deployed.state.pieces.find(piece=>piece.id===horse.id)?.x,4);
  assert.equal(deployed.state.turn,"han");
});

test("Amhaeng-eosa waits for a selected soldier and wins on the enemy back rank", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  const soldier:Piece={id:"agent",side:"cho",type:"jol",x:4,y:8};
  state.pieces=[soldier];
  state.cards.cho=[{cardId:"amhaeng-eosa",slot:0,state:"ready"}];
  assert.equal(reduceGame(state,{type:"USE_AUGMENT",cardIndex:0},"cho").accepted,false);
  state=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0,targetPieceId:soldier.id},"cho").state;
  assert.equal(state.cards.cho[0].state,"active");
  const won=reduceGame(state,{type:"MOVE_PIECE",pieceId:soldier.id,to:{x:4,y:9}},"cho");
  assert.equal(won.state.winner,"cho");
  assert.equal(won.state.endReason,"special_victory");
});

test("Powi converts a surrounded enemy, changes soldier allegiance, and wins by surrounding the king", () => {
  const makeState=(type:Piece["type"])=>{
    const state=createGame({cho:"귀마",han:"원앙마"},false);
    state.pieces=[
      {id:"left",side:"cho",type:"jol",x:3,y:4},
      {id:"right",side:"cho",type:"jol",x:5,y:4},
      {id:"mover",side:"cho",type:"jol",x:4,y:2},
      {id:"target",side:"han",type,x:4,y:4},
    ];
    state.cards.cho=[{cardId:"powi",slot:0,state:"active"}];
    return state;
  };
  const converted=reduceGame(makeState("jol"),{type:"MOVE_PIECE",pieceId:"mover",to:{x:4,y:3}},"cho");
  assert.equal(converted.state.pieces.find(piece=>piece.id==="target")?.side,"cho");
  const won=reduceGame(makeState("gung"),{type:"MOVE_PIECE",pieceId:"mover",to:{x:4,y:3}},"cho");
  assert.equal(won.state.winner,"cho");
  assert.equal(won.state.endReason,"special_victory");
});

test("Oksae returns a captured enemy in the captor's color inside the captor's palace", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const king:Piece={id:"king",side:"cho",type:"gung",x:4,y:1};
  const enemy:Piece={id:"enemy",side:"han",type:"ma",x:4,y:2};
  state.pieces=[king,enemy];
  state.cards.cho=[{cardId:"oksae",slot:0,state:"active"}];
  const result=reduceGame(state,{type:"MOVE_PIECE",pieceId:king.id,to:{x:4,y:2}},"cho");
  assert.equal(result.accepted,true);
  const converted=result.state.pieces.find(piece=>piece.id===enemy.id)!;
  assert.equal(converted.side,"cho");
  assert.equal(converted.captured,false);
  assert.equal(converted.type,"ma");
  assert.equal(converted.x>=3&&converted.x<=5&&converted.y>=0&&converted.y<=2,true);
});

test("Dogang permits movement inside enemy territory but never lets a piece cross the river back", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},false);
  const rook:Piece={id:"rook",side:"cho",type:"cha",x:4,y:5};
  state.pieces=[rook];
  state.cards.cho=[{cardId:"dogang",slot:0,state:"active"}];
  assert.equal(has(legalMoves(state,rook.id),3,5),true);
  assert.equal(has(legalMoves(state,rook.id),4,6),true);
  assert.equal(has(legalMoves(state,rook.id),4,4),false);
  assert.equal(cards.find(card=>card.id==="dogang")?.cost,3.5);
});

test("finite restrictions remain active with a countdown and receive the used state on expiry", () => {
  let state=createGame({cho:"귀마",han:"원앙마"},false);
  const rook:Piece={id:"rook",side:"han",type:"cha",x:0,y:9};
  state.pieces=[rook];
  state.cards.cho=[{cardId:"gyeolgak",slot:0,state:"ready"}];
  state=reduceGame(state,{type:"USE_AUGMENT",cardIndex:0},"cho").state;
  assert.equal(state.cards.cho[0].state,"active");
  assert.equal(restrictionTurnsRemaining(state,"gyeolgak"),4);
  for(let index=0;index<4;index++){
    const to=index%2?{x:0,y:9}:{x:0,y:8};
    state=reduceGame({...state,turn:"han"},{type:"MOVE_PIECE",pieceId:rook.id,to},"han").state;
  }
  assert.equal(restrictionTurnsRemaining(state,"gyeolgak"),undefined);
  assert.equal(state.cards.cho[0].state,"used");
});

test("player projection removes hidden enemy pieces and private draft choices", () => {
  const state=createGame({cho:"귀마",han:"원앙마"},true,42);
  state.jeokgi=[{x:4,y:3,side:"cho"}];
  const enemy=state.pieces.find(piece=>piece.side==="han"&&piece.type==="jol")!;
  enemy.hidden=true;
  const hanView=projectGameView({...state,draft:{...state.draft!,side:"cho"}},"han");
  assert.equal(hanView.pieces.some(piece=>piece.id===enemy.id),true);
  assert.equal(hanView.draft,undefined);
  const choView=projectGameView(state,"cho");
  assert.equal(choView.pieces.some(piece=>piece.id===enemy.id),false);
  assert.deepEqual(choView.draft?.choices,state.draft?.choices);
  assert.deepEqual(choView.jeokgi,state.jeokgi);
  assert.notEqual(choView.jeokgi,state.jeokgi);
  assert.deepEqual(choView.clocks,state.clocks);
  assert.notEqual(choView.clocks,state.clocks);
  assert.equal(choView.draftClockMs,state.draftClockMs);
});

test("legacy Yeokmacha saves invert the old horse-on-soldier mount", () => {
  const legacy=createGame({cho:"귀마",han:"원앙마"},false);
  const soldier:Piece={id:"soldier",side:"cho",type:"jol",x:4,y:4};
  const horse:Piece={id:"horse",side:"cho",type:"ma",x:4,y:4,carriedBy:soldier.id};
  legacy.pieces=[soldier,horse];
  legacy.cards.cho=[{cardId:"yeokmacha",slot:0,state:"active"}];
  const migrated=migrateGameState({...legacy,rulesetVersion:"augment-janggi-pilot-v6"} as typeof legacy);
  assert.equal(migrated.pieces.find(piece=>piece.id===horse.id)?.carriedBy,undefined);
  assert.equal(migrated.pieces.find(piece=>piece.id===soldier.id)?.carriedBy,horse.id);
});

test("legacy four-vertex palace structures migrate to three connected vertices", () => {
  const legacy=createGame({cho:"귀마",han:"원앙마"},false);
  legacy.palaceStructures=[{cardId:"seongbyeok",side:"cho",points:[{x:2,y:0},{x:2,y:1},{x:2,y:2},{x:2,y:3}]}];
  const migrated=migrateGameState({...legacy,rulesetVersion:"augment-janggi-pilot-v9"} as typeof legacy);
  assert.deepEqual(migrated.palaceStructures[0].points,[{x:2,y:0},{x:2,y:1},{x:2,y:2}]);
});

test("legacy local saves receive current schema metadata", () => {
  const current=createGame({cho:"귀마",han:"원앙마"},false);
  current.cards.cho=[{cardId:"hangu",slot:0,state:"active"}];
  const legacy={...current} as Partial<typeof current>;
  delete legacy.schemaVersion;
  delete legacy.rulesetVersion;
  delete legacy.revision;
  delete legacy.eventSequence;
  delete legacy.rngSeed;
  delete legacy.phase;
  delete legacy.jeokgi;
  delete legacy.traps;
  delete legacy.palaceStructures;
  delete legacy.waitingPieces;
  delete legacy.myosupuriPlans;
  delete legacy.clocks;
  delete legacy.draftClockMs;
  const migrated=migrateGameState(legacy as typeof current);
  assert.equal(migrated.schemaVersion,6);
  assert.equal(migrated.rulesetVersion,"augment-janggi-pilot-v13");
  assert.equal(migrated.phase,"ACTION");
  assert.deepEqual(migrated.jeokgi,[]);
  assert.deepEqual(migrated.palaceStructures,[]);
  assert.deepEqual(migrated.traps,[]);
  assert.deepEqual(migrated.waitingPieces,{cho:[],han:[]});
  assert.deepEqual(migrated.myosupuriPlans,{});
  assert.deepEqual(migrated.clocks,{cho:INITIAL_CLOCK_MS,han:INITIAL_CLOCK_MS});
  assert.equal(migrated.draftClockMs,DRAFT_CLOCK_MS);
  assert.equal(migrated.testMode,false);
  assert.equal(migrated.pieces.find(piece=>piece.side==="cho"&&piece.type==="gung")?.transformCardId,"hangu");
});
