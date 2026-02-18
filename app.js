import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, getDocs, writeBatch, limit
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================================================
   ULTRA STABLE PRO — USER-BASED ROLES + SELF VACATION
   - Rollen hängen an nameKey (nicht Gerät/UID)
     superadmins_by_name/{nameKey}
     admins_by_name/{nameKey}
   - Urlaub: vacations/{nameKey} (jeder nur sein eigenes)
   ========================================================= */

/* ---------------- Firebase config ---------------- */
const firebaseConfig = {
  apiKey: "AIzaSyCPTt1ZZ-lj5qZ1Rrn-N7e5QZnhtXB-Pu8",
  authDomain: "aufgabenliste-zdl-ra-93.firebaseapp.com",
  projectId: "aufgabenliste-zdl-ra-93",
  storageBucket: "aufgabenliste-zdl-ra-93.firebasestorage.app",
  messagingSenderId: "857214150388",
  appId: "1:857214150388:web:8bc019911092be0cffe0a1",
  measurementId: "G-6MC0G2V2YY"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/* iOS/Safari ULTRA STABLE */
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
});

/* ---------------- constants ---------------- */
const MAX_SUPER = 3;
const MAX_ADMIN = 8;

const META_COUNTS_REF = doc(db, "meta", "admin_counts");
const META_DAY_REF    = doc(db, "meta", "day_state");

/* ---------------- helpers ---------------- */
const $ = (id) => document.getElementById(id);
const show = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
const n = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const esc = (s) => String(s ?? "")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
const key = (s) => n(s).toLowerCase().replace(/["'„“”]/g,"").replace(/[^a-z0-9äöüß]/g,"");
const uniq = (arr) => Array.from(new Set((arr||[]).map(x=>n(x)).filter(Boolean)));

function pad2(x){ return String(x).padStart(2,"0"); }
function stamp(){
  const d=new Date();
  return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function dayKeyNow(){
  const d=new Date();
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
}
function weekdayNow(){ // 1=Mo ... 7=So
  const js = new Date().getDay(); // 0 So, 1 Mo...
  return js===0 ? 7 : js;
}
function msUntilMidnight(){
  const d = new Date();
  const next = new Date(d);
  next.setHours(24,0,0,0);
  return next.getTime() - d.getTime();
}
function nowMs(){ return Date.now(); }

/* --- Password hashing --- */
async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2,"0")).join("");
}
async function passHashFor(name, pass){
  return sha256Hex(`${key(name)}:${pass}`);
}

/* =========================================================
   ULTRA STABLE LISTEN: onSnapshot -> fallback polling
   ========================================================= */
const ULTRA_POLL_MS = 4000;
function ultraDocsToSnapLike_(docs){ return docs.map(d => ({ id:d.id, data:()=>d.data() })); }
function ultraListen_(q, onData){
  let unsub = null;
  let pollId = null;

  async function pollOnce(){
    try{
      const snap = await getDocs(q);
      onData(ultraDocsToSnapLike_(snap.docs));
    }catch(e){
      console.log("ULTRA poll error:", e?.message || e);
    }
  }
  function startPolling(){
    if(pollId) return;
    pollOnce();
    pollId = setInterval(pollOnce, ULTRA_POLL_MS);
    console.log("ULTRA MODE: polling enabled");
  }

  try{
    unsub = onSnapshot(
      q,
      (snap)=> onData(ultraDocsToSnapLike_(snap.docs)),
      (err)=>{
        console.log("ULTRA snapshot error:", err?.message || err);
        try{ if(unsub) unsub(); }catch(e){}
        unsub = null;
        startPolling();
      }
    );
  }catch(e){
    console.log("ULTRA snapshot init failed:", e?.message || e);
    startPolling();
  }

  return function(){
    try{ if(unsub) unsub(); }catch(e){}
    unsub = null;
    if(pollId){ clearInterval(pollId); pollId=null; }
  };
}

/* ---------------- DOM ---------------- */
const loginView = $("loginView");
const appView   = $("appView");

const whoami    = $("whoami");
const reloadBtn = $("reloadBtn");
const logoutBtn = $("logoutBtn");

const nameSel   = $("nameSel");
const passInp   = $("passInp");
const loginBtn  = $("loginBtn");
const loginErr  = $("loginErr");

const showUidBtn = $("showUidBtn");
const copyUidBtn = $("copyUidBtn");
const uidBox     = $("uidBox");

const tabBtns    = Array.from(document.querySelectorAll(".tabbtn"));
const adminTabBtn= $("adminTabBtn");

const tagSearch  = $("tagSearch");
const tagList    = $("tagList");

const openTagTitle = $("openTagTitle");
const tagMeta      = $("tagMeta");
const closeTagBtn  = $("closeTagBtn");
const newDailyTaskBtn = $("newDailyTaskBtn");

const doneBySel = $("doneBySel");
const markSelectedDoneBtn = $("markSelectedDoneBtn");
const taskHint  = $("taskHint");
const taskList  = $("taskList");

const dayKeyBadge = $("dayKeyBadge");
const rideNameSel = $("rideNameSel");
const rideEinsatz = $("rideEinsatz");
const addRideBtn  = $("addRideBtn");
const rideInfo    = $("rideInfo");
const ridesList   = $("ridesList");

const adminBadge = $("adminBadge");
const adminLock  = $("adminLock");
const adminArea  = $("adminArea");

const subtabBtns = Array.from(document.querySelectorAll(".subtabbtn"));

const empAdd   = $("empAdd");
const empAddBtn= $("empAddBtn");
const empList  = $("empList");

const tagAdd    = $("tagAdd");
const tagAddBtn = $("tagAddBtn");
const adminTagList = $("adminTagList");

const planWeekdaySel = $("planWeekdaySel");
const planTagSel     = $("planTagSel");
const planTaskInp    = $("planTaskInp");
const planAddBtn     = $("planAddBtn");
const planList       = $("planList");

