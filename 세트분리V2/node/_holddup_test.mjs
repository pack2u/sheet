/**
 * ═══════════════════════════════════════════════════════════════
 *  보류 탭에 «같은 줄이 두 번» 있을 때
 *  파일: node/_holddup_test.mjs      돌리기: node node/_holddup_test.mjs
 *
 *  2026-09-17 사장님 화면 :
 *    「세트분리 실행 중 오류 · 단계 : 보류 조치 걷기
 *      Cannot read properties of undefined (reading '3')」
 *
 *  보류 탭에 같은 주문이 두 줄씩 있었다 — 세트가 쪼개져 놓이면 늘 그렇다.
 *  쪼개진 줄들은 원본코드가 같으므로 (고유ID + 원본코드) 열쇠가 겹친다.
 *  겹친 두 번째 줄에서 «아직 시트에 없는» 줄 번호를 읽으러 가 멈췄다.
 *
 *  이 시험은 그 상황을 그대로 만든다. 고치기 전 코드로 돌리면 터진다.
 * ═══════════════════════════════════════════════════════════════
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 뿌리 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const 읽기 = (p) => fs.readFileSync(p, "utf8");

let 실패 = 0;
function eq(이름, 실제, 기대) {
  const a = String(실제), b = String(기대);
  if (a === b) { console.log("  ok   " + 이름); return; }
  실패++;
  console.log("  FAIL " + 이름 + "  기대=" + b + "  실제=" + a);
}

/* ── 시트 흉내 ─────────────────────────────────────────── */
function 가짜시트(rows) {
  const 기록 = [];
  const sh = {
    rows, 기록,
    getLastRow: () => rows.length,
    getLastColumn: () => (rows[0] || []).length,
    getRange(r, c, nr, nc) {
      return {
        getValues: () =>
          rows.slice(r - 1, r - 1 + nr).map((행) => {
            const 잘림 = (행 || []).slice(c - 1, c - 1 + nc);
            while (잘림.length < nc) 잘림.push("");
            return 잘림;
          }),
        setValues(v) {
          기록.push({ r, c, v });
          for (let i = 0; i < v.length; i++) {
            const 행 = rows[r - 1 + i] || (rows[r - 1 + i] = []);
            for (let j = 0; j < v[i].length; j++) 행[c - 1 + j] = v[i][j];
          }
        },
      };
    },
  };
  return sh;
}

const TABS = { 보류: "보류", 원장: "원장", 업체: "업체", 수동조치: "수동조치" };

function 판만들기(보류행들, 수동조치행들) {
  const core = 읽기(path.join(뿌리, "core.js"));
  const masters = 읽기(path.join(뿌리, "gasMasters.js"));

  //  머리글이 필요하므로 먼저 상수만 꺼내 온다
  const 상수 = new Function(core + "\nreturn { SS_HOLD_HEADER, SS_MANUAL_HEADER };")();
  const HH = 상수.SS_HOLD_HEADER, MH = 상수.SS_MANUAL_HEADER;

  const 시트 = {
    보류: 가짜시트([HH.slice()].concat(보류행들)),
    원장: null,
    업체: 가짜시트([["업체코드", "업체명"], ["HP", "하나팩"]]),
    수동조치: 가짜시트([MH.slice()].concat(수동조치행들 || [])),
  };

  const Utilities = {
    formatDate: (d, tz, fmt) =>
      fmt === "yyyy-MM-dd" ? "2026-09-17" : "2026-09-17 09:30:00",
  };
  const SpreadsheetApp = { getActiveSpreadsheet: () => ({ toast() {} }) };

  const 꺼내기 = new Function(
    "Utilities", "SpreadsheetApp", "Logger",
    "ssio_ss", "ssio_sheet", "ssio_body", "SSIO_TABS",
    core + "\n" + masters + "\nreturn { ssm_captureManual: ssm_captureManual };",
  );
  const { ssm_captureManual } = 꺼내기(
    Utilities, SpreadsheetApp, { log() {} },
    () => ({ getSheetByName: (n) => 시트[n] || null }),
    (n) => 시트[n],
    (n) => (시트[n] ? 시트[n].rows.slice(1) : []),
    TABS,
  );

  const idx = {};
  for (let i = 0; i < HH.length; i++) idx[HH[i]] = i;
  const 보류줄 = (uid, 코드, 이름, 조치, 사유, 상세, 원본) => {
    const 행 = new Array(HH.length).fill("");
    행[idx["사방넷주문번호"]] = uid;
    행[idx["품목코드"]] = 코드;
    행[idx["품목명"]] = 이름;
    행[idx["조치"]] = 조치;
    행[idx["보류사유"]] = 사유 || "";
    행[idx["상세"]] = 상세 || "";
    행[idx["원본코드"]] = 원본;
    return 행;
  };

  return { ssm_captureManual, 시트, 보류줄, MH };
}

