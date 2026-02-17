/* =========================================================
   Aufgabenliste ZDL RA 93 — ULTRA FINAL (PWA)
   - Tabs: Aufgaben / Fahrten / Admin
   - Auth: Anonymous + Name+Passwort (PBKDF2 Hash in Firestore, admin-managed)
   - Bootstrap: erster User wird Superadmin (nur einmal)
   - Wochenplan (Mo-Sa), Sonntag frei
   - Daily Tasks: werden aus Wochenplan erzeugt + extra Tagesaufgaben
   - Multi-Select beim Abhaken (mehrere Mitarbeiter)
   - Nach Abhaken: für normale User unsichtbar
   - Punkte: erst bei Endkontrolle (Admin) gebucht
   - Fahrten: 72h sichtbar, Fahrtenpunkte getrennt
   - Urlaubmodus bis Datum (stumm / hide reminders)
   - Android/iPad Homescreen Install via manifest + SW
   ========================================================= */

/* =======================
   0) DATE HELPERS (FIX!)
   ======================= */
function dayKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}
function todayKeyNow(){ return dayKey(); }

function weekdayKey() {
  // Mo=1 ... So=0
  const d = new Date();
  const wd = d.getDay(); // 0=So
  // Sonntag ist frei => return "SUN"
  if (wd === 0) return "SUN";
  return ["","MON","TUE","WED","THU","FRI","SAT"][wd];
}
function stamp() {
  const d=new Date(); const p=(x)=>String(x).padStart(2,"0");
  return `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function hoursAgoTs(h){
  return Date.now() - (h*60*60*1000);
}

/* =======================
   1) Firebase Imports
   ======================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, getDocs, writeBatch, limit
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =======================
   2) Firebase Config (FIX)
   ======================= */
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
const db = getFirestore(app);

/* =======================
   3) Constants / Roles
   ======================= */
const MAX_SUPER = 3;
const MAX_ADMIN = 8;

const META_COUNTS_REF = doc(db, "meta", "admin_counts");
const META_SUPER_EXISTS = doc(db, "meta", "superadmin_exists");

/* =======================
   4) DOM Helpers
   ======================= */
const $ = (id) => document.getElementById(id);
const show = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
const n = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const esc = (s) => String(s ?? "")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
const key = (s) => n(s).toLowerCase().replace(/["'„“”]/g,"").replace(/[^a-z0-9äöüß]/g,"");
const uniq = (arr) => Array.from(new Set((arr||[]).map(x=>n(x)).filter(Boolean)));

/* =======================
   5) DOM Elements
   ======================= */
const loginView = $("loginView");
const appView = $("appView");

const whoami = $("whoami");
const reloadBtn = $("reloadBtn");
const logoutBtn = $("logoutBtn");

const nameSel = $("nameSel");
const pwInp = $("pwInp");
const loginBtn = $("loginBtn");
const loginErr = $("loginErr");

const showUidBtn = $("showUidBtn");
const copyUidBtn = $("copyUidBtn");
const uidBox = $("uidBox");

const todayBadge = $("todayBadge");
const tagSearch = $("tagSearch");
const tagList = $("tagList");

const taskPanel = $("taskPanel");
const openTagTitle = $("openTagTitle");
const tagMeta = $("tagMeta");
const closeTagBtn = $("closeTagBtn");
const newTaskBtn = $("newTaskBtn");
const openTodayExtrasBtn = $("openTodayExtrasBtn");
const taskList = $("taskList");

const rideWindow = $("rideWindow");
const rideNameSel = $("rideNameSel");
const rideEinsatz = $("rideEinsatz");
const addRideBtn = $("addRideBtn");
const rideInfo = $("rideInfo");
const ridesList = $("ridesList");

const adminBadge = $("adminBadge");
const superBadge = $("superBadge");
const adminLock = $("adminLock");
const adminArea = $("adminArea");

const empAdd = $("empAdd");
const empAddBtn = $("empAddBtn");
const empList = $("empList");

const tagAdd = $("tagAdd");
const tagAddBtn = $("tagAddBtn");
const adminTagList = $("adminTagList");

const godSearch = $("godSearch");
const toggleOnlyOpenBtn = $("toggleOnlyOpenBtn");
const dayChangeBtn = $("dayChangeBtn");
const godSummary = $("godSummary");
const godList = $("godList");

const vacUntil = $("vacUntil");
const vacMode = $("vacMode");
const saveVacBtn = $("saveVacBtn");
const vacInfo = $("vacInfo");

const adminUidAdd = $("adminUidAdd");
const adminUidAddBtn = $("adminUidAddBtn");
const adminUidList = $("adminUidList");

const superUidAdd = $("superUidAdd");
const superUidAddBtn = $("superUidAddBtn");
const superUidList = $("superUidList");

const refreshPointsBtn = $("refreshPointsBtn");
const pointsList = $("pointsList");

/* Tabs */
const tabBtns = Array.from(document.querySelectorAll(".tab"));
const tabTasks = $("tab_tasks");
const tabRides = $("tab_rides");
const tabAdmin = $("tab_admin");

/* =======================
   6) State
   ======================= */
let meName = "";
let sessionOk = false;

let isAdmin = false;
let isSuperAdmin = false;

let employees = [];
let tags = [];

let currentTagId = "";
let currentTagKey = "";

let onlyOpen = false;

let unsubEmployees=null, unsubTags=null, unsubTasks=null;
let unsubAdmins=null, unsubSupers=null;
let unsubAllTasks=null;
let unsubRides=null;

let allTasks = [];
let allRides = [];

let vacation = { mode:"off", until:"" };

/* =======================
   7) Service Worker
   ======================= */
(async ()=>{
  try{
    if("serviceWorker" in navigator){
      await navigator.serviceWorker.register("./sw.js", { scope:"./" });
    }
  }catch(e){}
})();

/* =======================
   8) Crypto (PBKDF2)
   ======================= */
function bufToB64(buf){
  const bytes = new Uint8Array(buf);
  let bin = "";
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}
function b64ToBuf(b64){
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return bytes.buffer;
}
async function pbkdf2Hash(password, saltB64){
  const enc = new TextEncoder();
  const salt = saltB64 ? new Uint8Array(b64ToBuf(saltB64)) : crypto.getRandomValues(new Uint8Array(16));
  const keyMat = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name:"PBKDF2",
    salt,
    iterations: 120000,
    hash:"SHA-256"
  }, keyMat, 256);
  return { saltB64: bufToB64(salt), hashB64: bufToB64(bits) };
}

/* =======================
   9) Core Helpers
   ======================= */
async function ensureAnon_(){
  if(auth.currentUser) return;
  await signInAnonymously(auth);
}
async function alertSafe_(m){ try{ alert(m); }catch(_){} }

function enterApp_(){ show(loginView,false); show(appView,true); show(logoutBtn,true); }
function leaveApp_(){ show(loginView,true); show(appView,false); show(logoutBtn,false); }

function setWho_(){
  const label = `${meName || "—"}${isSuperAdmin ? " · SUPERADMIN" : (isAdmin ? " · ADMIN" : "")}`;
  if(whoami) whoami.textContent = label;
  if(adminBadge) adminBadge.classList.toggle("hidden", !isAdmin);
  if(superBadge) superBadge.classList.toggle("hidden", !isSuperAdmin);
}

/* =======================
   10) Bootstrap Superadmin
   ======================= */
async function ensureCountsDoc_(){
  const s = await getDoc(META_COUNTS_REF);
  if(!s.exists()){
    await setDoc(META_COUNTS_REF, { superCount:0, adminCount:0, updatedAt:serverTimestamp() }, { merge:true });
  }
}
async function getCounts_(){
  const s = await getDoc(META_COUNTS_REF);
  return s.exists() ? (s.data()||{}) : { superCount:0, adminCount:0 };
}
async function setCounts_(superCount, adminCount){
  await setDoc(META_COUNTS_REF,{
    superCount:Number(superCount||0),
    adminCount:Number(adminCount||0),
    updatedAt:serverTimestamp(),
    updatedBy:auth.currentUser.uid
  },{merge:true});
}
async function incCount_(field, delta){
  const cur = await getCounts_();
  const next = Math.max(0, Number(cur[field]||0) + Number(delta||0));
  await setDoc(META_COUNTS_REF,{ [field]: next, updatedAt:serverTimestamp(), updatedBy:auth.currentUser.uid },{merge:true});
}

async function bootstrapSuperAdminOnce_(){
  // if marker exists => already bootstrapped
  const m = await getDoc(META_SUPER_EXISTS);
  if(m.exists()) return;

  // if superadmin exists => create marker (admin later)
  const q1 = query(collection(db,"superadmins"), where("enabled","==",true), limit(1));
  const s = await getDocs(q1);
  if(!s.empty){
    await setDoc(META_SUPER_EXISTS, { exists:true, at:serverTimestamp() }, { merge:true });
    return;
  }

  // no superadmin => make current user superadmin
  await setDoc(doc(db,"superadmins",auth.currentUser.uid),{
    enabled:true, addedAt:serverTimestamp(), addedBy:"BOOTSTRAP"
  },{merge:true});

  await ensureCountsDoc_();
  await setCounts_(1, 0);

  // create marker to prevent future bootstrap
  await setDoc(META_SUPER_EXISTS, { exists:true, at:serverTimestamp(), by:auth.currentUser.uid }, { merge:true });
}

/* =======================
   11) Roles
   ======================= */
async function refreshRole_(){
  const uid = auth.currentUser.uid;

  const sdoc = await getDoc(doc(db,"superadmins",uid));
  isSuperAdmin = sdoc.exists() && sdoc.data()?.enabled === true;

  const adoc = await getDoc(doc(db,"admins",uid));
  isAdmin = isSuperAdmin || (adoc.exists() && adoc.data()?.enabled === true);

  setWho_();

  show(adminLock, !isAdmin);
  show(adminArea, isAdmin);

  if(adminUidAddBtn) adminUidAddBtn.disabled = !isSuperAdmin;
  if(superUidAddBtn) superUidAddBtn.disabled = !isSuperAdmin;
}

/* =======================
   12) Employees (seed + UI)
   ======================= */
async function seedFirstEmployeeIfEmpty_(){
  const snap = await getDocs(query(collection(db,"employees_public"), limit(1)));
  if(!snap.empty) return;
  await setDoc(doc(db,"employees_public", key("Patrick")), { name:"Patrick", createdAt:serverTimestamp() }, { merge:true });
}
function renderEmployeeSelectors_(){
  const opts = [`<option value="">Name wählen…</option>`].concat(
    employees.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`)
  ).join("");
  if(nameSel) nameSel.innerHTML = opts;
  if(rideNameSel) rideNameSel.innerHTML = opts;

  const stored = n(localStorage.getItem("meName"));
  if(stored){
    if(nameSel) nameSel.value = stored;
    if(rideNameSel) rideNameSel.value = stored;
  }
}

