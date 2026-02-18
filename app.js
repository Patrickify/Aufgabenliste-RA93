import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { initializeFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where, orderBy, limit, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
let isAdmin = false, myMuteUntil = "", currentTagKey = "", activeCheckTaskId = null;
let employees = [], tags = [], hygieneCats = [];

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const n = (v) => String(v ?? "").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function keyOfName(name) { return n(name).toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss").replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, ""); }
function dayKeyNow() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function stamp() { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

/* --- AUTH & BOOT --- */
signInAnonymously(auth).catch(console.error);
onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    const uRef = doc(db, "users", user.uid);
    await setDoc(uRef, { name: meName, nameKey: meKey }, { merge: true });
    const uSnap = await getDoc(uRef);
    if(uSnap.exists()) { myMuteUntil = uSnap.data().muteUntil || ""; if($("muteUntilInp")) $("muteUntilInp").value = myMuteUntil; updateMuteStatus(); }

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

/* --- LOGIN --- */
if ($("loginBtn")) $("loginBtn").onclick = async () => {
  const name = n($("nameSel").value), pass = n($("passInp").value);
  if (!name || !pass) return alert("Eingabe fehlt");
  const key = keyOfName(name);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${pass}`)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""));
  const eSnap = await getDoc(doc(db, "employees", key));
  if (!eSnap.exists()) return alert("Unbekannt");
  if (!eSnap.data().passHash) await updateDoc(doc(db, "employees", key), { passHash: hash });
  else if (eSnap.data().passHash !== hash) return alert("Passwort falsch");
  localStorage.setItem("meName", name); localStorage.setItem("meKey", key); location.reload();
};

/* --- PUSH & URLAUB --- */
function initPushSystem() {
  $("settingsBtn").onclick = () => show($("settingsCard"), true);
  $("closeSettingsBtn").onclick = () => show($("settingsCard"), false);
  $("reqPermBtn").onclick = () => Notification.requestPermission().then(p => $("permStatus").textContent = "Status: " + p);
  $("saveMuteBtn").onclick = async () => { const v = $("muteUntilInp").value; await updateDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: v }); myMuteUntil = v; updateMuteStatus(); };
  $("clearMuteBtn").onclick = async () => { await updateDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: "" }); myMuteUntil = ""; updateMuteStatus(); };
  setInterval(checkPushTime, 60000);
}
function updateMuteStatus() { if($("muteStatus")) $("muteStatus").textContent = (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) ? "🔕 Stumm bis " + myMuteUntil : "🔔 Push Aktiv"; }
let lastPushKey = "";
function checkPushTime() {
  if (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) return;
  const h = new Date().getHours();
  const key = `${dayKeyNow()}_${h}`;
  if ([9, 12, 14, 16, 18].includes(h) && lastPushKey !== key) {
    if(Notification.permission === "granted") new Notification("Check RA 93", { body: "Zeit für die Aufgaben!" });
    lastPushKey = key;
  }
}

/* --- STREAMS & RENDER --- */
function initStreams() {
  onSnapshot(query(collection(db, "employees"), orderBy("name")), s => {
    employees = s.docs.map(d => d.data());
    const opts = employees.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
    $("nameSel").innerHTML = `<option value="">Wer bist du?</option>` + opts;
    $("doneBySel").innerHTML = opts; $("rideNameSel").innerHTML = opts;
    if(isAdmin) renderEmpList();
  });

  onSnapshot(query(collection(db, "tags"), orderBy("tagId")), s => {
    tags = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderTagList();
    if(isAdmin) renderAdminTags();
  });

  onSnapshot(collection(db, "hygiene_cats"), s => {
    hygieneCats = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderHygieneUserView();
    if(isAdmin) renderHygieneAdmin();
  });

  onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(20)), s => {
    $("ridesList").innerHTML = s.docs.map(d => `<div class="item"><b>🚗 ${esc(d.data().name)}</b> <span>${d.data().einsatz}</span></div>`).join("");
  });
}

/* --- CHECKLISTEN LOGIK --- */
window.openHygCheck = async (id) => {
  activeCheckTaskId = id;
  const snap = await getDoc(doc(db, "daily_tasks", id));
  const data = snap.data();
  $("modalTitle").textContent = data.text;
  const cont = $("modalSubtasks"); cont.innerHTML = "";
  if (!data.subtasks || data.subtasks.length === 0) { finishHyg(id); return; }
  data.subtasks.forEach((sub, i) => {
    cont.innerHTML += `<label class="item"><input type="checkbox" class="sub-check"> <span>${esc(sub)}</span></label>`;
  });
  show($("checkModal"), true);
};
$("saveCheckBtn").onclick = async () => {
  if (Array.from(document.querySelectorAll(".sub-check")).every(c => c.checked)) {
    await updateDoc(doc(db, "daily_tasks", activeCheckTaskId), { status: "done", doneBy: [meName], doneAt: stamp() });
    show($("checkModal"), false);
  } else alert("Punkte fehlen!");
};
$("closeModalBtn").onclick = () => show($("checkModal"), false);

/* --- ADMIN FUNKTIONEN --- */
function initAdminLogic() {
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    const tH = [], hH = [];
    s.docs.forEach(d => {
      const t = d.data();
      const html = `<div class="item"><div><b>${esc(t.text)}</b><br><small>${t.doneBy.join(", ")}</small></div><button class="btn ghost" onclick="finalCheck('${d.id}')">OK</button></div>`;
      if(t.type === "hygiene") hH.push(html); else tH.push(html);
    });
    $("finalListTasks").innerHTML = tH.join(""); $("finalListHygiene").innerHTML = hH.join("");
  });
}

window.finalCheck = async (id) => {
  await updateDoc(doc(db, "daily_tasks", id), { status: "final" });
  // Punktevergabe Logik...
};

/* --- REGENERATE / DAY CHANGE --- */
async function generate(dateKey) {
  const batch = writeBatch(db);
  const wd = new Date().getDay() || 7;
  const wS = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd)));
  wS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [], type: "task" }));
  const hS = await getDocs(collection(db, "hygiene_templates"));
  hS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [], type: "hygiene" }));
  await batch.commit();
}
async function runDayChange() {
  const today = dayKeyNow(); const mS = await getDoc(doc(db, "meta", "day_state"));
  if (!mS.exists() || mS.data().lastDayKey !== today) {
    await generate(today); await setDoc(doc(db, "meta", "day_state"), { lastDayKey: today }, { merge: true });
  }
}

// ... Tab Logic & UI Helper wie gehabt ...
