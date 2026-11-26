import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase, ref, set, get, update, onValue, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

/* 1) Sustituye estos valores por los de tu proyecto Firebase. */
const firebaseConfig = {
  apiKey: "AIzaSyC48h7Rq6jvmstNtuKRJaaYL1CpvtLD8iQ",
  authDomain: "rummy-club-online-b1715.firebaseapp.com",
  databaseURL: "https://rummy-club-online-b1715-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "rummy-club-online-b1715",
  storageBucket: "rummy-club-online-b1715.firebasestorage.app",
  messagingSenderId: "988547819259",
  appId: "1:988547819259:web:f4ada700b2ab3b73e4b25e",
  measurementId: "G-WTKKPKWB8T"
};

const $ = id => document.getElementById(id);
const SUITS = ["♠","♥","♦","♣"], RANKS=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUIT_NAMES={"♠":"picas","♥":"corazones","♦":"diamantes","♣":"tréboles"};
let app,auth,db,uid=null,roomId=null,roomData=null,unsubscribe=null,selected=new Set(),busy=false;
const TURN_SECONDS=40;
let timeoutBusy=false,draggedCardId=null,lastDragAt=0;
const cfgMissing = firebaseConfig.apiKey.startsWith("PEGA_") || firebaseConfig.projectId==="TU-PROYECTO";
function msg(id,s){$(id).textContent=s||""}
function show(section){["home","lobby","game"].forEach(x=>$(x).classList.toggle("hidden",x!==section))}
function cleanName(s){return (s||"").trim().slice(0,18)}
function code(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function cardPoints(c){return c.rank==="A"||["J","Q","K"].includes(c.rank)?10:Number(c.rank)}
function cardText(c){return c.rank+c.suit}
function cardHtml(c,clickable=false,sel=false,draggable=false,valid=false){
 const red=c.suit==="♥"||c.suit==="♦";
 const classes=["card",red?"red":"",sel?"selected":"",valid?"hint-valid":""].filter(Boolean).join(" ");
 const attrs=clickable?`data-card="${c.id}"`:"";
 return `<div class="${classes}" ${attrs} ${draggable?'draggable="true"':''} ${valid?'title="Pertenece a una combinación válida"':''}><span class="corner">${c.rank}</span><span class="suit">${c.suit}</span><span class="corner">${c.rank}</span></div>`;
}
function deck(){let a=[];for(let d=0;d<2;d++)for(const suit of SUITS)for(const rank of RANKS)a.push({id:`${d}${suit}${rank}`,suit,rank});return shuffle(a)}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function validSet(cards){
 if(cards.length===3||cards.length===4){
  const same=cards.every(c=>c.rank===cards[0].rank);
  const distinct=new Set(cards.map(c=>c.suit)).size===cards.length;
  if(same&&distinct)return {type:cards.length===3?"Trío":"Cuarteto",points:cards.reduce((sum,c)=>sum+cardPoints(c),0)};
 }
 if(cards.length>=3){
  const suit=cards[0].suit;
  if(cards.every(c=>c.suit===suit)){
   const rankValue={A:1,J:11,Q:12,K:13};
   const values=cards.map(c=>rankValue[c.rank]??Number(c.rank)).sort((a,b)=>a-b);
   const consecutive=arr=>arr.every((v,i)=>i===0||v===arr[i-1]+1);
   if(consecutive(values))return {type:"Escalera",points:cards.reduce((sum,c)=>sum+cardPoints(c),0)};
   const highValues=cards.map(c=>c.rank==="A"?14:(rankValue[c.rank]??Number(c.rank))).sort((a,b)=>a-b);
   if(consecutive(highValues))return {type:"Escalera",points:cards.reduce((sum,c)=>sum+cardPoints(c),0)};
  }
 }
 return null;
}
function findValidCombinations(hand){
 const found=[];
 for(let size=3;size<=hand.length;size++){
  const picked=[];
  function visit(start){
   if(picked.length===size){
    const valid=validSet(picked);
    if(valid)found.push({ids:picked.map(c=>c.id),type:valid.type});
    return;
   }
   const needed=size-picked.length;
   for(let i=start;i<=hand.length-needed;i++){
    picked.push(hand[i]);visit(i+1);picked.pop();
   }
  }
  visit(0);
 }
 return found;
}
function selectedCards(){const hand=roomData?.hands?.[uid]||[];return hand.filter(c=>selected.has(c.id))}
async function init(){
 if(cfgMissing){$("connection").textContent="Configura Firebase";msg("homeMsg","Antes de jugar, configura Firebase siguiendo README.md.");return}
 try{app=initializeApp(firebaseConfig);auth=getAuth(app);db=getDatabase(app);await signInAnonymously(auth);onAuthStateChanged(auth,u=>{if(u){uid=u.uid;$("connection").textContent="Conectado"}})}catch(e){$("connection").textContent="Error de conexión";msg("homeMsg",friendly(e))}
}
function friendly(e){return e?.message||"Ha ocurrido un error."}
async function createRoom(){
 if(!uid)return msg("homeMsg","Espera a que Firebase conecte.");
 const name=cleanName($("playerName").value);if(!name)return msg("homeMsg","Escribe tu nombre.");
 const id=code(),player={name,joinedAt:Date.now(),host:true};
 try{await set(ref(db,`rooms/${id}`),{code:id,status:"lobby",host:uid,createdAt:serverTimestamp(),players:{[uid]:player},scores:{[uid]:0},round:0});enterRoom(id)}catch(e){msg("homeMsg",friendly(e))}
}
async function joinRoom(){
 if(!uid)return msg("homeMsg","Espera a que Firebase conecte.");
 const name=cleanName($("playerName").value),id=$("roomInput").value.trim().toUpperCase();if(!name||!id)return msg("homeMsg","Escribe tu nombre y el código.");
 try{const r=ref(db,`rooms/${id}`);const snap=await get(r);if(!snap.exists())throw Error("No existe esa sala.");const data=snap.val();if(data.status!=="lobby")throw Error("La partida ya ha comenzado.");if(Object.keys(data.players||{}).length>=4)throw Error("La sala está completa (máximo 4).");await update(r,{[`players/${uid}`]:{name,joinedAt:Date.now(),host:false},[`scores/${uid}`]:0});enterRoom(id)}catch(e){msg("homeMsg",friendly(e))}
}
function enterRoom(id){roomId=id;if(unsubscribe)unsubscribe();unsubscribe=onValue(ref(db,`rooms/${id}`),s=>{if(!s.exists()){msg("lobbyMsg","La sala ya no existe.");show("home");return}roomData=s.val();render()});}
function render(){
 if(!roomData)return;
 $("roomCode").textContent=roomId;$("gameRoomCode").textContent=roomId;
 const players=Object.entries(roomData.players||{});const mine=players.find(([id])=>id===uid);
 if(!mine){show("home");return}
 if(roomData.status==="lobby"){
 show("lobby");$("players").innerHTML=players.map(([id,p])=>`<div class="playerrow"><span>${escapeHtml(p.name)} ${id===roomData.host?"♛":""}</span><small>${id===uid?"Tú":"Conectado"}</small></div>`).join("");
 $("startBtn").disabled=uid!==roomData.host||players.length<2;$("startBtn").textContent=players.length<2?"Esperando al menos 2 jugadores": "Iniciar partida";return;
 }
 show("game");renderGame();
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function startGame(){
 if(uid!==roomData.host||Object.keys(roomData.players||{}).length<2)return;
 const ids=Object.keys(roomData.players),cards=deck(),hands={};ids.forEach(id=>hands[id]=cards.splice(0,14));
 const state={status:"playing",round:(roomData.round||0)+1,deck:cards,discard:[],hands,melds:[],opened:{},openingOrder:[],turn:ids[0],turnIndex:0,drawn:false,turnStartedAt:Date.now(),lastAction:"Partida iniciada"};
 await update(ref(db,`rooms/${roomId}`),state);
}
function renderGame(){
 const ids=Object.keys(roomData.players||{}),myHand=roomData.hands?.[uid]||[],myTurn=roomData.turn===uid,opened=!!roomData.opened?.[uid],playing=roomData.status==="playing";
 $("turnText").textContent=myTurn?"Es tu turno":`Turno de ${roomData.players?.[roomData.turn]?.name||"otro jugador"}`;
 const remaining=Math.max(0,TURN_SECONDS-Math.floor((Date.now()-(roomData.turnStartedAt||Date.now()))/1000));
 const timerEl=$("turnTimer"); if(timerEl){timerEl.textContent=`${remaining}s`;timerEl.classList.toggle("urgent",remaining<=10);}
 $("scoreline").innerHTML=ids.map(id=>`<span class="scoreitem">${escapeHtml(roomData.players[id].name)} <b>${roomData.scores?.[id]||0}</b></span>`).join("");
 $("opponents").innerHTML=ids.filter(id=>id!==uid).map(id=>`<div class="opponent ${roomData.turn===id?"active":""}">${escapeHtml(roomData.players[id].name)} · ${(roomData.hands?.[id]||[]).length} cartas</div>`).join("");
 $("deckCount").textContent=`${roomData.deck?.length||0} cartas`;$("discardCount").textContent=`${roomData.discard?.length||0} cartas`;
 const top=roomData.discard?.at(-1);$("drawDiscard").innerHTML=top?cardHtml(top):"—";
 $("drawDeck").disabled=!playing||!myTurn||roomData.drawn||!(roomData.deck||[]).length;
 $("drawDiscard").disabled=!playing||!myTurn||roomData.drawn||!opened||!(roomData.discard||[]).length;
 $("handCount").textContent=`${myHand.length} cartas`;$("phaseText").textContent=myTurn?(roomData.drawn?"Puedes jugar y descartar":"Debes robar una carta"):"Esperando turno";
 const combinations=findValidCombinations(myHand);
 const validCardIds=new Set(combinations.flatMap(combo=>combo.ids));
 $("hand").innerHTML=myHand.map(c=>cardHtml(c,true,selected.has(c.id),true,validCardIds.has(c.id))).join("");
 const comboCounts=combinations.reduce((acc,combo)=>{acc[combo.type]=(acc[combo.type]||0)+1;return acc;},{});
 const comboSummary=Object.entries(comboCounts).map(([type,count])=>`${count} ${type.toLowerCase()}${count===1?"":"s"}`).join(" · ");
 $("combinationHints").innerHTML=combinations.length
  ? `<span class="hint-check">✓</span> ${combinations.length} combinaciones posibles: ${escapeHtml(comboSummary)}. Las cartas marcadas en verde participan en al menos una.`
  : `No hay combinaciones válidas en tu mano. Arrastra las cartas para ordenarlas.`;
 $("melds").innerHTML=(roomData.melds||[]).map((m,i)=>`<div class="meld" data-meld="${i}" title="Arrastra aquí una carta para añadirla"><small>${escapeHtml(roomData.players[m.owner]?.name||"Jugador")}</small>${m.cards.map(c=>cardHtml(c)).join("")}</div>`).join("");
 $("openBtn").disabled=!playing||!myTurn||!roomData.drawn;$("addBtn").disabled=!playing||!myTurn||!roomData.drawn||!opened;
 $("discardBtn").disabled=!playing||!myTurn||!roomData.drawn||myHand.length===1;
 const winBtn=$("winBtn");
 if(winBtn){winBtn.classList.toggle("hidden",!playing||!myTurn||!roomData.drawn||myHand.length!==1);winBtn.disabled=!playing||!myTurn||!roomData.drawn||myHand.length!==1;}
 const scoreboard=$("scoreboard");
 if(scoreboard){
  const ended=roomData.status==="roundEnd"||roomData.status==="finished";
  scoreboard.classList.toggle("hidden",!ended);
  if(ended){
   const winner=roomData.players?.[roomData.roundWinner]?.name||"Jugador";
   const rows=ids.map(id=>`<tr class="${id===roomData.roundWinner?"winner-row":""}"><td>${escapeHtml(roomData.players[id].name)}${id===roomData.roundWinner?" 🏆":""}</td><td>${roomData.roundBreakdown?.[id]??0}</td><td><strong>${roomData.scores?.[id]||0}</strong></td></tr>`).join("");
   scoreboard.innerHTML=`<div class="eyebrow">${roomData.status==="finished"?"PARTIDA TERMINADA":"FIN DE RONDA"}</div><h2>${roomData.status==="finished"?"¡Victoria de "+escapeHtml(winner)+"!":"¡"+escapeHtml(winner)+" gana la ronda!"}</h2><p class="muted">${escapeHtml(winner)} suma <strong>${roomData.roundPoints||0} puntos</strong> por las cartas que quedan en las manos de los demás.</p><div class="scoreboard-scroll"><table><thead><tr><th>Jugador</th><th>Puntos en mano</th><th>Marcador total</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
 }
 msg("gameMsg",roomData.status==="finished"?`${roomData.lastAction} ¡Partida terminada!`:roomData.status==="roundEnd"?`${roomData.lastAction} Puedes iniciar la siguiente ronda.`:(roomData.lastAction||""));
}
async function mutate(fn){
 if(busy)return;busy=true;
 try{const r=ref(db,`rooms/${roomId}`);const result=await runTransaction(r,room=>{if(!room||room.status!=="playing"||room.turn!==uid)return;const ok=fn(room);if(ok===false)return;return room});if(!result.committed)throw Error("Movimiento no válido o ya no es tu turno.");selected.clear()}catch(e){msg("gameMsg",friendly(e))}finally{busy=false}
}
async function draw(which){
 await mutate(r=>{if(r.drawn)return false;if(which==="discard"){if(!r.opened?.[uid]||!r.discard?.length)return false;r.hands[uid].push(r.discard.pop())}else{if(!r.deck?.length)return false;r.hands[uid].push(r.deck.pop())}r.drawn=true;r.lastAction=`${r.players[uid].name} ha robado una carta.`});
}
function finishRound(r,winnerId){
 const ids=Object.keys(r.players||{});let earned=0;const breakdown={};
 for(const id of ids){
  const points=(r.hands?.[id]||[]).reduce((sum,c)=>sum+cardPoints(c),0);
  breakdown[id]=points;
  if(id!==winnerId)earned+=points;
 }
 r.scores=r.scores||{};r.scores[winnerId]=(r.scores[winnerId]||0)+earned;
 r.roundWinner=winnerId;r.roundPoints=earned;r.roundBreakdown=breakdown;
 r.status=r.scores[winnerId]>=100?"finished":"roundEnd";
 r.lastAction=`${r.players?.[winnerId]?.name||"Un jugador"} gana la ronda y suma ${earned} puntos. Marcador: ${r.scores[winnerId]}.`;
}
async function openMeld(){
 const cards=selectedCards();if(!cards.length)return msg("gameMsg","Selecciona una combinación para bajarla.");
 await mutate(r=>{
  if(!r.drawn)return false;
  const valid=validSet(cards);
  if(!valid){msg("gameMsg","La selección no forma una combinación válida. Selecciona un trío, cuarteto o escalera.");return false}
  const ids=new Set(cards.map(c=>c.id));
  r.hands[uid]=r.hands[uid].filter(c=>!ids.has(c.id));
  r.melds=r.melds||[];r.melds.push({owner:uid,cards,type:valid.type});
  r.opened=r.opened||{};r.opened[uid]=true;
  r.lastAction=`${r.players[uid].name} ha bajado una combinación (${valid.type}).`;
  if(r.hands[uid].length===0)finishRound(r,uid);
 });
}
async function addMeld(){
 const cards=selectedCards();if(!cards.length)return msg("gameMsg","Selecciona cartas para añadir.");
 await mutate(r=>{if(!r.opened?.[uid]||!r.drawn)return false;let hand=r.hands[uid];for(const c of cards){let found=false;for(const m of r.melds){const candidate=[...m.cards,c],v=validSet(candidate);if(v){m.cards=candidate;m.type=v.type;hand=hand.filter(x=>x.id!==c.id);found=true;break}}if(!found)return false}r.hands[uid]=hand;r.lastAction=`${r.players[uid].name} ha añadido ${cards.length} carta(s).`;if(hand.length===0)finishRound(r,uid)});
}
async function addCardToMeld(cardId,meldIndex){
 if(!cardId)return;
 await mutate(r=>{
  if(!r.opened?.[uid]||!r.drawn)return false;
  const hand=r.hands?.[uid]||[],card=hand.find(c=>c.id===cardId),meld=r.melds?.[meldIndex];
  if(!card||!meld)return false;
  const candidate=[...meld.cards,card],valid=validSet(candidate);
  if(!valid){msg("gameMsg","Esa carta no encaja en esa combinación.");return false}
  meld.cards=candidate;meld.type=valid.type;
  r.hands[uid]=hand.filter(c=>c.id!==cardId);
  r.lastAction=`${r.players[uid].name} ha añadido ${cardText(card)} a una combinación de ${r.players[meld.owner]?.name||"un jugador"}.`;
  if(r.hands[uid].length===0)finishRound(r,uid);
 });
}

async function claimWin(){
 await mutate(r=>{
  const hand=r.hands?.[uid]||[];
  if(!r.drawn||hand.length!==1)return false;
  finishRound(r,uid);
  return true;
 });
}

async function discard(){
 const cards=selectedCards();if(cards.length!==1)return msg("gameMsg","Selecciona exactamente una carta para descartar.");
 await mutate(r=>{if(!r.drawn||(r.hands?.[uid]||[]).length===1)return false;const hand=r.hands[uid],idx=hand.findIndex(c=>c.id===cards[0].id);if(idx<0)return false;const [c]=hand.splice(idx,1);r.discard.push(c);
 // Turn advances; rule about hand-size/end-of-turn is kept as stated by the user for later confirmation.
 if(hand.length===0){finishRound(r,uid);return;}const ids=Object.keys(r.players),i=ids.indexOf(uid),next=ids[(i+1)%ids.length];r.turn=next;r.drawn=false;r.turnStartedAt=Date.now();r.lastAction=`${r.players[uid].name} ha descartado ${cardText(c)}.`;});
}
async function reorderHand(sourceId,targetId){
 if(!sourceId||!targetId||sourceId===targetId||!roomId||!uid)return;
 try{
  const result=await runTransaction(ref(db,`rooms/${roomId}`),room=>{
   if(!room||room.status!=="playing"||!room.players?.[uid]||!room.hands?.[uid])return;
   const hand=room.hands[uid];
   const from=hand.findIndex(c=>c.id===sourceId),to=hand.findIndex(c=>c.id===targetId);
   if(from<0||to<0)return;
   const [card]=hand.splice(from,1);
   hand.splice(from<to?to-1:to,0,card);
   return room;
  });
  if(!result.committed)throw Error("No se ha podido cambiar el orden de las cartas.");
 }catch(e){msg("gameMsg",friendly(e))}
}

async function enforceTurnTimeout(){
 if(!db||!roomId||!roomData||roomData.status!=="playing"||timeoutBusy)return;
 const started=Number(roomData.turnStartedAt||0);
 if(!started||Date.now()-started<TURN_SECONDS*1000)return;
 timeoutBusy=true;
 try{
  await runTransaction(ref(db,`rooms/${roomId}`),r=>{
   if(!r||r.status!=="playing"||!r.turnStartedAt||Date.now()-r.turnStartedAt<TURN_SECONDS*1000)return;
   const expiredId=r.turn, playerName=r.players?.[expiredId]?.name||"El jugador";
   if(r.drawn){
    const hand=r.hands?.[expiredId]||[];
    if(hand.length){const randomIndex=Math.floor(Math.random()*hand.length);const [removed]=hand.splice(randomIndex,1);r.discard=r.discard||[];r.discard.push(removed);}
    r.lastAction=`Tiempo agotado: ${playerName} había robado; se descartó una carta aleatoria.`;
   }else{
    r.lastAction=`Tiempo agotado: ${playerName} no había robado y pierde el turno.`;
   }
   const ids=Object.keys(r.players||{});if(!ids.length)return;
   const index=ids.indexOf(expiredId);r.turn=ids[(index+1+ids.length)%ids.length];r.drawn=false;r.turnStartedAt=Date.now();
   return r;
  });
 }catch(e){console.error("No se pudo aplicar el timeout",e)}finally{timeoutBusy=false}
}
setInterval(()=>{
 if(roomData?.status==="playing"){
  const left=Math.max(0,TURN_SECONDS-Math.floor((Date.now()-(roomData.turnStartedAt||Date.now()))/1000));
  const el=$("turnTimer");if(el){el.textContent=`${left}s`;el.classList.toggle("urgent",left<=10)}
 }
 enforceTurnTimeout();
},250);

async function newRound(){
 if(uid!==roomData.host||roomData.status==="finished")return;
 const ids=Object.keys(roomData.players),cards=deck(),hands={};ids.forEach(id=>hands[id]=cards.splice(0,14));
 await update(ref(db,`rooms/${roomId}`),{status:"playing",round:(roomData.round||0)+1,deck:cards,discard:[],hands,melds:[],opened:{},openingOrder:[],roundWinner:null,roundPoints:0,roundBreakdown:{},turn:ids[0],drawn:false,turnStartedAt:Date.now(),lastAction:"Nueva ronda"});
}
async function leave(){if(unsubscribe)unsubscribe();try{if(roomId&&uid)await update(ref(db,`rooms/${roomId}/players`),{[uid]:null})}catch{}roomId=null;roomData=null;show("home")}
$("createBtn").onclick=createRoom;$("joinBtn").onclick=joinRoom;$("startBtn").onclick=startGame;$("leaveBtn").onclick=leave;$("backLobby").onclick=()=>show("lobby");$("newRound").onclick=newRound;
$("copyCode").onclick=()=>navigator.clipboard?.writeText(roomId).then(()=>msg("lobbyMsg","Código copiado."));
$("drawDeck").onclick=()=>draw("deck");$("drawDiscard").onclick=()=>draw("discard");$("openBtn").onclick=openMeld;$("addBtn").onclick=addMeld;$("discardBtn").onclick=discard;$("winBtn").onclick=claimWin;
const handEl=$("hand");
handEl.onclick=e=>{
 if(Date.now()-lastDragAt<350)return;
 const el=e.target.closest("[data-card]");if(!el)return;
 const id=el.dataset.card;selected.has(id)?selected.delete(id):selected.add(id);renderGame();
};
handEl.addEventListener("dragstart",e=>{
 const el=e.target.closest("[data-card]");if(!el)return;
 draggedCardId=el.dataset.card;el.classList.add("dragging");
 e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",draggedCardId);
});
handEl.addEventListener("dragover",e=>{
 const el=e.target.closest("[data-card]");if(!el||!draggedCardId)return;
 e.preventDefault();e.dataTransfer.dropEffect="move";el.classList.add("drag-over");
});
handEl.addEventListener("dragleave",e=>{const el=e.target.closest("[data-card]");if(el)el.classList.remove("drag-over")});
handEl.addEventListener("drop",async e=>{
 const el=e.target.closest("[data-card]");if(!el||!draggedCardId)return;
 e.preventDefault();el.classList.remove("drag-over");const source=draggedCardId,target=el.dataset.card;
 draggedCardId=null;lastDragAt=Date.now();await reorderHand(source,target);
});
handEl.addEventListener("dragend",e=>{
 const el=e.target.closest("[data-card]");if(el)el.classList.remove("dragging");
 handEl.querySelectorAll(".drag-over").forEach(card=>card.classList.remove("drag-over"));
 if(draggedCardId)lastDragAt=Date.now();draggedCardId=null;
});
const meldsEl=$("melds");
meldsEl.addEventListener("dragover",e=>{
 const target=e.target.closest("[data-meld]");
 if(!target||!draggedCardId||!roomData?.opened?.[uid]||roomData.turn!==uid||!roomData.drawn)return;
 e.preventDefault();e.dataTransfer.dropEffect="move";target.classList.add("meld-drop-target");
});
meldsEl.addEventListener("dragleave",e=>{
 const target=e.target.closest("[data-meld]");if(target&&!target.contains(e.relatedTarget))target.classList.remove("meld-drop-target");
});
meldsEl.addEventListener("drop",async e=>{
 const target=e.target.closest("[data-meld]");if(!target||!draggedCardId)return;
 e.preventDefault();target.classList.remove("meld-drop-target");
 const cardId=draggedCardId,index=Number(target.dataset.meld);draggedCardId=null;lastDragAt=Date.now();
 await addCardToMeld(cardId,index);
});

$("roomInput").oninput=e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
$("playerName").value=localStorage.getItem("rummyName")||"";$("playerName").addEventListener("change",()=>localStorage.setItem("rummyName",cleanName($("playerName").value)));
init();