/* =======================
   13) Password Login
   ======================= */
async function employeePrivateRef_(name){
  return doc(db, "employees_private", key(name));
}

async function ensurePasswordSetIfMissing_(name, password){
  // Admin-only write in rules, but we do first-time via admin? -> Not possible for normal user.
  // Therefore: in ULTRA FINAL, first-time password setup is done by ADMIN from admin panel.
  // Practical workaround: allow admin to reset/set. Users can only login.
  // We implement: if no password exists => show message "Admin muss Passwort setzen".
  const ref = await employeePrivateRef_(name);
  const s = await getDoc(ref);
  if(!s.exists()) return { ok:false, reason:"NO_PASSWORD_SET" };
  return { ok:true };
}

async function verifyPassword_(name, password){
  const ref = await employeePrivateRef_(name);
  const s = await getDoc(ref);
  if(!s.exists()) return { ok:false, reason:"NO_PASSWORD_SET" };

  const data = s.data() || {};
  if(!data.saltB64 || !data.hashB64) return { ok:false, reason:"NO_PASSWORD_SET" };

  const { hashB64 } = await pbkdf2Hash(password, data.saltB64);
  return { ok: hashB64 === data.hashB64 };
}

/* =======================
   14) Vacation Settings
   ======================= */
async function loadVacation_(){
  const ref = doc(db, "user_settings", auth.currentUser.uid);
  const s = await getDoc(ref);
  if(s.exists()){
    vacation = { mode: s.data()?.vacMode || "off", until: s.data()?.vacUntil || "" };
  } else {
    vacation = { mode:"off", until:"" };
  }
  if(vacMode) vacMode.value = vacation.mode || "off";
  if(vacUntil) vacUntil.value = vacation.until || "";
}
async function saveVacation_(){
  const mode = vacMode?.value || "off";
  const until = vacUntil?.value || "";
  await setDoc(doc(db,"user_settings",auth.currentUser.uid),{
    vacMode: mode,
    vacUntil: until,
    updatedAt: serverTimestamp()
  },{merge:true});
  vacation = { mode, until };
  if(vacInfo) { vacInfo.textContent="Gespeichert ✓"; setTimeout(()=>vacInfo.textContent="",1200); }
}
function vacationActive_(){
  if(vacation.mode !== "on") return false;
  if(!vacation.until) return true;
  const until = new Date(vacation.until + "T23:59:59").getTime();
  return Date.now() <= until;
}

