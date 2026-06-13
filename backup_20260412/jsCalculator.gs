function calculateProductValuesJS(sheet) {
  const lastRow = sheet.getRange(4, 1).getDataRegion().getLastRow();
  if (lastRow < 6) return; // 데이터 없음
  
  const numRows = lastRow - 5; // 6행부터 끝까지
  
  // 전체 데이터 가져오기 (1행~lastRow 범위로 다 가져오면 인덱싱 편함)
  // A=1 -> idx 0
  const fullData = sheet.getRange(1, 1, lastRow, 100).getValues(); 
  
  // 고정 설정값 캐싱 (윗부분 헤더 1~4행)
  // config[colIndex] 형태로 사용할 AT~BC (45~54), BP~BZ
  const config = {};
  for(let c = 45; c <= 77; c++) {
    config[c] = {
      val1: fullData[0][c] ? String(fullData[0][c]).split(",").filter(s=>s.trim()!=="") : [],
      val3: parseFloat(fullData[2][c]) || 0,
      val4: String(fullData[3][c] || "")
    };
  }
  
  const AS3 = parseFloat(fullData[2][44]) || 0; // AS3
  
  // 6행(인덱스 5)부터 반복
  for (let r = 5; r < lastRow; r++) {
    let row = fullData[r];
    
    // 컬럼 인덱스 (1 줄임)
    let A = String(row[0] || "");
    let C = String(row[2] || "");
    
    if (C === "") {
      // 빈칸이면 이 열들도 빈칸 처리
      row[21] = ""; row[22] = ""; row[24] = ""; row[25] = "";
      row[27] = ""; row[28] = ""; row[29] = ""; row[30] = "";
      // ... 계속 비우기
      continue;
    }
    
    let N = parseFloat(row[13]) || 0;
    let O = parseFloat(row[14]) || 0;
    let S = parseFloat(row[18]) || 0;
    let U = parseFloat(row[20]) || 0;
    let X = parseFloat(row[23]) || 0;
    let AA = parseFloat(row[26]) || 0;
    
    // V = U * 1.1
    let V = U * 1.1; row[21] = V;
    // W = V * N
    let W = V * N; row[22] = W;
    
    // Y = X / N
    let Y = N ? X / N : 0; row[24] = Y;
    // Z = 1 - ((W+O+S)/X)
    let Z = X ? 1 - ((W+O+S)/X) : 0; row[25] = Z;
    // AB = AA / N
    let AB = N ? AA / N : 0; row[27] = AB;
    
    // AD = X
    let AD = X; row[29] = AD;
    // AE = AD * 0.07
    let AE = AD * 0.07; row[30] = AE;
    
    // AC = 1 - ((W+O+S+AE)/AA)
    let AC = AA ? 1 - ((W+O+S+AE)/AA) : 0; row[28] = AC;
    
    // AF = 1 - ((W+O+S+AE)/AD)
    let AF = AD ? 1 - ((W+O+S+AE)/AD) : 0; row[31] = AF;
    
    // AG = ROUND((W+O+S)/((1-AF)-0.1), -3) -> 1000단위 반올림
    let AG_denom = (1 - AF) - 0.1;
    let AG = AG_denom ? Math.round(((W+O+S)/AG_denom) / 1000) * 1000 : 0; 
    row[32] = AG;
    
    // AH = AG * 0.1
    let AH = AG * 0.1; row[33] = AH;
    
    // AI = 1 - ((W+O+S+AH)/AG)
    let AI = AG ? 1 - ((W+O+S+AH)/AG) : 0; row[34] = AI;
    
    // AJ = ROUND((W+O+S)/((1-AF)-0.12), -3)
    let AJ_denom = (1 - AF) - 0.12;
    let AJ = AJ_denom ? Math.round(((W+O+S)/AJ_denom) / 1000) * 1000 : 0;
    row[35] = AJ;
    
    // AK = AJ * 0.12
    let AK = AJ * 0.12; row[36] = AK;
    
    // AL = 1 - ((W+O+S+AK)/AJ)
    let AL = AJ ? 1 - ((W+O+S+AK)/AJ) : 0; row[37] = AL;
    
    // AM = ROUND((W+O+S)/((1-AF)-0.17), -2) -> 100단위 반올림
    let AM_denom = (1 - AF) - 0.17;
    let AM = AM_denom ? Math.round(((W+O+S)/AM_denom) / 100) * 100 : 0;
    row[38] = AM;
    
    // AN = AM * 0.17
    let AN = AM * 0.17; row[39] = AN;
    
    // AO = 1 - ((W+O+S+AN)/AM)
    let AO = AM ? 1 - ((W+O+S+AN)/AM) : 0; row[40] = AO;
    
    // AP = ROUND((W+O+S)/((1-AF)-0.25), -3)
    let AP_denom = (1 - AF) - 0.25;
    let AP = AP_denom ? Math.round(((W+O+S)/AP_denom) / 1000) * 1000 : 0;
    row[41] = AP;
    
    // AQ = AP * 0.25
    let AQ = AP * 0.25; row[42] = AQ;
    
    // AR = 1 - ((W+O+S+AQ)/AP)
    let AR = AP ? 1 - ((W+O+S+AQ)/AP) : 0; row[43] = AR;
    
    // BG (57) ~ BN (64) 연산
    let BE = parseFloat(row[56]) || 0;
    let BF = parseFloat(row[57]) || 0;
    
    let BG = AG * 0.04; row[57] = BG;
    let BH = AG - BE - BF - O - S - W; row[58] = BH;
    let BI = AG ? BG / AG : 0; row[59] = BI;
    
    let BJ = AG * 0.88; row[60] = BJ;
    let BK = BI * 0.1; row[61] = BK; // Wait, original says =BI6*0.1? Yes, col 62 is BK (index 61).
    let BL = AG * 0.12; row[62] = BL;
    let BM = AG - BJ - BK - O - S - W; row[63] = BM;
    let BN = AG ? BL / AG : 0; row[64] = BN;
    
    // AS = ROUND((BN+O+S)/(1-AS3), -2) -> 여기서 BN은 col 65 (idx 64) 임.
    let AS_denom = 1 - AS3;
    let AS_val = AS_denom ? Math.round(((BN + O + S) / AS_denom) / 100) * 100 : 0;
    row[44] = AS_val;
    
    let AC_text = A + C;
    
    // AT(45) ~ BC(54) 연산
    for(let c = 45; c <= 54; c++) {
      let cfg = config[c];
      
      // regexmatch
      let matched = false;
      for (let k = 0; k < cfg.val1.length; k++) {
        if (AC_text.includes(cfg.val1[k])) {
          matched = true;
          break;
        }
      }
      
      if (matched) {
        row[c] = "";
      } else {
        let isExcludeShip = cfg.val4.includes("배송비별도");
        let O_val = isExcludeShip ? 0 : O;
        let c_denom = 1 - cfg.val3;
        // ROUND(($BN5:$BN+$S5:$S+O_val)/(1-val3),-2)
        row[c] = c_denom ? Math.round(((BN + S + O_val) / c_denom) / 100) * 100 : 0;
      }
    }
  }
  
  // 연산 결과를 포함하여 6행부터 다시 시트에 밀어넣기
  sheet.getRange(6, 1, numRows, 100).setValues(fullData.slice(5, 5 + numRows));
  SpreadsheetApp.flush();
}
