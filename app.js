import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { initializeFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch, increment } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

/* --- GLOBALE VARIABLEN --- */
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

/* --- 1. LOGIN & AUTH (STARTET SOFORT) --- */
signInAnonymously(auth);
initStreams(); // Lädt Namen sofort für das Login-Dropdown

onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    const uRef = doc(db, "users", user.uid);
    await setDoc(uRef, { name: meName, nameKey: meKey }, { merge: true });
    const [sSnap, aSnap, uSnap] = await Promise.all([
      getDoc(doc(db, "superadmins_by_name", meKey)),
      getDoc(doc(db, "admins_by_name", meKey)),
      getDoc(uRef)
    ]);
    if(uSnap.exists()) myMuteUntil = uSnap.data().muteUntil || "";
    isSuperAdmin = sSnap.exists() && sSnap.data()?.enabled === true;
    isAdmin = isSuperAdmin || (aSnap.exists() && aSnap.data()?.enabled === true);
    $("whoami").textContent = `${meName}${isSuperAdmin ? " (S)" : isAdmin ? " (A)" : ""}`;
    show($("adminTabBtn"), isAdmin); show($("loginView"), false); show($("appView"), true);
    if (isAdmin) { initAdminLogic(); runDayChange(); initPushSystem(); }
  } else { show($("loginView"), true); show($("appView"), false); }
});