/* =======================
   15) Tabs
   ======================= */
function setTab_(tab){
  tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  show(tabTasks, tab==="tasks");
  show(tabRides, tab==="rides");
  show(tabAdmin, tab==="admin");
}
tabBtns.forEach(b => b.onclick = ()=> setTab_(b.dataset.tab || "tasks"));

/* =======================
   16) Tags + Tasks
   ======================= */
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
        <div class="sub muted small">ID: ${esc(t.id)}</div>
      </div>
      <div class="actions">
        <button class="btn ghost">Öffnen</button>
      </div>
    `;
    div.querySelector("button").onclick = ()=>openTag_(tid);
    tagList.appendChild(div);
  });
}

async function openTag_(tagId){
  currentTagId = n(tagId);
  currentTagKey = key(currentTagId);

  show(taskPanel, true);
  if(openTagTitle) openTagTitle.textContent = `Tag: ${currentTagId}`;
  if(tagMeta) tagMeta.textContent = `tagKey: ${currentTagKey} · heute: ${dayKey()} · weekday: ${weekdayKey()}`;

  if(unsubTasks) unsubTasks();

  // show daily tasks for today + this tag
  unsubTasks = onSnapshot(
    query(
      collection(db,"daily_tasks"),
      where("dayKey","==",dayKey()),
      where("tagKey","==",currentTagKey),
      orderBy("createdAt")
    ),
    (snap)=>{
      const tasks = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderTasks_(tasks);
    }
  );
}

function closeTag_(){
  currentTagId=""; currentTagKey="";
  show(taskPanel,false);
  if(taskList) taskList.innerHTML="";
  if(unsubTasks){ unsubTasks(); unsubTasks=null; }
}

function taskVisibleForMe_(t){
  // normal user sees only open tasks
  if(isAdmin) return true;
  return t.done !== true;
}

function renderTasks_(tasks){
  if(!taskList) return;
  const visible = tasks.filter(taskVisibleForMe_);

  taskList.innerHTML = "";
  if(!visible.length){
    taskList.innerHTML = `<div class="muted">Keine Aufgaben sichtbar.</div>`;
    return;
  }

  visible.forEach(t=>{
    const doneByTxt = Array.isArray(t.doneBy) ? t.doneBy.join(", ") : "";
    const div = document.createElement("div");
    div.className="item";

    div.innerHTML = `
      <div class="main">
        <div class="title">${t.done ? "✅" : "⏳"} ${esc(t.task||"")}</div>
        <div class="sub muted small">
          ${t.done ? `Erledigt von: ${esc(doneByTxt || "—")}` : ""}
          ${t.finalOk ? ` · 🧾 Endkontrolle: ${esc(t.finalBy||"")}` : ""}
        </div>
      </div>
      <div class="actions">
        ${t.done ? "" : `<button class="btn ghost" data-done="1">✅ Abhaken</button>`}
        ${isAdmin ? `
          <button class="btn ghost" data-final="1">🧾 Endkontrolle</button>
          <button class="btn ghost" data-edit="1">✏️</button>
          <button class="btn danger" data-del="1">🗑️</button>
        `:""}
      </div>
    `;

    const doneBtn = div.querySelector('[data-done="1"]');
    if(doneBtn){
      doneBtn.onclick = async ()=>{
        if(vacationActive_()){
          await alertSafe_("Urlaubmodus aktiv: bitte deaktivieren wenn du wieder Punkte sammeln willst.");
        }
        // Multi-select via prompt (einfach & robust)
        // -> Admin kann auch andere auswählen (Dropdown wäre extra UI; das kommt als nächstes Upgrade)
        const suggested = meName ? meName : "";
        const input = prompt("Wer hat diese Aufgabe erledigt?\nMehrere Namen mit Komma trennen.", suggested);
        if(!input) return;
        const chosen = uniq(input.split(","));
        if(!chosen.length) return;

        await updateDoc(doc(db,"daily_tasks",t.id),{
          done:true,
          doneBy: chosen,
          doneAt: stamp(),
          updatedAt: serverTimestamp()
        });
      };
    }

    if(isAdmin){
      div.querySelector('[data-final="1"]').onclick = async ()=>{
        if(!t.done){ await alertSafe_("Endkontrolle nur wenn Aufgabe erledigt ist."); return; }

        const next = !t.finalOk;
        await updateDoc(doc(db,"daily_tasks",t.id),{
          finalOk: next,
          finalBy: meName || "Admin",
          finalAt: next ? stamp() : "",
          updatedAt: serverTimestamp()
        });

        if(next){
          // Punkte buchen (erst jetzt!)
          await bookTaskPoints_(t, t.doneBy || []);
        }
      };

      div.querySelector('[data-edit="1"]').onclick = async ()=>{
        const nt = prompt("Aufgabe ändern:", t.task || "");
        if(nt==null) return;
        await updateDoc(doc(db,"daily_tasks",t.id), { task:n(nt), updatedAt:serverTimestamp() });
      };

      div.querySelector('[data-del="1"]').onclick = async ()=>{
        if(!confirm("Aufgabe löschen?")) return;
        await deleteDoc(doc(db,"daily_tasks",t.id));
      };
    }

    taskList.appendChild(div);
  });
}

/* =======================
   17) Weekly Plan -> Daily
   ======================= */
async function ensureTodayTasksGenerated_(){
  const dk = dayKey();
  const wd = weekdayKey();
  if(wd === "SUN") return; // Sonntag frei

  // marker doc
  const marker = doc(db, "meta", `generated_${dk}`);
  const ms = await getDoc(marker);
  if(ms.exists()) return;

  // load weekly tasks for this weekday
  const weeklySnap = await getDocs(query(collection(db,"weekly_tasks"), where("weekday","==",wd)));
  if(!weeklySnap.empty){
    const batch = writeBatch(db);
    weeklySnap.docs.forEach(d=>{
      const w = d.data()||{};
      const tagId = n(w.tagId);
      const tagKeyStr = key(tagId);
      const taskText = n(w.task);

      if(!tagId || !taskText) return;

      const newRef = doc(collection(db,"daily_tasks"));
      batch.set(newRef,{
        dayKey: dk,
        weekday: wd,
        tagId,
        tagKey: tagKeyStr,
        task: taskText,
        source: "weekly",
        done:false,
        doneBy:[],
        doneAt:"",
        finalOk:false,
        finalBy:"",
        finalAt:"",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
  }

  // set marker
  await setDoc(marker,{ ok:true, dayKey:dk, at:serverTimestamp() },{merge:true});
}

/* =======================
   18) Admin: Create Weekly / Today Extra
   ======================= */
async function addTodayExtraTask_(){
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  const t = prompt("Neue Tagesaufgabe (heute):");
  if(!t) return;
  const tagId = prompt("Für welche Tag_ID?");
  if(!tagId) return;

  await addDoc(collection(db,"daily_tasks"),{
    dayKey: dayKey(),
    weekday: weekdayKey(),
    tagId: n(tagId),
    tagKey: key(tagId),
    task: n(t),
    source: "extra",
    done:false,
    doneBy:[],
    doneAt:"",
    finalOk:false,
    finalBy:"",
    finalAt:"",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

/* =======================
   19) Admin: Tags / Employees
   ======================= */
function renderEmployeesAdmin_(){
  if(!empList) return;
  empList.innerHTML = "";
  employees.forEach(name=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">${esc(name)}</div>
        <div class="sub muted small">ID: ${esc(key(name))}</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-reset="1">Passwort setzen/reset</button>
        <button class="btn danger" data-del="1">🗑️</button>
      </div>
    `;
    div.querySelector('[data-del="1"]').onclick = async ()=>{
      if(!confirm(`"${name}" löschen?`)) return;
      await deleteDoc(doc(db,"employees_public", key(name)));
      // optional: also delete private hash
      try{ await deleteDoc(doc(db,"employees_private", key(name))); }catch(_){}
    };
    div.querySelector('[data-reset="1"]').onclick = async ()=>{
      const pw = prompt(`Neues Passwort für ${name}:`);
      if(!pw) return;
      const { saltB64, hashB64 } = await pbkdf2Hash(pw);
      await setDoc(doc(db,"employees_private", key(name)),{
        name,
        saltB64,
        hashB64,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
      },{merge:true});
      await alertSafe_("Passwort gespeichert ✓");
    };
    empList.appendChild(div);
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
    div.querySelector('[data-del="1"]').onclick = async ()=>{
      if(!confirm(`Tag "${tid}" löschen?`)) return;
      await deleteDoc(doc(db,"tags", t.id));
    };
    adminTagList.appendChild(div);
  });
}