const forceDayChangeBtn = $("forceDayChangeBtn");
const regenTodayBtn     = $("regenTodayBtn");
const finalList         = $("finalList");

const adminNameKeyInp   = $("adminUidAdd");
const adminUidAddBtn    = $("adminUidAddBtn");
const adminUidList      = $("adminUidList");

const superNameKeyInp   = $("superUidAdd");
const superUidAddBtn    = $("superUidAddBtn");
const superUidList      = $("superUidList");

const vacFrom   = $("vacFrom");
const vacUntil  = $("vacUntil");
const vacSaveBtn= $("vacSaveBtn");
const vacClearBtn=$("vacClearBtn");
const vacInfo   = $("vacInfo");

const pointsList= $("pointsList");

/* ---------------- state ---------------- */
let meName = "";
let meKey  = "";
let isAdmin = false;
let isSuperAdmin = false;

let employees = [];
let tags = [];

let currentTagId = "";
let currentTagKey = "";
let selectedTaskId = "";

let myVacation = { from:"", until:"" };

let unsubEmployees=null, unsubTags=null, unsubTasks=null, unsubRides=null, unsubAdmins=null, unsubSupers=null, unsubWeekly=null, unsubFinal=null;

/* ---------------- auth helpers ---------------- */
async function ensureAnon_(){
  if(auth.currentUser) return;
  await signInAnonymously(auth);
}
async function alertSafe_(msg){
  try{ alert(msg); }catch(e){}
}

/* ---------------- meta docs ---------------- */
async function ensureCountsDoc_(){
  const snap = await getDoc(META_COUNTS_REF);
  if(!snap.exists()){
    await setDoc(META_COUNTS_REF, { superCount:0, adminCount:0, updatedAt:serverTimestamp() }, { merge:true });
  }
}
async function getCounts_(){
  const snap = await getDoc(META_COUNTS_REF);
  return snap.exists() ? (snap.data()||{}) : { superCount:0, adminCount:0 };
}
async function incCount_(field, delta){
  const snap = await getDoc(META_COUNTS_REF);
  const cur = snap.exists() ? (snap.data()||{}) : {};
  const next = Math.max(0, Number(cur[field]||0) + delta);
  await setDoc(META_COUNTS_REF, { [field]: next, updatedAt:serverTimestamp(), updatedBy:auth.currentUser.uid }, { merge:true });
}
async function ensureDayState_(){
  const snap = await getDoc(META_DAY_REF);
  if(!snap.exists()){
    await setDoc(META_DAY_REF, { lastDayKey: "", updatedAt: serverTimestamp() }, { merge:true });
  }
}

/* =========================================================
   USER-BASED ROLES
   ========================================================= */
async function refreshRole_(){
  const uid = auth.currentUser.uid;

  // meKey aus users/{uid} lesen (damit Gerät 2 sofort richtig ist)
  try{
    const uSnap = await getDoc(doc(db,"users", uid));
    if(uSnap.exists()){
      const d = uSnap.data()||{};
      if(d.nameKey) meKey = n(d.nameKey);
      if(d.name) meName = n(d.name);
    }
  }catch(e){}

  const sdoc = meKey ? await getDoc(doc(db,"superadmins_by_name", meKey)) : null;
  isSuperAdmin = !!(sdoc && sdoc.exists() && sdoc.data()?.enabled === true);

  const adoc = meKey ? await getDoc(doc(db,"admins_by_name", meKey)) : null;
  isAdmin = isSuperAdmin || !!(adoc && adoc.exists() && adoc.data()?.enabled === true);

  const label = `${meName || "—"}${isSuperAdmin ? " · SUPERADMIN" : (isAdmin ? " · ADMIN" : "")}`;
  if(whoami) whoami.textContent = label;

  if(adminBadge) adminBadge.classList.toggle("hidden", !isAdmin);
  show(adminLock, !isAdmin);
  show(adminArea, isAdmin);

  if(adminTabBtn) adminTabBtn.classList.toggle("hidden", !isAdmin);
  show(newDailyTaskBtn, isAdmin);

  if(adminUidAddBtn) adminUidAddBtn.disabled = !isSuperAdmin;
  if(superUidAddBtn) superUidAddBtn.disabled = !isSuperAdmin;
}

/* bootstrap: erster Benutzer wird Superadmin (wenn keiner existiert) */
async function bootstrapSuperAdminForMeIfNone_(){
  if(!meKey) return;
  const q1 = query(collection(db,"superadmins_by_name"), where("enabled","==",true), limit(1));
  const snap = await getDocs(q1);
  if(!snap.empty) return;

  await ensureCountsDoc_();
  await setDoc(doc(db,"superadmins_by_name", meKey), {
    enabled:true, addedAt:serverTimestamp(), addedBy:"BOOTSTRAP", name: meName
  }, { merge:true });

  const counts = await getCounts_();
  if((counts.superCount||0) < 1){
    await setDoc(META_COUNTS_REF, { superCount:1, adminCount:(counts.adminCount||0), updatedAt:serverTimestamp() }, { merge:true });
  }
}

/* ---------------- UI Tabs ---------------- */
function setTab(tabId){
  document.querySelectorAll(".tab").forEach(t=>t.classList.add("hidden"));
  const el = $(tabId);
  el && el.classList.remove("hidden");
  tabBtns.forEach(b=>b.classList.toggle("active", b.dataset.tab===tabId));
}
tabBtns.forEach(btn=> btn.addEventListener("click", ()=> setTab(btn.dataset.tab)));
setTab("tasksTab");

function setSubtab(subId){
  document.querySelectorAll(".subtab").forEach(t=>t.classList.add("hidden"));
  const el = $(subId);
  el && el.classList.remove("hidden");
  subtabBtns.forEach(b=>b.classList.toggle("active", b.dataset.subtab===subId));
}
subtabBtns.forEach(btn=> btn.addEventListener("click", ()=> setSubtab(btn.dataset.subtab)));
setSubtab("employeesSub");

