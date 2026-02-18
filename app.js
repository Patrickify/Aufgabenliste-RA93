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
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

/* --- State --- */
let meName = localStorage.getItem("meName") || "", meKey = localStorage.getItem("meKey") || "";
let isAdmin = false, myMuteUntil = "", currentTagKey = "", activeCheckTaskId = null, selectedTaskId = "";
let employees = [], tags = [], hygieneCats = [];

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const n = (v) => String(v ?? "").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function keyOfName(name) { return n(name).toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss").replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, ""); }
function dayKeyNow() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function stamp() { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

/* --- 1. BOOTSTRAP & LOGIN --- */
signInAnonymously(auth).catch(console.error);
onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    const uRef = doc(db, "users", user.uid);
    await setDoc(uRef, { name: meName, nameKey: meKey }, { merge: true });
    const uSnap = await getDoc(uRef);
    if(uSnap.exists()) { myMuteUntil = uSnap.data().muteUntil || ""; updateMuteStatus(); if($("muteUntilInp")) $("muteUntilInp").value = myMuteUntil; }

    const adminSnap = await getDoc(doc(db, "admins_by_name", meKey));
    isAdmin = adminSnap.exists() && adminSnap.data()?.enabled;
    
    $("whoami").textContent = `${meName}${isAdmin?" (Admin)":""}`;
    show($("adminTabBtn"), isAdmin); show($("loginView"), false); show($("appView"), true);
    
    initStreams();
    initPushSystem();
    if (isAdmin) initAdminLogic();
    runDayChange();
  } else { show($("loginView"), true); }
});