/* =======================
   20) Dashboard (Admin Tools)
   ======================= */
function renderGod_(){
  if(!isAdmin){
    if(godSummary) godSummary.textContent="";
    if(godList) godList.innerHTML="";
    return;
  }

  const qtxt = n(godSearch?.value).toLowerCase();
  const map = new Map();

  for(const t of allTasks){
    if(t.dayKey !== dayKey()) continue; // dashboard for today
    const tk = t.tagKey || "";
    if(!tk) continue;

    if(!map.has(tk)){
      map.set(tk, { tagKey:tk, tagId:t.tagId||tk, open:0, done:0, final:0, openTasks:[] });
    }
    const g = map.get(tk);

    if(t.done) g.done++;
    else { g.open++; g.openTasks.push(t); }

    if(t.finalOk) g.final++;
  }

  let groups = [...map.values()].sort((a,b)=>(a.tagId||"").localeCompare(b.tagId||""));
  if(onlyOpen) groups = groups.filter(g=>g.open>0);
  if(qtxt){
    groups = groups.filter(g=>{
      const inTag = (g.tagId||"").toLowerCase().includes(qtxt);
      const inTask = g.openTasks.some(t=>String(t.task||"").toLowerCase().includes(qtxt));
      return inTag || inTask;
    });
  }

  let open=0, done=0, fin=0;
  for(const g of map.values()){ open+=g.open; done+=g.done; fin+=g.final; }
  if(godSummary) godSummary.textContent = `Heute: ${dayKey()} · Tags: ${map.size} · Offen: ${open} · Erledigt: ${done} · Endkontrolle: ${fin}`;

  if(!godList) return;
  godList.innerHTML = "";

  if(!groups.length){
    godList.innerHTML = `<div class="muted">Keine Treffer.</div>`;
    return;
  }

  for(const g of groups){
    const det = document.createElement("details");
    det.className="detailsCard";
    det.open = g.open>0;

    det.innerHTML = `
      <summary>
        <div class="row between">
          <div><b>🏷️ ${esc(g.tagId)}</b></div>
          <div class="row">
            <span class="pill">⏳ ${g.open}</span>
            <span class="pill">✅ ${g.done}</span>
            <span class="pill">🧾 ${g.final}</span>
          </div>
        </div>
      </summary>
      <div class="row">
        <button class="btn ghost" data-open="1">Öffnen</button>
        <button class="btn ghost" data-reset="1">Reset (heute)</button>
      </div>
      <div class="list" data-list="1"></div>
    `;

    det.querySelector('[data-open="1"]').onclick = ()=>openTag_(g.tagId);
    det.querySelector('[data-reset="1"]').onclick = ()=>bulkResetTagToday_(g.tagKey, g.tagId);

    const list = det.querySelector('[data-list="1"]');
    if(!g.openTasks.length){
      list.innerHTML = `<div class="muted">Keine offenen Aufgaben.</div>`;
    }else{
      g.openTasks.slice(0,30).forEach(t=>{
        const it = document.createElement("div");
        it.className="item";
        it.innerHTML = `
          <div class="main">
            <div class="title">⏳ ${esc(t.task||"")}</div>
            <div class="sub muted small">Quelle: ${esc(t.source||"")}</div>
          </div>
          <div class="actions">
            <button class="btn ghost" data-done="1">✅</button>
            <button class="btn danger" data-del="1">🗑️</button>
          </div>
        `;
        it.querySelector('[data-done="1"]').onclick = async ()=>{
          await updateDoc(doc(db,"daily_tasks",t.id),{
            done:true,
            doneBy: uniq([meName||"Admin"]),
            doneAt: stamp(),
            updatedAt: serverTimestamp()
          });
        };
        it.querySelector('[data-del="1"]').onclick = async ()=>{
          if(!confirm("Aufgabe löschen?")) return;
          await deleteDoc(doc(db,"daily_tasks",t.id));
        };
        list.appendChild(it);
      });
    }

    godList.appendChild(det);
  }
}