/* ---------------- UI actions ---------------- */
reloadBtn && (reloadBtn.onclick = () => location.reload());
logoutBtn && (logoutBtn.onclick = async () => {
  try{ await signOut(auth); }catch(e){}
  localStorage.removeItem("meName");
  localStorage.removeItem("meKey");
  location.reload();
});
showUidBtn && (showUidBtn.onclick = async () => {
  await ensureAnon_();
  const uid = auth.currentUser.uid;
  if(uidBox) uidBox.textContent = uid;
  if(copyUidBtn) copyUidBtn.disabled = false;
  await alertSafe_("UID:\n" + uid);
});
copyUidBtn && (copyUidBtn.onclick = async () => {
  const uid = auth?.currentUser?.uid || "";
  if(!uid) return;
  try{ await navigator.clipboard.writeText(uid); await alertSafe_("UID kopiert ✓"); }
  catch(e){ await alertSafe_(uid); }
});

/* ---------------- seed employee ---------------- */
async function seedFirstEmployeeIfEmpty_(){
  const snap = await getDocs(query(collection(db,"employees"), limit(1)));
  if(!snap.empty) return;
  const firstName = "Patrick";
  await setDoc(doc(db,"employees", key(firstName)), {
    name: firstName,
    passHash: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    seeded: true
  }, { merge:true });
}

/* ---------------- Vacation (SELF) ---------------- */
async function loadVacation_(){
  if(!meKey) return;
  const ref = doc(db,"vacations", meKey);
  const snap = await getDoc(ref);
  if(snap.exists()){
    const d = snap.data()||{};
    myVacation = { from:n(d.from||""), until:n(d.until||"") };
  } else {
    myVacation = { from:"", until:"" };
  }
  renderVacationInfo_();
}
function isInVacation_(){
  if(!myVacation?.from || !myVacation?.until) return false;
  const t = dayKeyNow();
  return t >= myVacation.from && t <= myVacation.until;
}
function renderVacationInfo_(){
  if(!vacInfo) return;
  if(isInVacation_()){
    vacInfo.textContent = `Urlaub aktiv: ${myVacation.from} bis ${myVacation.until} (stumm).`;
  } else if(myVacation.from && myVacation.until){
    vacInfo.textContent = `Urlaub gespeichert: ${myVacation.from} bis ${myVacation.until}.`;
  } else {
    vacInfo.textContent = "Kein Urlaub aktiv.";
  }
}
vacSaveBtn && (vacSaveBtn.onclick = async ()=>{
  if(!meKey){ await alertSafe_("Bitte einloggen."); return; }
  const f = n(vacFrom?.value);
  const u = n(vacUntil?.value);
  if(!/^\d{8}$/.test(f) || !/^\d{8}$/.test(u)){
    await alertSafe_("Bitte Datum als YYYYMMDD eingeben.");
    return;
  }
  await setDoc(doc(db,"vacations", meKey), { name:meName, from:f, until:u, updatedAt:serverTimestamp() }, { merge:true });
  await loadVacation_();
});
vacClearBtn && (vacClearBtn.onclick = async ()=>{
  if(!meKey){ await alertSafe_("Bitte einloggen."); return; }
  await deleteDoc(doc(db,"vacations", meKey));
  await loadVacation_();
});

/* ---------------- Login ---------------- */
loginBtn && (loginBtn.onclick = async () => {
  loginErr && (loginErr.textContent = "");
  const nm = n(nameSel?.value);
  const pw = n(passInp?.value);

  if(!nm){ if(loginErr) loginErr.textContent="Bitte Name wählen."; return; }
  if(!pw){ if(loginErr) loginErr.textContent="Bitte Passwort eingeben."; return; }

  await ensureAnon_();

  const nameKey = key(nm);

  // users/{uid} zuerst schreiben (Rules nutzen das für self-check)
  await setDoc(doc(db,"users",auth.currentUser.uid), {
    name: nm,
    nameKey: nameKey,
    updatedAt: serverTimestamp()
  }, { merge:true });

  const eRef = doc(db,"employees", nameKey);
  const eSnap = await getDoc(eRef);
  if(!eSnap.exists()){
    if(loginErr) loginErr.textContent="Dieser Name existiert nicht. Admin muss ihn anlegen.";
    return;
  }

  const eData = eSnap.data()||{};
  const existing = n(eData.passHash||"");
  const h = await passHashFor(nm, pw);

  if(!existing){
    // erstes Login setzt Passwort
    await setDoc(eRef, { passHash: h, updatedAt: serverTimestamp() }, { merge:true });
  } else {
    if(existing !== h){
      if(loginErr) loginErr.textContent="Falsches Passwort.";
      return;
    }
  }

  meName = nm;
  meKey  = nameKey;
  localStorage.setItem("meName", meName);
  localStorage.setItem("meKey", meKey);

  await bootstrapSuperAdminForMeIfNone_();
  await refreshRole_();
  await loadVacation_();

  enterApp_();
});

function enterApp_(){
  show(loginView,false);
  show(appView,true);
  setTab("tasksTab");
}

/* ---------------- render selectors ---------------- */
function renderEmployeeSelectors_(){
  const opts = [`<option value="">Name wählen…</option>`].concat(
    employees.map(x=>`<option value="${esc(x.name)}">${esc(x.name)}</option>`)
  ).join("");

  if(nameSel) nameSel.innerHTML = opts;
  if(rideNameSel) rideNameSel.innerHTML = opts;

  if(doneBySel){
    doneBySel.innerHTML = employees.map(x=>`<option value="${esc(x.name)}">${esc(x.name)}</option>`).join("");
  }

  const stored = n(localStorage.getItem("meName"));
  if(stored){
    if(nameSel) nameSel.value = stored;
    if(rideNameSel) rideNameSel.value = stored;
  }
}

