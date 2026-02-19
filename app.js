import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
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

let meName = localStorage.getItem("meName") || "", meKey = localStorage.getItem("meKey") || "";
let isAdmin = false, isSuperAdmin = false, myMuteUntil = "";
let tags = [], employees = [], hygieneCats = [];
let selectedTaskId = "", activeCheckTaskId = null;

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const n = (v) => String(v ?? "").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function keyOfName(name) { return n(name).toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss").replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, ""); }
function dayKeyNow() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function stamp() { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

signInAnonymously(auth);
if($("menuToggle")) $("menuToggle").onclick = () => $("sidebar").classList.toggle("open");

onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    const uRef = doc(db, "users", user.uid);
    await setDoc(uRef, { name: meName, nameKey: meKey }, { merge: true });
    const [sSnap, aSnap, uSnap] = await Promise.all([ getDoc(doc(db, "superadmins_by_name", meKey)), getDoc(doc(db, "admins_by_name", meKey)), getDoc(uRef) ]);
    if(uSnap.exists()) myMuteUntil = uSnap.data().muteUntil || "";
    isSuperAdmin = sSnap.exists() && sSnap.data()?.enabled === true;
    isAdmin = isSuperAdmin || (aSnap.exists() && aSnap.data()?.enabled === true);
    if($("whoami")) $("whoami").textContent = meName + (isSuperAdmin ? " (S)" : isAdmin ? " (A)" : "");
    show($("adminTabBtn"), isAdmin); show($("loginView"), false); show($("appView"), true);
    initAppDataStreams();
    if (isAdmin) { initAdminLogic(); runDayChange(); initPushSystem(); }
  } else { show($("loginView"), true); show($("appView"), false); }
});

/* --- WIEDERHERGESTELLTE PASSWORT-LOGIK --- */
if($("loginBtn")) $("loginBtn").onclick = async () => {
  const inputName = n($("nameInp").value);
  const pass = n($("passInp").value);
  if (!inputName || !pass) return alert("Bitte Name und Passwort eingeben!");
  
  const testKey = keyOfName(inputName);
  
  // Passwort verschlüsseln (Hashing)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${testKey}:${pass}`))
    .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,"0")).join(""));
  
  const empSnap = await getDoc(doc(db, "employees", testKey));
  if (!empSnap.exists()) return alert("Name ist nicht im System registriert!");
  
  const empData = empSnap.data();
  
  // Wenn der Mitarbeiter noch kein Passwort hat, speichern wir das aktuelle
  if (!empData.passHash) {
    await updateDoc(doc(db, "employees", testKey), { passHash: hash });
  } 
  // Ansonsten prüfen wir, ob das eingegebene Passwort mit dem Hash übereinstimmt
  else if (empData.passHash !== hash) {
    return alert("Passwort falsch!");
  }
  
  localStorage.setItem("meName", empData.name); 
  localStorage.setItem("meKey", testKey); 
  location.reload();
};
/* ----------------------------------------- */

function initAppDataStreams() {
  onSnapshot(query(collection(db, "employees"), orderBy("name")), s => {
    employees = s.docs.map(d => d.data());
    if($("doneByCheckBoxes")) $("doneByCheckBoxes").innerHTML = employees.map(e => `<label class="check-item"><input type="checkbox" name="worker" value="${esc(e.name)}"> <span>${esc(e.name)}</span></label>`).join("");
    if($("rideNameSel")) $("rideNameSel").innerHTML = employees.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
    if(isAdmin && $("empList")) $("empList").innerHTML = employees.map(e => `<div class="item"><span>${esc(e.name)}</span><button class="btn danger" onclick="window.delDoc('employees','${keyOfName(e.name)}')">X</button></div>`).join("");
  });
  onSnapshot(query(collection(db, "tags"), orderBy("tagId")), s => {
    tags = s.docs.map(d => ({id:d.id, ...d.data()})); renderTagList();
    const opts = tags.map(t=>`<option value="${t.tagKey}">${t.tagId}</option>`).join("");
    if($("planTagSel")) $("planTagSel").innerHTML = opts;
    if($("extraTaskTagSel")) $("extraTaskTagSel").innerHTML = opts;
    if(isAdmin && $("adminTagList")) $("adminTagList").innerHTML = tags.map(t=>`<div class="item"><span>${t.tagId}</span><button class="btn danger" onclick="window.delDoc('tags','${t.id}')">X</button></div>`).join("");
  });
  onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(50)), s => {
    if($("ridesList")) $("ridesList").innerHTML = s.docs.map(d => `<div class="item"><span>🚗 ${esc(d.data().name)} (${esc(d.data().einsatz)})</span>${isAdmin ? `<button class="btn danger" onclick="window.delRide('${d.id}', '${keyOfName(d.data().name)}')">X</button>` : ''}</div>`).join("");
  });
  onSnapshot(collection(db, "hygiene_cats"), s => {
    hygieneCats = s.docs.map(d => ({id: d.id, ...d.data()})); renderHygieneUserView();
    if(isAdmin && $("hygieneCatList")) $("hygieneCatList").innerHTML = hygieneCats.map(c => `<div class="item"><span>${esc(c.title)}</span><button class="btn danger" onclick="window.delDoc('hygiene_cats','${c.id}')">X</button></div>`).join("");
    if(isAdmin && $("hygieneItemCatSel")) $("hygieneItemCatSel").innerHTML = hygieneCats.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join("");
  });
}