async function bulkResetTagToday_(tagKeyStr, tagIdStr){
  if(!confirm(`Alle Aufgaben HEUTE in "${tagIdStr}" zurücksetzen?`)) return;
  const snap = await getDocs(query(
    collection(db,"daily_tasks"),
    where("dayKey","==",dayKey()),
    where("tagKey","==",tagKeyStr)
  ));
  for(const d of snap.docs){
    await updateDoc(d.ref,{
      done:false,
      doneBy:[],
      doneAt:"",
      finalOk:false,
      finalBy:"",
      finalAt:"",
      updatedAt:serverTimestamp()
    });
  }
  await alertSafe_("Reset ✓");
}

/* =======================
   21) Points (Ledger)
   ======================= */
async function bookTaskPoints_(task, doneByArr){
  // Prevent double booking: create final record doc with taskId
  const ref = doc(db, "task_finals", task.id);
  const s = await getDoc(ref);
  if(s.exists()) return; // already booked once

  const users = uniq(doneByArr);
  if(!users.length) return;

  const batch = writeBatch(db);

  // mark booked
  batch.set(ref,{
    taskId: task.id,
    dayKey: task.dayKey,
    tagId: task.tagId,
    task: task.task,
    users,
    bookedAt: serverTimestamp(),
    bookedBy: auth.currentUser.uid
  },{merge:true});

  // add ledger entries
  users.forEach(u=>{
    const entry = doc(collection(db,"points_tasks"));
    batch.set(entry,{
      user: u,
      amount: 1,
      dayKey: task.dayKey,
      type: "task",
      tagId: task.tagId,
      task: task.task,
      createdAt: serverTimestamp()
    });
  });

  await batch.commit();
}