/* ---------------- tags render ---------------- */
function renderTags_(){
  if(!tagList) return;
  const qtxt = n(tagSearch?.value).toLowerCase();

  const list = tags.filter(t=>{
    const tid = String(t.tagId || t.id || "").toLowerCase();
    return !qtxt || tid.includes(qtxt);
  });

  tagList.innerHTML = "";
  if(!list.length){
    tagList.innerHTML = `<div class="muted">Keine Tags.</div>`;
    return;
  }

  list.forEach(t=>{
    const tid = t.tagId || t.id;
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">🏷️ ${esc(tid)}</div>
        <div class="sub muted small">${esc(t.id)}</div>
      </div>
      <div class="actions"><button class="btn ghost">Öffnen</button></div>
    `;
    div.querySelector("button").onclick = ()=>openTag_(tid);
    tagList.appendChild(div);
  });
}
function renderAdminTags_(){
  if(!adminTagList) return;
  adminTagList.innerHTML = "";
  tags.forEach(t=>{
    const tid = t.tagId || t.id;
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">🏷️ ${esc(tid)}</div>
        <div class="sub muted small">${esc(t.id)}</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-open="1">Öffnen</button>
        <button class="btn danger" data-del="1">Löschen</button>
      </div>
    `;
    div.querySelector('[data-open="1"]').onclick = ()=>openTag_(tid);
    div.querySelector('[data-del="1"]').onclick = ()=>deleteTagWithTasks_(t.id, tid);
    adminTagList.appendChild(div);
  });
}
function renderPlanTagSel_(){
  if(!planTagSel) return;
  planTagSel.innerHTML = tags.map(t=>`<option value="${esc(t.tagId||t.id)}">${esc(t.tagId||t.id)}</option>`).join("");
}

/* ---------------- open tag ---------------- */
closeTagBtn && (closeTagBtn.onclick = () => closeTag_());

async function openTag_(tagId){
  currentTagId = n(tagId);
  currentTagKey = key(currentTagId);
  selectedTaskId = "";

  if(openTagTitle) openTagTitle.textContent = `Tag: ${currentTagId}`;
  if(tagMeta) tagMeta.textContent = `Heute: ${dayKeyNow()} · tagKey: ${currentTagKey} · ${isAdmin ? "Admin sieht alles" : "User sieht nur offene"}`;

  await listenTasksForCurrentTag_();
}
function closeTag_(){
  currentTagId = "";
  currentTagKey = "";
  selectedTaskId = "";
  if(openTagTitle) openTagTitle.textContent = "Kein Tag geöffnet";
  if(tagMeta) tagMeta.textContent = "";
  if(taskList) taskList.innerHTML = "";
  if(unsubTasks){ unsubTasks(); unsubTasks=null; }
}

/* ---------------- tasks daily ---------------- */
async function listenTasksForCurrentTag_(){
  if(!currentTagKey) return;
  if(unsubTasks) unsubTasks();

  const today = dayKeyNow();

  const q = isAdmin
    ? query(collection(db,"daily_tasks"),
        where("dateKey","==",today),
        where("tagKey","==",currentTagKey),
        orderBy("text"))
    : query(collection(db,"daily_tasks"),
        where("dateKey","==",today),
        where("tagKey","==",currentTagKey),
        where("status","==","open"),
        orderBy("text"));

  unsubTasks = ultraListen_(q, (docs)=>{
    const tasks = docs.map(d=>({ id:d.id, ...d.data() }));
    renderTasks_(tasks);
  });
}

function renderTasks_(tasks){
  if(!taskList) return;
  taskList.innerHTML = "";

  if(!tasks.length){
    taskList.innerHTML = `<div class="muted">Keine Aufgaben für heute.</div>`;
    return;
  }

  tasks.forEach(t=>{
    const div = document.createElement("div");
    div.className = "item";
    const doneByTxt = Array.isArray(t.doneBy) ? t.doneBy.join(", ") : "";
    const st = t.status || "open";

    div.innerHTML = `
      <div class="main">
        <div class="title">${st==="open"?"⏳":st==="done"?"✅":"🧾"} ${esc(t.text||"")}</div>
        <div class="sub muted small">
          ${doneByTxt ? `Erledigt von: ${esc(doneByTxt)}` : ""}
          ${t.finalOk ? ` · Endkontrolle: ${esc(t.finalBy||"")}` : ""}
        </div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-select="1">${selectedTaskId===t.id?"✓":"Auswählen"}</button>
        ${isAdmin ? `<button class="btn danger" data-del="1">🗑️</button>` : ``}
      </div>
    `;

    div.querySelector('[data-select="1"]').onclick = ()=>{
      selectedTaskId = t.id;
      if(taskHint) taskHint.textContent = `Ausgewählt: ${t.text||""}`;
      renderTasks_(tasks);
    };

    if(isAdmin){
      div.querySelector('[data-del="1"]').onclick = async ()=>{
        if(!confirm("Aufgabe löschen?")) return;
        await deleteDoc(doc(db,"daily_tasks", t.id));
      };
    }

    taskList.appendChild(div);
  });
}

/* mark done with multi selection */
markSelectedDoneBtn && (markSelectedDoneBtn.onclick = async ()=>{
  if(!selectedTaskId){ await alertSafe_("Bitte erst eine Aufgabe auswählen."); return; }
  const selected = Array.from(doneBySel?.selectedOptions||[]).map(o=>n(o.value)).filter(Boolean);
  if(!selected.length){
    await alertSafe_("Bitte mindestens einen Mitarbeiter auswählen.");
    return;
  }

  const ref = doc(db,"daily_tasks", selectedTaskId);
  const snap = await getDoc(ref);
  if(!snap.exists()){ await alertSafe_("Aufgabe nicht gefunden."); return; }
  const t = snap.data()||{};
  if(t.status !== "open"){
    await alertSafe_("Diese Aufgabe ist bereits erledigt.");
    return;
  }

  await updateDoc(ref, {
    status: "done",
    doneBy: uniq(selected),
    doneAt: stamp(),
    updatedAt: serverTimestamp()
  });

  selectedTaskId = "";
  if(taskHint) taskHint.textContent = "";
});