if ($("loginBtn")) $("loginBtn").onclick = async () => {
  const name = n($("nameSel").value), pass = n($("passInp").value);
  if (!name || !pass) return alert("Fehlende Daten");
  const key = keyOfName(name);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${pass}`)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""));
  const eSnap = await getDoc(doc(db, "employees", key));
  if (!eSnap.exists()) return alert("Mitarbeiter nicht gefunden");
  if (!eSnap.data().passHash) await updateDoc(doc(db, "employees", key), { passHash: hash });
  else if (eSnap.data().passHash !== hash) return alert("Falsches Passwort");
  localStorage.setItem("meName", name); localStorage.setItem("meKey", key); location.reload();
};

/* --- 2. PUSH & URLAUB --- */
function initPushSystem() {
  $("settingsBtn").onclick = () => show($("settingsCard"), true);
  $("closeSettingsBtn").onclick = () => show($("settingsCard"), false);
  $("reqPermBtn").onclick = () => Notification.requestPermission();
  $("saveMuteBtn").onclick = async () => { const v = $("muteUntilInp").value; await updateDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: v }); myMuteUntil = v; updateMuteStatus(); };
  $("clearMuteBtn").onclick = async () => { await updateDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: "" }); myMuteUntil = ""; updateMuteStatus(); };
  setInterval(checkPushTime, 60000);
}
function updateMuteStatus() { if($("muteStatus")) $("muteStatus").textContent = (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) ? "🔕 Stumm bis " + myMuteUntil : "🔔 Push aktiv"; }
function checkPushTime() {
  if (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) return;
  const h = new Date().getHours();
  if ([9, 12, 14, 16, 18].includes(h) && new Date().getSeconds() < 60) {
    if(Notification.permission === "granted") new Notification("Check RA 93", { body: "Zeit für die Aufgaben!" });
  }
}

/* --- 3. STREAMS & RENDER --- */
function initStreams() {
  onSnapshot(query(collection(db, "employees"), orderBy("name")), s => {
    employees = s.docs.map(d => d.data());
    const opts = employees.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
    $("nameSel").innerHTML = `<option value="">Wählen...</option>` + opts;
    $("doneBySel").innerHTML = opts; $("rideNameSel").innerHTML = opts;
    if(isAdmin) $("empList").innerHTML = employees.map(e => `<div class="item"><span>${esc(e.name)}</span></div>`).join("");
  });

  onSnapshot(query(collection(db, "tags"), orderBy("tagId")), s => {
    tags = s.docs.map(d => ({id:d.id, ...d.data()}));
    const q = n($("tagSearch").value).toLowerCase();
    $("tagList").innerHTML = tags.filter(t=>t.tagId.toLowerCase().includes(q)).map(t=>`<div class="item"><span>🏷️ ${t.tagId}</span><button class="btn ghost" onclick="openTag('${t.tagKey}','${t.tagId}')">Öffnen</button></div>`).join("");
    if($("planTagSel")) $("planTagSel").innerHTML = tags.map(t=>`<option value="${t.tagKey}">${t.tagId}</option>`).join("");
    if(isAdmin) $("adminTagList").innerHTML = tags.map(t => `<div class="item"><span>${t.tagId}</span><button class="btn danger" onclick="delDoc('tags','${t.id}')">X</button></div>`).join("");
  });

  onSnapshot(collection(db, "hygiene_cats"), s => {
    hygieneCats = s.docs.map(d => ({id:d.id, ...d.data()}));
    const userCont = $("hygieneUserList"); userCont.innerHTML = "";
    hygieneCats.forEach(cat => {
      userCont.innerHTML += `<h3>${esc(cat.title)}</h3><div id="hlist_${cat.id}" class="list"></div>`;
      onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("catId", "==", cat.id)), snap => {
        $(`hlist_${cat.id}`).innerHTML = snap.docs.map(d => {
          if(d.data().status !== "open" && !isAdmin) return "";
          return `<div class="item"><span>${esc(d.data().text)}</span><button class="btn ghost" onclick="openHygCheck('${d.id}')">Bearbeiten</button></div>`;
        }).join("");
      });
    });
    if(isAdmin) {
      $("hygieneCatList").innerHTML = hygieneCats.map(c => `<div class="item"><span>${esc(c.title)}</span><button class="btn danger" onclick="delDoc('hygiene_cats','${c.id}')">X</button></div>`).join("");
      $("hygieneItemCatSel").innerHTML = hygieneCats.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join("");
    }
  });

  onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(20)), s => {
    $("ridesList").innerHTML = s.docs.map(d => `<div class="item"><b>🚗 ${esc(d.data().name)}</b> <span>${d.data().einsatz}</span></div>`).join("");
  });
}

/* --- 4. AUFGABEN & CHECKLISTE --- */
window.openTag = (key, id) => {
  currentTagKey = key; $("openTagTitle").textContent = `Tag: ${id}`;
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", key), where("type", "==", "task")), s => {
    $("taskList").innerHTML = s.docs.map(d => `<div class="item"><b>${d.data().status==='open'?'⏳':'✅'} ${esc(d.data().text)}</b><button class="btn ghost" onclick="selectedTaskId='${d.id}';$('taskHint').textContent='Gewählt: '+ '${esc(d.data().text)}'">Wählen</button></div>`).join("");
  });
};

$("markSelectedDoneBtn").onclick = async () => {
  const who = Array.from($("doneBySel").selectedOptions).map(o=>o.value);
  if(selectedTaskId && who.length) { await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp() }); selectedTaskId=""; $("taskHint").textContent=""; }
};

window.openHygCheck = async (id) => {
  activeCheckTaskId = id; const snap = await getDoc(doc(db, "daily_tasks", id)); const data = snap.data();
  $("modalTitle").textContent = data.text; const cont = $("modalSubtasks"); cont.innerHTML = "";
  if (!data.subtasks || data.subtasks.length === 0) { if(confirm("Abschließen?")) finishHyg(id); return; }
  data.subtasks.forEach(sub => cont.innerHTML += `<label class="item"><input type="checkbox" class="sub-check"> <span>${esc(sub)}</span></label>`);
  show($("checkModal"), true);
};

$("saveCheckBtn").onclick = async () => {
  if (Array.from(document.querySelectorAll(".sub-check")).every(c => c.checked)) {
    await updateDoc(doc(db, "daily_tasks", activeCheckTaskId), { status: "done", doneBy: [meName], doneAt: stamp() });
    show($("checkModal"), false);
  } else alert("Punkte offen!");
};

/* --- 5. ADMIN LOGIK --- */
function initAdminLogic() {
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    const tH = [], hH = [];
    s.docs.forEach(d => {
      const t = d.data(); const html = `<div class="item"><div><b>${esc(t.text)}</b><br><small>${t.doneBy.join(", ")}</small></div><button class="btn ghost" onclick="finalCheck('${d.id}')">OK</button></div>`;
      if(t.type === "hygiene") hH.push(html); else tH.push(html);
    });
    $("finalListTasks").innerHTML = tH.join(""); $("finalListHygiene").innerHTML = hH.join("");
  });
  onSnapshot(collection(db, "hygiene_templates"), s => $("hygieneTemplateList").innerHTML = s.docs.map(d => `<div class="item"><span>${esc(d.data().text)}</span><button class="btn danger" onclick="delDoc('hygiene_templates','${d.id}')">X</button></div>`).join(""));
}

window.finalCheck = async (id) => {
  const dRef = doc(db, "daily_tasks", id); const snap = await getDoc(dRef); await updateDoc(dRef, { status: "final" });
  if(snap.data().type !== "hygiene") {
    for(const name of snap.data().doneBy) {
      const pRef = doc(db, "points_tasks", keyOfName(name)); const pS = await getDoc(pRef);
      await setDoc(pRef, { points: (pS.exists()?pS.data().points:0)+1 }, { merge: true });
    }
  }
};

/* ADMIN SETUP */
$("hygieneCatAddBtn").onclick = async () => { if($("hygieneCatInp").value) await addDoc(collection(db, "hygiene_cats"), { title: $("hygieneCatInp").value }); $("hygieneCatInp").value=""; };
$("hygieneItemAddBtn").onclick = async () => {
  const subs = $("hygieneSubtasksInp").value.split('\n').filter(l => l.trim() !== "");
  await addDoc(collection(db, "hygiene_templates"), { catId: $("hygieneItemCatSel").value, text: $("hygieneItemInp").value, subtasks: subs, type: "hygiene" });
  $("hygieneItemInp").value=""; $("hygieneSubtasksInp").value="";
};
$("planAddBtn").onclick = async () => { await addDoc(collection(db, "weekly_tasks"), { text: $("planTaskInp").value, tagKey: $("planTagSel").value, weekday: Number($("planWeekdaySel").value), type: "task" }); $("planTaskInp").value=""; };
$("empAddBtn").onclick = async () => { await setDoc(doc(db, "employees", keyOfName($("empAdd").value)), { name: $("empAdd").value, passHash: "" }); $("empAdd").value=""; };
$("tagAddBtn").onclick = async () => { await setDoc(doc(db, "tags", keyOfName($("tagAdd").value)), { tagId: $("tagAdd").value, tagKey: keyOfName($("tagAdd").value) }); $("tagAdd").value=""; };
$("adminUidAddBtn").onclick = async () => { await setDoc(doc(db, "admins_by_name", keyOfName($("adminUidAdd").value)), { enabled: true }); $("adminUidAdd").value=""; };
window.delDoc = (col, id) => deleteDoc(doc(db, col, id));

/* GENERATOR */
async function generate(dateKey) {
  const batch = writeBatch(db); const wd = new Date().getDay() || 7;
  const wS = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd)));
  wS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [] }));
  const hS = await getDocs(collection(db, "hygiene_templates"));
  hS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [] }));
  await batch.commit();
}
async function runDayChange() {
  const today = dayKeyNow(); const mS = await getDoc(doc(db, "meta", "day_state"));
  if (!mS.exists() || mS.data().lastDayKey !== today) { await generate(today); await setDoc(doc(db, "meta", "day_state"), { lastDayKey: today }, { merge: true }); }
}
$("regenTestBtn").onclick = async () => { if(confirm("Tag Reset?")) { const ex = await getDocs(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()))); const b = writeBatch(db); ex.forEach(d => b.delete(d.ref)); await b.commit(); await generate(dayKeyNow()); alert("Neu geladen"); } };

/* TABS */
document.querySelectorAll(".tabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".tab").forEach(t => show(t, false)); show($(b.dataset.tab), true); document.querySelectorAll(".tabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active"); });
document.querySelectorAll(".subtabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".subtab").forEach(s => show(s, false)); show($(b.dataset.subtab), true); document.querySelectorAll(".subtabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active"); });
$("closeModalBtn").onclick = () => show($("checkModal"), false);
$("logoutBtn").onclick = () => { localStorage.clear(); location.reload(); };
$("reloadBtn").onclick = () => location.reload();