/* ── [1] 겹친 줄에서 터지지 않는다 ──────────────────────── */
console.log("[1] 세트가 두 줄로 쪼개진 보류 — 터지지 않는가");
{
  const 판 = 판만들기([]);           // 머리글·도우미만 먼저
  const t = 판만들기([
    판.보류줄("2163378867", "A", "몸통", "HP", "품목누락", "코드없음", "SET1"),
    판.보류줄("2163378867", "B", "뚜껑", "HP", "품목누락", "코드없음", "SET1"),
  ]);

  let 터짐 = "";
  let n = -1;
  try { n = t.ssm_captureManual("R1"); }
  catch (e) { 터짐 = String(e && e.message ? e.message : e); }

  eq("★ 멈추지 않는다", 터짐, "");
  eq("★ 한 줄로만 담는다", n, 1);
  const 담긴 = t.시트.수동조치.rows.slice(1);
  eq("수동조치 탭에 한 줄", 담긴.length, 1);
  eq("고유ID", 담긴[0] && 담긴[0][1], "2163378867");
  eq("원본코드가 열쇠다", 담긴[0] && 담긴[0][2], "SET1");
  eq("조치", 담긴[0] && 담긴[0][3], "대리발송");
  eq("업체", 담긴[0] && 담긴[0][4], "HP");
}

/* ── [2] 사람이 적은 것이 짐작을 이긴다 ─────────────────── */
console.log("\n[2] 한 줄은 적은 조치 · 다른 줄은 상세를 지운 짐작");
{
  const 판 = 판만들기([]);
  //  첫 줄에 사람이 HP 라 적었고, 둘째 줄은 상세를 지워 「해소」로 읽힌다
  const t = 판만들기([
    판.보류줄("2163378853", "A", "몸통", "HP", "품목누락", "코드없음", "SET1"),
    판.보류줄("2163378853", "B", "뚜껑", "", "품목누락", "", "SET1"),
  ]);
  t.ssm_captureManual("R1");
  const 담긴 = t.시트.수동조치.rows.slice(1);
  eq("한 줄만 담긴다", 담긴.length, 1);
  eq("★ 사람이 적은 대리발송이 남는다", 담긴[0][3], "대리발송");
  eq("★ 업체도 남는다", 담긴[0][4], "HP");
}

console.log("\n[3] 순서가 반대여도 마찬가지");
{
  const 판 = 판만들기([]);
  const t = 판만들기([
    판.보류줄("2163378853", "A", "몸통", "", "품목누락", "", "SET1"),
    판.보류줄("2163378853", "B", "뚜껑", "HP", "품목누락", "코드없음", "SET1"),
  ]);
  t.ssm_captureManual("R1");
  const 담긴 = t.시트.수동조치.rows.slice(1);
  eq("한 줄만 담긴다", 담긴.length, 1);
  eq("★ 사람이 적은 것이 이긴다", 담긴[0][3], "대리발송");
  eq("업체도 이긴다", 담긴[0][4], "HP");
}

/* ── [4] 이미 수동조치에 있던 줄이어도 안 터진다 ────────── */
console.log("\n[4] 어제 담아 둔 줄이 있는데 보류에 두 줄이 또 올라온 경우");
{
  const 판 = 판만들기([]);
  const 옛줄 = ["2026-09-17", "0917-PH-baab9", "SET1", "발송", "", "",
    "R0", "2026-09-17 08:00:00", "", "", ""];
  const t = 판만들기([
    판.보류줄("0917-PH-baab9", "A", "몸통", "HP", "품목누락", "코드없음", "SET1"),
    판.보류줄("0917-PH-baab9", "B", "뚜껑", "HP", "품목누락", "코드없음", "SET1"),
  ], [옛줄]);

  let 터짐 = "";
  try { t.ssm_captureManual("R1"); }
  catch (e) { 터짐 = String(e && e.message ? e.message : e); }

  eq("★ 멈추지 않는다", 터짐, "");
  const 담긴 = t.시트.수동조치.rows.slice(1);
  eq("★ 줄이 늘지 않는다", 담긴.length, 1);
  eq("★ 새 값으로 고쳐진다", 담긴[0][3], "대리발송");
  eq("업체가 들어갔다", 담긴[0][4], "HP");
  eq("회차도 갱신된다", 담긴[0][6], "R1");
}

/* ── [5] 겹치지 않는 평범한 경우는 그대로 ───────────────── */
console.log("\n[5] 서로 다른 주문 두 건은 두 줄 그대로");
{
  const 판 = 판만들기([]);
  const t = 판만들기([
    판.보류줄("U1", "A", "가", "HP", "품목누락", "코드없음", "O1"),
    판.보류줄("U2", "B", "나", "발송", "품목누락", "코드없음", "O2"),
  ]);
  eq("두 줄이 담긴다", t.ssm_captureManual("R1"), 2);
  const 담긴 = t.시트.수동조치.rows.slice(1);
  eq("첫 줄 대리발송", 담긴[0][3] + "/" + 담긴[0][4], "대리발송/HP");
  eq("둘째 줄 발송", 담긴[1][3] + "/" + 담긴[1][4], "발송/");
}

/* ── [6] 고친 코드는 «없는 줄»을 가리키지 않는다 ─────────── */
console.log("\n[6] 코드 자리가 시트 줄 번호로 새지 않는가");
{
  const masters = 읽기(path.join(뿌리, "gasMasters.js"));
  eq("★ 새 줄은 addAt 으로만 센다",
    masters.indexOf("at[k] = body.length + add.length") < 0, "true");
  eq("addAt 이 있다", masters.indexOf("addAt[k] = add.length") >= 0, "true");
  eq("겹친 줄은 시트를 안 읽는다",
    masters.indexOf("var a0 = add[addAt[k]]") >= 0, "true");
  eq("사람이 적은 것을 기억한다", masters.indexOf("명시한키[k] = true") >= 0, "true");
}

console.log(실패 ? "\n실패 " + 실패 + "건" : "\n겹친 보류 줄도 안전하다");
process.exit(실패 ? 1 : 0);