function renderTagList() {
  const q = n($("tagSearch").value).toLowerCase();
  if($("tagList")) $("tagList").innerHTML = tags.filter(t=>t.tagId.toLowerCase().includes(q)).map(t=>`<div class="item"><span>🏷️ ${esc(t.tagId)}</span><button class="btn ghost" onclick="window.openTag('${t.tagKey}','${esc(t.tagId)}')">Öffnen</button></div>`).join("");
}

window.openTag = (key, id) => {
  if($("openTagTitle")) $("openTagTitle").textContent = `Bereich: ${id}`;
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", key)), s => {
    const list = $("taskList"); if(!list) return;
    const openTasks = s.docs.filter(d => d.data().status === "open");
    list.innerHTML = openTasks.length === 0 ? '<p class="muted">Keine Aufgaben.</p>' : openTasks.map(d => `<div class="item"><span>${esc(d.data().text)}</span><button class="btn ghost" onclick="window.selectTask('${d.id}', '${esc(d.data().text)}')">Wählen</button></div>`).join("");
  });
};

window.selectTask = (id, text) => { selectedTaskId = id; if($("taskHint")) $("taskHint").textContent = "Gewählt: " + text; };

if($("markSelectedDoneBtn")) $("markSelectedDoneBtn").onclick = async () => {
  const who = Array.from(document.querySelectorAll('input[name="worker"]:checked')).map(cb => cb.value);
  if(!selectedTaskId || who.length === 0) return alert("Person & Aufgabe wählen!");
  await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp() });
  selectedTaskId = ""; if($("taskHint")) $("taskHint").textContent = ""; document.querySelectorAll('input[name="worker"]').forEach(cb => cb.checked = false);
};

function initAdminLogic() {
  const updatePlanFilter = () => {
    if(!$("planDaySel") || !$("planTagSel")) return;
    const d = Number($("planDaySel").value), t = $("planTagSel").value;
    onSnapshot(query(collection(db, "weekly_tasks"), where("weekday", "==", d), where("tagKey", "==", t)), s => {
      if($("planList")) $("planList").innerHTML = s.docs.map(doc => `<div class="item"><span>${esc(doc.data().text)}</span><button class="btn danger" onclick="window.delDoc('weekly_tasks','${doc.id}')">X</button></div>`).join("");
    });
  };
  if($("planDaySel")) $("planDaySel").onchange = updatePlanFilter;
  if($("planTagSel")) $("planTagSel").onchange = updatePlanFilter; updatePlanFilter();

  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    const tH = [], hH = [];
    s.docs.forEach(d => {
      const t = d.data();
      const html = `<div class="item"><span>${esc(t.text)} (${(t.doneBy||[]).join(",")})</span><div class="row"><button class="btn danger" onclick="window.rejectTask('${d.id}')">❌</button><button class="btn ghost" onclick="window.finalCheck('${d.id}')">OK</button></div></div>`;
      if(t.type === "hygiene") hH.push(html); else tH.push(html);
    });
    if($("finalListTasks")) $("finalListTasks").innerHTML = tH.join("");
    if($("finalListHygiene")) $("finalListHygiene").innerHTML = hH.join("");
  });
  onSnapshot(collection(db, "points_tasks"), st => onSnapshot(collection(db, "points_rides"), sr => renderPointsTable(st, sr)));
}

