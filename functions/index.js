const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

/* =========================
   Helpers
   ========================= */
function n(v){ return String(v ?? "").replace(/\s+/g," ").trim(); }

function key(s){
  return n(s).toLowerCase()
    .replace(/["'„“”]/g,"")
    .replace(/[^a-z0-9äöüß]/g,"");
}

function dayKey(date){
  const d = date || new Date();
  const p=(x)=>String(x).padStart(2,"0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`; // yyyyMMdd
}

// ISO weekday: Mon=1 ... Sun=7
function weekdayISO(date){
  const d = date || new Date();
  const js = d.getDay(); // Sun=0..Sat=6
  return js === 0 ? 7 : js;
}

async function deleteInBatches(refs, batchSize=350){
  for(let i=0;i<refs.length;i+=batchSize){
    const b = db.batch();
    refs.slice(i,i+batchSize).forEach(r=>b.delete(r));
    await b.commit();
  }
}

/* =========================
   Admin Counts (limits)
   ========================= */
const MAX_SUPER = 3;
const MAX_ADMIN = 8;
const META_COUNTS_REF = db.doc("meta/admin_counts");

async function ensureCountsDoc(){
  const snap = await META_COUNTS_REF.get();
  if(!snap.exists){
    await META_COUNTS_REF.set({ superCount:0, adminCount:0, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge:true });
  }
}

async function getCounts(){
  const snap = await META_COUNTS_REF.get();
  return snap.exists ? (snap.data()||{}) : { superCount:0, adminCount:0 };
}

/* =========================
   HTTP: superadmin bootstrap helper (optional)
   You can call once manually if needed.
   ========================= */
exports.bootstrap = onRequest(async (req, res) => {
  try{
    await ensureCountsDoc();
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});

/* =========================
   00:00 daily roll (Europe/Vienna)
   - Archives YESTERDAY tasks to archives/{yesterday}/tasks/*
   - DOES NOT delete rides_daily for yesterday (to keep 72h)
   - Creates TODAY tasks from weekly_templates for Mon-Sat only
   ========================= */
exports.midnightRoll = onSchedule(
  { schedule: "0 0 * * *", timeZone: "Europe/Vienna" },
  async () => {
    const now = new Date();
    const todayKeyStr = dayKey(now);

    const yesterday = new Date(now.getTime() - 24*60*60*1000);
    const yesterdayKeyStr = dayKey(yesterday);

    // 1) Archive + delete ALL daily_tasks as yesterday
    const tasksSnap = await db.collection("daily_tasks").get();

    for(const d of tasksSnap.docs){
      await db.doc(`archives/${yesterdayKeyStr}/tasks/${d.id}`).set({
        ...d.data(),
        dayKey: yesterdayKeyStr,
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge:true });
    }
    await deleteInBatches(tasksSnap.docs.map(d=>d.ref));

    // 2) Archive rides_daily for yesterday, but keep rides_daily (72h requirement)
    const ridesSnap = await db.collection("rides_daily").doc(yesterdayKeyStr).collection("people").get();
    for(const d of ridesSnap.docs){
      await db.doc(`rides_archives/${yesterdayKeyStr}/people/${d.id}`).set({
        ...d.data(),
        dayKey: yesterdayKeyStr,
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge:true });
    }

    // 3) Create today's tasks from weekly templates (Mon-Sat only, Sunday free)
    const wd = weekdayISO(now); // 1..7
    if(wd !== 7){
      const templSnap = await db.collection("weekly_templates")
        .where("weekday", "==", wd)
        .orderBy("order")
        .get();

      for(const d of templSnap.docs){
        const t = d.data() || {};
        const tagId = n(t.tagId || "");
        const tagKeyStr = n(t.tagKey || key(tagId));
        const taskText = n(t.task || "");
        if(!tagKeyStr || !taskText) continue;

        const id = crypto.createHash("sha1")
          .update(`${todayKeyStr}|${tagKeyStr}|${taskText}`)
          .digest("hex")
          .slice(0, 20);

        await db.doc(`daily_tasks/${id}`).set({
          dayKey: todayKeyStr,
          weekday: wd,
          source: "weekly",
          tagId: tagId || tagKeyStr,
          tagKey: tagKeyStr,
          task: taskText,
          status: "❌",
          doneBy: [],
          doneAtLast: "",
          finalOk: false,
          finalBy: "",
          pointsAwarded: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge:true });
      }
    }
  }
);

/* =========================
   72h cleanup for rides_daily
   Keep: today, yesterday, day-2
   Delete: day-3 and older
   Runs daily at 03:10.
   ========================= */
exports.cleanupRidesDaily = onSchedule(
  { schedule: "10 3 * * *", timeZone: "Europe/Vienna" },
  async () => {
    const now = new Date();
    const keep0 = dayKey(now);
    const keep1 = dayKey(new Date(now.getTime() - 24*60*60*1000));
    const keep2 = dayKey(new Date(now.getTime() - 2*24*60*60*1000));

    const snap = await db.collection("rides_daily").get();

    const toDeleteDays = [];
    for(const d of snap.docs){
      const id = d.id; // yyyyMMdd
      if(id !== keep0 && id !== keep1 && id !== keep2){
        toDeleteDays.push(id);
      }
    }

    for(const day of toDeleteDays){
      const peopleSnap = await db.collection("rides_daily").doc(day).collection("people").get();
      await deleteInBatches(peopleSnap.docs.map(x=>x.ref));
      await db.collection("rides_daily").doc(day).delete().catch(()=>{});
    }
  }
);

/* =========================
   Points: booked ONLY when admin toggles finalOk from false->true
   Stored in:
   - employees_public/{nameKey}.points (int)
   NOTE: daily_tasks pointsAwarded prevents double booking.
   ========================= */
exports.onFinalOkPoints = admin.firestore().document("daily_tasks/{id}").onUpdate(async (change) => {
  const before = change.before.data() || {};
  const after  = change.after.data() || {};

  // only when finalOk becomes true AND not already awarded
  if(before.finalOk === true) return;
  if(after.finalOk !== true) return;
  if(after.pointsAwarded === true) return;

  const doneBy = Array.isArray(after.doneBy) ? after.doneBy : [];
  if(!doneBy.length) {
    await change.after.ref.set({ pointsAwarded:true }, { merge:true });
    return;
  }

  const batch = db.batch();

  for(const nm of doneBy){
    const name = n(nm);
    if(!name) continue;
    const ref = db.doc(`employees_public/${key(name)}`);
    const snap = await ref.get();
    const cur = snap.exists ? Number(snap.data().points || 0) : 0;
    batch.set(ref, {
      name: name,
      points: Math.max(0, cur + 1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge:true });
  }

  batch.set(change.after.ref, {
    pointsAwarded: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge:true });

  await batch.commit();
});

