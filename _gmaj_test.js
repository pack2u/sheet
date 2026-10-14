/**
 * 아주팩 Gmail 송장 매칭 검증 (로컬)
 * 실행: node _gmaj_test.js <아주팩 시트를 텍스트로 내보낸 파일>
 *
 * 마감탭의 실제 발송 기록(송장·받는분·전화·품목·박스수량)을 정답으로 삼아,
 * 하루치씩 「송장 엑셀」을 흉내 내고 빈 A열에 다시 맞춰 넣어 본다.
 *
 *   박스가 여러 개인 주문은 마감탭 A열 한 칸에 송장이 줄바꿈으로 여러 개 있다.
 *   송장 엑셀은 박스마다 한 줄씩 온다고 보고(가장 흔한 택배사 양식) 흉내 낸다.
 *
 *   ① 엑셀에 이름·품목·수량(박스당 1)만 있을 때
 *   ② 엑셀에 전화번호까지 있을 때
 *   ③ 엑셀 수량 칸에 주문 박스수량이 그대로 적혀 올 때
 *   ④ 엑셀 줄 순서가 뒤섞였을 때
 * 틀리게 넣은 것(오입력)은 0 이어야 한다. 못 넣은 것(미매칭)은 사람에게 간다.
 */
const fs = require("fs");
const vm = require("vm");

const exportPath = process.argv[2];
if (!exportPath) { console.error("사용법: node _gmaj_test.js <export.txt>"); process.exit(1); }

const ctx = { console, Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("_partnerGmailInvoiceAJ.gs", "utf8"), ctx);

// ── CSV — 따옴표 칸 안의 줄바꿈까지 ──
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// 탭별로 자르기
const raw = fs.readFileSync(exportPath, "utf8");
const parts = raw.split(/^## Sheet name: (.*)$/m); // [앞, 이름, 본문, 이름, 본문 …]
const recs = [];
for (let i = 1; i < parts.length; i += 2) {
  if (!/전용발주 마감/.test(parts[i])) continue;
  parseCsv(parts[i + 1].replace(/^\s*\n/, "")).forEach(c => {
    if (c[0] === "이동일시") return;
    const trks = ctx._gma_trackingsIn_(c[1]);
    if (!trks.length || !c[6]) return;
    recs.push({ day: (c[0] || "").slice(0, 10), trks, name: c[6], phone: c[7], item: c[9], qty: c[10] });
  });
}

const byDay = {};
recs.forEach(r => (byDay[r.day] = byDay[r.day] || []).push(r));
const days = Object.keys(byDay).filter(Boolean).sort();

function shuffle(a, seed) {
  a = a.slice(); let s = seed;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor(s / 233280 * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function runScenario(label, o) {
  let total = 0, right = 0, wrong = 0, miss = 0;
  const wrongs = [];
  days.forEach((d, di) => {
    const rows = byDay[d];
    // 같은 사람·같은 품목 줄끼리는 어느 쪽에 들어가도 같은 고객에게 같은 물건이 간다.
    // 엑셀 수량이 주문 박스수량으로 올 때(③)만 수량까지 맞아야 정답으로 친다.
    const sig = r => ctx._gma_normName_(r.name) + "|" + ctx._gma_normItem_(r.item) + (o.orderQty ? "|" + r.qty : "");
    // 한 박스에 두 품목(몸통+뚜껑)이면 송장 하나가 두 줄에 있다 — 어느 줄이든 정답
    const truthSig = {};
    rows.forEach(r => r.trks.forEach(t => (truthSig[t] = truthSig[t] || new Set()).add(sig(r))));

    // 송장 엑셀 흉내 — 박스마다 한 줄
    const hdr = o.phone ? ["운송장번호", "받는분", "받는분전화", "품목명", "수량"] : ["운송장번호", "받는분", "품목명", "수량"];
    let body = []; const seen = {};
    rows.forEach(r => r.trks.forEach(t => {
      if (seen[t]) return; seen[t] = 1; // 엑셀에는 송장이 한 번만 온다
      const q = o.orderQty ? r.qty : 1;
      body.push(o.phone ? [t, r.name, r.phone, r.item, q] : [t, r.name, r.item, q]);
    }));
    if (o.shuffle) body = shuffle(body, di + 7);
    const parsed = ctx._gma_parseInvoiceRows_([hdr].concat(body));

    const cands = rows.map((r, i) => ctx._gma_makeCand_(i, { 5: r.name, 6: r.phone, 8: r.item, 9: r.qty }, { name: 5, phone: 6, item: 8, qty: 9 }));

    parsed.entries.forEach(e => {
      total++;
      const p = ctx._gma_pickRow_(e, cands);
      if (!p.row) { miss++; return; }
      ctx._gma_assign_(p.row, e.tracking);
      if (truthSig[e.tracking].has(sig(rows[p.row.idx]))) right++;
      else { wrong++; wrongs.push(d + " " + e.rawName + "/" + e.rawItem + " → " + rows[p.row.idx].name + "/" + rows[p.row.idx].item); }
    });
  });
  console.log(`${label}: 송장 ${total} · 정확 ${right} · 오입력 ${wrong} · 미매칭 ${miss}`);
  wrongs.slice(0, 10).forEach(w => console.log("   ✗ " + w));
  return wrong;
}

const multi = recs.filter(r => r.trks.length > 1).length;
console.log(`마감 기록 ${recs.length}줄 (송장 여러 개인 줄 ${multi}) · ${days.length}일치`);
let bad = 0;
bad += runScenario("① 이름·품목·수량", {});
bad += runScenario("② + 전화번호", { phone: true });
bad += runScenario("③ 수량 칸=주문 박스수량", { orderQty: true });
bad += runScenario("④ 순서 섞임", { shuffle: true });

// 머리글 해석: 보내는분 성명이 받는분보다 앞에 있어도 받는분을 잡아야 한다
const tricky = ctx._gma_parseInvoiceRows_([
  ["보내는분성명", "운송장번호", "받는분성명", "받는분전화번호", "품목명", "박스수량"],
  ["팩투유", "463430548232", "홍길동", "010-1111-2222", "AJ도시락/5칸/흑(셋트)", "1"],
]);
const e0 = tricky.entries[0];
const hdrOk = e0 && e0.rawName === "홍길동" && e0.tracking === "463430548232" && e0.qty === 1;
console.log("머리글 해석(보내는분 회피): " + (hdrOk ? "OK" : "FAIL " + tricky.headerDesc));
if (!hdrOk) bad++;

// 받는분 주소·전화가 이름보다 앞에 있고, 박스타입이 수량보다 앞에 있어도
const tricky2 = ctx._gma_parseInvoiceRows_([
  ["받는분주소", "받는분전화", "운송장번호", "박스타입", "받는분", "품목", "박스수량"],
  ["서울", "010-1111-2222", "463430548232", "소", "홍길동", "탕용기캡", "2"],
]);
const e1 = tricky2.entries[0];
const hdr2Ok = e1 && e1.rawName === "홍길동" && e1.qty === 2 && e1.phone === "11112222";
console.log("머리글 해석(주소·박스타입 회피): " + (hdr2Ok ? "OK" : "FAIL " + tricky2.headerDesc));
if (!hdr2Ok) bad++;

// 칸 안 여러 송장
const multiOk = ctx._gma_trackingsIn_("463471817115\n463471817126").length === 2;
console.log("한 칸 여러 송장 인식: " + (multiOk ? "OK" : "FAIL"));
if (!multiOk) bad++;

process.exit(bad ? 1 : 0);