async function bookRidePoint_(name, einsatz){
  const entry = doc(collection(db,"points_rides"));
  await setDoc(entry,{
    user: name,
    amount: 1,
    type: "ride",
    einsatz: einsatz,
    createdAt: serverTimestamp()
  },{merge:true});
}

async function recomputePointsUI_(){
  if(!isAdmin){ if(pointsList) pointsList.innerHTML=""; return; }

  const [tSnap, rSnap] = await Promise.all([
    getDocs(query(collection(db,"points_tasks"))),
    getDocs(query(collection(db,"points_rides")))
  ]);

  const taskPts = new Map();
  tSnap.docs.forEach(d=>{
    const x = d.data()||{};
    const u = n(x.user);
    taskPts.set(u, (taskPts.get(u)||0) + Number(x.amount||0));
  });

  const ridePts = new Map();
  rSnap.docs.forEach(d=>{
    const x = d.data()||{};
    const u = n(x.user);
    ridePts.set(u, (ridePts.get(u)||0) + Number(x.amount||0));
  });

  const allUsers = uniq([ ...taskPts.keys(), ...ridePts.keys(), ...employees ]);

  if(!pointsList) return;
  pointsList.innerHTML="";

  allUsers.forEach(u=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">${esc(u)}</div>
        <div class="sub muted small">Aufgabenpunkte: <b>${taskPts.get(u)||0}</b> · Fahrtenpunkte: <b>${ridePts.get(u)||0}</b></div>
      </div>
    `;
    pointsList.appendChild(div);
  });
}

/* =======================
   22) Rides (72h)
   ======================= */
function renderRides_(){
  if(!ridesList) return;
  ridesList.innerHTML="";

  const cutoff = hoursAgoTs(72);
  const list = allRides
    .filter(r => (r.ts || 0) >= cutoff)
    .sort((a,b)=>(b.ts||0)-(a.ts||0));

  if(!list.length){
    ridesList.innerHTML = `<div class="muted">Keine Fahrten in den letzten 72h.</div>`;
    return;
  }

  list.forEach(r=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">🚗 ${esc(r.name||"")} — Einsatz: ${esc(r.einsatz||"")}</div>
        <div class="sub muted small">${esc(r.at||"")}</div>
      </div>
      <div class="actions">
        ${isAdmin ? `<button class="btn danger" data-del="1">🗑️</button>` : ``}
      </div>
    `;
    const del = div.querySelector('[data-del="1"]');
    if(del){
      del.onclick = async ()=>{
        if(!confirm("Fahrt löschen?")) return;
        await deleteDoc(doc(db,"rides", r.id));
      };
    }
    ridesList.appendChild(div);
  });
}

/* =======================
   23) Day Change (Auto-ish)
   ======================= */
async function runDayChangeIfNeeded_(){
  // echte 00:00 Automatik geht ohne Server nicht, wenn App geschlossen ist.
  // Lösung: beim Öffnen prüfen, ob "gestern" noch nicht archiviert wurde.
  // -> hier: wir machen nur "heute tasks generieren" und lassen Archiv optional (Admin Button).
  await ensureTodayTasksGenerated_();
}

/* =======================
   24) UI Events
   ======================= */
reloadBtn && (reloadBtn.onclick = () => location.reload());

logoutBtn && (logoutBtn.onclick = async ()=>{
  try{ await signOut(auth); }catch(_){}
  localStorage.removeItem("meName");
  localStorage.removeItem("sessionOk");
  location.reload();
});

showUidBtn && (showUidBtn.onclick = async ()=>{
  await ensureAnon_();
  const uid = auth.currentUser.uid;
  if(uidBox) uidBox.textContent = uid;
  if(copyUidBtn) copyUidBtn.disabled = false;
  await alertSafe_("UID:\n" + uid);
});
copyUidBtn && (copyUidBtn.onclick = async ()=>{
  const uid = auth?.currentUser?.uid || "";
  if(!uid) return;
  try{ await navigator.clipboard.writeText(uid); await alertSafe_("UID kopiert ✓"); }
  catch(e){ await alertSafe_(uid); }
});

closeTagBtn && (closeTagBtn.onclick = ()=>closeTag_());
openTodayExtrasBtn && (openTodayExtrasBtn.onclick = ()=>addTodayExtraTask_());