async function runDayChange() {
  const today = dayKeyNow(); const mS = await getDoc(doc(db, "meta", "day_state"));
  if (mS.exists() && mS.data().lastDayKey === today) return;
  const batch = writeBatch(db); const wd = new Date().getDay() || 7;
  const wSnap = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd)));
  wSnap.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey: today, status: "open", doneBy: [] }));
  const hSnap = await getDocs(collection(db, "hygiene_templates"));
  hSnap.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey: today, status: "open", doneBy: [] }));
  await batch.set(doc(db, "meta", "day_state"), { lastDayKey: today }, { merge: true }); await batch.commit();
}

if($("regenTestBtn")) $("regenTestBtn").onclick = async () => { 
  if(confirm("Reset? Daten für heute werden neu aus dem Wochenplan geladen.")) { 
    const ex = await getDocs(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()))); 
    const b = writeBatch(db); ex.forEach(d => b.delete(d.ref)); await b.commit(); 
    await setDoc(doc(db, "meta", "day_state"), { lastDayKey: "" }, { merge: true }); 
    await runDayChange();
    alert("Reset erfolgreich! Aufgaben wurden neu geladen.");
    location.reload(); 
  } 
};

function initPushSystem() {
  if($("settingsBtn")) $("settingsBtn").onclick = () => show($("settingsCard"), true);
  if($("closeSettingsBtn")) $("closeSettingsBtn").onclick = () => show($("settingsCard"), false);
  if($("saveMuteBtn")) $("saveMuteBtn").onclick = async () => {
    const v = $("muteUntilInp").value;
    if(v && auth.currentUser) { await setDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: v }, { merge: true }); alert("Urlaub gespeichert!"); }
  };
  if($("clearMuteBtn")) $("clearMuteBtn").onclick = async () => { if(auth.currentUser) { await setDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: "" }, { merge: true }); alert("Urlaub beendet!"); } };
  setInterval(() => {
    if (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) return;
    if ([9, 12, 14, 16, 18].includes(new Date().getHours()) && new Date().getMinutes() === 0 && Notification.permission === "granted") new Notification("Check RA 93!");
  }, 60000);
}

function setupTabs(btnClass, tabClass) {
  document.querySelectorAll(btnClass).forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(tabClass).forEach(t => t.classList.add("hidden"));
      const target = $(btn.dataset.tab || btn.dataset.subtab); if(target) target.classList.remove("hidden");
      document.querySelectorAll(btnClass).forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      if(window.innerWidth <= 768 && $("sidebar")) $("sidebar").classList.remove("open");
    };
  });
}
setupTabs(".tabbtn", ".tab"); setupTabs(".subtabbtn", ".subtab");

if($("addExtraTaskBtn")) $("addExtraTaskBtn").onclick = async () => {
  const text = n($("extraTaskInp").value), tagKey = $("extraTaskTagSel").value;
  if(!text || !tagKey) return;
  await addDoc(collection(db, "daily_tasks"), { text, tagKey, dateKey: dayKeyNow(), status: "open", type: "task", doneBy: [] });
  $("extraTaskInp").value = ""; alert("Zusatzaufgabe live!");
};

if($("empAddBtn")) $("empAddBtn").onclick = async () => {
  const v = n($("empAdd").value); if(!v) return; await setDoc(doc(db, "employees", keyOfName(v)), { name: v, passHash: "" }); $("empAdd").value = "";
};
if($("adminUidAddBtn")) $("adminUidAddBtn").onclick = async () => { if(!isAdmin) return; await setDoc(doc(db, "admins_by_name", keyOfName($("adminUidAdd").value)), { enabled: true }); $("adminUidAdd").value = ""; };
if($("superUidAddBtn")) $("superUidAddBtn").onclick = async () => { if(!isSuperAdmin) return; await setDoc(doc(db, "superadmins_by_name", keyOfName($("superUidAdd").value)), { enabled: true }); $("superUidAdd").value = ""; };
if($("tagAddBtn")) $("tagAddBtn").onclick = async () => { const v = n($("tagAddInp").value); if(!v) return; await setDoc(doc(db, "tags", keyOfName(v)), { tagId: v, tagKey: keyOfName(v) }); $("tagAddInp").value = ""; };
if($("planAddBtn")) $("planAddBtn").onclick = async () => {
  const text = n($("planTextInp").value); if(!text) return;
  await addDoc(collection(db, "weekly_tasks"), { weekday: Number($("planDaySel").value), tagKey: $("planTagSel").value, text }); $("planTextInp").value = "";
};
if($("hygieneCatAddBtn")) $("hygieneCatAddBtn").onclick = async () => { const v = n($("hygieneCatInp").value); if(!v) return; await addDoc(collection(db, "hygiene_cats"), { title: v }); $("hygieneCatInp").value = ""; };
if($("hygieneItemAddBtn")) $("hygieneItemAddBtn").onclick = async () => {
  const subs = $("hygieneSubtasksInp").value.split('\n').filter(l => l.trim() !== "");
  await addDoc(collection(db, "hygiene_templates"), { catId: $("hygieneItemCatSel").value, text: $("hygieneItemInp").value, subtasks: subs, type: "hygiene" });
  $("hygieneItemInp").value = ""; $("hygieneSubtasksInp").value = ""; alert("Vorlage gespeichert!");
};

