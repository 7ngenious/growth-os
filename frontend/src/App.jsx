import React, { useState, useEffect, useRef } from "react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip,
} from "recharts";

/* ------------------------------------------------------------------ */
/* Design tokens — FM scout-report direction                           */
/* ------------------------------------------------------------------ */
const C = {
  bg: "#0d141c", panel: "#151f2b", panelHi: "#1b2836", line: "#263444",
  text: "#d9e2ec", muted: "#7d8ea1", faint: "#55677b",
  low: "#e0656b", mid: "#e3b84e", high: "#43d9a3", accent: "#43d9a3",
};
// ─── 배포 설정 ───────────────────────────────────────────────
// 동기화 값은 소스에 하드코딩하지 않는다 — 리포지토리 공개 시 토큰이 유출된다.
// Vercel(또는 로컬 .env.local)에 환경변수로 설정하라:
//   VITE_SYNC_URL   = https://<growth-os-sync 배포 주소>
//   VITE_SYNC_TOKEN = 서버 SYNC_TOKEN과 동일한 값
// 미설정 시: Claude 아티팩트에선 window.storage, 일반 배포에선 localStorage 단독 동작.
const ENV = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};
const SYNC_URL = ENV.VITE_SYNC_URL || "";
const SYNC_TOKEN = ENV.VITE_SYNC_TOKEN || "";
// ─────────────────────────────────────────────────────────────

// 저장소 어댑터 — 우선순위: 동기화 서버(+로컬 캐시) > window.storage(아티팩트) > localStorage
// 오프라인 우선: 항상 로컬에 먼저 쓰고, 서버 전송 실패는 조용히 무시(다음 저장 때 전체 상태가 다시 올라간다)
const store = {
  async get(k) {
    if (SYNC_URL) {
      try {
        const res = await fetch(`${SYNC_URL}/state`, { headers: { "X-Sync-Token": SYNC_TOKEN } });
        if (res.ok) {
          const data = await res.json();
          if (data && data.value) {
            localStorage.setItem(k, data.value);
            return { key: k, value: data.value };
          }
        }
      } catch (e) { /* 오프라인 → 로컬 캐시 사용 */ }
      const v = localStorage.getItem(k);
      return v == null ? null : { key: k, value: v };
    }
    if (typeof window !== "undefined" && window.storage && window.storage.get) return window.storage.get(k);
    const v = localStorage.getItem(k);
    return v == null ? null : { key: k, value: v };
  },
  async set(k, val) {
    if (SYNC_URL) {
      localStorage.setItem(k, val); // 로컬 캐시 먼저 — 서버가 죽어도 기록은 산다
      try {
        await fetch(`${SYNC_URL}/state`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-Sync-Token": SYNC_TOKEN },
          body: JSON.stringify({ value: val }),
        });
      } catch (e) { /* 다음 저장 때 재동기화 */ }
      return { key: k, value: val };
    }
    if (typeof window !== "undefined" && window.storage && window.storage.set) return window.storage.set(k, val);
    localStorage.setItem(k, val);
    return { key: k, value: val };
  },
};

const attrColor = (v) => (v >= 14 ? C.high : v >= 8 ? C.mid : C.low);
const AREA_COLORS = { lang: "#43d9a3", tech: "#6aa8d8", port: "#e3b84e", body: "#e0656b" };

// 앱을 열 때마다 하나씩 순차 표시. 탭하면 다음으로 넘어간다.
const TIPS = [
  { t: "주간 루틴", d: "일요일 밤에 ① 훈련 탭에서 복기 입력 → ② 설정 탭에서 주간 로그 내보내기 → ③ 리포지토리 logs/ 폴더에 커밋. 100일 뒤 남는 건 앱 데이터가 아니라 매주 기록한 커밋 이력이다." },
  { t: "레벨은 증거로만", d: "XP가 차면 승급전이 열릴 뿐, 레벨은 외부 증거를 적어야 오른다. 공개한 결과물·시험 점수·발표·면접처럼 제3자가 확인 가능한 것만 증거다." },
  { t: "행동력은 물리 법칙", d: "직접 올릴 수 없다. 연속 완수는 가속하고, 하루 실패는 유예이며, 2일 연속 미실행부터 매일 감소한다. 근육과 같아서 유지에도 훈련이 필요하다." },
  { t: "난이도를 속이지 마라", d: "대(20XP) 하나가 소(5XP) 넷과 같다. 쉬운 퀘스트만 골라도 모멘텀에서 이득이 없다. 풀에 넣을 기준: 이걸 이력서나 몸이 기억하는가?" },
  { t: "TIL이 블로그가 된다", d: "'90분 공부함'은 아무것도 증명하지 않는다. '무엇을 해결했는가' 한 줄이 90일 쌓이면 기술 글 서너 편 분량의 재료가 된다." },
  { t: "쉬어도 되는 규칙", d: "야근·질병·휴가는 설정 탭 컨디션 모드로 동결하라. 분기 14일 예산 안에서는 감점이 없다. 무단 이탈과 계획된 회복은 다르다." },
  { t: "빨간 날을 지우지 마라", d: "캘린더의 미실행일은 실패 기록이 아니라 패턴 데이터다. 어느 요일에 무너지는지가 다음 주 복기의 입력이 된다." },
  { t: "이 앱의 성공 조건", d: "언젠가 불필요해지는 것. 공개된 결과물과 시장의 반응이 진짜 피드백 루프가 되면, 이 앱은 임무를 마친 것이다." },
];