tagSearch && (tagSearch.oninput = ()=>renderTags_());

toggleOnlyOpenBtn && (toggleOnlyOpenBtn.onclick = ()=>{ onlyOpen=!onlyOpen; renderGod_(); });

saveVacBtn && (saveVacBtn.onclick = ()=>saveVacation_());

loginBtn && (loginBtn.onclick = async ()=>{
  loginErr && (loginErr.textContent="");

  const nm = n(nameSel?.value);
  const pw = n(pwInp?.value);
  if(!nm){ loginErr.textContent="Bitte Name wählen."; return; }
  if(!pw){ loginErr.textContent="Bitte Passwort eingeben."; return; }

  await ensureAnon_();

  // verify
  const ok = await verifyPassword_(nm, pw);
  if(!ok.ok){
    loginErr.textContent = ok.reason === "NO_PASSWORD_SET"
      ? "Für diesen Mitarbeiter ist noch kein Passwort gesetzt. Admin muss es im Adminbereich setzen."
      : "Passwort falsch.";
    return;
  }

  meName = nm;
  sessionOk = true;
  localStorage.setItem("meName", nm);
  localStorage.setItem("sessionOk", "1");

  await refreshRole_();
  setWho_();
  setTab_("tasks");
  enterApp_();
});

addRideBtn && (addRideBtn.onclick = async ()=>{
  const nm = n(rideNameSel?.value) || meName;
  const eins = n(rideEinsatz?.value);
  if(!nm){ await alertSafe_("Name fehlt."); return; }
  if(!eins){ await alertSafe_("Einsatznummer fehlt."); return; }

  const ts = Date.now();
  await addDoc(collection(db,"rides"),{
    name: nm,
    einsatz: eins,
    at: stamp(),
    ts,
    createdAt: serverTimestamp()
  });

  // Fahrtenpunkt sofort buchen (separates Konto)
  await bookRidePoint_(nm, eins);

  if(rideEinsatz) rideEinsatz.value="";
  if(rideInfo){ rideInfo.textContent="Gespeichert ✓"; setTimeout(()=>rideInfo.textContent="",1200); }
});

empAddBtn && (empAddBtn.onclick = async ()=>{
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  const nm = n(empAdd?.value);
  if(!nm){ await alertSafe_("Name fehlt."); return; }
  await setDoc(doc(db,"employees_public", key(nm)), { name:nm, updatedAt:serverTimestamp() }, { merge:true });
  if(empAdd) empAdd.value="";
});

tagAddBtn && (tagAddBtn.onclick = async ()=>{
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  const tid = n(tagAdd?.value);
  if(!tid){ await alertSafe_("Tag_ID fehlt."); return; }
  await setDoc(doc(db,"tags", key(tid)), { tagId:tid, tagKey:key(tid), updatedAt:serverTimestamp() }, { merge:true });
  if(tagAdd) tagAdd.value="";
});

newTaskBtn && (newTaskBtn.onclick = async ()=>{
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  if(!currentTagId){ await alertSafe_("Erst Tag öffnen."); return; }
  const t = prompt("Neue Aufgabe (heute, für diesen Tag):");
  if(!t) return;
  await addDoc(collection(db,"daily_tasks"),{
    dayKey: dayKey(),
    weekday: weekdayKey(),
    tagId: currentTagId,
    tagKey: currentTagKey,
    task: n(t),
    source: "extra",
    done:false,
    doneBy:[],
    doneAt:"",
    finalOk:false,
    finalBy:"",
    finalAt:"",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
});

dayChangeBtn && (dayChangeBtn.onclick = async ()=>{
  // ohne Server: nur manuell archivieren möglich -> optional später
  await alertSafe_("Hinweis: echter automatischer Tageswechsel um 00:00 braucht Server/Function.\nAktuell werden tägliche Aufgaben beim Start erzeugt.\nArchivierung kommt als nächster Schritt.");
});

refreshPointsBtn && (refreshPointsBtn.onclick = ()=>recomputePointsUI_());

/* Superadmin manage */
adminUidAddBtn && (adminUidAddBtn.onclick = async ()=>{
  if(!isSuperAdmin){ await alertSafe_("Nur Superadmin."); return; }
  const uid = n(adminUidAdd?.value);
  if(!uid){ await alertSafe_("UID fehlt."); return; }
  await ensureCountsDoc_();
  const counts = await getCounts_();
  if((counts.adminCount||0) >= MAX_ADMIN){ await alertSafe(`Max ${MAX_ADMIN} Admins.`); return; }
  await setDoc(doc(db,"admins",uid), { enabled:true, addedAt:serverTimestamp(), addedBy:auth.currentUser.uid }, { merge:true });
  await incCount_("adminCount", +1);
  if(adminUidAdd) adminUidAdd.value="";
});

superUidAddBtn && (superUidAddBtn.onclick = async ()=>{
  if(!isSuperAdmin){ await alertSafe_("Nur Superadmin."); return; }
  const uid = n(superUidAdd?.value);
  if(!uid){ await alertSafe_("UID fehlt."); return; }
  await ensureCountsDoc_();
  const counts = await getCounts_();
  if((counts.superCount||0) >= MAX_SUPER){ await alertSafe(`Max ${MAX_SUPER} Superadmins.`); return; }
  await setDoc(doc(db,"superadmins",uid), { enabled:true, addedAt:serverTimestamp(), addedBy:auth.currentUser.uid }, { merge:true });
  await incCount_("superCount", +1);
  if(superUidAdd) superUidAdd.value="";
});

/* =======================
   25) Streams
   ======================= */
function renderAdmins_(rows){
  if(!adminUidList) return;
  adminUidList.innerHTML="";
  if(!rows.length){ adminUidList.innerHTML=`<div class="muted">Keine Admins.</div>`; return; }
  rows.forEach(r=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`
      <div class="main">
        <div class="title">ADMIN UID: ${esc(r.id)}</div>
        <div class="sub muted small">enabled: ${String(r.enabled===true)}</div>
      </div>
      <div class="actions"><button class="btn danger">Entfernen</button></div>
    `;
    div.querySelector("button").onclick = async ()=>{
      if(!isSuperAdmin){ await alertSafe_("Nur Superadmin."); return; }
      if(!confirm("Admin entfernen?")) return;
      await deleteDoc(doc(db,"admins",r.id));
      await incCount_("adminCount",-1);
    };
    adminUidList.appendChild(div);
  });
}
function renderSuperAdmins_(rows){
  if(!superUidList) return;
  superUidList.innerHTML="";
  if(!rows.length){ superUidList.innerHTML=`<div class="muted">Keine Superadmins.</div>`; return; }
  rows.forEach(r=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`
      <div class="main">
        <div class="title">SUPERADMIN UID: ${esc(r.id)}</div>
        <div class="sub muted small">enabled: ${String(r.enabled===true)}</div>
      </div>
      <div class="actions"><button class="btn danger">Entfernen</button></div>
    `;
    div.querySelector("button").onclick = async ()=>{
      if(!isSuperAdmin){ await alertSafe_("Nur Superadmin."); return; }
      const counts = await getCounts_();
      if((counts.superCount||0) <= 1){ await alertSafe_("Mindestens 1 Superadmin muss bleiben."); return; }
      if(!confirm("Superadmin entfernen?")) return;
      await deleteDoc(doc(db,"superadmins",r.id));
      await incCount_("superCount",-1);
    };
    superUidList.appendChild(div);
  });
}

