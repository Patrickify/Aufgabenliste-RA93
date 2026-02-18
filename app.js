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

/* --- State & Globale Variablen --- */
let meName = localStorage.getItem("meName") || "", meKey = localStorage.getItem("meKey") || "";
let isAdmin = false, isSuperAdmin = false, myMuteUntil = "";
let tags = [], employees = [], hygieneCats = [];
let currentTagKey = "", selectedTaskId = "", activeCheckTaskId = null;

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const n = (v) => String(v ?? "").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function keyOfName(name) { return n(name).toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss").replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, ""); }
function dayKeyNow() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function monthKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function stamp() { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function getWeekday() { const d = new Date().getDay(); return d === 0 ? 7 : d; }

/* --- 1. LOGIN & AUTH --- */
signInAnonymously(auth).catch(console.error);

onSnapshot(query(collection(db, "employees"), orderBy("name")), s => {
  employees = s.docs.map(d => d.data());
  const opts = employees.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
  if ($("nameSel")) $("nameSel").innerHTML = `<option value="">Wer bist du?</option>` + opts;
  if ($("doneBySel")) $("doneBySel").innerHTML = opts;
  if ($("rideNameSel")) $("rideNameSel").innerHTML = opts;
});

if ($("loginBtn")) $("loginBtn").onclick = async () => {
  const name = n($("nameSel")?.value), pass = n($("passInp")?.value);
  if (!name || !pass) return alert("Eingabe fehlt");
  const key = keyOfName(name);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${pass}`)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""));
  const eSnap = await getDoc(doc(db, "employees", key));
  if (!eSnap.exists()) return alert("User unbekannt");
  if (!eSnap.data().passHash) await updateDoc(doc(db, "employees", key), { passHash: hash });
  else if (eSnap.data().passHash !== hash) return alert("Passwort falsch");
  localStorage.setItem("meName", name); localStorage.setItem("meKey", key); location.reload();
};

onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    const uRef = doc(db, "users", user.uid);
    await setDoc(uRef, { name: meName, nameKey: meKey }, { merge: true });
    const uSnap = await getDoc(uRef);
    if(uSnap.exists()) { 
      myMuteUntil = uSnap.data().muteUntil || ""; 
      if($("muteUntilInp")) $("muteUntilInp").value = myMuteUntil; 
      updateMuteStatus(); 
    }

    const [sSnap, aSnap] = await Promise.all([
      getDoc(doc(db, "superadmins_by_name", meKey)),
      getDoc(doc(db, "admins_by_name", meKey))
    ]);
    isSuperAdmin = sSnap.exists() && sSnap.data()?.enabled === true;
    isAdmin = isSuperAdmin || (aSnap.exists() && aSnap.data()?.enabled === true);

    if($("whoami")) $("whoami").textContent = `${meName}${isSuperAdmin ? " (Super)" : isAdmin ? " (Admin)" : ""}`;
    show($("adminTabBtn"), isAdmin);
    show($("loginView"), false); show($("appView"), true);
    
    initStreams();
    initPushSystem();
    if (isAdmin) { initAdminLogic(); runDayChange(); }
  } else { show($("loginView"), true); }
});

/* --- 2. PUSH & URLAUB --- */
function initPushSystem() {
  if($("settingsBtn")) $("settingsBtn").onclick = () => show($("settingsCard"), true);
  if($("closeSettingsBtn")) $("closeSettingsBtn").onclick = () => show($("settingsCard"), false);
  if($("reqPermBtn")) $("reqPermBtn").onclick = () => Notification.requestPermission();
  
  if($("saveMuteBtn")) $("saveMuteBtn").onclick = async () => {
    const v = $("muteUntilInp").value;
    myMuteUntil = v;
    await updateDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: v });
    updateMuteStatus();
    alert("Gespeichert");
  };
  
  if($("clearMuteBtn")) $("clearMuteBtn").onclick = async () => {
    myMuteUntil = "";
    await updateDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: "" });
    updateMuteStatus();
  };
  setInterval(checkPushTime, 60000);
}

function updateMuteStatus() {
  if($("muteStatus")) $("muteStatus").textContent = (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) ? "🔕 Stumm bis " + myMuteUntil : "🔔 Push Aktiv";
}

let lastPushKey = "";
function checkPushTime() {
  if (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) return;
  const h = new Date().getHours();
  const key = `${dayKeyNow()}_${h}`;
  if ([9, 12, 14, 16, 18].includes(h) && lastPushKey !== key) {
    if(Notification.permission === "granted") {
        new Notification("Check RA 93", { body: "Zeit für die Aufgaben!" });
    }
    lastPushKey = key;
  }
}

/* --- 3. STREAMS & DATA --- */
function initStreams() {
  onSnapshot(query(collection(db, "tags"), orderBy("tagId")), s => {
    tags = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderTagList();
    if($("planTagSel")) $("planTagSel").innerHTML = tags.map(t=>`<option value="${t.tagKey}">${t.tagId}</option>`).join("");
  });

  onSnapshot(collection(db, "hygiene_cats"), s => {
    hygieneCats = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderHygieneUserView();
    if(isAdmin) renderHygieneAdmin();
  });

  onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(25)), s => {
    const cutoff = Date.now() - (72 * 60 * 60 * 1000);
    $("ridesList").innerHTML = s.docs.map(d => {
      const r = d.data();
      if (!isAdmin && r.createdMs < cutoff) return "";
      return `<div class="item">
        <div class="main"><b>🚗 ${esc(r.name)}</b><br><small>Einsatz: ${esc(r.einsatz)}</small></div>
        ${isAdmin ? `<button class="btn danger" onclick="delDoc('rides','${d.id}')">X</button>` : ''}
      </div>`;
    }).join("");
  });
}

/* --- 4. AUFGABEN & CHECKLISTEN --- */
function renderTagList() {
  const q = n($("tagSearch").value).toLowerCase();
  $("tagList").innerHTML = tags.filter(t=>t.tagId.toLowerCase().includes(q)).map(t=>`<div class="item"><span>🏷️ ${t.tagId}</span><button class="btn ghost" onclick="openTag('${t.tagKey}','${t.tagId}')">Öffnen</button></div>`).join("");
}

window.openTag = (key, id) => {
  currentTagKey = key; $("openTagTitle").textContent = `Tag: ${id}`;
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", key), where("type", "==", "task")), s => {
    $("taskList").innerHTML = s.docs.map(d => {
      const t = d.data();
      if(t.status !== "open" && !isAdmin) return "";
      return `<div class="item">
        <div class="main"><b>${t.status==='open'?'⏳':'✅'} ${esc(t.text)}</b></div>
        <button class="btn ghost" onclick="selectedTaskId='${d.id}'; $('taskHint').textContent='Gewählt: ' + '${esc(t.text)}'">Wählen</button>
      </div>`;
    }).join("");
  });
};

$("markSelectedDoneBtn").onclick = async () => {
  const who = Array.from($("doneBySel").selectedOptions).map(o=>o.value);
  if(!selectedTaskId || who.length === 0) return alert("Aufgabe & Personen wählen!");
  await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp() });
  selectedTaskId = "";
};

window.openHygCheck = async (id) => {
  activeCheckTaskId = id;
  const snap = await getDoc(doc(db, "daily_tasks", id));
  const data = snap.data();
  $("modalTitle").textContent = data.text;
  const cont = $("modalSubtasks"); cont.innerHTML = "";
  if (!data.subtasks || data.subtasks.length === 0) {
    if(confirm("Abschließen?")) {
        await updateDoc(doc(db, "daily_tasks", id), { status: "done", doneBy: [meName], doneAt: stamp() });
    }
    return;
  }
  data.subtasks.forEach(sub => cont.innerHTML += `<label class="item"><input type="checkbox" class="sub-check"> <span>${esc(sub)}</span></label>`);
  show($("checkModal"), true);
};

$("saveCheckBtn").onclick = async () => {
  if (Array.from(document.querySelectorAll(".sub-check")).every(c => c.checked)) {
    await updateDoc(doc(db, "daily_tasks", activeCheckTaskId), { status: "done", doneBy: [meName], doneAt: stamp() });
    show($("checkModal"), false);
  } else alert("Punkte offen!");
};

/* --- 5. ADMIN BEREICH --- */
function initAdminLogic() {
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    const tH = [], hH = [];
    s.docs.forEach(d => {
      const t = d.data();
      const html = `<div class="item">
        <div><b>${esc(t.text)}</b><br><small>${t.doneBy.join(", ")}</small></div>
        <div class="row">
          <button class="btn danger" onclick="rejectTask('${d.id}')" style="margin-right:5px">❌</button>
          <button class="btn ghost" onclick="finalCheck('${d.id}','${t.type}')">OK</button>
        </div>
      </div>`;
      if(t.type === "hygiene") hH.push(html); else tH.push(html);
    });
    $("finalListTasks").innerHTML = tH.join(""); $("finalListHygiene").innerHTML = hH.join("");
  });
}

window.rejectTask = async (id) => {
  if(!confirm("Aufgabe als nicht erledigt zurückweisen?")) return;
  await updateDoc(doc(db, "daily_tasks", id), { status: "open", doneBy: [], doneAt: null });
};

window.finalCheck = async (id, type) => {
  const dRef = doc(db, "daily_tasks", id);
  const snap = await getDoc(dRef);
  const data = snap.data();
  // Archiv
  await setDoc(doc(db, "archive", monthKey(), "tasks", id), { ...data, status: "final", finalBy: meName });
  // Punkte
  if(type !== "hygiene") {
    for(const name of data.doneBy) {
      const pRef = doc(db, "points_tasks", keyOfName(name));
      const pS = await getDoc(pRef);
      await setDoc(pRef, { points: (pS.exists() ? pS.data().points : 0) + 1 }, { merge: true });
    }
  }
  await deleteDoc(dRef);
};

/* --- 6. GENERATOR & SETUP --- */
async function generate(dateKey) {
  const batch = writeBatch(db);
  const wd = getWeekday();
  const wS = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd)));
  wS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [], type: "task" }));
  const hS = await getDocs(collection(db, "hygiene_templates"));
  hS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [], type: "hygiene" }));
  await batch.commit();
}

async function runDayChange() {
  const today = dayKeyNow();
  const mS = await getDoc(doc(db, "meta", "day_state"));
  if (!mS.exists() || mS.data().lastDayKey !== today) {
    await generate(today);
    await setDoc(doc(db, "meta", "day_state"), { lastDayKey: today }, { merge: true });
  }
}

/* Admin UI Actions */
$("hygieneCatAddBtn").onclick = async () => { if($("hygieneCatInp").value) await addDoc(collection(db, "hygiene_cats"), { title: $("hygieneCatInp").value }); $("hygieneCatInp").value=""; };
$("hygieneItemAddBtn").onclick = async () => {
  const subs = $("hygieneSubtasksInp").value.split('\n').filter(l => l.trim() !== "");
  await addDoc(collection(db, "hygiene_templates"), { 
    catId: $("hygieneItemCatSel").value, 
    text: $("hygieneItemInp").value, 
    subtasks: subs, 
    type: "hygiene" 
  });
  $("hygieneItemInp").value=""; $("hygieneSubtasksInp").value="";
};

$("empAddBtn").onclick = async () => { if($("empAdd").value) await setDoc(doc(db, "employees", keyOfName($("empAdd").value)), { name: $("empAdd").value, passHash: "" }); $("empAdd").value=""; };
$("superUidAddBtn").onclick = async () => { if($("superUidAdd").value) await setDoc(doc(db, "superadmins_by_name", keyOfName($("superUidAdd").value)), { enabled: true }); $("superUidAdd").value=""; };
$("regenTestBtn").onclick = async () => { if(confirm("Tag Reset?")) { const ex = await getDocs(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()))); const b = writeBatch(db); ex.forEach(d => b.delete(d.ref)); await b.commit(); await generate(dayKeyNow()); alert("Neu!"); } };

/* UI HELPERS */
document.querySelectorAll(".tabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".tab").forEach(t => show(t, false)); show($(b.dataset.tab), true); document.querySelectorAll(".tabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active"); });
document.querySelectorAll(".subtabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".subtab").forEach(s => show(s, false)); show($(b.dataset.subtab), true); document.querySelectorAll(".subtabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active"); });
$("closeModalBtn").onclick = () => show($("checkModal"), false);
$("logoutBtn").onclick = () => { localStorage.clear(); location.reload(); };
$("reloadBtn").onclick = () => location.reload();
