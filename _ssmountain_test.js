/**
 * 강원 산간 — 로젠 「산간지역 세부 list(260801)」 55곳
 *
 *  > "1로 해야되"                        (도서산간 탭이 아니라 «일반» 로젠)
 *  > "평균 5000원으로 일괄적용"
 *  > "반품의 경우 비용이 너무 많이들어서 평균비용으로 처리하는거야"
 *
 *  ★ 왜 넣었나 ★
 *    우리 시스템은 이름만 「도서산간」이지 «섬»만 봤다. 산은 안 봤다.
 *    17일치 6,081건을 훑으니 강원 산간이 10건 나갔고 전부 추가운임 0원이었다.
 *    로젠은 우리에게 3,000원을 청구하는데 우리는 손님에게 안 받았다.
 *
 * 실행: node _ssmountain_test.js
 */
const fs = require("fs"), path = require("path");
const core = require(path.join(__dirname, "세트분리V2", "core.js"));

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

/** gasMasters.js 에 박아 둔 산간 표를 그대로 꺼내 온다 (GAS 파일이라 require 가 안 된다) */
function 산간표() {
  const s = fs.readFileSync(path.join(__dirname, "세트분리V2", "gasMasters.js"), "utf8");
  const 시작 = s.indexOf("var SS_SEED_산간 = [");
  const 끝 = s.indexOf("];", 시작);
  if (시작 < 0 || 끝 < 0) throw new Error("SS_SEED_산간 을 못 찾았습니다");
  return eval(s.slice(시작 + "var SS_SEED_산간 = ".length, 끝 + 1));
}
const 씨 = 산간표();

/** 시트에서 읽은 것과 같은 모양으로 바꾼다 (ssm_ferryRows 가 하는 일) */
const ferry = 씨.map((r) => ({
  시도: r[0], 시군: r[1], 읍면동: r[2],
  리: r[3] ? String(r[3]).split("|") : [],
  료: r[4], 권역: r[5],
}));

console.log("\n① 표가 제대로 들어 있다");
{
  ok("55곳이다", 씨.length === 55, String(씨.length));
  ok("전부 강원이다", 씨.every((r) => r[0] === "강원"));
  ok("전부 권역이 「산간」이다", 씨.every((r) => r[5] === "산간"));
  ok("금액은 로젠 실제값 3,000 으로 적어 둔다 (통일을 끄면 진짜 값이 나오게)",
    씨.every((r) => r[4] === 3000));
  ok("★ 원본 오타 「영원군」을 영월군으로 바로잡았다",
    !씨.some((r) => r[1] === "영원군") && 씨.some((r) => r[1] === "영월군" && r[2] === "남면"));
  ok("★ 「국토중앙면」을 정식 이름 국토정중앙면으로 바로잡았다",
    씨.some((r) => r[2] === "국토정중앙면"), JSON.stringify(씨.filter((r) => /국토/.test(r[2]))));
}

console.log("\n② ★ 17일치에서 실제로 샜던 10건이 잡힌다 ★");
{
  //  주문라인원장에서 그대로 가져온 주소다 (260912-1 ~ 260928-1)
  const 샌것 = [
    "강원특별자치도 화천군 사내면 사창리 427-4 청기와, 호식이두마리치킨",
    "강원특별자치도인제군서화면서화길4-11",
    "강원특별자치도 평창군 대관령면 솔봉로 325 (대관령면, 알펜시아리조트)",
    "강원도 홍천군 서석면 구룡령로 2546 (서석면) 빵굽는동네",
    "강원특별자치도 정선군 남면 자미원길 378-17 1층",
    "강원도 평창군 용평면 금당계곡로 2010-13",
    "강원특별자치도 고성군 현내면 초도항길 135 (현내면) 해미소 카페",
  ];
  샌것.forEach((a) => {
    const m = core.ssFerryMatch(core.ssNormAddr ? core.ssNormAddr(a) : a, ferry);
    ok(a.slice(0, 30) + "…", !!m && m.권역 === "산간", JSON.stringify(m));
  });
}

console.log("\n③ 금액은 평균 5,000원 (통일이 씌운다)");
{
  const a = "강원특별자치도 정선군 남면 자미원길 378-17 1층";
  const 통일 = core.ssSurcharge(a, "", ferry, { 통일도선료: 5000 });
  ok("5,000원이 붙는다", 통일.합계 === 5000, JSON.stringify(통일));
  ok("  항공료는 안 붙는다 (제주가 아니다)", 통일.항공료 === 0);
  const 맨값 = core.ssSurcharge(a, "", ferry, {});
  ok("통일을 끄면 로젠 실제값 3,000원이 나온다", 맨값.합계 === 3000, JSON.stringify(맨값));
}