/* admin add daily task */
newDailyTaskBtn && (newDailyTaskBtn.onclick = async ()=>{
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  if(!currentTagKey){ await alertSafe_("Erst Tag öffnen."); return; }
  const t = prompt("Neue Tagesaufgabe:");
  if(!t) return;

  const today = dayKeyNow();
  await addDoc(collection(db,"daily_tasks"), {
    dateKey: today,
    tagId: currentTagId,
    tagKey: currentTagKey,
    text: n(t),
    status: "open",
    doneBy: [],
    doneAt: "",
    finalOk: false,
    finalBy: "",
    finalAt: "",
    pointsBooked: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    source: "manual"
  });
});

/* ---------------- weekly plan ---------------- */
planAddBtn && (planAddBtn.onclick = async ()=>{
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  const wd = Number(planWeekdaySel?.value||0);
  const tagId = n(planTagSel?.value);
  const text = n(planTaskInp?.value);
  if(!(wd>=1 && wd<=6)) { await alertSafe_("Wochentag wählen (Mo–Sa)."); return; }
  if(!tagId){ await alertSafe_("Tag wählen."); return; }
  if(!text){ await alertSafe_("Aufgabe eingeben."); return; }

  await addDoc(collection(db,"weekly_tasks"), {
    weekday: wd,
    tagId,
    tagKey: key(tagId),
    text,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  if(planTaskInp) planTaskInp.value = "";
});

function renderWeeklyList_(rows){
  if(!planList) return;
  planList.innerHTML = "";
  if(!rows.length){
    planList.innerHTML = `<div class="muted">Keine Wochenplan-Aufgaben.</div>`;
    return;
  }
  rows.forEach(r=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">${esc(r.text||"")}</div>
        <div class="sub muted small">Tag: ${esc(r.tagId||"")} · weekday: ${r.weekday}</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-edit="1">✏️</button>
        <button class="btn danger" data-del="1">🗑️</button>
      </div>
    `;
    div.querySelector('[data-edit="1"]').onclick = async ()=>{
      const nt = prompt("Text:", r.text||"");
      if(nt==null) return;
      await updateDoc(doc(db,"weekly_tasks", r.id), { text:n(nt), updatedAt:serverTimestamp() });
    };
    div.querySelector('[data-del="1"]').onclick = async ()=>{
      if(!confirm("Wochenplan-Aufgabe löschen?")) return;
      await deleteDoc(doc(db,"weekly_tasks", r.id));
    };
    planList.appendChild(div);
  });
}

/* create today tasks from weekly */
async function generateTodayFromWeekly_(todayKey){
  const wd = weekdayNow();
  if(wd === 7) return;

  const weeklyQ = query(
    collection(db,"weekly_tasks"),
    where("weekday","==",wd),
    where("active","==",true),
    orderBy("tagKey"),
    orderBy("text")
  );
  const snap = await getDocs(weeklyQ);

  const existingQ = query(collection(db,"daily_tasks"), where("dateKey","==",todayKey));
  const exSnap = await getDocs(existingQ);
  const exSet = new Set(exSnap.docs.map(d=>{
    const x=d.data()||{};
    return `${x.tagKey||""}|${(x.text||"").toLowerCase()}`;
  }));

  const batch = writeBatch(db);
  let created = 0;

  snap.docs.forEach(d=>{
    const w = d.data()||{};
    const k = `${w.tagKey||""}|${(w.text||"").toLowerCase()}`;
    if(exSet.has(k)) return;

    const ref = doc(collection(db,"daily_tasks"));
    batch.set(ref, {
      dateKey: todayKey,
      tagId: w.tagId,
      tagKey: w.tagKey,
      text: w.text,
      status: "open",
      doneBy: [],
      doneAt: "",
      finalOk: false,
      finalBy: "",
      finalAt: "",
      pointsBooked: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: "weekly"
    });
    created++;
  });

  if(created>0) await batch.commit();
}

/* day change */
async function runDayChange_(){
  const today = dayKeyNow();

  await ensureDayState_();
  const stateSnap = await getDoc(META_DAY_REF);
  const last = stateSnap.exists() ? n((stateSnap.data()||{}).lastDayKey) : "";

  if(last === today) return;

  if(last){
    const snap = await getDocs(query(collection(db,"daily_tasks"), where("dateKey","==",last)));
    const batch = writeBatch(db);
    snap.docs.forEach(d=>{
      batch.set(doc(db,"archives", last, "tasks", d.id), { ...d.data(), archivedAt: serverTimestamp() }, { merge:true });
      batch.delete(d.ref);
    });
    if(!snap.empty) await batch.commit();
  }

  await setDoc(META_DAY_REF, { lastDayKey: today, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid }, { merge:true });
  await generateTodayFromWeekly_(today);
  await cleanupRides72h_();
}

function scheduleMidnightJob_(){
  setTimeout(async ()=>{
    try{
      await runDayChange_();
      if(currentTagKey) await listenTasksForCurrentTag_();
      await refreshFinalList_();
      await refreshPointsList_();
    }catch(e){}
    scheduleMidnightJob_();
  }, msUntilMidnight() + 1000);
}

forceDayChangeBtn && (forceDayChangeBtn.onclick = async ()=>{
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  if(!confirm("Tageswechsel jetzt ausführen?")) return;
  await runDayChange_();
  await alertSafe_("Tageswechsel ✓");
});

regenTodayBtn && (regenTodayBtn.onclick = async ()=>{
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  await generateTodayFromWeekly_(dayKeyNow());
  await alertSafe_("Heute neu erzeugt ✓");
});

/* ---------------- points ---------------- */
async function addTaskPoint_(name){
  const id = key(name);
  const ref = doc(db,"points_tasks", id);
  const snap = await getDoc(ref);
  const cur = snap.exists() ? Number((snap.data()||{}).points||0) : 0;
  await setDoc(ref, { name, points: cur + 1, updatedAt: serverTimestamp() }, { merge:true });
}
async function addRidePoint_(name){
  const id = key(name);
  const ref = doc(db,"points_rides", id);
  const snap = await getDoc(ref);
  const cur = snap.exists() ? Number((snap.data()||{}).points||0) : 0;
  await setDoc(ref, { name, points: cur + 1, updatedAt: serverTimestamp() }, { merge:true });
}
async function bookTaskPointsOnce_(taskId){
  const ref = doc(db,"daily_tasks", taskId);
  const snap = await getDoc(ref);
  if(!snap.exists()) return;
  const t = snap.data()||{};
  if(t.pointsBooked) return;

  const people = Array.isArray(t.doneBy) ? uniq(t.doneBy) : [];
  for(const p of people) await addTaskPoint_(p);

  await updateDoc(ref, { pointsBooked:true, updatedAt: serverTimestamp() });
}

async function refreshFinalList_(){
  if(!isAdmin || !finalList) { if(finalList) finalList.innerHTML=""; return; }

  const today = dayKeyNow();
  const q = query(
    collection(db,"daily_tasks"),
    where("dateKey","==",today),
    where("status","==","done"),
    orderBy("tagKey"),
    orderBy("text")
  );

  if(unsubFinal) unsubFinal();
  unsubFinal = ultraListen_(q, (docs)=>{
    const rows = docs.map(d=>({ id:d.id, ...d.data() }));
    finalList.innerHTML = "";

    if(!rows.length){
      finalList.innerHTML = `<div class="muted">Keine erledigten Aufgaben für Endkontrolle.</div>`;
      return;
    }

    rows.forEach(r=>{
      const div = document.createElement("div");
      div.className="item";
      div.innerHTML = `
        <div class="main">
          <div class="title">✅ ${esc(r.text||"")}</div>
          <div class="sub muted small">Tag: ${esc(r.tagId||"")} · Erledigt von: ${esc((r.doneBy||[]).join(", "))}</div>
        </div>
        <div class="actions">
          <button class="btn ghost" data-final="1">🧾 Endkontrolle</button>
        </div>
      `;
      div.querySelector('[data-final="1"]').onclick = async ()=>{
        const ref = doc(db,"daily_tasks", r.id);
        const snap = await getDoc(ref);
        if(!snap.exists()) return;
        const t = snap.data()||{};
        if(t.finalOk){ await alertSafe_("Endkontrolle ist bereits gesetzt."); return; }

        await updateDoc(ref, {
          finalOk: true,
          finalBy: meName || "Admin",
          finalAt: stamp(),
          status: "final",
          updatedAt: serverTimestamp()
        });

        await bookTaskPointsOnce_(r.id);
        await refreshPointsList_();
      };
      finalList.appendChild(div);
    });
  });
}

async function refreshPointsList_(){
  if(!pointsList) return;

  const [tSnap, rSnap] = await Promise.all([
    getDocs(query(collection(db,"points_tasks"), orderBy("name"))).catch(()=>({docs:[]})),
    getDocs(query(collection(db,"points_rides"), orderBy("name"))).catch(()=>({docs:[]})),
  ]);

  const map = new Map();
  (tSnap.docs||[]).forEach(d=>{
    const x=d.data()||{};
    map.set(d.id, { name:x.name||d.id, taskPoints:Number(x.points||0), ridePoints:0 });
  });
  (rSnap.docs||[]).forEach(d=>{
    const x=d.data()||{};
    const cur = map.get(d.id) || { name:x.name||d.id, taskPoints:0, ridePoints:0 };
    cur.ridePoints = Number(x.points||0);
    map.set(d.id, cur);
  });

  const rows = Array.from(map.values()).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  pointsList.innerHTML = "";

  if(!rows.length){
    pointsList.innerHTML = `<div class="muted">Noch keine Punkte.</div>`;
    return;
  }

  rows.forEach(r=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">${esc(r.name)}</div>
        <div class="sub muted small">Aufgabenpunkte: ${r.taskPoints} · Fahrtenpunkte: ${r.ridePoints}</div>
      </div>
      ${isAdmin ? `<div class="actions"><button class="btn ghost" data-edit="1">Bearbeiten</button></div>` : ``}
    `;
    if(isAdmin){
      div.querySelector('[data-edit="1"]').onclick = async ()=>{
        const tp = prompt("Aufgabenpunkte:", String(r.taskPoints));
        if(tp==null) return;
        const rp = prompt("Fahrtenpunkte:", String(r.ridePoints));
        if(rp==null) return;

        const id = key(r.name);
        await setDoc(doc(db,"points_tasks", id), { name:r.name, points: Number(tp||0), updatedAt: serverTimestamp() }, { merge:true });
        await setDoc(doc(db,"points_rides", id), { name:r.name, points: Number(rp||0), updatedAt: serverTimestamp() }, { merge:true });
        await refreshPointsList_();
      };
    }
    pointsList.appendChild(div);
  });
}

/* ---------------- rides (72h) ---------------- */
addRideBtn && (addRideBtn.onclick = async ()=>{
  const nm = n(rideNameSel?.value) || meName;
  const eins = n(rideEinsatz?.value);
  if(!nm){ await alertSafe_("Name fehlt."); return; }
  if(!eins){ await alertSafe_("Einsatznummer fehlt."); return; }

  await addDoc(collection(db,"rides"), {
    name: nm,
    nameKey: key(nm),
    einsatz: eins,
    at: stamp(),
    createdMs: nowMs(),
    createdAt: serverTimestamp()
  });

  await addRidePoint_(nm);

  if(rideEinsatz) rideEinsatz.value = "";
  if(rideInfo) rideInfo.textContent = "Gespeichert ✓ (+1 Fahrtenpunkt)";
  setTimeout(()=>{ if(rideInfo) rideInfo.textContent=""; }, 1500);

  await refreshPointsList_();
});

async function cleanupRides72h_(){
  const cutoff = nowMs() - (72 * 60 * 60 * 1000);
  const snap = await getDocs(query(collection(db,"rides"), orderBy("createdMs")));
  const old = snap.docs.filter(d => Number((d.data()||{}).createdMs||0) < cutoff);
  if(!old.length) return;

  const batch = writeBatch(db);
  old.forEach(d=>batch.delete(d.ref));
  await batch.commit();
}

function renderRides_(rows){
  if(!ridesList) return;
  ridesList.innerHTML = "";
  if(!rows.length){
    ridesList.innerHTML = `<div class="muted">Keine Fahrten in den letzten 72h.</div>`;
    return;
  }

  rows.sort((a,b)=>Number(b.createdMs||0)-Number(a.createdMs||0));
  rows.forEach(r=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">🚗 ${esc(r.name||"")} · ${esc(r.einsatz||"")}</div>
        <div class="sub muted small">${esc(r.at||"")}</div>
      </div>
      ${isAdmin ? `<div class="actions"><button class="btn danger">🗑️</button></div>` : ``}
    `;
    if(isAdmin){
      div.querySelector("button").onclick = async ()=>{
        if(!confirm("Fahrt löschen?")) return;
        await deleteDoc(doc(db,"rides", r.id));
      };
    }
    ridesList.appendChild(div);
  });
}

/* ---------------- admin: employees ---------------- */
empAddBtn && (empAddBtn.onclick = async ()=>{
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  const nm = n(empAdd?.value);
  if(!nm){ await alertSafe_("Name fehlt."); return; }
  await setDoc(doc(db,"employees", key(nm)), { name:nm, passHash:"", updatedAt:serverTimestamp() }, { merge:true });
  if(empAdd) empAdd.value = "";
});

function renderEmployeesAdmin_(){
  if(!empList) return;
  empList.innerHTML = "";
  employees.forEach(e=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">${esc(e.name)}</div>
        <div class="sub muted small">pass gesetzt: ${e.passHash ? "ja" : "nein"}</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-reset="1">Reset PW</button>
        <button class="btn danger" data-del="1">🗑️</button>
      </div>
    `;
    div.querySelector('[data-reset="1"]').onclick = async ()=>{
      if(!confirm(`Passwort für "${e.name}" zurücksetzen?`)) return;
      await updateDoc(doc(db,"employees", key(e.name)), { passHash:"", updatedAt:serverTimestamp() });
    };
    div.querySelector('[data-del="1"]').onclick = async ()=>{
      if(!confirm(`"${e.name}" löschen?`)) return;
      await deleteDoc(doc(db,"employees", key(e.name)));
    };
    empList.appendChild(div);
  });
}