async function startStreams_(){
  // employees public
  if(unsubEmployees) unsubEmployees();
  unsubEmployees = onSnapshot(query(collection(db,"employees_public"), orderBy("name")),
    (snap)=>{
      employees = snap.docs.map(d=>n(d.data().name)).filter(Boolean);
      renderEmployeeSelectors_();
      if(isAdmin) renderEmployeesAdmin_();
    }
  );

  // tags
  if(unsubTags) unsubTags();
  unsubTags = onSnapshot(query(collection(db,"tags"), orderBy("tagId")),
    (snap)=>{
      tags = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderTags_();
      if(isAdmin) renderAdminTags_();
    }
  );

  // all tasks today (for dashboard)
  if(unsubAllTasks) unsubAllTasks();
  unsubAllTasks = onSnapshot(
    query(collection(db,"daily_tasks"), where("dayKey","==",dayKey()), orderBy("tagKey"), orderBy("createdAt")),
    (snap)=>{
      allTasks = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderGod_();
    }
  );

  // rides last 72h (we fetch all & filter client)
  if(unsubRides) unsubRides();
  unsubRides = onSnapshot(query(collection(db,"rides"), orderBy("ts","desc")),
    (snap)=>{
      allRides = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderRides_();
    }
  );

  // admins / superadmins lists
  if(unsubAdmins) unsubAdmins();
  unsubAdmins = onSnapshot(query(collection(db,"admins"), orderBy("addedAt")),
    (snap)=>{
      if(!isAdmin){ if(adminUidList) adminUidList.innerHTML=""; return; }
      renderAdmins_(snap.docs.map(d=>({id:d.id, ...d.data()})));
    }
  );

  if(unsubSupers) unsubSupers();
  unsubSupers = onSnapshot(query(collection(db,"superadmins"), orderBy("addedAt")),
    (snap)=>{
      if(!isAdmin){ if(superUidList) superUidList.innerHTML=""; return; }
      renderSuperAdmins_(snap.docs.map(d=>({id:d.id, ...d.data()})));
    }
  );

  if(godSearch) godSearch.oninput = ()=>renderGod_();
}

/* =======================
   26) Init
   ======================= */
onAuthStateChanged(auth, async ()=>{
  await ensureAnon_();

  // UI badges
  if(todayBadge) todayBadge.textContent = "Heute: " + dayKey();
  if(rideWindow) rideWindow.textContent = "Fenster: 72h";

  // bootstrap
  await ensureCountsDoc_();
  await bootstrapSuperAdminOnce_();
  await seedFirstEmployeeIfEmpty_();

  // roles + settings
  await refreshRole_();
  await loadVacation_();

  // generate today tasks from weekly plan (if needed)
  await runDayChangeIfNeeded_();

  // streams
  await startStreams_();

  // restore session
  const storedName = n(localStorage.getItem("meName"));
  const storedOk = localStorage.getItem("sessionOk") === "1";
  if(storedName && storedOk){
    meName = storedName;
    sessionOk = true;
    setWho_();
    enterApp_();
    setTab_("tasks");
  }else{
    leaveApp_();
    setTab_("tasks");
  }
});
