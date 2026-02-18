import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { initializeFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCPTt1ZZ-lj5qZ1Rrn-N7e5QZnhtXB-Pu8",
  authDomain: "aufgabenliste-zdl-ra-93.firebaseapp.com",
  projectId: "aufgabenliste-zdl-ra-93",
  storageBucket: "aufgabenliste-zdl-ra-93.firebasestorage.app",
  messagingSenderId: "857214150388",
  appId: "1:857214150388:web:8bc019911092be0cffe0a1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { experimentalForceLongPolling: true, useFetchStreams: false });

/* --- State --- */
let meName = localStorage.getItem("meName") || "", meKey = localStorage.getItem("meKey") || "";
let isAdmin = false, isSuperAdmin = false, myMuteUntil = "";
let tags = [], employees = [], hygieneCats = [];
let currentTagKey = "", selectedTaskId = "";

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const n = (v) => String(v ?? "").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function keyOfName(name) { return n(name).toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss").replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, ""); }
function dayKeyNow() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function stamp() { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

/* --- 1. BOOTSTRAP & LOGIN --- */
signInAnonymously(auth).catch(console.error);
onSnapshot(query(collection(db, "employees"), orderBy("name")), s => {
  employees = s.docs.map(d => d.data());
  const sel = $("nameSel");
  if (!sel) return;
  if (employees.length === 0) {
    sel.innerHTML = `<option>DB LEER</option>`;
  } else {
    const opts = employees.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
    sel.innerHTML = `<option value="">Wählen...</option>` + opts;
    if ($("doneBySel")) $("doneBySel").innerHTML = opts;
    if ($("rideNameSel")) $("rideNameSel").innerHTML = opts;
  }
});

if ($("loginBtn")) $("loginBtn").onclick = async () => {
  const name = n($("nameSel")?.value), pass = n($("passInp")?.value);
  if (!name || !pass) return alert("Eingabe fehlt");
  const key = keyOfName(name);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${pass}`)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""));
  const eSnap = await getDoc(doc(db, "employees", key));
  if (!eSnap.exists()) return alert("User unbekannt");
  if (!eSnap.data().passHash) await updateDoc(doc(db, "employees", key), { passHash: hash });
  else if (eSnap.data().passHash !== hash) return alert("Falsch");
  localStorage.setItem("meName", name); localStorage.setItem("meKey", key); location.reload();
};

/* --- 2. MAIN AUTH STATE --- */
onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    const uRef = doc(db, "users", user.uid);
    await setDoc(uRef, { name: meName, nameKey: meKey }, { merge: true });
    const uSnap = await getDoc(uRef);
    if(uSnap.exists()) { myMuteUntil = uSnap.data().muteUntil || ""; if($("muteUntilInp")) $("muteUntilInp").value = myMuteUntil; updateMuteStatus(); }

    const [s, a] = await Promise.all([getDoc(doc(db, "superadmins_by_name", meKey)), getDoc(doc(db, "admins_by_name", meKey))]);
    isSuperAdmin = s.exists() && s.data()?.enabled; isAdmin = isSuperAdmin || (a.exists() && a.data()?.enabled);
    
    $("whoami").textContent = `${meName}${isAdmin?" (A)":""}`;
    show($("adminTabBtn"), isAdmin); show($("adminArea"), isAdmin); show($("adminLock"), !isAdmin); show($("newDailyTaskBtn"), isAdmin);
    show($("loginView"), false); show($("appView"), true);
    
    initStreams();
    initPushSystem();
    if (isAdmin) { initAdminLogic(); runDayChange(); }
  } else { show($("loginView"), true); }
});

/* --- 3. PUSH SYSTEM --- */
function initPushSystem() {
  $("settingsBtn").onclick = () => show($("settingsCard"), true);
  $("closeSettingsBtn").onclick = () => show($("settingsCard"), false);
  $("reqPermBtn").onclick = () => Notification.requestPermission().then(p => { if(p==="granted") new Notification("Aktiv!"); });
  $("saveMuteBtn").onclick = async () => { const v = $("muteUntilInp").value; myMuteUntil = v; await updateDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: v }); updateMuteStatus(); alert("Ok"); };
  $("clearMuteBtn").onclick = async () => { myMuteUntil = ""; await updateDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: "" }); updateMuteStatus(); };
  setInterval(checkPushTime, 60000);
}
function updateMuteStatus() { if($("muteStatus")) $("muteStatus").textContent = (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) ? "🔕 Stumm bis " + myMuteUntil : "🔔 Aktiv"; }
let lastPushKey = "";
function checkPushTime() {
  if (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) return;
  const h = new Date().getHours();
  const key = `${dayKeyNow()}_${h}`;
  if ([9, 12, 14, 16, 18].includes(h) && lastPushKey !== key) {
    if(Notification.permission === "granted") new Notification("Aufgaben Check!", { body: "Schau mal in die Liste." });
    lastPushKey = key;
  }
}

/* --- 4. STREAMS --- */
function initStreams() {
  onSnapshot(query(collection(db, "tags")), s => {
    tags = s.docs.map(d => ({id:d.id, ...d.data()}));
    tags.sort((a,b) => a.tagId.localeCompare(b.tagId));
    renderTags();
    if($("planTagSel")) $("planTagSel").innerHTML = `<option value="">-- Alle --</option>` + tags.map(t=>`<option value="${t.tagKey}">${t.tagId}</option>`).join("");
  });
  onSnapshot(collection(db, "hygiene_cats"), s => {
    hygieneCats = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderHygieneUserView();
    if(isAdmin) renderHygieneAdmin();
  });
  onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(50)), s => {
    $("ridesList").innerHTML = s.docs.map(d => {
      const r = d.data();
      return `<div class="item"><div class="main"><b>🚗 ${esc(r.name)}</b><br><small>Einsatz: ${esc(r.einsatz)}</small></div>${isAdmin?`<button class="btn danger" onclick="delRide('${d.id}')">X</button>`:''}</div>`;
    }).join("");
  });
}
window.delRide = async (id) => { if(confirm("Löschen?")) await deleteDoc(doc(db, "rides", id)); };

/* --- 5. ACTIONS --- */
function renderTags() {
  const q = n($("tagSearch").value).toLowerCase();
  $("tagList").innerHTML = tags.filter(t=>t.tagId.toLowerCase().includes(q)).map(t=>`<div class="item"><span>🏷️ ${t.tagId}</span><button class="btn ghost" onclick="openTag('${t.tagKey}','${t.tagId}')">Öffnen</button></div>`).join("");
}
window.openTag = (key, id) => {
  currentTagKey = key; $("openTagTitle").textContent = `Tag: ${id}`;
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", key), where("type", "==", "task")), s => {
    $("taskList").innerHTML = s.docs.map(d => {
      const t = d.data(); if(!isAdmin && t.status !== "open") return "";
      return `<div class="item"><b>${t.status==='open'?'⏳':'✅'} ${esc(t.text)}</b><button class="btn ghost" onclick="selectTask('${d.id}','${esc(t.text)}')">Wählen</button></div>`;
    }).join("");
  });
};
window.selectTask = (id, txt) => { selectedTaskId = id; $("taskHint").textContent = txt; };
$("markSelectedDoneBtn").onclick = async () => {
  const who = Array.from($("doneBySel").selectedOptions).map(o=>o.value);
  if(selectedTaskId && who.length) { await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp() }); selectedTaskId = ""; }
};

/* --- 6. GRUNDDESINFEKTION --- */
function renderHygieneUserView() {
  const cont = $("hygieneUserList"); if(!cont) return; cont.innerHTML = "";
  hygieneCats.forEach(cat => {
    const div = document.createElement("div");
    div.innerHTML = `<h3 style="margin-top:10px">${esc(cat.title)}</h3><div id="hlist_${cat.id}" class="list"></div>`;
    cont.appendChild(div);
    onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("catId", "==", cat.id), where("type", "==", "hygiene")), s => {
      $(`hlist_${cat.id}`).innerHTML = s.docs.map(d => {
        if(d.data().status !== "open" && !isAdmin) return "";
        return `<div class="item"><span>${esc(d.data().text)}</span><button class="btn ghost" onclick="finishHyg('${d.id}')">Abhaken</button></div>`;
      }).join("");
    });
  });
}
window.finishHyg = async (id) => { await updateDoc(doc(db, "daily_tasks", id), { status: "done", doneBy: [meName], doneAt: stamp() }); };

/* --- 7. ADMIN --- */
function initAdminLogic() {
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    const tH = [], hH = [];
    s.docs.forEach(d => {
      const t = d.data();
      const html = `<div class="item"><div><b>${esc(t.text)}</b><br><small>${t.doneBy.join(", ")}</small></div><div><button class="btn danger" onclick="rejectTask('${d.id}')">❌</button><button class="btn ghost" onclick="finalCheck('${d.id}','${t.type}')">OK</button></div></div>`;
      if(t.type === "hygiene") hH.push(html); else tH.push(html);
    });
    $("finalListTasks").innerHTML = tH.join(""); $("finalListHygiene").innerHTML = hH.join("");
  });
}
window.rejectTask = async (id) => { if(confirm("Nicht bestanden?")) await updateDoc(doc(db, "daily_tasks", id), { status: "open", doneBy: [], doneAt: null }); };
window.finalCheck = async (id, type) => {
  const dRef = doc(db, "daily_tasks", id); const snap = await getDoc(dRef); await updateDoc(dRef, { status: "final" });
  if(type !== "hygiene") {
    for(const name of snap.data().doneBy) {
      const pRef = doc(db, "points_tasks", keyOfName(name)); const pS = await getDoc(pRef);
      await setDoc(pRef, { points: (pS.exists()?pS.data().points:0)+1 }, { merge: true });
    }
  }
};

/* --- 8. GENERATOR --- */
async function generate(dateKey) {
  const batch = writeBatch(db); const wd = new Date().getDay() || 7;
  const wS = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd)));
  wS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [], type: "task" }));
  const hS = await getDocs(collection(db, "hygiene_templates"));
  hS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [], type: "hygiene" }));
  await batch.commit();
}
async function runDayChange() {
  const today = dayKeyNow(); const mS = await getDoc(doc(db, "meta", "day_state"));
  if (mS.exists() && mS.data().lastDayKey === today) return;
  await generate(today); await setDoc(doc(db, "meta", "day_state"), { lastDayKey: today }, { merge: true });
}
if($("regenTestBtn")) $("regenTestBtn").onclick = async () => {
  const today = dayKeyNow(); const ex = await getDocs(query(collection(db, "daily_tasks"), where("dateKey", "==", today)));
  const b = writeBatch(db); ex.forEach(d => b.delete(d.ref)); await b.commit();
  await generate(today); alert("Neu generiert!");
};

/* --- TAB LOGIC --- */
document.querySelectorAll(".tabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".tab").forEach(t => show(t, false)); show($(b.dataset.tab), true); document.querySelectorAll(".tabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active"); });
document.querySelectorAll(".subtabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".subtab").forEach(s => show(s, false)); show($(b.dataset.subtab), true); document.querySelectorAll(".subtabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active"); });