if ($("loginBtn")) $("loginBtn").onclick = async () => {
  const name = $("nameSel").value, pass = n($("passInp").value);
  if (!name || !pass) return alert("Daten unvollständig!");
  const key = keyOfName(name);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${pass}`)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""));
  const eSnap = await getDoc(doc(db, "employees", key));
  if (!eSnap.exists()) return alert("User unbekannt");
  if (!eSnap.data().passHash) await updateDoc(doc(db, "employees", key), { passHash: hash });
  else if (eSnap.data().passHash !== hash) return alert("Passwort falsch");
  localStorage.setItem("meName", name); localStorage.setItem("meKey", key); location.reload();
};

/* --- 2. DATA STREAMS (LIVE-UPDATES) --- */
function initStreams() {
  onSnapshot(query(collection(db, "employees"), orderBy("name")), s => {
    employees = s.docs.map(d => d.data());
    const opts = `<option value="">Wer bist du?</option>` + employees.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
    if($("nameSel")) $("nameSel").innerHTML = opts; if($("rideNameSel")) $("rideNameSel").innerHTML = opts;
    if ($("doneByCheckBoxes")) {
      $("doneByCheckBoxes").innerHTML = employees.map(e => `<label style="display:flex; align-items:center; gap:12px; padding:12px; background:#1a1f26; border-radius:8px; width:100%;"><input type="checkbox" name="worker" value="${esc(e.name)}" style="width:22px; height:22px;"> <span style="font-size:1.1rem">${esc(e.name)}</span></label>`).join("");
    }
    if (isAdmin && $("empList")) $("empList").innerHTML = employees.map(e => `<div class="item"><span>${esc(e.name)}</span><button class="btn danger" onclick="window.delDoc('employees','${keyOfName(e.name)}')">X</button></div>`).join("");
  });

  onSnapshot(query(collection(db, "tags"), orderBy("tagId")), s => {
    tags = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderTagList();
    const tagOpts = tags.map(t=>`<option value="${t.tagKey}">${t.tagId}</option>`).join("");
    if($("planTagSel")) $("planTagSel").innerHTML = tagOpts;
    if($("extraTaskTagSel")) $("extraTaskTagSel").innerHTML = tagOpts;
    if($("adminTagList")) $("adminTagList").innerHTML = tags.map(t=>`<div class="item"><span>${t.tagId}</span><button class="btn danger" onclick="window.delDoc('tags','${t.id}')">X</button></div>`).join("");
  });

  onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(50)), s => {
    if($("ridesList")) $("ridesList").innerHTML = s.docs.map(d => `<div class="item"><span>🚗 ${esc(d.data().name)} (${esc(d.data().einsatz)})</span>${isAdmin ? `<button class="btn danger" onclick="window.delRide('${d.id}', '${keyOfName(d.data().name)}')">X</button>` : ''}</div>`).join("");
  });

  onSnapshot(collection(db, "hygiene_cats"), s => {
    hygieneCats = s.docs.map(d => ({id: d.id, ...d.data()}));
    renderHygieneUserView();
    if(isAdmin) {
      if($("hygieneCatList")) $("hygieneCatList").innerHTML = hygieneCats.map(c => `<div class="item"><span>${c.title}</span><button class="btn danger" onclick="window.delDoc('hygiene_cats','${c.id}')">X</button></div>`).join("");
      if($("hygieneItemCatSel")) $("hygieneItemCatSel").innerHTML = hygieneCats.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join("");
    }
  });
}

/* --- 3. AUFGABEN-LOGIK (USER) --- */
function renderTagList() {
  const q = n($("tagSearch").value).toLowerCase();
  $("tagList").innerHTML = tags.filter(t=>t.tagId.toLowerCase().includes(q)).map(t=>`<div class="item"><span>🏷️ ${t.tagId}</span><button class="btn ghost" onclick="window.openTag('${t.tagKey}','${t.tagId}')">Öffnen</button></div>`).join("");
}

window.openTag = (key, id) => {
  currentTagKey = key; $("openTagTitle").textContent = `Bereich: ${id}`;
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", key)), s => {
    $("taskList").innerHTML = s.docs.map(d => d.data().status === 'open' ? `<div class="item"><span>${esc(d.data().text)}</span><button class="btn ghost" onclick="window.selectTask('${d.id}', '${esc(d.data().text)}')">Wählen</button></div>` : "").join("");
  });
};

window.selectTask = (id, text) => { selectedTaskId = id; $("taskHint").textContent = "Gewählt: " + text; };

$("markSelectedDoneBtn").onclick = async () => {
  const who = Array.from(document.querySelectorAll('input[name="worker"]:checked')).map(cb => cb.value);
  if(!selectedTaskId || who.length === 0) return alert("Wähle Aufgabe & Personen!");
  await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp() });
  selectedTaskId = ""; $("taskHint").textContent = "";
  document.querySelectorAll('input[name="worker"]').forEach(cb => cb.checked = false);
};

/* --- 4. HYGIENE & CHECKLISTEN --- */
window.openHygCheck = async (id) => {
  activeCheckTaskId = id; const snap = await getDoc(doc(db, "daily_tasks", id)); const data = snap.data();
  $("modalTitle").textContent = data.text; const cont = $("modalSubtasks"); cont.innerHTML = "";
  if (!data.subtasks || data.subtasks.length === 0) { if(confirm("Abschließen?")) { await updateDoc(doc(db, "daily_tasks", id), { status: "done", doneBy: [meName], doneAt: stamp() }); } return; }
  data.subtasks.forEach(sub => cont.innerHTML += `<label class="item"><input type="checkbox" class="sub-check"> <span>${esc(sub)}</span></label>`);
  show($("checkModal"), true);
};

$("saveCheckBtn").onclick = async () => {
  if (Array.from(document.querySelectorAll(".sub-check")).every(c => c.checked)) {
    await updateDoc(doc(db, "daily_tasks", activeCheckTaskId), { status: "done", doneBy: [meName], doneAt: stamp() });
    show($("checkModal"), false);
  } else alert("Bitte alles abhaken!");
};

function renderHygieneUserView() {
  const cont = $("hygieneUserList"); if(!cont) return; cont.innerHTML = "";
  hygieneCats.forEach(cat => {
    cont.innerHTML += `<h3>${esc(cat.title)}</h3><div id="hlist_${cat.id}" class="list"></div>`;
    onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("catId", "==", cat.id)), snap => {
      const l = $(`hlist_${cat.id}`); if(l) l.innerHTML = snap.docs.map(d => d.data().status === 'open' ? `<div class="item"><span>${esc(d.data().text)}</span><button class="btn ghost" onclick="window.openHygCheck('${d.id}')">Check</button></div>` : "").join("");
    });
  });
}

/* --- 5. ADMIN LOGIK & WOCHENPLAN --- */
function initAdminLogic() {
  onSnapshot(query(collection(db, "weekly_tasks"), orderBy("weekday")), s => {
    const days = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    if($("planList")) $("planList").innerHTML = s.docs.map(d => `<div class="item"><span><b>${days[d.data().weekday]}</b>: ${esc(d.data().text)}</span><button class="btn danger" onclick="window.delDoc('weekly_tasks','${d.id}')">X</button></div>`).join("");
  });

  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    const tH = [], hH = [];
    s.docs.forEach(d => {
      const t = d.data();
      const html = `<div class="item"><span>${esc(t.text)} (${t.doneBy.join(",")})</span><div class="row"><button class="btn danger" onclick="window.rejectTask('${d.id}')">❌</button><button class="btn ghost" onclick="window.finalCheck('${d.id}')">OK</button></div></div>`;
      if(t.type === "hygiene") hH.push(html); else tH.push(html);
    });
    $("finalListTasks").innerHTML = tH.join(""); $("finalListHygiene").innerHTML = hH.join("");
  });
  onSnapshot(collection(db, "points_tasks"), st => { onSnapshot(collection(db, "points_rides"), sr => renderPointsTable(st, sr)); });
}

window.finalCheck = async (id) => {
  const dRef = doc(db, "daily_tasks", id); const snap = await getDoc(dRef); const data = snap.data();
  if (data.type !== "hygiene") { for (const name of data.doneBy) { await setDoc(doc(db, "points_tasks", keyOfName(name)), { points: increment(1) }, { merge: true }); } }
  await deleteDoc(dRef);
};

window.rejectTask = async (id) => { if(confirm("Zurückweisen?")) await updateDoc(doc(db, "daily_tasks", id), { status: "open", doneBy: [] }); };

/* --- 6. SETUP-BUTTONS (ADMIN) --- */
if($("planAddBtn")) $("planAddBtn").onclick = async () => {
  const text = n($("planTextInp").value); if(!text) return;
  await addDoc(collection(db, "weekly_tasks"), { weekday: Number($("planDaySel").value), tagKey: $("planTagSel").value, text: text, type: "task" });
  $("planTextInp").value = "";
};

if($("addExtraTaskBtn")) $("addExtraTaskBtn").onclick = async () => {
  const text = n($("extraTaskInp").value); const tagKey = $("extraTaskTagSel").value;
  if(!text) return;
  await addDoc(collection(db, "daily_tasks"), { text, tagKey, dateKey: dayKeyNow(), status: "open", type: "task", doneBy: [] });
  $("extraTaskInp").value = ""; alert("Zusatzaufgabe live!");
};

$("tagAddBtn").onclick = async () => {
  const v = n($("tagAddInp").value); if(!v) return;
  await setDoc(doc(db, "tags", keyOfName(v)), { tagId: v, tagKey: keyOfName(v) });
  $("tagAddInp").value = "";
};

$("hygieneItemAddBtn").onclick = async () => {
  const subs = $("hygieneSubtasksInp").value.split('\n').filter(l => l.trim() !== "");
  await addDoc(collection(db, "hygiene_templates"), { catId: $("hygieneItemCatSel").value, text: $("hygieneItemInp").value, subtasks: subs, type: "hygiene" });
  $("hygieneItemInp").value=""; $("hygieneSubtasksInp").value="";
};

$("superUidAddBtn").onclick = async () => { if(!isSuperAdmin) return alert("Nur Superadmin!"); await setDoc(doc(db, "superadmins_by_name", keyOfName($("superUidAdd").value)), { enabled: true }); $("superUidAdd").value = ""; };
$("adminUidAddBtn").onclick = async () => { if(!isAdmin) return; await setDoc(doc(db, "admins_by_name", keyOfName($("adminUidAdd").value)), { enabled: true }); $("adminUidAdd").value = ""; };
$("empAddBtn").onclick = async () => { await setDoc(doc(db, "employees", keyOfName($("empAdd").value)), { name: $("empAdd").value, passHash: "" }); $("empAdd").value=""; };
$("hygieneCatAddBtn").onclick = async () => { if($("hygieneCatInp").value) await addDoc(collection(db, "hygiene_cats"), { title: $("hygieneCatInp").value }); $("hygieneCatInp").value=""; };
window.delDoc = async (col, id) => { if(confirm("Löschen?")) await deleteDoc(doc(db, col, id)); };

/* --- 7. PUNKTE & TABELLEN --- */
window.delRide = async (id, userKey) => {
  if(!confirm("Löschen? Punkt wird abgezogen!")) return;
  await deleteDoc(doc(db, "rides", id));
  await setDoc(doc(db, "points_rides", userKey), { points: increment(-1) }, { merge: true });
};

function renderPointsTable(sTasks, sRides) {
  const stats = {};
  sTasks.forEach(d => { stats[d.id] = { t: d.data().points || 0, r: 0 }; });
  sRides.forEach(d => { if(!stats[d.id]) stats[d.id] = { t: 0, r: 0 }; stats[d.id].r = d.data().points || 0; });
  if($("pointsTableBody")) $("pointsTableBody").innerHTML = Object.keys(stats).map(k => `<tr><td align="left">${k}</td><td align="center">${stats[k].t}</td><td align="center">${stats[k].r}</td><td align="right"><b>${stats[k].t + stats[k].r}</b></td></tr>`).join("");
}

/* --- 8. AUTOMATISIERUNG --- */
async function runDayChange() {
  const today = dayKeyNow(); const mS = await getDoc(doc(db, "meta", "day_state"));
  if (mS.exists() && mS.data().lastDayKey === today) return;
  const batch = writeBatch(db); const wd = new Date().getDay() || 7;
  const wSnap = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd)));
  wSnap.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey: today, status: "open", doneBy: [] }));
  const hSnap = await getDocs(collection(db, "hygiene_templates"));
  hSnap.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey: today, status: "open", doneBy: [] }));
  await batch.set(doc(db, "meta", "day_state"), { lastDayKey: today }, { merge: true });
  await batch.commit();
}

/* --- 9. UI & TABS --- */
function setupTabs(btnClass, tabClass) {
  document.querySelectorAll(btnClass).forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(tabClass).forEach(t => show(t, false));
      show($(btn.dataset.tab || btn.dataset.subtab), true);
      document.querySelectorAll(btnClass).forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
  });
}
setupTabs(".tabbtn", ".tab"); setupTabs(".subtabbtn", ".subtab");

function initPushSystem() {
  $("settingsBtn").onclick = () => show($("settingsCard"), true);
  $("closeSettingsBtn").onclick = () => show($("settingsCard"), false);
  setInterval(() => {
    if (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) return;
    const h = new Date().getHours();
    if ([9, 12, 14, 16, 18].includes(h) && new Date().getMinutes() === 0) {
      if(Notification.permission === "granted") new Notification("Check RA 93!");
    }
  }, 60000);
}

$("logoutBtn").onclick = () => { localStorage.clear(); location.reload(); };
$("reloadBtn").onclick = () => location.reload();
if($("tagSearch")) $("tagSearch").oninput = renderTagList;
$("closeModalBtn").onclick = () => show($("checkModal"), false);
$("regenTestBtn").onclick = async () => { if(confirm("Tag Reset?")) { const ex = await getDocs(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()))); const b = writeBatch(db); ex.forEach(d => b.delete(d.ref)); await b.commit(); location.reload(); } };