window.openHygCheck = async (id) => {
  activeCheckTaskId = id; const snap = await getDoc(doc(db, "daily_tasks", id)); const data = snap.data();
  if($("modalTitle")) $("modalTitle").textContent = data.text; const cont = $("modalSubtasks"); if(cont) cont.innerHTML = "";
  if (!data.subtasks || data.subtasks.length === 0) { if(confirm("Abschließen?")) { await updateDoc(doc(db, "daily_tasks", id), { status: "done", doneBy: [meName], doneAt: stamp() }); } return; }
  data.subtasks.forEach(sub => cont.innerHTML += `<label class="check-item"><input type="checkbox" class="sub-check"> <span>${esc(sub)}</span></label>`); show($("checkModal"), true);
};

if($("saveCheckBtn")) $("saveCheckBtn").onclick = async () => {
  if (Array.from(document.querySelectorAll(".sub-check")).every(c => c.checked)) { await updateDoc(doc(db, "daily_tasks", activeCheckTaskId), { status: "done", doneBy: [meName], doneAt: stamp() }); show($("checkModal"), false);
  } else alert("Hake alles ab!");
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

if($("saveRideBtn")) $("saveRideBtn").onclick = async () => {
  const name = $("rideNameSel").value, einsatz = $("rideEinsatz").value; if(!name || !einsatz) return;
  await addDoc(collection(db, "rides"), { name, einsatz, createdAt: serverTimestamp() });
  await setDoc(doc(db, "points_rides", keyOfName(name)), { points: increment(1) }, { merge: true }); $("rideEinsatz").value = "";
};

window.finalCheck = async (id) => {
  const snap = await getDoc(doc(db, "daily_tasks", id));
  if(snap.exists() && snap.data().doneBy) { for (const name of snap.data().doneBy) await setDoc(doc(db, "points_tasks", keyOfName(name)), { points: increment(1) }, { merge: true }); }
  await deleteDoc(doc(db, "daily_tasks", id));
};

window.rejectTask = async (id) => { await updateDoc(doc(db, "daily_tasks", id), { status: "open", doneBy: [] }); };
window.delRide = async (id, userKey) => { if(!confirm("Punkt abziehen?")) return; await deleteDoc(doc(db, "rides", id)); await setDoc(doc(db, "points_rides", userKey), { points: increment(-1) }, { merge: true }); };

function renderPointsTable(st, sr) {
  if(!$("pointsTableBody")) return; const res = {};
  st.forEach(d => res[d.id] = { t: d.data().points||0, r: 0 });
  sr.forEach(d => { if(!res[d.id]) res[d.id]={t:0,r:0}; res[d.id].r = d.data().points||0; });
  $("pointsTableBody").innerHTML = Object.keys(res).map(k => `<tr><td>${k}</td><td>${res[k].t}</td><td>${res[k].r}</td><td><b>${res[k].t+res[k].r}</b></td></tr>`).join("");
}

window.delDoc = async (col, id) => { if(confirm("Löschen?")) await deleteDoc(doc(db, col, id)); };
if($("logoutBtn")) $("logoutBtn").onclick = () => { localStorage.clear(); location.reload(); };
if($("reloadBtn")) $("reloadBtn").onclick = () => location.reload();
if($("closeModalBtn")) $("closeModalBtn").onclick = () => show($("checkModal"), false);