/* ---------------- admin: tags ---------------- */
tagAddBtn && (tagAddBtn.onclick = async ()=>{
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  const tid = n(tagAdd?.value);
  if(!tid){ await alertSafe_("Tag_ID fehlt."); return; }
  await setDoc(doc(db,"tags", key(tid)), { tagId:tid, tagKey:key(tid), updatedAt:serverTimestamp() }, { merge:true });
  if(tagAdd) tagAdd.value = "";
});

async function deleteTagWithTasks_(tagKeyStr, tagIdStr){
  if(!confirm(`Tag "${tagIdStr}" + ALLE Aufgaben (heute & Wochenplan) löschen?`)) return;

  const batch = writeBatch(db);
  batch.delete(doc(db,"tags",tagKeyStr));

  const today = dayKeyNow();
  const tSnap = await getDocs(query(collection(db,"daily_tasks"),
    where("dateKey","==",today),
    where("tagKey","==",tagKeyStr)
  ));
  tSnap.docs.forEach(d=>batch.delete(d.ref));

  const wSnap = await getDocs(query(collection(db,"weekly_tasks"), where("tagKey","==",tagKeyStr)));
  wSnap.docs.forEach(d=>batch.delete(d.ref));

  await batch.commit();
  await alertSafe_("Gelöscht ✓");
}