const FONT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=IBM+Plex+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
* { box-sizing: border-box; }
.gos-num { font-family: 'IBM Plex Mono', monospace; }
.gos-disp { font-family: 'Rajdhani', 'IBM Plex Sans KR', sans-serif; letter-spacing: .06em; }
.gos-body { font-family: 'IBM Plex Sans KR', sans-serif; }
.gos-check { transition: background .15s, border-color .15s; }
.gos-check:active { transform: scale(.97); }
input.gos-input:focus, textarea.gos-input:focus, select.gos-input:focus { outline: 2px solid #43d9a3; outline-offset: 1px; }
button:focus-visible { outline: 2px solid #43d9a3; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

/* ------------------------------------------------------------------ */
/* Domain                                                              */
/* ------------------------------------------------------------------ */
// 훈련 가능한 4개 영역 (레벨 + 증거 기반 승급)
const AREAS = [
  { id: "lang", name: "어학", en: "LANGUAGE" },
  { id: "tech", name: "기술", en: "TECHNICAL" },
  { id: "port", name: "포트폴리오", en: "PORTFOLIO" },
  { id: "body", name: "건강", en: "CONDITION" },
];
// 행동력: 파생 지표. 습관도 XP도 승급전도 없다.
const EXEC = { id: "exec", name: "행동력", en: "EXECUTION" };

const DEFAULT_STATE = {
  onboarded: false,
  profile: { job: "", age: "", dream: "", startDate: "" },
  levels: { lang: 11, tech: 10, port: 6, body: 9 },
  xp: { lang: 0, tech: 0, port: 0, body: 0 },
  weights: { lang: 2, tech: 2, port: 3, body: 1 }, // 0=쉼 ~ 3=집중
  subskills: {
    lang: [
      { id: "s1", name: "JLPT", value: "N1" },
      { id: "s2", name: "TOEIC", value: "785" },
    ],
    tech: [
      { id: "s3", name: "OPC-UA / ModBus", value: "실무 운용" },
      { id: "s4", name: "Python", value: "주력" },
      { id: "s5", name: "PLC 로그 수집", value: "실무" },
      { id: "s6", name: "TimescaleDB", value: "학습 중" },
    ],
    port: [{ id: "s7", name: "OT 데이터 파이프라인", value: "비공개 · 제작 중" }],
    body: [],
  },
  rest: {},            // { 'YYYY-MM-DD': '사유' } — 컨디션/휴가로 동결된 날
  goal: {
    name: "제조 데이터 엔지니어 이직",
    targets: { lang: 15, tech: 14, port: 14, body: 12, exec: 16 },
  },
  deadline: { name: "포트폴리오 공개", date: "" }, // 외부 이벤트 D-Day
  habits: [
    { id: "h1", stat: "lang", name: "영어 스피킹 / 단어 20분", diff: 1, min: 20 },
    { id: "h2", stat: "tech", name: "딥워크 90분 (파이프라인 학습)", diff: 3, min: 90 },
    { id: "h3", stat: "port", name: "포트폴리오 커밋 1개 이상", diff: 2, min: 45 },
    { id: "h4", stat: "port", name: "README / 문서 30분", diff: 2, min: 30 },
    { id: "h5", stat: "body", name: "운동 30분 / 취침 00:30 이전", diff: 1, min: 30 },
  ],
  til: {},             // { 'YYYY-MM-DD': { habitId: '한 줄 메모' } }
  actualMin: {},       // { 'YYYY-MM-DD': { habitId: 실제 분 } } — 미기록 시 목표 시간 사용
  weeklyGoals: { lang: 3, tech: 5, port: 3, body: 2 }, // 영역별 주간 목표 시간(h)
  dreamHistory: [],    // [{ date, dream }] — 달성/변경된 과거의 꿈
  assignments: {},     // { 'YYYY-MM-DD': [habitId, habitId] } — 그날 편성된 퀘스트
  checks: {},          // { 'YYYY-MM-DD': [habitId, ...] } — 완료한 퀘스트
  evidence: [],        // [{ date, stat, from, to, text, kind, major }]
  reviews: [],         // [{ date, mistake, fix }]
};

// 난이도: 소(1)/중(2)/대(3) — XP와 모멘텀 기여 모두 차등
const DIFF = { 1: { label: "소", xp: 5 }, 2: { label: "중", xp: 10 }, 3: { label: "대", xp: 20 } };
const habitDiff = (h) => DIFF[h?.diff] ? h.diff : 2;
const habitXp = (h) => DIFF[habitDiff(h)].xp;
const habitMin = (h) => (h && h.min > 0 ? h.min : { 1: 20, 2: 45, 3: 90 }[habitDiff(h)]);
const QUESTS_PER_DAY = 2;   // 자동 편성(최소)
const MAX_QUESTS = 5;       // 수동 추가 포함 최대
const WEEKLY_CAP = 4; // 같은 영역 주 최대 '자동 편성' 횟수 (수동 추가에는 미적용)
const REST_BUDGET = 14; // 분기당 컨디션 모드 사용 가능 일수
const xpNeed = (level) => 60 + level * 10;

const fmtDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// 하루 마감 오프셋: 새벽 2시까지는 전날로 귀속된다.
// 늦게까지 작업하는 날의 기록이 다음 날로 밀리지 않게 하기 위함.
const DAY_CUTOFF_HOUR = 2;
const logicalNow = () => {
  const d = new Date();
  d.setHours(d.getHours() - DAY_CUTOFF_HOUR);
  return d;
};
const todayKey = () => fmtDate(logicalNow());
const quarterLabel = () => {
  const d = logicalNow();
  return `SEASON ${d.getFullYear()} · Q${Math.floor(d.getMonth() / 3) + 1}`;
};

// 날짜 문자열 → 결정적 시드 난수 (하루 안에서 편성이 흔들리지 않게)
function seededRandom(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// 이번 주(월~일) 각 영역 편성 횟수
function weeklyStatCount(assignments, habits, refDate) {
  const d = new Date(refDate);
  const day = (d.getDay() + 6) % 7; // 월=0
  d.setDate(d.getDate() - day);
  const count = {};
  for (let i = 0; i < 7; i++) {
    const k = fmtDate(d);
    (assignments[k] || []).forEach((hid) => {
      const h = habits.find((x) => x.id === hid);
      if (h) count[h.stat] = (count[h.stat] || 0) + 1;
    });
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// 가중치 기반 오늘의 퀘스트 편성 (결정적 + 주간 상한)
function generateAssignment(dateKey, habits, weights, assignments) {
  const rand = seededRandom(dateKey + "|gos");
  const weekCount = weeklyStatCount(assignments, habits, new Date(dateKey + "T12:00:00"));
  const picked = [];
  const pool = habits.filter((h) => (weights[h.stat] || 0) > 0);
  const fallback = pool.length ? pool : habits.slice();

  for (let slot = 0; slot < QUESTS_PER_DAY; slot++) {
    let candidates = fallback.filter(
      (h) => !picked.includes(h.id) && (weekCount[h.stat] || 0) < WEEKLY_CAP
    );
    if (!candidates.length)
      candidates = fallback.filter((h) => !picked.includes(h.id));
    if (!candidates.length) break;
    // 슬롯 내 같은 영역 중복 회피 (대안이 있을 때만)
    const diverse = candidates.filter(
      (h) => !picked.some((pid) => fallback.find((x) => x.id === pid)?.stat === h.stat)
    );
    if (diverse.length) candidates = diverse;

    const total = candidates.reduce((a, h) => a + (weights[h.stat] || 1), 0);
    let r = rand() * total;
    let chosen = candidates[candidates.length - 1];
    for (const h of candidates) {
      r -= weights[h.stat] || 1;
      if (r <= 0) { chosen = h; break; }
    }
    picked.push(chosen.id);
    weekCount[chosen.stat] = (weekCount[chosen.stat] || 0) + 1;
  }
  return picked;
}

// 행동력 파생 계산: 모멘텀 모델 (0~100 → 레벨 0~20)
// - 완수일: 난이도 가중 실행률 × (0.7 + 전량완수 스트릭 보너스, 최대 1.2/일) 획득
// - 부분 완수: 획득하되 스트릭은 유지 / 1일 미실행: 유예 / 2일 연속부터 -1.2/일
// - 컨디션 모드(rest) 날: 완전 동결 — 획득·감소·스트릭 변동 없음. 단, 그날 완수하면 획득은 인정
function calcExecution(assignments, checks, habits, rest) {
  const hMap = {}; (habits || []).forEach((h) => { hMap[h.id] = h; });
  const activeKeys = Object.keys(assignments)
    .filter((k) => (assignments[k] || []).length)
    .sort();
  const tk = todayKey();  // 논리 날짜 기준 (새벽 2시 마감)
  let M = 0, streak = 0, missRun = 0, status = "idle";
  let assigned14 = 0, done14 = 0, totalFull = 0, maxStreak = 0;

  if (activeKeys.length) {
    const start = new Date(activeKeys[0] + "T12:00:00");
    const cutoff14 = logicalNow(); cutoff14.setDate(cutoff14.getDate() - 13);
    for (const d = new Date(start); ; d.setDate(d.getDate() + 1)) {
      const k = fmtDate(d);
      if (k > tk) break;
      const a = (assignments[k] || []).filter((id) => hMap[id]); // 삭제된 습관은 판정에서 제외
      const doneIds = a.filter((id) => (checks[k] || []).includes(id));
      const totalW = a.reduce((s, id) => s + habitXp(hMap[id]), 0);
      const doneW = doneIds.reduce((s, id) => s + habitXp(hMap[id]), 0);
      const r = totalW ? doneW / totalW : 0;
      if (d >= cutoff14) { assigned14 += a.length; done14 += doneIds.length; }
      const isToday = k === tk;
      const frozen = rest && rest[k];

      if (r > 0) {
        const full = doneIds.length === a.length && a.length > 0;
        if (full) {
          totalFull += 1;
          if (!frozen) { streak += 1; maxStreak = Math.max(maxStreak, streak); }
        }
        M += r * (0.7 + 0.05 * Math.min(streak, 10));
        missRun = 0;
        status = "gain";
      } else if (frozen) {
        // 동결: 아무 일도 일어나지 않는다
        if (!isToday) status = "rest";
      } else if (!isToday) {
        streak = 0;
        missRun += 1;
        if (missRun >= 2) { M -= 1.2; status = "decay"; }
        else status = "grace";
      }
      M = Math.max(0, Math.min(100, M));
      if (isToday) { if (rest && rest[tk]) status = "rest"; break; }
    }
  }

  return {
    level: Math.floor(M / 5),
    momentum: Math.round(M * 10) / 10,
    streak,
    maxStreak,
    totalFull,
    missRun,
    status, // gain | grace | decay | rest | idle
    rate14: assigned14 ? done14 / assigned14 : 0,
    gainPerDay: Math.round((0.7 + 0.05 * Math.min(streak, 10)) * 10) / 10,
  };
}

// 이번 분기 컨디션 모드 사용 일수
function restUsedThisQuarter(rest) {
  const now = new Date();
  const qStart = fmtDate(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1));
  return Object.keys(rest || {}).filter((k) => k >= qStart).length;
}

// 특정 날짜의 완수 상태: null=편성 없음, 0~1=완수율
function dayRate(state, key) {
  const a = state.assignments[key] || [];
  if (!a.length) return null;
  const done = a.filter((id) => (state.checks[key] || []).includes(id)).length;
  return done / a.length;
}

// 일자별·영역별 몰입 분 집계: 실제 기록(actualMin) 우선, 없으면 목표 시간
function minutesByDay(state) {
  const hm = {}; state.habits.forEach((h) => { hm[h.id] = h; });
  const out = {}; // { dateKey: { lang: min, ... } }
  Object.entries(state.checks || {}).forEach(([dk, ids]) => {
    ids.forEach((id) => {
      const h = hm[id]; if (!h) return;
      const m = state.actualMin?.[dk]?.[id] ?? habitMin(h);
      if (!out[dk]) out[dk] = { lang: 0, tech: 0, port: 0, body: 0 };
      if (out[dk][h.stat] !== undefined) out[dk][h.stat] += m;
    });
  });
  return out;
}

// 해당 날짜가 속한 주의 월요일 키
function weekStartKey(dateKey) {
  const d = new Date(dateKey + "T12:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fmtDate(d);
}

/* ------------------------------------------------------------------ */
/* Calendar (읽기 전용 — 과거는 열람만, 수정 불가)                       */
/* ------------------------------------------------------------------ */
function HistoryCalendar({ state, selected, onSelect, month, onMonth }) {
  const today = logicalNow();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startPad = (first.getDay() + 6) % 7; // 월=0
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const isCurrentMonth =
    month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();

  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const rateColor = (r) => (r === null ? "transparent" : r >= 1 ? C.high : r > 0 ? C.mid : C.low);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <button onClick={() => onMonth(-1)} className="gos-disp"
          style={{ border: `1px solid ${C.line}`, background: "transparent", color: C.muted, borderRadius: 5, padding: "4px 10px", fontSize: 13, cursor: "pointer" }}>‹</button>
        <div className="gos-disp" style={{ fontSize: 14, fontWeight: 700 }}>
          {month.getFullYear()}. {String(month.getMonth() + 1).padStart(2, "0")}
        </div>
        <button onClick={() => onMonth(1)} disabled={isCurrentMonth} className="gos-disp"
          style={{ border: `1px solid ${C.line}`, background: "transparent", color: isCurrentMonth ? C.faint : C.muted, borderRadius: 5, padding: "4px 10px", fontSize: 13, cursor: isCurrentMonth ? "default" : "pointer" }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {["월", "화", "수", "목", "금", "토", "일"].map((w) => (
          <div key={w} className="gos-disp" style={{ textAlign: "center", fontSize: 10, color: C.faint, fontWeight: 600 }}>{w}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={"p" + i} />;
          const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const future = key > todayKey();
          const rate = dayRate(state, key);
          const hasEvidence = state.evidence.some((e) => e.date === key);
          const hasReview = state.reviews.some((r) => r.date === key);
          const isSel = selected === key;
          const isToday = key === todayKey();
          return (
            <button key={key} disabled={future} onClick={() => onSelect(isSel ? null : key)}
              style={{
                aspectRatio: "1", borderRadius: 6, cursor: future ? "default" : "pointer",
                border: `1px solid ${isSel ? C.accent : isToday ? C.muted : C.line}`,
                background: rate === null ? "transparent"
                  : rate >= 1 ? "rgba(67,217,163,.55)" : rate > 0 ? "rgba(227,184,78,.45)" : "rgba(224,101,107,.4)",
                color: future ? C.faint : rate !== null ? "#0d141c" : C.text,
                fontWeight: rate !== null ? 700 : 400,
                position: "relative", padding: 0,
              }}>
              <span className="gos-num" style={{ fontSize: 11 }}>{d}</span>
              {hasEvidence && (
                <span style={{ position: "absolute", top: 0, right: 2, fontSize: 10, color: C.mid, textShadow: "0 0 3px rgba(0,0,0,.7)" }}>★</span>
              )}
              {hasReview && (
                <span style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: 2, background: rate !== null ? "#0d141c" : C.muted, opacity: .7 }} />
              )}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
        {[["전량 완수", "rgba(67,217,163,.7)"], ["일부", "rgba(227,184,78,.6)"], ["미실행", "rgba(224,101,107,.55)"], ["★ 승급", C.mid], ["● 복기", C.muted]].map(([l, c]) => (
          <span key={l} style={{ fontSize: 10, color: C.faint, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
          </span>
        ))}
      </div>
    </div>
  );
}

function DayDetail({ state, dateKey }) {
  const assigned = state.assignments[dateKey] || [];
  const checks = state.checks[dateKey] || [];
  const evs = state.evidence.filter((e) => e.date === dateKey);
  const revs = state.reviews.filter((r) => r.date === dateKey);
  const empty = !assigned.length && !evs.length && !revs.length;
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 12, paddingTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span className="gos-num" style={{ fontSize: 13, color: C.accent, fontWeight: 600 }}>{dateKey}</span>
        <span className="gos-disp" style={{ fontSize: 10, color: C.faint, fontWeight: 700 }}>READ ONLY</span>
      </div>
      {empty && <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>이 날의 기록이 없다.</p>}
      {assigned.map((hid) => {
        const h = state.habits.find((x) => x.id === hid);
        const on = checks.includes(hid);
        const til = (state.til?.[dateKey] || {})[hid];
        return (
          <div key={hid} style={{ padding: "5px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: on ? C.high : C.low, width: 16, flexShrink: 0 }}>{on ? "✓" : "✗"}</span>
              <span style={{ fontSize: 13, color: on ? C.text : C.muted }}>
                {h ? h.name : "(삭제된 훈련 항목)"}
              </span>
            </div>
            {til && <div style={{ fontSize: 12, color: C.muted, marginLeft: 24, marginTop: 2, borderLeft: `2px solid ${C.accent}`, paddingLeft: 8 }}>{til}</div>}
          </div>
        );
      })}
      {evs.map((ev, i) => {
        const st = AREAS.find((s) => s.id === ev.stat);
        return (
          <div key={"e" + i} style={{ fontSize: 12, marginTop: 6, color: C.mid }}>
            ★ 승급 — {st?.name} {ev.from}→{ev.to} · <span style={{ color: C.text }}>{ev.text}</span>
          </div>
        );
      })}
      {revs.map((r, i) => (
        <div key={"r" + i} style={{ fontSize: 12, marginTop: 6, color: C.muted }}>
          복기 — <span style={{ color: C.low }}>실책:</span> {r.mistake} / <span style={{ color: C.high }}>수정:</span> {r.fix}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onboarding — 최초 1회 프로필 & 초기 능력치 설정                       */
/* ------------------------------------------------------------------ */
function Onboarding({ initialLevels, onStart }) {
  const [job, setJob] = useState("");
  const [age, setAge] = useState("");
  const [dream, setDream] = useState("");
  const [startDate, setStartDate] = useState(todayKey());
  const [lv, setLv] = useState({ ...initialLevels });
  const valid = job.trim().length >= 2 && String(age).trim().length >= 1 && dream.trim().length >= 2;

  const setL = (id, v) => setLv((s) => ({ ...s, [id]: Math.max(1, Math.min(20, Number(v) || 1)) }));

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text }} className="gos-body">
      <style>{FONT_CSS}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 16px 48px" }}>
        <div className="gos-disp" style={{ fontSize: 12, color: C.accent, fontWeight: 600 }}>NEW SAVE</div>
        <h1 className="gos-disp" style={{ fontSize: 28, fontWeight: 700, margin: "2px 0 4px" }}>CREATE YOUR PROFILE</h1>
        <p style={{ fontSize: 12, color: C.muted, margin: "0 0 20px", lineHeight: 1.6 }}>
          스카우트 리포트의 주인공을 등록한다. 한 번 시작하면 능력치는 외부 증거로만 오른다.
        </p>

        <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <h2 className="gos-disp" style={{ fontSize: 13, fontWeight: 700, margin: "0 0 10px" }}>IDENTITY</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input className="gos-input" value={job} onChange={(e) => setJob(e.target.value)} placeholder="현재 직업 (예: IoT Engineer)"
              style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 12px", color: C.text, fontSize: 13 }} />
            <input className="gos-input gos-num" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="나이" inputMode="numeric"
              style={{ width: 70, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 12px", color: C.text, fontSize: 13, textAlign: "center" }} />
          </div>
          <input className="gos-input" value={dream} onChange={(e) => setDream(e.target.value)} placeholder="꿈 / 전향 목표 (예: 제조 데이터 엔지니어)"
            style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 12px", color: C.text, fontSize: 13, marginBottom: 8 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>시작일</span>
            <input className="gos-input gos-num" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px", color: C.text, fontSize: 13 }} />
          </div>
        </section>

        <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <h2 className="gos-disp" style={{ fontSize: 13, fontWeight: 700, margin: "0 0 4px" }}>INITIAL ATTRIBUTES</h2>
          <p style={{ fontSize: 11, color: C.faint, margin: "0 0 12px", lineHeight: 1.6 }}>
            기준: 목표 직무 채용 시장에서의 상대 위치. 1–7 탈락 요인 / 8–13 수행 가능 / 14–17 강점 / 18–20 그것만으로 뽑히는 수준.
            혼자 정하지 말고 <span style={{ color: C.accent }}>AI와 상담해 근거와 함께</span> 정하라 — 자기평가는 대체로 후하다.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {AREAS.map((st) => (
              <div key={st.id} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{st.name}</div>
                <input className="gos-input gos-num" type="number" min={1} max={20} value={lv[st.id]}
                  onChange={(e) => setL(st.id, e.target.value)}
                  style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 0", color: attrColor(lv[st.id]), fontSize: 17, fontWeight: 600, textAlign: "center" }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, padding: "10px 12px", background: C.panelHi, borderRadius: 6 }}>
            <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>행동력</span>
            <span className="gos-num" style={{ fontSize: 17, fontWeight: 600, color: C.low }}>0</span>
            <span className="gos-disp" style={{ fontSize: 9, color: C.faint, fontWeight: 700 }}>고정 · 실행으로만 오르고, 멈추면 떨어진다</span>
          </div>
        </section>

        <button disabled={!valid} className="gos-disp"
          onClick={() => onStart({ job: job.trim(), age: String(age).trim(), dream: dream.trim(), startDate }, lv)}
          style={{
            width: "100%", padding: "13px 0", borderRadius: 6, border: "none",
            background: valid ? C.accent : C.line, color: valid ? C.bg : C.faint,
            fontSize: 14, fontWeight: 700, cursor: valid ? "pointer" : "default",
          }}>
          시즌 시작
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */
export default function GrowthOS() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);
  const [levelUpTarget, setLevelUpTarget] = useState(null);
  const [evidenceText, setEvidenceText] = useState("");
  const [evidenceKind, setEvidenceKind] = useState("self"); // official | self
  const [skillName, setSkillName] = useState("");
  const [skillValue, setSkillValue] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [majorMode, setMajorMode] = useState(false);
  const [restReason, setRestReason] = useState("");
  const [restUntil, setRestUntil] = useState("");
  const [newHabitDiff, setNewHabitDiff] = useState(2);
  const [newHabitMin, setNewHabitMin] = useState(30);
  const [newDream, setNewDream] = useState("");
  const [nodeArea, setNodeArea] = useState("lang");
  const [nodeName, setNodeName] = useState("");
  const [nodeValue, setNodeValue] = useState("");
  const [reviewMistake, setReviewMistake] = useState("");
  const [reviewFix, setReviewFix] = useState("");
  const [tab, setTab] = useState("main"); // main | today | focus | log
  const [newHabit, setNewHabit] = useState("");
  const [newHabitStat, setNewHabitStat] = useState("lang");
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [resetConfirm, setResetConfirm] = useState("");
  const [minDraft, setMinDraft] = useState({}); // { habitId: "입력 중 문자열" }
  const [toast, setToast] = useState(null);
  const saveTimer = useRef(null);

  /* ---------- persistence + 오늘 편성 보장 ---------- */
  useEffect(() => {
    (async () => {
      let s = DEFAULT_STATE;
      try {
        const r = await store.get("growth-os-v2");
        if (r && r.value) s = { ...DEFAULT_STATE, ...JSON.parse(r.value) };
      } catch (e) { /* 첫 실행 */ }
      s = { ...s, tipSeed: ((s.tipSeed || 0) + 1) % TIPS.length };
      // v5 보정: 어학 초기치 12→11 (시장 상대평가 재조정, 1회만)
      if (!s.calibratedV5) {
        s = { ...s, levels: { ...s.levels, lang: Math.min(s.levels.lang, 11) }, calibratedV5: true };
      }
      const tk = todayKey();
      if (!s.assignments[tk] || !s.assignments[tk].length) {
        s = { ...s, assignments: { ...s.assignments, [tk]: generateAssignment(tk, s.habits, s.weights, s.assignments) } };
      }
      setTipIndex(s.tipSeed || 0);
      setState(s);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await store.set("growth-os-v2", JSON.stringify(state)); }
      catch (e) { console.error("저장 실패", e); }
    }, 400);
  }, [state, loaded]);

  // 자정 넘김 대응: 날짜가 바뀌면 새 편성 생성
  useEffect(() => {
    if (!loaded) return;
    const t = setInterval(() => {
      const tk2 = todayKey();
      setState((s) => {
        if (s.assignments[tk2] && s.assignments[tk2].length) return s;
        return { ...s, assignments: { ...s.assignments, [tk2]: generateAssignment(tk2, s.habits, s.weights, s.assignments) } };
      });
    }, 60000);
    return () => clearInterval(t);
  }, [loaded]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  /* ---------- derived ---------- */
  const tKey = todayKey();
  const todayAssigned = state.assignments[tKey] || [];
  const todayChecks = state.checks[tKey] || [];
  const exec = calcExecution(state.assignments, state.checks, state.habits, state.rest);
  const dayMin = minutesByDay(state);
  const cumMin = { lang: 0, tech: 0, port: 0, body: 0 };
  Object.values(dayMin).forEach((m) => AREAS.forEach((a) => { cumMin[a.id] += m[a.id] || 0; }));
  // 이번 주(월~일) 영역별 분
  const thisWeekKey = weekStartKey(tKey);
  const weekMin = { lang: 0, tech: 0, port: 0, body: 0 };
  Object.entries(dayMin).forEach(([dk, m]) => {
    if (weekStartKey(dk) === thisWeekKey) AREAS.forEach((a) => { weekMin[a.id] += m[a.id] || 0; });
  });
  // 최근 8주 주간 집계 (차트용)
  const weekChart = (() => {
    const rows = [];
    for (let w = 7; w >= 0; w--) {
      const monday = new Date(thisWeekKey + "T12:00:00");
      monday.setDate(monday.getDate() - w * 7);
      const wk = fmtDate(monday);
      const row = { week: `${monday.getMonth() + 1}/${monday.getDate()}` };
      AREAS.forEach((a) => { row[a.id] = 0; });
      Object.entries(dayMin).forEach(([dk, m]) => {
        if (weekStartKey(dk) === wk) AREAS.forEach((a) => { row[a.id] += Math.round(((m[a.id] || 0) / 60) * 10) / 10; });
      });
      rows.push(row);
    }
    return rows;
  })();
  const allLevels = { ...state.levels, exec: exec.level };
  const targets = state.goal?.targets || {};
  const overall = (
    (AREAS.reduce((a, s) => a + state.levels[s.id], 0) + exec.level) / 5
  ).toFixed(1);
  const radarData = [...AREAS, EXEC].map((st) => ({
    subject: st.name,
    value: allLevels[st.id],
    target: targets[st.id] ?? 0,
  }));

  /* ---------- actions ---------- */
  const toggleHabit = (habit) => {
    setState((s) => {
      const cur = s.checks[tKey] || [];
      const on = cur.includes(habit.id);
      return {
        ...s,
        checks: { ...s.checks, [tKey]: on ? cur.filter((i) => i !== habit.id) : [...cur, habit.id] },
        xp: { ...s.xp, [habit.stat]: Math.max(0, s.xp[habit.stat] + (on ? -habitXp(habit) : habitXp(habit))) },
      };
    });
  };

  const swapQuest = (slotIdx) => {
    setState((s) => {
      const cur = s.assignments[tKey] || [];
      if ((s.checks[tKey] || []).includes(cur[slotIdx])) return s; // 완료한 퀘스트는 교체 불가
      const pool = s.habits.filter((h) => (s.weights[h.stat] || 0) > 0 && !cur.includes(h.id));
      if (!pool.length) return s;
      const curHabit = s.habits.find((h) => h.id === cur[slotIdx]);
      const idxOfCur = s.habits.findIndex((h) => h.id === curHabit?.id);
      const next = pool.find((h) => s.habits.indexOf(h) > idxOfCur) || pool[0];
      const nextAssign = [...cur];
      nextAssign[slotIdx] = next.id;
      return { ...s, assignments: { ...s.assignments, [tKey]: nextAssign } };
    });
  };

  const setWeight = (statId, w) => {
    setState((s) => {
      const weights = { ...s.weights, [statId]: w };
      // 내일부터 반영이 원칙이지만, 오늘 미완료 편성은 재생성
      const doneToday = (s.checks[tKey] || []).length > 0;
      const assignments = doneToday
        ? s.assignments
        : { ...s.assignments, [tKey]: generateAssignment(tKey, s.habits, weights, s.assignments) };
      return { ...s, weights, assignments };
    });
  };

  const addHabit = () => {
    const name = newHabit.trim();
    if (name.length < 2) return;
    setState((s) => ({
      ...s,
      habits: [...s.habits, { id: "h" + Date.now(), stat: newHabitStat, name, diff: newHabitDiff, min: newHabitMin }],
    }));
    setNewHabit("");
    flash("훈련 항목 추가됨 — 내일 편성부터 반영");
  };

  const removeHabit = (id) => {
    setState((s) => {
      const cur = s.assignments[tKey] || [];
      const kept = cur.filter((x) => x !== id || (s.checks[tKey] || []).includes(x));
      return {
        ...s,
        habits: s.habits.filter((h) => h.id !== id),
        assignments: { ...s.assignments, [tKey]: kept },
      };
    });
  };

  const closePromotion = () => {
    setLevelUpTarget(null); setMajorMode(false);
    setEvidenceText(""); setEvidenceKind("self"); setSkillName(""); setSkillValue(""); setEvidenceUrl("");
  };

  const confirmLevelUp = () => {
    const stat = levelUpTarget;
    const text = evidenceText.trim();
    if (!stat || text.length < 8) return;
    if (majorMode && evidenceKind !== "official") return; // 메이저 승급은 공인 증빙만
    setState((s) => {
      const lv = s.levels[stat];
      if (lv >= 20) return s;
      if (!majorMode && s.xp[stat] < xpNeed(lv)) return s;
      // 스킬 노드 갱신/추가 (선택)
      const subs = { ...(s.subskills || {}) };
      const nm = skillName.trim(), val = skillValue.trim();
      if (nm) {
        const list = [...(subs[stat] || [])];
        const idx = list.findIndex((x) => x.name.toLowerCase() === nm.toLowerCase());
        if (idx >= 0) list[idx] = { ...list[idx], value: val || list[idx].value };
        else list.push({ id: "s" + Date.now(), name: nm, value: val || "달성" });
        subs[stat] = list;
      }
      return {
        ...s,
        levels: { ...s.levels, [stat]: lv + 1 },
        xp: majorMode ? s.xp : { ...s.xp, [stat]: s.xp[stat] - xpNeed(lv) },
        subskills: subs,
        deadline: majorMode ? { name: "", date: "" } : s.deadline,
        evidence: [{ date: tKey, stat, from: lv, to: lv + 1, text, kind: evidenceKind, major: majorMode, url: evidenceUrl.trim() }, ...s.evidence],
      };
    });
    const wasMajor = majorMode;
    closePromotion();
    flash(wasMajor ? "★ 메이저 승급 — D-Day를 완수했다" : "레벨 업 — 증거가 기록에 남았다");
  };

  // 컨디션 모드: 오늘~종료일을 동결. 분기 예산 내에서만.
  const activateRest = () => {
    if (!restUntil || restUntil < tKey) return;
    setState((s) => {
      let budget = REST_BUDGET - restUsedThisQuarter(s.rest);
      if (budget <= 0) return s;
      const rest = { ...(s.rest || {}) };
      for (const d = new Date(tKey + "T12:00:00"); fmtDate(d) <= restUntil && budget > 0; d.setDate(d.getDate() + 1)) {
        const k = fmtDate(d);
        if (!rest[k]) { rest[k] = restReason.trim() || "컨디션 모드"; budget -= 1; }
      }
      return { ...s, rest };
    });
    setRestReason(""); setRestUntil("");
    flash("❄ 컨디션 모드 시작 — 모멘텀 동결");
  };

  const cancelRest = () => {
    setState((s) => {
      const rest = { ...(s.rest || {}) };
      Object.keys(rest).forEach((k) => { if (k >= tKey) delete rest[k]; });
      return { ...s, rest };
    });
    flash("컨디션 모드 해제 — 오늘부터 다시 계산");
  };

  const addQuestToday = (habitId) => {
    setState((s) => {
      const cur = s.assignments[tKey] || [];
      if (cur.length >= MAX_QUESTS || cur.includes(habitId)) return s;
      return { ...s, assignments: { ...s.assignments, [tKey]: [...cur, habitId] } };
    });
    setShowPicker(false);
  };

  // 자동 편성분(앞 2개)은 제거 불가. 수동 추가분만, 미완료 상태에서만 제거 가능.
  const removeQuestToday = (slotIdx) => {
    setState((s) => {
      const cur = s.assignments[tKey] || [];
      if (slotIdx < QUESTS_PER_DAY) return s;
      if ((s.checks[tKey] || []).includes(cur[slotIdx])) return s;
      return { ...s, assignments: { ...s.assignments, [tKey]: cur.filter((_, i) => i !== slotIdx) } };
    });
  };

  // 입력 중에는 문자열을 그대로 보관하고, 확정(blur/Enter) 시에만 숫자로 반영한다.
  // 즉시 Number() 변환하면 "10" 입력 중 "1"에서 값이 확정돼 두 자리 입력이 막힌다.
  const commitActualMin = (habitId, raw, fallback) => {
    const trimmed = String(raw ?? "").trim();
    const n = trimmed === "" ? fallback : Math.max(0, Math.min(600, Math.round(Number(trimmed)) || 0));
    setState((s) => ({
      ...s,
      actualMin: { ...(s.actualMin || {}), [tKey]: { ...((s.actualMin || {})[tKey] || {}), [habitId]: n } },
    }));
    setMinDraft((d) => { const nd = { ...d }; delete nd[habitId]; return nd; });
  };

  const setWeeklyGoal = (area, v) => {
    const n = Math.max(0, Math.min(60, Number(v) || 0));
    setState((s) => ({ ...s, weeklyGoals: { ...(s.weeklyGoals || {}), [area]: n } }));
  };

  const setTil = (habitId, text) => {
    setState((s) => ({
      ...s,
      til: { ...(s.til || {}), [tKey]: { ...((s.til || {})[tKey] || {}), [habitId]: text } },
    }));
  };

  const updateSubskill = (area, id, field, val) => {
    setState((s) => {
      const subs = { ...(s.subskills || {}) };
      subs[area] = (subs[area] || []).map((x) => (x.id === id ? { ...x, [field]: val } : x));
      return { ...s, subskills: subs };
    });
  };

  const addSubskill = (area, name, value) => {
    if (!name.trim()) return;
    setState((s) => {
      const subs = { ...(s.subskills || {}) };
      subs[area] = [...(subs[area] || []), { id: "s" + Date.now(), name: name.trim(), value: value.trim() || "-" }];
      return { ...s, subskills: subs };
    });
  };

  const removeSubskill = (area, id) => {
    setState((s) => {
      const subs = { ...(s.subskills || {}) };
      subs[area] = (subs[area] || []).filter((x) => x.id !== id);
      return { ...s, subskills: subs };
    });
  };

  const updateDream = (newDream) => {
    const nd = newDream.trim();
    if (nd.length < 2) return;
    setState((s) => ({
      ...s,
      dreamHistory: [...(s.dreamHistory || []), { date: tKey, dream: s.profile?.dream || "" }],
      profile: { ...s.profile, dream: nd },
    }));
    flash("★ 꿈 갱신 — 이전 꿈은 마일스톤으로 기록됐다");
  };

  const setTarget = (statId, v) => {
    const n = Math.max(1, Math.min(20, Number(v) || 1));
    setState((s) => ({ ...s, goal: { ...s.goal, targets: { ...s.goal.targets, [statId]: n } } }));
  };

  const exportReport = () => {
    const p = state.profile || {};
    const days = p.startDate ? Math.max(1, Math.floor((new Date() - new Date(p.startDate + "T00:00:00")) / 86400000) + 1) : "-";
    const now = logicalNow();
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    let active = 0, full = 0, aN = 0, dN = 0;
    for (const d = new Date(qStart); d <= now; d.setDate(d.getDate() + 1)) {
      const k = fmtDate(d);
      const a = state.assignments[k] || [];
      if (a.length) {
        active++;
        const dn = a.filter((id) => (state.checks[k] || []).includes(id)).length;
        aN += a.length; dN += dn;
        if (dn === a.length) full++;
      }
    }
    const statLine = (id, name, lv) => {
      const tgt = state.goal?.targets?.[id];
      const nodes = (state.subskills?.[id] || []).map((sk) => `${sk.name} ${sk.value}`).join(", ") || "-";
      return `| ${name} | ${lv}/20 | ${tgt ?? "-"} | ${(cumMin[id] / 60).toFixed(1)}h | ${nodes} |`;
    };
    const md = [
      `# SCOUT REPORT — ${p.job || "PLAYER"}${p.age ? ` · ${p.age}` : ""}`,
      ``,
      `> ${p.dream || ""} · DAY ${days} · ${quarterLabel()}`,
      ``,
      `> 생성일: ${todayKey()}${p.startDate ? ` · 시작일: ${p.startDate}` : ""}`,
      ``,
      `## Attributes (1–20, 시장 상대평가)`,
      ``,
      `| 영역 | 현재 | 목표 | 누적 몰입 | 하위 스킬 |`,
      `|---|---|---|---|---|`,
      ...AREAS.map((st) => statLine(st.id, st.name, state.levels[st.id])),
      `| 행동력 | ${exec.level}/20 | ${state.goal?.targets?.exec ?? "-"} | 최장 ${exec.maxStreak}일 연속 | 누적 전량완수 ${exec.totalFull}일 · 모멘텀 ${exec.momentum}/100 (실행으로만 산출) |`,
      ``,
      `## Quarter Summary`,
      ``,
      `훈련일 ${active} · 전량 완수 ${full}일 · 실행률 ${aN ? Math.round((dN / aN) * 100) : 0}% · 승급 ${state.evidence.filter((e) => e.date >= fmtDate(qStart)).length}회`,
      ``,
      `## Evidence Log (승급은 외부 증거로만 확정)`,
      ``,
      ...(state.evidence.length
        ? state.evidence.map((ev) => {
            const st = AREAS.find((s) => s.id === ev.stat);
            const link = ev.url ? ` [증거 확인](${ev.url})` : "";
            return `- ${ev.date} ${ev.major ? "★" : ""}[${st?.name}] ${ev.from}→${ev.to} (${ev.kind === "official" ? "공인" : "자체"}) — ${ev.text}${link}`;
          })
        : ["- (아직 없음)"]),
      ``,
      `## Engineering Log (TIL)`,
      ``,
      ...(() => {
        const lines = [];
        Object.keys(state.til || {}).sort().reverse().forEach((dk) => {
          Object.entries(state.til[dk] || {}).forEach(([hid, txt]) => {
            if (!txt || !txt.trim()) return;
            const h = state.habits.find((x) => x.id === hid);
            const ar = AREAS.find((s) => s.id === h?.stat);
            lines.push(`- ${dk} [${ar?.name || "-"}] ${txt.trim()}`);
          });
        });
        return lines.length ? lines : ["- (아직 없음)"];
      })(),
      ``,
      `## Career Milestones`,
      ``,
      ...((state.dreamHistory || []).length
        ? state.dreamHistory.slice().reverse().map((d) => `- ${d.date} — ${d.dream} ✓`)
        : ["- (진행 중)"]),
      ``,
      `## Weekly Reviews`,
      ``,
      ...(state.reviews.length
        ? state.reviews.map((r) => `- ${r.date} — 실책: ${r.mistake} / 수정: ${r.fix}`)
        : ["- (아직 없음)"]),
      ``,
      `---`,
      `*Growth OS — 레벨은 자기평가가 아닌 외부 증거로만 상승하며, 행동력은 일일 실행 기록에서 자동 산출된다.*`,
    ].join("\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scout-report-${todayKey()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    flash("스카우트 리포트 내보내기 완료");
  };

  const importData = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== "object" || !parsed.levels || !parsed.habits) {
          flash("가져오기 실패 — Growth OS 백업 파일이 아니다");
          return;
        }
        setState({ ...DEFAULT_STATE, ...parsed });
        flash("복원 완료 — 백업 시점의 기록으로 돌아왔다");
      } catch (e) {
        flash("가져오기 실패 — JSON을 읽을 수 없다");
      }
    };
    reader.readAsText(file);
  };

  // 주간 로그: 이번 주(월~일) TIL·시간·완수·복기·승급을 마크다운으로
  const exportWeekly = () => {
    const monday = new Date(thisWeekKey + "T12:00:00");
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(d.getDate() + i);
      const k = fmtDate(d);
      if (k > tKey) break;
      days.push(k);
    }
    const hm = {}; state.habits.forEach((h) => { hm[h.id] = h; });
    const lines = [];
    lines.push(`# WEEKLY LOG — ${thisWeekKey} 주차`);
    lines.push(``);
    lines.push(`> ${state.profile?.job || ""} · ${state.profile?.dream || ""} · 생성일 ${todayKey()}`);
    lines.push(``);

    // 주간 목표 달성
    lines.push(`## 주간 목표 달성`);
    lines.push(``);
    lines.push(`| 영역 | 실적 | 목표 | 달성 |`);
    lines.push(`|---|---|---|---|`);
    AREAS.forEach((a) => {
      const g = (state.weeklyGoals || {})[a.id] ?? 0;
      const h = weekMin[a.id] / 60;
      lines.push(`| ${a.name} | ${h.toFixed(1)}h | ${g}h | ${g > 0 && h >= g ? "✓" : "—"} |`);
    });
    lines.push(``);

    // 일자별 실행 + TIL
    lines.push(`## 일자별 기록`);
    lines.push(``);
    days.forEach((k) => {
      const a = (state.assignments[k] || []).filter((id) => hm[id]);
      const done = a.filter((id) => (state.checks[k] || []).includes(id));
      const rest = state.rest?.[k];
      const mark = rest ? "❄" : a.length === 0 ? "·" : done.length === a.length ? "🔥" : done.length > 0 ? "🟡" : "🔴";
      lines.push(`### ${k} ${mark} ${done.length}/${a.length}${rest ? ` (${rest})` : ""}`);
      a.forEach((id) => {
        const h = hm[id];
        const on = done.includes(id);
        const min = state.actualMin?.[k]?.[id] ?? habitMin(h);
        const til = (state.til?.[k] || {})[id];
        lines.push(`- ${on ? "✓" : "✗"} ${h.name}${on ? ` (${min}분)` : ""}`);
        if (on && til && til.trim()) lines.push(`  - TIL: ${til.trim()}`);
      });
      lines.push(``);
    });

    // 이번 주 승급·복기
    const evs = state.evidence.filter((e) => e.date >= thisWeekKey);
    lines.push(`## 이번 주 승급`);
    lines.push(``);
    lines.push(...(evs.length
      ? evs.map((ev) => {
          const st = AREAS.find((s) => s.id === ev.stat);
          return `- ${ev.date} ${ev.major ? "★" : ""}[${st?.name}] ${ev.from}→${ev.to} (${ev.kind === "official" ? "공인" : "자체"}) — ${ev.text}${ev.url ? ` [증거 확인](${ev.url})` : ""}`;
        })
      : ["- (없음)"]));
    lines.push(``);
    const revs = state.reviews.filter((r) => r.date >= thisWeekKey);
    lines.push(`## 이번 주 복기`);
    lines.push(``);
    lines.push(...(revs.length
      ? revs.map((r) => `- 실책: ${r.mistake}\n- 수정: ${r.fix}`)
      : ["- (없음)"]));
    lines.push(``);
    lines.push(`---`);
    lines.push(`*이 로그의 TIL 항목은 기술 블로그 초안의 재료다.*`);

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement("a");
    a2.href = url;
    a2.download = `weekly-log-${thisWeekKey}.md`;
    a2.click();
    URL.revokeObjectURL(url);
    flash("주간 로그 내보내기 완료");
  };

  // 전체 초기화 — 실행 전 자동 백업을 내려받고, 온보딩부터 다시 시작한다
  const resetAll = () => {
    if (resetConfirm.trim().toUpperCase() !== "RESET") return;
    try {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `growth-os-backup-before-reset-${todayKey()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { /* 백업 실패해도 초기화는 진행 */ }
    const tk2 = todayKey();
    setState({
      ...DEFAULT_STATE,
      assignments: { [tk2]: generateAssignment(tk2, DEFAULT_STATE.habits, DEFAULT_STATE.weights, {}) },
    });
    setResetConfirm("");
    setTab("main");
    flash("초기화 완료 — 백업 파일이 다운로드됐다");
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `growth-os-export-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash("데이터 내보내기 완료");
  };

  const saveReview = () => {
    if (!reviewMistake.trim() || !reviewFix.trim()) return;
    setState((s) => ({ ...s, reviews: [{ date: tKey, mistake: reviewMistake.trim(), fix: reviewFix.trim() }, ...s.reviews] }));
    setReviewMistake(""); setReviewFix("");
    flash("주간 복기 저장됨");
  };

  if (!loaded) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted }} className="gos-body">
        <style>{FONT_CSS}</style>불러오는 중…
      </div>
    );
  }

  if (!state.onboarded) {
    return (
      <Onboarding
        initialLevels={state.levels}
        onStart={(profile, levels) =>
          setState((s) => ({ ...s, profile, levels, onboarded: true }))
        }
      />
    );
  }

  const WEIGHT_LABELS = ["쉼", "유지", "훈련", "집중"];

  /* ---------------------------------------------------------------- */
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text }} className="gos-body">
      <style>{FONT_CSS}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 100px" }}>

        {/* ---------- Header ---------- */}
        <header style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <div className="gos-disp" style={{ fontSize: 12, color: C.accent, fontWeight: 600 }}>
                SCOUT REPORT{state.profile?.startDate && (() => {
                  const days = Math.max(1, Math.floor((new Date() - new Date(state.profile.startDate + "T00:00:00")) / 86400000) + 1);
                  return <span className="gos-num" style={{ color: C.faint, marginLeft: 8 }}>DAY {days}</span>;
                })()}
              </div>
              <h1 className="gos-disp" style={{ fontSize: 28, fontWeight: 700, margin: "2px 0 0", lineHeight: 1.1 }}>
                {(state.profile?.job || "PLAYER").toUpperCase()}{state.profile?.age ? ` · ${state.profile.age}` : ""}
              </h1>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                {state.profile?.dream || "목표 미설정"} · {quarterLabel()}
              </div>
              {state.deadline?.date && (() => {
                const diff = Math.ceil((new Date(state.deadline.date + "T23:59:59") - new Date()) / 86400000);
                return (
                  <div className="gos-num" style={{
                    display: "inline-block", marginTop: 8, padding: "4px 10px", borderRadius: 5,
                    border: `1px solid ${diff <= 7 ? C.low : C.mid}`,
                    color: diff < 0 ? C.low : diff <= 7 ? C.low : C.mid,
                    fontSize: 13, fontWeight: 600,
                  }}>
                    {state.deadline.name} {diff < 0 ? `D+${-diff} 경과` : diff === 0 ? "D-DAY" : `D-${diff}`}
                  </div>
                );
              })()}
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="gos-num" style={{ fontSize: 34, fontWeight: 600, color: attrColor(Math.round(overall)), lineHeight: 1 }}>{overall}</div>
              <div className="gos-disp" style={{ fontSize: 10, color: C.faint, fontWeight: 600 }}>CURRENT ABILITY</div>
              <div className="gos-num" style={{ fontSize: 12, color: exec.streak > 0 ? C.mid : C.faint, marginTop: 6 }}>🔥 {exec.streak}일 연속</div>
              <div className="gos-num" style={{ fontSize: 11, color: exec.totalFull > 0 ? C.high : C.faint, marginTop: 2 }}>🏁 전량완수 {exec.totalFull}일</div>
            </div>
          </div>
        </header>

        {/* ---------- MAIN: Radar + attributes ---------- */}
        {tab === "main" && (
        <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ height: 230 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="75%">
                <PolarGrid stroke={C.line} />
                <PolarAngleAxis dataKey="subject" tick={{ fill: C.muted, fontSize: 12, fontFamily: "'IBM Plex Sans KR', sans-serif" }} />
                <PolarRadiusAxis domain={[0, 20]} tick={false} axisLine={false} />
                <Radar name="목표" dataKey="target" stroke={C.mid} strokeDasharray="4 4" fill="none" strokeWidth={1.5} />
                <Radar name="현재" dataKey="value" stroke={C.accent} fill={C.accent} fillOpacity={0.25} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: C.accent }}>— 현재</span>
            <span style={{ fontSize: 11, color: C.mid }}>┄ 목표: {state.goal?.name || "미설정"}</span>
          </div>

          <div style={{ marginTop: 8 }}>
            {AREAS.map((st) => {
              const lv = state.levels[st.id];
              const need = xpNeed(lv);
              const cur = state.xp[st.id];
              const ready = cur >= need && lv < 20;
              const w = state.weights[st.id] || 0;
              const tgt = targets[st.id] ?? null;
              const gap = tgt !== null ? tgt - lv : null;
              return (
                <div key={st.id} style={{ padding: "9px 0", borderTop: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 84, flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>
                      {st.name}{w === 3 && <span style={{ color: C.accent, fontSize: 10, marginLeft: 4 }}>●집중</span>}
                    </div>
                    <div className="gos-disp" style={{ fontSize: 9, color: C.faint, fontWeight: 600 }}>{st.en}</div>
                  </div>
                  <div style={{ width: 52, textAlign: "center", flexShrink: 0 }}>
                    <span className="gos-num" style={{ fontSize: 20, fontWeight: 600, color: attrColor(lv) }}>{lv}</span>
                    <span className="gos-num" style={{ fontSize: 11, color: C.faint }}>/20</span>
                    {gap !== null && (
                      <div className="gos-num" style={{ fontSize: 9, color: gap > 0 ? C.mid : C.high, marginTop: 1 }}>
                        {gap > 0 ? `목표 ${tgt} (+${gap})` : "목표 달성"}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(100, (cur / need) * 100)}%`, background: ready ? C.mid : C.accent, transition: "width .3s" }} />
                    </div>
                    <div className="gos-num" style={{ fontSize: 10, color: C.faint, marginTop: 3 }}>{cur} / {need} XP · 누적 {(cumMin[st.id] / 60).toFixed(1)}h</div>
                  </div>
                  <button onClick={() => ready && setLevelUpTarget(st.id)} disabled={!ready} className="gos-disp"
                    style={{
                      flexShrink: 0, fontSize: 11, fontWeight: 700, padding: "7px 10px", borderRadius: 5,
                      border: `1px solid ${ready ? C.mid : C.line}`,
                      background: ready ? "rgba(227,184,78,.12)" : "transparent",
                      color: ready ? C.mid : C.faint, cursor: ready ? "pointer" : "default",
                    }}>
                    {lv >= 20 ? "MAX" : ready ? "승급전" : "🔒"}
                  </button>
                </div>
                {(state.subskills?.[st.id] || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7, marginLeft: 94 }}>
                    {(state.subskills[st.id] || []).map((sk) => (
                      <span key={sk.id} style={{
                        fontSize: 10, padding: "3px 8px", borderRadius: 10,
                        border: `1px solid ${C.line}`, background: C.panelHi, color: C.muted,
                      }}>
                        {sk.name} <span className="gos-num" style={{ color: C.accent }}>{sk.value}</span>
                      </span>
                    ))}
                  </div>
                )}
                </div>
              );
            })}

            {/* 행동력 — 파생 지표 행 */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${C.line}`, background: "rgba(67,217,163,.03)" }}>
              <div style={{ width: 84, flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{EXEC.name}</div>
                <div className="gos-disp" style={{ fontSize: 9, color: C.faint, fontWeight: 600 }}>{EXEC.en} · 자동</div>
              </div>
              <div style={{ width: 52, textAlign: "center", flexShrink: 0 }}>
                <span className="gos-num" style={{ fontSize: 20, fontWeight: 600, color: attrColor(exec.level) }}>{exec.level}</span>
                <span className="gos-num" style={{ fontSize: 11, color: C.faint }}>/20</span>
                {targets.exec != null && (
                  <div className="gos-num" style={{ fontSize: 9, color: targets.exec - exec.level > 0 ? C.mid : C.high, marginTop: 1 }}>
                    {targets.exec - exec.level > 0 ? `목표 ${targets.exec} (+${targets.exec - exec.level})` : "목표 달성"}
                  </div>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${exec.momentum}%`, background: attrColor(exec.level) }} />
                </div>
                <div className="gos-num" style={{ fontSize: 10, color: C.faint, marginTop: 3 }}>
                  모멘텀 {exec.momentum}/100 · 최근 14일 {Math.round(exec.rate14 * 100)}%
                  {exec.status === "gain" && <span style={{ color: C.high }}> · ▲ +{exec.gainPerDay}/일 가속 중</span>}
                  {exec.status === "grace" && <span style={{ color: C.mid }}> · ⏸ 유예일 — 내일도 쉬면 감소 시작</span>}
                  {exec.status === "rest" && <span style={{ color: "#6aa8d8" }}> · ❄ 컨디션 모드 — 동결 중</span>}
                </div>
                <div className="gos-num" style={{ fontSize: 10, color: C.faint, marginTop: 2 }}>
                  현재 {exec.streak}일 연속 · 최장 {exec.maxStreak}일 · 누적 전량완수 {exec.totalFull}일
                  {exec.status === "decay" && <span style={{ color: C.low }}> · ▼ {exec.missRun}일 미실행, -1.2/일 감소 중</span>}
                </div>
              </div>
              <div className="gos-disp" style={{ flexShrink: 0, fontSize: 10, color: C.faint, fontWeight: 700, padding: "7px 6px" }}>파생</div>
            </div>
          </div>
          <p style={{ fontSize: 11, color: C.faint, margin: "10px 0 0", lineHeight: 1.5 }}>
            행동력은 <span style={{ color: C.accent }}>모멘텀</span>이다 — 연속 완수는 가속, 하루 실패는 유예, <span style={{ color: C.low }}>2일 연속 미실행부터 감소</span>한다. 근육과 같다: 유지에도 훈련이 필요하다. 레벨업은 여전히 <span style={{ color: C.mid }}>외부 증거</span>가 필요하다.
          </p>
        </section>
        )}

        {tab === "main" && (
          <button onClick={() => setTipIndex((i) => (i + 1) % TIPS.length)}
            style={{
              display: "block", width: "100%", textAlign: "left", cursor: "pointer",
              background: C.panel, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.mid}`,
              borderRadius: 8, padding: "14px 16px", marginBottom: 16, color: C.text,
            }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <span className="gos-disp" style={{ fontSize: 11, color: C.mid, fontWeight: 700 }}>
                TIP · {TIPS[tipIndex].t}
              </span>
              <span className="gos-num" style={{ fontSize: 10, color: C.faint }}>
                {tipIndex + 1}/{TIPS.length} ›
              </span>
            </div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{TIPS[tipIndex].d}</div>
          </button>
        )}

        {/* ---------- TODAY ---------- */}
        {tab === "today" && (
          <>
            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>TODAY'S QUESTS</h2>
                <span className="gos-num" style={{ fontSize: 12, color: C.muted }}>{todayChecks.filter((id) => todayAssigned.includes(id)).length}/{todayAssigned.length} · {tKey}</span>
              </div>
              <p style={{ fontSize: 11, color: C.faint, margin: "0 0 10px" }}>가중치 기반 자동 편성 · 같은 영역 주 {WEEKLY_CAP}회 상한 · 하루 마감 새벽 {DAY_CUTOFF_HOUR}시</p>
              {todayAssigned.map((hid, idx) => {
                const h = state.habits.find((x) => x.id === hid);
                if (!h) return null;
                const on = todayChecks.includes(h.id);
                const st = AREAS.find((s) => s.id === h.stat);
                return (
                  <div key={hid} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => toggleHabit(h)} className="gos-check"
                      style={{
                        display: "flex", alignItems: "center", gap: 12, flex: 1, textAlign: "left",
                        padding: "12px 12px", borderRadius: 6, cursor: "pointer",
                        border: `1px solid ${on ? C.accent : C.line}`,
                        background: on ? "rgba(67,217,163,.08)" : C.panelHi, color: C.text,
                      }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                        border: `2px solid ${on ? C.accent : C.faint}`,
                        background: on ? C.accent : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: C.bg, fontSize: 14, fontWeight: 700,
                      }}>{on ? "✓" : ""}</span>
                      <span style={{ flex: 1, fontSize: 14, opacity: on ? 0.75 : 1 }}>{h.name}</span>
                      <span className="gos-num" style={{ fontSize: 10, color: C.faint, flexShrink: 0 }}>{st?.name} · {DIFF[habitDiff(h)].label} +{habitXp(h)} · {habitMin(h)}분</span>
                    </button>
                    {!on && idx >= QUESTS_PER_DAY && (
                      <button onClick={() => removeQuestToday(idx)} className="gos-disp" title="추가분 제거"
                        style={{ flexShrink: 0, width: 40, borderRadius: 6, border: `1px solid ${C.line}`, background: C.panel, color: C.faint, fontSize: 14, cursor: "pointer" }}>
                        ✕
                      </button>
                    )}
                    {!on && idx < QUESTS_PER_DAY && (
                      <button onClick={() => swapQuest(idx)} className="gos-disp" title="다른 퀘스트로 교체"
                        style={{ flexShrink: 0, width: 40, borderRadius: 6, border: `1px solid ${C.line}`, background: C.panel, color: C.muted, fontSize: 15, cursor: "pointer" }}>
                        ⇄
                      </button>
                    )}
                  </div>
                  {on && (
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "0 8px" }}>
                        <input className="gos-input gos-num" type="text" inputMode="numeric" pattern="[0-9]*"
                          value={minDraft[h.id] ?? String((state.actualMin?.[tKey] || {})[h.id] ?? habitMin(h))}
                          onChange={(e) => setMinDraft((d) => ({ ...d, [h.id]: e.target.value }))}
                          onBlur={(e) => commitActualMin(h.id, e.target.value, habitMin(h))}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          onFocus={(e) => { const el = e.currentTarget; setTimeout(() => { try { el.select(); el.setSelectionRange(0, el.value.length); } catch (_) {} }, 0); }}
                          onClick={(e) => { const el = e.currentTarget; setTimeout(() => { try { el.select(); } catch (_) {} }, 0); }}
                          style={{ width: 46, background: "transparent", border: "none", color: C.accent, fontSize: 12, fontWeight: 600, textAlign: "right", padding: "8px 0" }} />
                        <span className="gos-num" style={{ fontSize: 10, color: C.faint }}>분</span>
                      </div>
                      <input className="gos-input" value={(state.til?.[tKey] || {})[h.id] || ""}
                        onChange={(e) => setTil(h.id, e.target.value)}
                        placeholder="TIL 한 줄 — 무엇을 해결/습득했나? (선택)"
                        style={{
                          flex: 1, minWidth: 0, background: C.bg,
                          border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.accent}`,
                          borderRadius: 6, padding: "8px 10px", color: C.text, fontSize: 12,
                        }} />
                    </div>
                  )}
                  </div>
                );
              })}

              {todayAssigned.length < MAX_QUESTS && (
                <button onClick={() => setShowPicker((v) => !v)} className="gos-disp"
                  style={{
                    width: "100%", padding: "10px 0", borderRadius: 6, marginTop: 2,
                    border: `1px dashed ${C.line}`, background: "transparent", color: C.muted,
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>
                  + 퀘스트 추가 ({todayAssigned.length}/{MAX_QUESTS})
                </button>
              )}
              {showPicker && (
                <div style={{ marginTop: 8, border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden" }}>
                  {state.habits.filter((h) => !todayAssigned.includes(h.id)).map((h) => {
                    const st = AREAS.find((s) => s.id === h.stat);
                    return (
                      <button key={h.id} onClick={() => addQuestToday(h.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                          padding: "10px 12px", border: "none", borderBottom: `1px solid ${C.line}`,
                          background: C.panelHi, color: C.text, fontSize: 13, cursor: "pointer",
                        }}>
                        <span className="gos-disp" style={{ fontSize: 10, color: C.accent, fontWeight: 700, width: 60, flexShrink: 0 }}>{st?.name}</span>
                        {h.name}
                      </button>
                    );
                  })}
                  {state.habits.filter((h) => !todayAssigned.includes(h.id)).length === 0 && (
                    <div style={{ padding: "10px 12px", fontSize: 12, color: C.faint }}>추가할 수 있는 훈련 항목이 없다. 집중 설정에서 풀을 늘려라.</div>
                  )}
                </div>
              )}
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>WEEKLY GOALS · 주간 목표</h2>
              <p style={{ fontSize: 11, color: C.faint, margin: "0 0 10px" }}>
                영역별 주간 몰입 시간 목표(h). 퀘스트 완수 시 실제 기록 시간으로 자동 집계된다 — 따로 적을 것 없다.
              </p>
              {AREAS.map((ar) => {
                const goalH = (state.weeklyGoals || {})[ar.id] ?? 0;
                const doneH = weekMin[ar.id] / 60;
                const pct = goalH > 0 ? Math.min(100, (doneH / goalH) * 100) : 0;
                const hit = goalH > 0 && doneH >= goalH;
                return (
                  <div key={ar.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                    <span style={{ width: 70, flexShrink: 0, fontSize: 13 }}>{ar.name}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: hit ? C.high : AREA_COLORS[ar.id], transition: "width .3s" }} />
                      </div>
                      <div className="gos-num" style={{ fontSize: 10, color: hit ? C.high : C.faint, marginTop: 3 }}>
                        {doneH.toFixed(1)}h / {goalH}h{hit && " ✓ 달성"}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}>
                      <input className="gos-input gos-num" type="number" min={0} max={60} value={goalH}
                        onChange={(e) => setWeeklyGoal(ar.id, e.target.value)}
                        style={{ width: 42, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5, padding: "6px 0", color: C.text, fontSize: 12, textAlign: "center" }} />
                      <span className="gos-num" style={{ fontSize: 10, color: C.faint }}>h</span>
                    </div>
                  </div>
                );
              })}
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>WEEKLY REVIEW</h2>
              <p style={{ fontSize: 11, color: C.faint, margin: "0 0 10px" }}>주 1회 — 실책 하나, 수정 하나. 그리고 실제로 가능해진 것이 있으면 수정 칸에 적어라.</p>
              <input className="gos-input" value={reviewMistake} onChange={(e) => setReviewMistake(e.target.value)}
                placeholder="이번 주 가장 큰 실책 1개"
                style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 12px", color: C.text, fontSize: 13, marginBottom: 8 }} />
              <input className="gos-input" value={reviewFix} onChange={(e) => setReviewFix(e.target.value)}
                placeholder="다음 주 수정 1개 / 새로 가능해진 것"
                style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 12px", color: C.text, fontSize: 13, marginBottom: 10 }} />
              <button onClick={saveReview} className="gos-disp"
                style={{ width: "100%", padding: "10px 0", borderRadius: 6, border: "none", background: C.accent, color: C.bg, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                복기 저장
              </button>
            </section>
          </>
        )}

        {/* ---------- FOCUS ---------- */}
        {tab === "focus" && (
          <>
            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>PROFILE & DREAM</h2>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input className="gos-input" value={state.profile?.job || ""}
                  onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, job: e.target.value } }))}
                  placeholder="현재 직업"
                  style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "9px 10px", color: C.text, fontSize: 13 }} />
                <input className="gos-input gos-num" value={state.profile?.age || ""}
                  onChange={(e) => setState((s) => ({ ...s, profile: { ...s.profile, age: e.target.value.replace(/\D/g, "").slice(0, 3) } }))}
                  placeholder="나이" inputMode="numeric"
                  style={{ width: 60, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "9px 8px", color: C.text, fontSize: 13, textAlign: "center" }} />
              </div>
              <div style={{ padding: "10px 12px", background: C.panelHi, borderRadius: 6, marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: C.faint, marginBottom: 3 }}>현재의 꿈</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.accent }}>{state.profile?.dream || "미설정"}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="gos-input" value={newDream} onChange={(e) => setNewDream(e.target.value)}
                  placeholder="새로운 꿈 (달성 또는 방향 전환 시)"
                  style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "9px 10px", color: C.text, fontSize: 13 }} />
                <button onClick={() => { updateDream(newDream); setNewDream(""); }} disabled={newDream.trim().length < 2} className="gos-disp"
                  style={{
                    flexShrink: 0, padding: "0 12px", borderRadius: 6, border: "none",
                    background: newDream.trim().length >= 2 ? C.mid : C.line,
                    color: newDream.trim().length >= 2 ? C.bg : C.faint,
                    fontSize: 12, fontWeight: 700, cursor: newDream.trim().length >= 2 ? "pointer" : "default",
                  }}>★ 갱신</button>
              </div>
              {(state.dreamHistory || []).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="gos-disp" style={{ fontSize: 10, color: C.faint, fontWeight: 700, marginBottom: 4 }}>CAREER MILESTONES</div>
                  {(state.dreamHistory || []).slice().reverse().map((d, i) => (
                    <div key={i} style={{ fontSize: 12, color: C.muted, padding: "3px 0" }}>
                      <span className="gos-num" style={{ color: C.faint }}>{d.date}</span> — {d.dream} <span style={{ color: C.high }}>✓</span>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ fontSize: 10, color: C.faint, margin: "8px 0 0" }}>
                꿈은 삭제되지 않는다 — 갱신하면 이전 꿈이 달성일과 함께 마일스톤으로 영구 기록된다.
              </p>
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>GOAL & TARGET</h2>
              <p style={{ fontSize: 11, color: C.faint, margin: "0 0 10px", lineHeight: 1.5 }}>
                목표와 그에 필요한 능력치. 레이더에 점선으로 표시되고, 갭이 큰 영역이 집중 후보다.
              </p>
              <input className="gos-input" value={state.goal?.name || ""}
                onChange={(e) => setState((s) => ({ ...s, goal: { ...s.goal, name: e.target.value } }))}
                placeholder="목표 (예: 제조 데이터 엔지니어 이직)"
                style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 12px", color: C.text, fontSize: 13, marginBottom: 10 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                {[...AREAS, EXEC].map((st) => (
                  <div key={st.id} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{st.name}</div>
                    <input className="gos-input gos-num" type="number" min={1} max={20}
                      value={state.goal?.targets?.[st.id] ?? ""}
                      onChange={(e) => setTarget(st.id, e.target.value)}
                      style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 0", color: C.mid, fontSize: 15, fontWeight: 600, textAlign: "center" }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <input className="gos-input" value={state.deadline?.name || ""}
                  onChange={(e) => setState((s) => ({ ...s, deadline: { ...s.deadline, name: e.target.value } }))}
                  placeholder="D-Day 이벤트 (외부 이벤트만)"
                  style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 12px", color: C.text, fontSize: 13 }} />
                <input className="gos-input gos-num" type="date" value={state.deadline?.date || ""}
                  onChange={(e) => setState((s) => ({ ...s, deadline: { ...s.deadline, date: e.target.value } }))}
                  style={{ flexShrink: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px", color: C.text, fontSize: 13 }} />
              </div>
              <p style={{ fontSize: 10, color: C.faint, margin: "8px 0 0" }}>
                D-Day는 포트폴리오 공개·시험·발표 같은 외부에서 확인 가능한 이벤트만. 앱 내부 목표는 D-Day가 아니다.
              </p>
              {state.deadline?.date && (
                <button onClick={() => { setMajorMode(true); setEvidenceKind("official"); setLevelUpTarget("port"); }} className="gos-disp"
                  style={{
                    width: "100%", marginTop: 10, padding: "11px 0", borderRadius: 6,
                    border: `1px solid ${C.mid}`, background: "rgba(227,184,78,.1)",
                    color: C.mid, fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}>
                  ★ D-DAY 달성 보고 — XP 무관 즉시 승급 (공인 증빙 필수)
                </button>
              )}
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>TRAINING FOCUS</h2>
              <p style={{ fontSize: 11, color: C.faint, margin: "0 0 12px", lineHeight: 1.5 }}>
                영역별 훈련 비중. 편성 확률에 반영된다. <span style={{ color: C.mid }}>집중은 최대 2개</span> — 전부 집중이면 아무것도 집중이 아니다.
              </p>
              {AREAS.map((st) => {
                const w = state.weights[st.id] || 0;
                const focusCount = AREAS.filter((a) => (state.weights[a.id] || 0) === 3).length;
                return (
                  <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
                    <div style={{ width: 84, flexShrink: 0, fontSize: 14 }}>{st.name}</div>
                    <div style={{ display: "flex", gap: 6, flex: 1 }}>
                      {WEIGHT_LABELS.map((label, val) => {
                        const active = w === val;
                        const blocked = val === 3 && !active && focusCount >= 2;
                        return (
                          <button key={val} disabled={blocked}
                            onClick={() => setWeight(st.id, val)} className="gos-disp"
                            style={{
                              flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 700, borderRadius: 5,
                              border: `1px solid ${active ? C.accent : C.line}`,
                              background: active ? "rgba(67,217,163,.12)" : "transparent",
                              color: blocked ? C.faint : active ? C.accent : C.muted,
                              cursor: blocked ? "default" : "pointer",
                            }}>{label}</button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>SKILL NODES · 역량 지도 편집</h2>
              <p style={{ fontSize: 11, color: C.faint, margin: "0 0 10px", lineHeight: 1.5 }}>
                내 점수·기록은 내가 직접 관리한다 (예: 어학 TOEIC 785, 건강 체중/체지방). 승급 시에도 자동 갱신된다.
              </p>
              {AREAS.map((ar) => (
                <div key={ar.id} style={{ marginBottom: 8 }}>
                  <div className="gos-disp" style={{ fontSize: 10, color: C.accent, fontWeight: 700, marginBottom: 4 }}>{ar.name}</div>
                  {(state.subskills?.[ar.id] || []).map((sk) => (
                    <div key={sk.id} style={{ display: "flex", gap: 6, marginBottom: 5 }}>
                      <input className="gos-input" value={sk.name}
                        onChange={(e) => updateSubskill(ar.id, sk.id, "name", e.target.value)}
                        style={{ flex: 2, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5, padding: "7px 9px", color: C.text, fontSize: 12 }} />
                      <input className="gos-input gos-num" value={sk.value}
                        onChange={(e) => updateSubskill(ar.id, sk.id, "value", e.target.value)}
                        style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5, padding: "7px 9px", color: C.accent, fontSize: 12 }} />
                      <button onClick={() => removeSubskill(ar.id, sk.id)} aria-label="삭제"
                        style={{ flexShrink: 0, border: "none", background: "transparent", color: C.faint, fontSize: 13, cursor: "pointer" }}>✕</button>
                    </div>
                  ))}
                  {(state.subskills?.[ar.id] || []).length === 0 && (
                    <div style={{ fontSize: 11, color: C.faint, marginBottom: 5 }}>노드 없음</div>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <select className="gos-input" value={nodeArea} onChange={(e) => setNodeArea(e.target.value)}
                  style={{ flexShrink: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5, padding: "7px", color: C.text, fontSize: 12 }}>
                  {AREAS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input className="gos-input" value={nodeName} onChange={(e) => setNodeName(e.target.value)}
                  placeholder="노드 (예: 체중)"
                  style={{ flex: 2, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5, padding: "7px 9px", color: C.text, fontSize: 12 }} />
                <input className="gos-input" value={nodeValue} onChange={(e) => setNodeValue(e.target.value)}
                  placeholder="값 (예: 74kg)"
                  style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5, padding: "7px 9px", color: C.text, fontSize: 12 }} />
                <button onClick={() => { addSubskill(nodeArea, nodeName, nodeValue); setNodeName(""); setNodeValue(""); }} className="gos-disp"
                  style={{ flexShrink: 0, padding: "0 12px", borderRadius: 5, border: "none", background: C.accent, color: C.bg, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>추가</button>
              </div>
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>QUEST POOL · 훈련 항목</h2>
              {state.habits.map((h) => {
                const st = AREAS.find((s) => s.id === h.stat);
                return (
                  <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                    <span className="gos-disp" style={{ fontSize: 10, color: C.accent, fontWeight: 700, width: 64, flexShrink: 0 }}>{st?.name}</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{h.name}</span>
                    <span className="gos-num" style={{ flexShrink: 0, fontSize: 10, color: habitDiff(h) === 3 ? C.low : habitDiff(h) === 2 ? C.mid : C.faint }}>
                      {DIFF[habitDiff(h)].label}·{habitXp(h)}XP·{habitMin(h)}분
                    </span>
                    <button onClick={() => removeHabit(h.id)} aria-label="삭제"
                      style={{ flexShrink: 0, border: "none", background: "transparent", color: C.faint, fontSize: 14, cursor: "pointer" }}>✕</button>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <select className="gos-input" value={newHabitStat} onChange={(e) => setNewHabitStat(e.target.value)}
                  style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px", color: C.text, fontSize: 12, flexShrink: 0 }}>
                  {AREAS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="gos-input" value={newHabitDiff} onChange={(e) => setNewHabitDiff(Number(e.target.value))}
                  style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px", color: C.text, fontSize: 12, flexShrink: 0 }}>
                  <option value={1}>소 5XP</option>
                  <option value={2}>중 10XP</option>
                  <option value={3}>대 20XP</option>
                </select>
                <input className="gos-input gos-num" type="number" min={5} max={480} value={newHabitMin}
                  onChange={(e) => setNewHabitMin(Math.max(5, Math.min(480, Number(e.target.value) || 30)))}
                  title="목표 시간(분)"
                  style={{ width: 58, flexShrink: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 4px", color: C.text, fontSize: 12, textAlign: "center" }} />
                <input className="gos-input" value={newHabit} onChange={(e) => setNewHabit(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addHabit()}
                  placeholder="새 훈련 항목"
                  style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 10px", color: C.text, fontSize: 13 }} />
                <button onClick={addHabit} className="gos-disp"
                  style={{ flexShrink: 0, padding: "0 14px", borderRadius: 6, border: "none", background: C.accent, color: C.bg, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>추가</button>
              </div>
              <p style={{ fontSize: 10, color: C.faint, margin: "8px 0 0" }}>
                난이도는 XP·모멘텀에, 목표 시간(분)은 영역별 누적 시간에 반영된다. 대(20XP) 하나가 소(5XP) 넷과 같다 — 쉬운 것만 골라도 이득이 없다.
              </p>
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>CONDITION MODE · 컨디션/휴가</h2>
              {(() => {
                const used = restUsedThisQuarter(state.rest);
                const remain = Math.max(0, REST_BUDGET - used);
                const activeToday = state.rest?.[tKey];
                return (
                  <>
                    <p style={{ fontSize: 11, color: C.faint, margin: "0 0 10px", lineHeight: 1.6 }}>
                      야근·질병·공식 휴가를 시스템 안의 정당한 규칙으로 승인한다. 동결 기간엔 모멘텀 획득·감소·스트릭 변동이 모두 멈춘다 (완수하면 획득은 인정).
                      분기 예산 <span className="gos-num" style={{ color: remain > 3 ? C.accent : C.low }}>{remain}/{REST_BUDGET}일</span> 남음 — 예산이 있는 이유: 무한 휴가는 휴가가 아니라 이탈이다.
                    </p>
                    {activeToday ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ flex: 1, fontSize: 13, color: "#6aa8d8" }}>❄ 동결 중 — {activeToday}</span>
                        <button onClick={cancelRest} className="gos-disp"
                          style={{ flexShrink: 0, padding: "9px 14px", borderRadius: 6, border: `1px solid ${C.line}`, background: "transparent", color: C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          오늘부터 해제
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8 }}>
                        <input className="gos-input" value={restReason} onChange={(e) => setRestReason(e.target.value)}
                          placeholder="사유 (야근 주간 / 병가 / 휴가)"
                          style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "9px 10px", color: C.text, fontSize: 13 }} />
                        <input className="gos-input gos-num" type="date" value={restUntil} min={tKey}
                          onChange={(e) => setRestUntil(e.target.value)}
                          style={{ flexShrink: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "9px", color: C.text, fontSize: 12 }} />
                        <button onClick={activateRest} disabled={!restUntil || remain <= 0} className="gos-disp"
                          style={{
                            flexShrink: 0, padding: "0 12px", borderRadius: 6, border: "none",
                            background: restUntil && remain > 0 ? "#6aa8d8" : C.line,
                            color: restUntil && remain > 0 ? C.bg : C.faint, fontSize: 13, fontWeight: 700,
                            cursor: restUntil && remain > 0 ? "pointer" : "default",
                          }}>❄</button>
                      </div>
                    )}
                  </>
                );
              })()}
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>EXPORT</h2>
              <p style={{ fontSize: 11, color: C.faint, margin: "0 0 10px", lineHeight: 1.5 }}>
                스카우트 리포트는 GitHub README나 이력서 첨부용 마크다운으로 변환된다. JSON은 전체 백업용.
              </p>
              <button onClick={exportReport} className="gos-disp"
                style={{ width: "100%", padding: "11px 0", borderRadius: 6, border: "none", background: C.accent, color: C.bg, fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>
                ★ 스카우트 리포트 내보내기 (README.md)
              </button>
              <button onClick={exportWeekly} className="gos-disp"
                style={{ width: "100%", padding: "11px 0", borderRadius: 6, border: `1px solid ${C.mid}`, background: "rgba(227,184,78,.1)", color: C.mid, fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>
                주간 로그 내보내기 (이번 주 TIL·복기)
              </button>
              <button onClick={exportData} className="gos-disp"
                style={{ width: "100%", padding: "10px 0", borderRadius: 6, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>
                데이터 내보내기 (JSON)
              </button>
              <label className="gos-disp" style={{
                display: "block", textAlign: "center", width: "100%", padding: "10px 0", borderRadius: 6,
                border: `1px dashed ${C.line}`, color: C.muted, fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>
                데이터 가져오기 (JSON 복원)
                <input type="file" accept=".json,application/json" style={{ display: "none" }}
                  onChange={(e) => { importData(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <p style={{ fontSize: 10, color: C.faint, margin: "8px 0 0" }}>
                복원은 현재 기록을 백업 시점으로 완전히 덮어쓴다. 가져오기 전에 지금 상태를 먼저 내보내라.
              </p>
            </section>

            <section style={{ background: C.panel, border: `1px solid rgba(224,101,107,.45)`, borderRadius: 8, padding: 16, marginTop: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px", color: C.low }}>DANGER ZONE</h2>
              <p style={{ fontSize: 11, color: C.faint, margin: "0 0 10px", lineHeight: 1.6 }}>
                모든 기록(능력치·증거·TIL·복기·캘린더)을 지우고 온보딩부터 다시 시작한다. <b style={{ color: C.low }}>되돌릴 수 없다.</b><br />
                실행 직전 백업 JSON이 자동으로 다운로드되므로, 실수했다면 그 파일을 가져오기로 복원하라.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="gos-input gos-num" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)}
                  placeholder="RESET 입력"
                  style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "9px 10px", color: C.text, fontSize: 13 }} />
                <button onClick={resetAll} disabled={resetConfirm.trim().toUpperCase() !== "RESET"} className="gos-disp"
                  style={{
                    flexShrink: 0, padding: "0 16px", borderRadius: 6, border: "none",
                    background: resetConfirm.trim().toUpperCase() === "RESET" ? C.low : C.line,
                    color: resetConfirm.trim().toUpperCase() === "RESET" ? "#fff" : C.faint,
                    fontSize: 13, fontWeight: 700,
                    cursor: resetConfirm.trim().toUpperCase() === "RESET" ? "pointer" : "default",
                  }}>전체 초기화</button>
              </div>
            </section>
          </>
        )}

        {/* ---------- LOG ---------- */}
        {tab === "log" && (
          <>
            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>QUARTER SUMMARY · 분기 실행 기록</h2>
              {(() => {
                const now = logicalNow();
                const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
                let active = 0, full = 0, assignedN = 0, doneN = 0;
                const d = new Date(qStart);
                while (d <= now) {
                  const k = fmtDate(d);
                  const a = state.assignments[k] || [];
                  if (a.length) {
                    active++;
                    const dn = a.filter((id) => (state.checks[k] || []).includes(id)).length;
                    assignedN += a.length; doneN += dn;
                    if (dn === a.length) full++;
                  }
                  d.setDate(d.getDate() + 1);
                }
                const qStartKey = fmtDate(qStart);
                const promos = state.evidence.filter((e) => e.date >= qStartKey).length;
                const revs = state.reviews.filter((r) => r.date >= qStartKey).length;
                const cells = [
                  ["훈련일", active, ""],
                  ["전량 완수", full, "일"],
                  ["실행률", assignedN ? Math.round((doneN / assignedN) * 100) : 0, "%"],
                  ["승급", promos, "회"],
                  ["복기", revs, "회"],
                ];
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                    {cells.map(([label, val, unit]) => (
                      <div key={label} style={{ textAlign: "center", background: C.panelHi, borderRadius: 6, padding: "10px 0" }}>
                        <div className="gos-num" style={{ fontSize: 18, fontWeight: 600, color: C.text }}>{val}<span style={{ fontSize: 10, color: C.faint }}>{unit}</span></div>
                        <div style={{ fontSize: 10, color: C.faint, marginTop: 2 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <p style={{ fontSize: 10, color: C.faint, margin: "8px 0 0" }}>
                이 분기의 진짜 성적표는 위 숫자가 아니라 승급 칸의 증거들이다.
              </p>
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 2px" }}>FOCUS HOURS · 주간 몰입 시간</h2>
              <p style={{ fontSize: 11, color: C.faint, margin: "0 0 8px" }}>최근 8주, 영역별 누적(h). 레벨보다 먼저 움직이는 정직한 선행 지표다.</p>
              <div style={{ height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekChart} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <XAxis dataKey="week" tick={{ fill: C.faint, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }} axisLine={{ stroke: C.line }} tickLine={false} />
                    <YAxis tick={{ fill: C.faint, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,.04)" }}
                      contentStyle={{ background: C.panelHi, border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 11 }}
                      labelStyle={{ color: C.muted }}
                      formatter={(v, name) => [`${v}h`, AREAS.find((a) => a.id === name)?.name || name]}
                    />
                    {AREAS.map((a) => (
                      <Bar key={a.id} dataKey={a.id} stackId="w" fill={AREA_COLORS[a.id]} radius={a.id === "body" ? [2, 2, 0, 0] : 0} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                {AREAS.map((a) => (
                  <span key={a.id} style={{ fontSize: 10, color: C.faint, display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: AREA_COLORS[a.id] }} />
                    {a.name} <span className="gos-num" style={{ color: C.muted }}>{(cumMin[a.id] / 60).toFixed(1)}h</span>
                  </span>
                ))}
              </div>
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 2px" }}>SEASON CALENDAR</h2>
              <p style={{ fontSize: 11, color: C.faint, margin: "0 0 12px" }}>날짜를 누르면 그날의 기록을 열람한다. 과거는 수정할 수 없다 — 그래서 지표를 믿을 수 있다.</p>
              <HistoryCalendar
                state={state}
                selected={selectedDay}
                onSelect={setSelectedDay}
                month={calMonth}
                onMonth={(dir) => {
                  setSelectedDay(null);
                  setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() + dir, 1));
                }}
              />
              {(() => {
                const y = calMonth.getFullYear(), m = calMonth.getMonth();
                const dim = new Date(y, m + 1, 0).getDate();
                let full = 0, partial = 0, miss = 0, frozen = 0;
                for (let d = 1; d <= dim; d++) {
                  const k = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                  if (k > todayKey()) break;
                  const r = dayRate(state, k);
                  if (r === null) continue;
                  if (r >= 1) full++;
                  else if (r > 0) partial++;
                  else if (state.rest?.[k]) frozen++;
                  else miss++;
                }
                const total = full + partial + miss + frozen;
                return (
                  <div style={{ marginTop: 12, padding: "10px 12px", background: C.panelHi, borderRadius: 6 }}>
                    <div className="gos-disp" style={{ fontSize: 10, color: C.faint, fontWeight: 700, marginBottom: 6 }}>
                      {m + 1}월 달성 현황{total === 0 && " — 기록 없음"}
                    </div>
                    {total > 0 && (
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <span className="gos-num" style={{ fontSize: 12, color: C.high }}>🔥 전량 완수 {full}일</span>
                        <span className="gos-num" style={{ fontSize: 12, color: C.mid }}>🟡 일부 완수 {partial}일</span>
                        <span className="gos-num" style={{ fontSize: 12, color: C.low }}>🔴 미실행 {miss}일</span>
                        {frozen > 0 && <span className="gos-num" style={{ fontSize: 12, color: "#6aa8d8" }}>❄ 동결 {frozen}일</span>}
                      </div>
                    )}
                  </div>
                );
              })()}
              {selectedDay && <DayDetail state={state} dateKey={selectedDay} />}
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>EVIDENCE LOG · 승급 기록</h2>
              {state.evidence.length === 0 && (
                <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>아직 승급 기록이 없다. XP를 채우고 외부 증거로 첫 레벨업을 만들어라.</p>
              )}
              {state.evidence.map((ev, i) => {
                const st = AREAS.find((s) => s.id === ev.stat);
                return (
                  <div key={i} style={{ borderTop: i ? `1px solid ${C.line}` : "none", padding: "10px 0" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <span className="gos-num" style={{ fontSize: 11, color: C.faint }}>{ev.date}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>{ev.major && "★"}{st?.name}</span>
                      <span className="gos-num" style={{ fontSize: 12, color: C.mid }}>{ev.from} → {ev.to}</span>
                      <span className="gos-disp" style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 8, border: `1px solid ${ev.kind === "official" ? C.high : C.line}`, color: ev.kind === "official" ? C.high : C.faint }}>{ev.kind === "official" ? "공인" : "자체"}</span>
                    </div>
                    <div style={{ fontSize: 13, marginTop: 3, lineHeight: 1.5 }}>
                      {ev.text}
                      {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" style={{ color: C.accent, marginLeft: 6, fontSize: 12 }}>↗ 증거 확인</a>}
                    </div>
                  </div>
                );
              })}
            </section>

            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16 }}>
              <h2 className="gos-disp" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>REVIEW LOG · 복기 기록</h2>
              {state.reviews.length === 0 && <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>복기 기록이 아직 없다.</p>}
              {state.reviews.map((r, i) => (
                <div key={i} style={{ borderTop: i ? `1px solid ${C.line}` : "none", padding: "10px 0" }}>
                  <div className="gos-num" style={{ fontSize: 11, color: C.faint }}>{r.date}</div>
                  <div style={{ fontSize: 13, marginTop: 3 }}><span style={{ color: C.low }}>실책</span> — {r.mistake}</div>
                  <div style={{ fontSize: 13, marginTop: 2 }}><span style={{ color: C.high }}>수정</span> — {r.fix}</div>
                </div>
              ))}
            </section>
          </>
        )}
      </div>

      {/* ---------- Bottom navigation ---------- */}
      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 40,
        background: C.panel, borderTop: `1px solid ${C.line}`,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        <div style={{ maxWidth: 560, margin: "0 auto", display: "flex" }}>
          {[["main", "메인", "◈"], ["today", "훈련", "✓"], ["focus", "설정", "⚙"], ["log", "기록", "▤"]].map(([id, label, icon]) => {
            const active = tab === id;
            const badge = id === "today" && todayAssigned.some((hid) => !todayChecks.includes(hid));
            return (
              <button key={id} onClick={() => setTab(id)} className="gos-disp"
                style={{
                  flex: 1, padding: "10px 0 8px", border: "none", background: "transparent",
                  color: active ? C.accent : C.faint, cursor: "pointer", position: "relative",
                }}>
                <div style={{ fontSize: 16, lineHeight: 1 }}>{icon}</div>
                <div style={{ fontSize: 10, fontWeight: 700, marginTop: 3 }}>{label}</div>
                {badge && <span style={{ position: "absolute", top: 7, left: "50%", marginLeft: 10, width: 6, height: 6, borderRadius: 3, background: C.mid }} />}
                {active && <span style={{ position: "absolute", top: 0, left: "20%", right: "20%", height: 2, background: C.accent }} />}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ---------- Level-up modal ---------- */}
      {levelUpTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(6,10,15,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}
          onClick={closePromotion}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: C.panel, border: `1px solid ${C.mid}`, borderRadius: 10, padding: 20, width: "100%", maxWidth: 420 }}>
            <div className="gos-disp" style={{ fontSize: 12, color: C.mid, fontWeight: 700 }}>
              {majorMode ? "★ MAJOR PROMOTION — D-DAY CLEARED" : "PROMOTION MATCH"}
            </div>
            <h3 style={{ margin: "4px 0 8px", fontSize: 18, fontWeight: 700 }}>
              {majorMode ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select className="gos-input" value={levelUpTarget} onChange={(e) => setLevelUpTarget(e.target.value)}
                    style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "6px 8px", color: C.text, fontSize: 15, fontWeight: 700 }}>
                    {AREAS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <span className="gos-num">{state.levels[levelUpTarget]} → {state.levels[levelUpTarget] + 1}</span>
                </span>
              ) : (
                <>{AREAS.find((s) => s.id === levelUpTarget)?.name} {state.levels[levelUpTarget]} → {state.levels[levelUpTarget] + 1}</>
              )}
            </h3>
            <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, margin: "0 0 10px" }}>
              {majorMode
                ? <>D-Day 「{state.deadline?.name}」 달성을 증명하는 <b style={{ color: C.text }}>공인 증빙</b>을 기록하라. XP와 무관하게 즉시 승급되며, D-Day는 완료 처리된다.</>
                : <>이 레벨업을 증명하는 <b style={{ color: C.text }}>외부 증거</b>를 기록하라. 공개한 결과물, 시험 점수, 발표, 지원·면접, 타인의 평가 등. 기분이나 자기평가는 증거가 아니다.</>}
            </p>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {[["official", "공인 (성적표·자격증·공개 URL·제3자 확인)"], ["self", "자체 (모의고사·블로그·내부 산출물)"]].map(([k, label]) => {
                const on = evidenceKind === k;
                const blocked = majorMode && k === "self";
                return (
                  <button key={k} disabled={blocked} onClick={() => setEvidenceKind(k)} className="gos-disp"
                    style={{
                      flex: 1, padding: "8px 4px", fontSize: 10, fontWeight: 700, borderRadius: 5, lineHeight: 1.4,
                      border: `1px solid ${on ? (k === "official" ? C.high : C.mid) : C.line}`,
                      background: on ? (k === "official" ? "rgba(67,217,163,.1)" : "rgba(227,184,78,.1)") : "transparent",
                      color: blocked ? C.faint : on ? (k === "official" ? C.high : C.mid) : C.muted,
                      cursor: blocked ? "default" : "pointer",
                    }}>{label}</button>
                );
              })}
            </div>
            <textarea className="gos-input" value={evidenceText} onChange={(e) => setEvidenceText(e.target.value)}
              placeholder="예: 포트폴리오 리포지토리 공개 + README 완성 / TOEIC 850 취득 / 사내 개선안 발표"
              rows={3}
              style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 12px", color: C.text, fontSize: 13, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input className="gos-input" value={skillName} onChange={(e) => setSkillName(e.target.value)}
                placeholder="스킬 노드 (예: TOEIC)"
                style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 10px", color: C.text, fontSize: 12 }} />
              <input className="gos-input" value={skillValue} onChange={(e) => setSkillValue(e.target.value)}
                placeholder="갱신값 (예: 850)"
                style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 10px", color: C.text, fontSize: 12 }} />
            </div>
            <input className="gos-input gos-num" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)}
              placeholder="증빙 URL (GitHub / 블로그 / 성적표 링크 — 선택이지만 강력 권장)"
              style={{ width: "100%", marginTop: 8, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 10px", color: C.text, fontSize: 12 }} />
            <p style={{ fontSize: 10, color: C.faint, margin: "6px 0 0" }}>
              스킬 노드를 입력하면 역량 지도에 갱신·추가된다. URL이 붙은 증거는 리포트에서 클릭 가능한 링크가 된다.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={closePromotion} className="gos-disp"
                style={{ flex: 1, padding: "10px 0", borderRadius: 6, border: `1px solid ${C.line}`, background: "transparent", color: C.muted, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>취소</button>
              <button onClick={confirmLevelUp} disabled={evidenceText.trim().length < 8} className="gos-disp"
                style={{
                  flex: 2, padding: "10px 0", borderRadius: 6, border: "none",
                  background: evidenceText.trim().length >= 8 ? C.mid : C.line,
                  color: evidenceText.trim().length >= 8 ? C.bg : C.faint,
                  fontSize: 13, fontWeight: 700, cursor: evidenceText.trim().length >= 8 ? "pointer" : "default",
                }}>{majorMode ? "★ 메이저 승급" : "증거 제출 & 레벨 업"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: C.panelHi, border: `1px solid ${C.accent}`, color: C.text,
          padding: "10px 18px", borderRadius: 8, fontSize: 13, zIndex: 60, whiteSpace: "nowrap",
        }}>{toast}</div>
      )}
    </div>
  );
}