console.log("\n④ 산간이 아닌 곳은 안 걸린다");
{
  const 아닌것 = [
    "강원특별자치도 춘천시 중앙로 1",
    "강원특별자치도 원주시 시청로 1",
    "경기도 파주시 소라지로 138-53",
    "강원특별자치도 강릉시 하슬라로206번길 11-13",
  ];
  아닌것.forEach((a) => ok("안 걸린다 — " + a.slice(0, 24),
    core.ssFerryMatch(a, ferry) === null, JSON.stringify(core.ssFerryMatch(a, ferry))));
}

console.log("\n⑤ 리까지 짚은 곳은 그 리만 걸린다");
{
  //  인제군 북면은 용대리·월학리·한계리만 산간이다
  const 북면 = ferry.filter((f) => f.시군 === "인제군" && f.읍면동 === "북면");
  ok("인제군 북면이 리별로 셋이다", 북면.length === 3, JSON.stringify(북면.map((f) => f.리)));
  ok("  용대리는 걸린다",
    !!core.ssFerryMatch("강원특별자치도 인제군 북면 용대리 123", ferry));
  ok("★ 리가 안 적힌 북면 주소는 안 걸린다 (아무 북면이나 붙으면 안 된다)",
    core.ssFerryMatch("강원특별자치도 인제군 북면 금강로 751", ferry) === null,
    JSON.stringify(core.ssFerryMatch("강원특별자치도 인제군 북면 금강로 751", ferry)));
  //  홍천군 남면은 남노일리만
  ok("홍천군 남면 남노일리는 걸린다",
    !!core.ssFerryMatch("강원특별자치도 홍천군 남면 남노일리 5", ferry));
}

console.log("\n⑤-2 ★ 도로명만 있는 주소는 «우편번호»가 푼다 ★");
{
  /*  로젠은 「인제군 북면 용대리·월학리·한계리」만 산간으로 친다.
      그런데 도로명 주소에는 리가 안 찍힌다 —
        "강원도 인제군 북면 금강로 751"  →  어느 리인지 알 수 없다
      실제로 그 주문은 주소로는 안 잡힌다. 우편번호 24609 가 월학리 구간이다. */
  ok("★ 주소만으로는 못 잡는다 (리를 모르니 안 붙이는 것이 맞다)",
    core.ssFerryMatch("강원도 인제군 북면 금강로 751 (북면) 행운식당", ferry) === null);

  const mst = fs.readFileSync(path.join(__dirname, "세트분리V2", "gasMasters.js"), "utf8");
  const 시작 = mst.indexOf("var SS_SEED_산간우편 = [");
  const 끝 = mst.indexOf("];", 시작);
  const 우편 = eval(mst.slice(시작 + "var SS_SEED_산간우편 = ".length, 끝 + 1));
  ok("산간 우편번호를 " + 우편.length + "개 심는다", 우편.length > 200, String(우편.length));
  ok("★ 그 주문의 24609 가 들어 있다", 우편.indexOf("24609") >= 0);

  //  실제로 새던 8건의 우편번호가 모두 들어 있어야 한다 — 옮겨 적기가 맞았는지 보는 검문
  const 샌번호 = ["24609", "24154", "24600", "25351", "25166", "26145", "25316", "24706"];
  샌번호.forEach((z) => ok("  " + z, 우편.indexOf(z) >= 0));

  ok("  번호는 다섯 자리 문자열이다 (앞 0 이 날아가면 안 맞는다)",
    우편.every((z) => /^[0-9]{5}$/.test(z)));
  ok("  춘천·원주 같은 시내 번호는 안 들어 있다",
    우편.indexOf("24200") < 0 &&우편.indexOf("26400") < 0);
}