/* ---------------- roles management (BY NAMEKEY) ---------------- */
adminUidAddBtn && (adminUidAddBtn.onclick = async ()=>{
  if(!isSuperAdmin){ await alertSafe_("Nur Superadmin."); return; }
  const nk = key(n(adminNameKeyInp?.value));
  if(!nk){ await alertSafe_("NameKey fehlt (z.B. patrick)."); return; }

  await ensureCountsDoc_();
  const counts = await getCounts_();
  if((counts.adminCount||0) >= MAX_ADMIN){
    await alertSafe_(`Maximal ${MAX_ADMIN} Admins erreicht.`);
    return;
  }

  await setDoc(doc(db,"admins_by_name", nk), { enabled:true, addedAt:serverTimestamp(), addedBy:meKey, nameKey:nk }, { merge:true });
  await incCount_("adminCount", +1);

  if(adminNameKeyInp) adminNameKeyInp.value = "";
});

superUidAddBtn && (superUidAddBtn.onclick = async ()=>{
  if(!isSuperAdmin){ await alertSafe_("Nur Superadmin."); return; }
  const nk = key(n(superNameKeyInp?.value));
  if(!nk){ await alertSafe_("NameKey fehlt (z.B. patrick)."); return; }

  await ensureCountsDoc_();
  const counts = await getCounts_();
  if((counts.superCount||0) >= MAX_SUPER){
    await alertSafe_(`Maximal ${MAX_SUPER} Superadmins erreicht.`);
    return;
  }

  await setDoc(doc(db,"superadmins_by_name", nk), { enabled:true, addedAt:serverTimestamp(), addedBy:meKey, nameKey:nk }, { merge:true });
  await incCount_("superCount", +1);

  if(superNameKeyInp) superNameKeyInp.value = "";
});

function renderAdmins_(rows){
  if(!adminUidList) return;
  adminUidList.innerHTML = "";
  if(!rows.length){
    adminUidList.innerHTML = `<div class="muted">Keine Admins.</div>`;
    return;
  }
  rows.forEach(r=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">ADMIN: ${esc(r.id)}</div>
        <div class="sub muted small">enabled: ${String(r.enabled===true)}</div>
      </div>
      <div class="actions"><button class="btn danger">Entfernen</button></div>
    `;
    div.querySelector("button").onclick = async ()=>{
      if(!isSuperAdmin){ await alertSafe_("Nur Superadmin."); return; }
      if(!confirm("Admin entfernen?")) return;
      await deleteDoc(doc(db,"admins_by_name", r.id));
      await incCount_("adminCount", -1);
    };
    adminUidList.appendChild(div);
  });
}
function renderSuperAdmins_(rows){
  if(!superUidList) return;
  superUidList.innerHTML = "";
  if(!rows.length){
    superUidList.innerHTML = `<div class="muted">Keine Superadmins?</div>`;
    return;
  }
  rows.forEach(r=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">SUPERADMIN: ${esc(r.id)}</div>
        <div class="sub muted small">enabled: ${String(r.enabled===true)}</div>
      </div>
      <div class="actions"><button class="btn danger">Entfernen</button></div>
    `;
    div.querySelector("button").onclick = async ()=>{
      if(!isSuperAdmin){ await alertSafe_("Nur Superadmin."); return; }
      const counts = await getCounts_();
      if((counts.superCount||0) <= 1){
        await alertSafe_("Mindestens 1 Superadmin muss bleiben.");
        return;
      }
      if(!confirm("Superadmin entfernen?")) return;
      await deleteDoc(doc(db,"superadmins_by_name", r.id));
      await incCount_("superCount", -1);
    };
    superUidList.appendChild(div);
  });
}

/* ---------------- streams ---------------- */
async function startStreams_(){
  // employees
  if(unsubEmployees) unsubEmployees();
  unsubEmployees = ultraListen_(query(collection(db,"employees"), orderBy("name")), (docs)=>{
    employees = docs.map(d=>({ id:d.id, ...d.data() }));
    renderEmployeeSelectors_();
    if(isAdmin) renderEmployeesAdmin_();
  });

  // tags
  if(unsubTags) unsubTags();
  unsubTags = ultraListen_(query(collection(db,"tags"), orderBy("tagId")), (docs)=>{
    tags = docs.map(d=>({ id:d.id, ...d.data() }));
    renderTags_();
    if(isAdmin){
      renderAdminTags_();
      renderPlanTagSel_();
    }
  });

  // rides
  if(unsubRides) unsubRides();
  unsubRides = ultraListen_(query(collection(db,"rides"), orderBy("createdMs")), (docs)=>{
    const cutoff = nowMs() - (72*60*60*1000);
    const rows = docs.map(d=>({ id:d.id, ...d.data() })).filter(r=>Number(r.createdMs||0) >= cutoff);
    renderRides_(rows);
  });

  // weekly list filtered
  const refreshWeekly = ()=>{
    if(!isAdmin || !planList) return;
    if(unsubWeekly) unsubWeekly();

    const wd = Number(planWeekdaySel?.value||1);
    const tagId = n(planTagSel?.value);
    const tk = key(tagId);

    const q = query(
      collection(db,"weekly_tasks"),
      where("weekday","==",wd),
      where("tagKey","==",tk),
      orderBy("text")
    );
    unsubWeekly = ultraListen_(q, (docs)=>{
      const rows = docs.map(d=>({ id:d.id, ...d.data() }));
      renderWeeklyList_(rows);
    });
  };
  planWeekdaySel && (planWeekdaySel.onchange = refreshWeekly);
  planTagSel && (planTagSel.onchange = refreshWeekly);
  setTimeout(()=>{ try{ refreshWeekly(); }catch(e){} }, 600);

  // roles lists (admin)
  if(unsubAdmins) unsubAdmins();
  unsubAdmins = ultraListen_(query(collection(db,"admins_by_name"), orderBy("addedAt")), (docs)=>{
    if(!isAdmin){ if(adminUidList) adminUidList.innerHTML=""; return; }
    renderAdmins_(docs.map(d=>({ id:d.id, ...d.data() })));
  });

  if(unsubSupers) unsubSupers();
  unsubSupers = ultraListen_(query(collection(db,"superadmins_by_name"), orderBy("addedAt")), (docs)=>{
    if(!isAdmin){ if(superUidList) superUidList.innerHTML=""; return; }
    renderSuperAdmins_(docs.map(d=>({ id:d.id, ...d.data() })));
  });

  tagSearch && (tagSearch.oninput = ()=>renderTags_());

  await refreshFinalList_();
}

/* ---------------- init ---------------- */
onAuthStateChanged(auth, async ()=>{
  await ensureAnon_();

  if(dayKeyBadge) dayKeyBadge.textContent = dayKeyNow();

  await ensureCountsDoc_();
  await ensureDayState_();
  await seedFirstEmployeeIfEmpty_();

  // Auto daychange + midnight
  await runDayChange_();
  scheduleMidnightJob_();

  // hourly rides cleanup
  setInterval(()=>{ cleanupRides72h_().catch(()=>{}); }, 60*60*1000);

  // restore
  const storedName = n(localStorage.getItem("meName"));
  const storedKey  = n(localStorage.getItem("meKey"));
  if(storedName) meName = storedName;
  if(storedKey)  meKey = storedKey;

  await refreshRole_();
  await startStreams_();
  await refreshPointsList_();

  if(meKey){
    await loadVacation_();
    show(loginView,false);
    show(appView,true);
  } else {
    show(loginView,true);
    show(appView,false);
  }
});