console.log("\n⑤-3 ★ 추가운임은 «합계»가 평균 5,000원 하나다 ★  (2026-09-28)");
{
  /*  > "평균 5000원으로 일괄적용"   > "제주도 포함 5000원"
      > "반품의 경우 비용이 너무 많이들어서 평균비용으로 처리하는거야"

      여태 통일은 «도선료»에만 걸려 두 군데가 어긋났다 —
        · 제주 본섬은 항공료 3,000 만 붙고 통일이 아예 안 걸렸다
        · 우도·추자는 항공료 3,000 + 도선료 5,000 = 8,000 이 됐다  */
  const 표 = [
    { 시도: "제주", 시군: "제주", 읍면동: "우도면", 리: [], 료: 4000, 권역: "제주" },
    { 시도: "전남", 시군: "신안군", 읍면동: "흑산면", 리: [], 료: 8000, 권역: "도서" },
  ].concat(ferry);

  const 오천 = (a, z) => core.ssSurcharge(a, z, 표, { 통일도선료: 5000 });
  const 곳 = [
    ["제주 본섬", "제주특별자치도 제주시 연북로 12", "제주"],
    ["제주 우도", "제주특별자치도 제주시 우도면 연평리 1", "제주"],
    ["신안 흑산", "전라남도 신안군 흑산면 진리 1", "도서"],
    ["강원 산간", "강원특별자치도 정선군 남면 자미원길 378-17", ""],
  ];
  곳.forEach(([이름, a, z]) => {
    const r = 오천(a, z);
    ok(이름 + " → 5,000원", r.합계 === 5000, JSON.stringify(r));
  });
  ok("★ 항공료를 따로 안 세운다 (나눠 적어도 실제 청구액과 다른 숫자다)",
    오천("제주특별자치도 제주시 우도면 연평리 1", "제주").항공료 === 0);
  ok("  근거에 「평균 통일」이라고 적는다",
    /평균 통일/.test(오천("제주특별자치도 제주시 연북로 12", "제주").근거));

  ok("★ 육지는 0원 그대로 (통일값을 아무 데나 붙이면 안 된다)",
    오천("경기도 파주시 소라지로 138-53", "").합계 === 0);

  //  통일을 끄면 표값이 그대로 나온다 — 로젠 표가 오는 날 설정만 비우면 된다
  const 맨 = (a, z) => core.ssSurcharge(a, z, 표, {});
  ok("통일을 끄면 제주 본섬은 항공료 3,000", 맨("제주특별자치도 제주시 연북로 12", "제주").합계 === 3000);
  ok("  흑산은 표값 8,000", 맨("전라남도 신안군 흑산면 진리 1", "도서").합계 === 8000);
  ok("  강원 산간은 로젠 실제값 3,000",
    맨("강원특별자치도 정선군 남면 자미원길 378-17", "").합계 === 3000);
}

console.log("\n⑥ 배선 — 소스에서 직접 확인");
{
  const src = fs.readFileSync(path.join(__dirname, "세트분리V2", "core.js"), "utf8");
  const mst = fs.readFileSync(path.join(__dirname, "세트분리V2", "gasMasters.js"), "utf8");
  ok("★ 산간은 «일반» 로젠으로 보낸다 (도서산간 탭이 아니다)",
    /if \(ssText\(fh\.권역\) === '산간'\) \{[\s\S]{0,120}u\.route = SS_ROUTE\.LOTTE;/.test(src));
  ok("  판정을 알아볼 수 있게 적는다", /도서판정 = '산간\(도선료표\)'/.test(src));
  ok("★ 도서 갈래보다 «먼저» 갈린다 (안 그러면 도서산간 탭으로 샌다)",
    src.indexOf("=== '산간') {") < src.indexOf("if (면제) { ssIslandSkipByManual_"));
  ok("표가 없으면 한 번만 심는다", /function ssm_산간심기_\(\)/.test(mst));
  ok("  도선료 표를 읽을 때 심는다", /function ssm_ferryRows\(\) \{[\s\S]{0,40}ssm_산간심기_\(\);/.test(mst));
  ok("  이미 있으면 안 심는다 (사장님이 고치신 값이 이긴다)", /if \(있다\[r\[0\]/.test(mst));
  ok("  못 심어도 실행은 계속한다", /\[산간 심기\] 실패/.test(mst));
  ok("★ 우편번호로 잡힌 산간도 일반 로젠이다",
    /islandZip\[zip\]\) === '산간'\) \{[\s\S]{0,200}u\.route = SS_ROUTE\.LOTTE;/.test(src));
  ok("  우편번호 산간을 심는다", /function ssm_산간우편심기_\(\)/.test(mst) &&
    /'산간'\]\);/.test(mst));
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
