function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("🚚 위탁번역 & 송장 자동화")
    .addItem("송장 텍스트 한방에 매핑하기", "showTrackingModal")
    .addToUi();
}

function showTrackingModal() {
  const html = HtmlService.createHtmlOutputFromFile("trackingModal")
    .setTitle("위탁 송장 스마트 OCR 매핑기")
    .setWidth(600).setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, "위탁 송장 스마트 OCR 매핑기");
}

function processImageOCR(base64Data, mimeType) {
  try {
    const b64Data = base64Data.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
    const blob = Utilities.newBlob(Utilities.base64Decode(b64Data), mimeType, "ocr_temp_img");

    DriveApp.getFiles(); 
    let resource = { title: 'ocr_temp_document', mimeType: 'application/vnd.google-apps.document' };
    let insertedFile;
    
    if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.insert) {
       insertedFile = Drive.Files.insert(resource, blob, {ocr: true, ocrLanguage: 'ko'});
    } else if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.create) {
       resource.name = 'ocr_temp_document';
       insertedFile = Drive.Files.create(resource, blob);
    } else {
       return { success: false, msg: "[서비스 +] 메뉴에서 Drive API를 추가해주세요!" };
    }

    const doc = DocumentApp.openById(insertedFile.id);
    const extractedText = doc.getBody().getText();
    DriveApp.getFileById(insertedFile.id).setTrashed(true);

    if (!extractedText || extractedText.trim() === "") return { success: false, msg: "이미지에 글자가 없습니다." };
    return processTrackingText(extractedText);
  } catch (e) {
    return { success: false, msg: "스캐너 에러: " + e.message };
  }
}

function processTrackingText(rawText) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: false, msg: "시트에 데이터가 없습니다." };

  const trackCol = 0; // A열이 송장번호라고 가정
  let matchCount = 0, updates = [];
  
  let candidates = [];
  // \s(공백) 허용 시 주문자 이름에 섞인 숫자(예: 1984식당)가 송장번호와 병합되어 쓰레기값을 만드는 현상 방지! 숫자, 하이픈, 온점만 허용
  let trackRegex = /\d(?:[-.]*\d)*/g; 
  let lines = rawText.split(/\r?\n/);
  
  for(let l=0; l<lines.length; l++){
      let line = lines[l];
      let tMatch;
      while ((tMatch = trackRegex.exec(line)) !== null) {
          let rawStr = tMatch[0];
          let cleanStr = rawStr.replace(/\D/g, ""); 
          
          // ✅ 휴대전화/일반전화 오인 방지
          let isPhone = /^(01[016789]|0[2-9])\d{7,8}$/.test(cleanStr);
          if (isPhone) continue; 
          
          if (cleanStr.length >= 9 && cleanStr.length <= 16) {
              let context = "";
              // ✅ 영수증 화면 판단기: 이미지에서 흔히 나타나는 송장 페이지 단어들을 감지
              let isReceipt = /받으시는분|배송지정보|주문번호|주문일자|주문상품|배송사|보내는사람|받는사람|주문처리상태|총배송비/.test(rawText.replace(/\s/g, ""));
              
              // ✅ 엑셀 복붙이나 긴 텍스트 리스트(길이 15자 이상이면서 문자/숫자가 섞여있을 때) -> 타이트하게 한 줄만 스캔! 
              // (상하 줄을 섞으면 동명이인이나 엉뚱한 이름이 섞여 남의 송장을 탈취하는 사고를 원천 방지)
              if (line.length >= 15 && (line.includes(",") || line.includes("\t") || line.includes(" "))) {
                  context = line.replace(/[^a-zA-Z0-9가-힣]/g, "");
              } 
              // ✅ 단독 영수증/송장 페이지 화면 (스캐너) -> 멀리 떨어진 전화번호, 주소까지 영수증 전체 정보를 긁어모아 100% 매칭!
              else if (isReceipt) {
                  context = rawText.replace(/[^a-zA-Z0-9가-힣]/g, "");
              } 
              // ✅ OCR 캡처 이미지로 인해 줄바꿈이 무작위로 파편화된 영수증 -> 위아래 2줄씩만 스캔
              else {
                  let startIdx = Math.max(0, l - 2);
                  let endIdx = Math.min(lines.length, l + 3);
                  context = lines.slice(startIdx, endIdx).join(" ").replace(/[^a-zA-Z0-9가-힣]/g, "");
              }
              
              let exactLineStr = line.replace(/[^a-zA-Z0-9가-힣]/g, "");
              candidates.push({ track: cleanStr, context: context, exactLine: exactLineStr });
          }
      }
  }

  let skipCols = {};
  let prodCols = {};
  for (let c = 0; c < data[0].length; c++) {
      let header = String(data[0][c]).replace(/\s/g, "");
      
      // ✅ 품목, 상품명은 제외하지 않고 파싱 대상에 포함! (isProduct 식별위함)
      if (/품목|상품|옵션/i.test(header)) {
          prodCols[c] = true;
      } else if (/상태|수량|박스|금액|단가|코드|jeharu|송하인|업체명|판매처/i.test(header) && !header.includes("수취")) {
          skipCols[c] = true;
      }
  }

  let rowKeywords = [];
  for (let r = 1; r < data.length; r++) { 
    let keywords = [];
    let existingTrack = String(data[r][trackCol]).trim();

    for (let c = 1; c < data[r].length; c++) {
      if (skipCols[c]) continue;

      let header = String(data[0][c]).replace(/\s/g, "");
      let isNameCol = /거래처|이름|상호|수취인|수하인|성함|고객|주문자/i.test(header);
      let isProductCol = prodCols[c] === true;

      let rawVal = String(data[r][c]).trim();
      let squashVal = rawVal.replace(/[^a-zA-Z0-9가-힣]/g, "");
      
      if (squashVal.length < 2) continue;
      
      // ✅ 이름이나 상호에 괄호가 포함된 경우(예: 권경만(홍이네)), 괄호 앞의 본명(권경만)만 별도 키워드로 추가하여 융통성 극대화
      if (rawVal.includes("(")) {
         let core = rawVal.split("(")[0].replace(/[^a-zA-Z0-9가-힣]/g, "");
         if(core.length >= 2) keywords.push({ val: core, isName: isNameCol, isProduct: isProductCol });
      }
      
      let digitsOnly = rawVal.replace(/\D/g, "");
      if (digitsOnly.length >= 8) {
         keywords.push({ val: digitsOnly.slice(-8), isName: false, isProduct: false, isPhone8: true }); 
         if (/번호|연락|휴대|전화|폰|모바일/i.test(header)) {
             keywords.push({ val: digitsOnly.slice(-4), isName: false, isProduct: false, isPhone4: true }); 
         }
      }
      
      let isPureNumber = /^\d+$/.test(squashVal);
      if (!isPureNumber && squashVal.length >= 2 && squashVal.length <= 30) {
          keywords.push({ val: squashVal, isName: isNameCol, isProduct: isProductCol });
      }
    }
    
    if (keywords.length > 0) {
       let used = existingTrack !== "";
       let penalty = used ? existingTrack.split("/").length * 1 : 0;
       rowKeywords.push({ r: r, keywords: keywords, used: used, penalty: penalty, existingTrack: existingTrack });
    }
  }
  // 변수 재선언 방지
  matchCount = 0;
  updates = [];
  // 매 행마다 찾지 않고, '후보 송장'마다 가장 점수가 높은(확실한) 고객을 찾아서 꽂아줍니다!
  for (let c = 0; c < candidates.length; c++) {
      let cand = candidates[c];
      
      let bestRowObj = null;
      let bestScore = 0;
      
      for (let i = 0; i < rowKeywords.length; i++) {
          let rowObj = rowKeywords[i];
          
          let score = 0;
          for (let k = 0; k < rowObj.keywords.length; k++) {
              let kwObj = rowObj.keywords[k];
              let kw = kwObj.val;
              let isPerfectMatch = cand.context.includes(kw);
              let isExactLineMatch = cand.exactLine.includes(kw);
              
              if (isPerfectMatch) {
                  let multiplier = isExactLineMatch ? 50 : 1; 
                  
                  if (kwObj.isPhone8) {
                      score += (1000 * multiplier); 
                  } else if (kwObj.isPhone4) {
                      score += (400 * multiplier);  
                  } else {
                      let lengthScore = Math.pow(kw.length, 3); 
                      if (kwObj.isName) {
                          score += (lengthScore * 10 * multiplier); 
                      } else if (kwObj.isProduct) {
                          // 품목명은 동명이인 타이 브레이커용이므로 보조 점수로 설정!
                          score += (lengthScore * 0.5 * multiplier);
                      } else {
                          score += (lengthScore * multiplier); 
                      }
                  }
              } else if (kwObj.isName && kw.length >= 3) {
                  let maxPartialScore = 0;
                  for (let j = 0; j < kw.length - 1; j++) {
                      let bigram = kw.substring(j, j + 2);
                      if (cand.context.includes(bigram)) {
                          let isExactLineBigram = cand.exactLine.includes(bigram);
                          let partialScore = 80 * (isExactLineBigram ? 50 : 1);
                          maxPartialScore += partialScore;
                      }
                  }
                  if (maxPartialScore > 0) {
                      score += maxPartialScore;
                  }
              }
          }
          
          if (score > 0) {
              // ✨ 핵심 로직: 동명이인(이름과 점수가 완전히 동일한 2줄) 자연 분산!!
              // 이미 배정받은 내역이 있다면 -1점 패널티를 주어, 타이 브레이커 발생 시 아직 비어있는 행(아래쪽 줄)으로 우선 할당되도록 강제 유도!
              let isMapped = updates.some(u => u.r === rowObj.r);
              if (isMapped) {
                  score -= 1;
              }
          }
          
          if (score > bestScore) {
              bestScore = score;
              bestRowObj = rowObj;
          }
      }
      
      // ✅ 4점 이상(우연히 매칭 방지)이어야만 인정!!
      if (bestScore >= 4 && bestRowObj !== null) {
          let currentTrack = bestRowObj.existingTrack;
          // 중복 매핑 시, 업데이트 배열에서 기존 해당 고객의 기록 찾기
          let existingUp = updates.find(u => u.r === bestRowObj.r);
          
          if (existingUp) {
              if (!existingUp.track.includes(cand.track)) { 
                  existingUp.track += " / " + cand.track; // 송장 2개 이상이면 슬래시(/)로 병합 결합!
                  matchCount++;
              }
          } else {
              if (currentTrack !== "" && !currentTrack.includes(cand.track)) {
                  updates.push({ r: bestRowObj.r, track: currentTrack + " / " + cand.track });
              } else {
                  updates.push({ r: bestRowObj.r, track: cand.track });
              }
              matchCount++;
          }
          
          // 패널티 및 누적 로직 (동명이인 처리 강제 유도)
          let finalTrack = existingUp ? existingUp.track : updates[updates.length - 1].track;
          let mappedCount = finalTrack.split("/").length;
          
          let targetRowObj = rowKeywords.find(obj => obj.r === bestRowObj.r);
          if (targetRowObj) {
              targetRowObj.used = true;
              targetRowObj.penalty = mappedCount * 1;
              targetRowObj.existingTrack = finalTrack; // 다음 매칭 시 누적되게 업데이트!
          }
      }
  }
  // 3. 실제 값 업데이트 및 마스터 탭(판매중) 역동기화(Sync-back) 처리
  let activeSheetName = sheet.getName();
  let masterSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("판매중");
  
  // 현재 탭의 전화번호/품목명 열 찾기 (동기화 용도 - Fallback)
  let phoneCol = -1; let prodCol = -1;
  let idCol = -1; // 🕵️ 숨겨진 고유 아이디열(A147 등)을 찾기 위한 탐정 변수
  let vPhoneCols = []; // 업체 탭의 수취인 전화번호 후보들
  
  for (let c = 0; c < data[0].length; c++) {
      let h = String(data[0][c]).replace(/\s/g, "");
      if (/번호|연락|휴대|전화|폰|모바일/.test(h)) {
          if (!(/업체|발송|가맹|주문자|송장/.test(h))) vPhoneCols.push(c);
      }
      if (/품목|상품|제품|옵션/.test(h)) prodCol = c;
      
      // 🕵️ 명탐정 로직: 헤더나 첫 5줄을 훑어서 "A147, B209" 같은 고유번호 패턴이 있는지 냄새 맡기
      let isIdFormat = false;
      for (let checkRow = 1; checkRow < Math.min(6, data.length); checkRow++) {
          let testVal = String(data[checkRow][c]).trim();
          if (/^[A-Za-z]+\d+$/.test(testVal)) {
              isIdFormat = true;
              break;
          }
      }
      if (isIdFormat && !(/송장|수량|운임/.test(h))) { 
          idCol = c; // 유력한 고유번호 열 발견!!
      }
  }
  if (vPhoneCols.length > 0) phoneCol = vPhoneCols[0]; // 수취인 전화번호 우선 채택

  let syncCount = 0;
  let level0SyncCount = 0;
  
  // 현재 탭의 고객명 열 찾기 (로그 기록용)
  let nameCol = -1;
  for (let c = 0; c < data[0].length; c++) {
      let h = String(data[0][c]).replace(/\s/g, "");
      if (/이름|상호|수취인|성함|고객/.test(h)) nameCol = c;
  }
  
  // 🚀 외부 Level 0 마스터 파일 - DB 로그 탭 열기
  let level0LogSheet = null;
  let level0Error = "";
  let existingTrackingNumbers = new Map(); // Set 대신 Map을 써서 몇 번째 줄(Row)인지 기억!
  try {
      let externalSS = SpreadsheetApp.openById('1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs');
      level0LogSheet = externalSS.getSheetByName('대리발송 송장데이타');
      if (level0LogSheet) {
          let logData = level0LogSheet.getDataRange().getValues();
          for(let r = 1; r < logData.length; r++) {
              let t = String(logData[r][6]).replace(/[^0-9]/g, ""); 
              if(t) existingTrackingNumbers.set(t, r + 1); // 1번째 줄은 헤더이므로 r+1 이 실제 행 번호!
          }
      }
  } catch(e) { }

  // 마스터 시트(판매중) 헤더 1회 스캔 (정확한 열 인덱스 파악)
  let mTrackCol = 0, mProdCol = 4, mIdCol = 1, mNameCol = -1, mVendorPhoneCol = -1;
  let mPhoneCols = [];
  let masterData = [];

  // [P1 최적화] 매 update마다 masterData를 전체 선형 스캔하던 것을
  //   ① ID → 행번호 Map(masterIdIndex)
  //   ② 전화 끝8자리 → 행번호[] Map(masterPhoneIndex)
  //   로 사전 구축하여 O(1) / O(k) 매칭으로 전환.
  //   기존: updates × masterData × mPhoneCols 루프 (최악 수십만회)
  //   변경: updates × O(k)  (k는 동일 전화번호 후보 수, 보통 1~2)
  let masterIdIndex = new Map();
  let masterPhoneIndex = new Map();

  if (masterSheet && activeSheetName !== "판매중") {
      masterData = masterSheet.getDataRange().getValues();
      for (let c = 0; c < masterData[0].length; c++) {
          let mh = String(masterData[0][c]).replace(/\s/g, "");
          if (/송장/.test(mh)) mTrackCol = c;
          if (/품목|상품|제품|옵션/.test(mh)) mProdCol = c;
          if (/이름|상호|수취인|성함|고객/.test(mh)) mNameCol = c;
          
          if (/모바일|전화/.test(mh)) {
              // 업체 전화나 주문자 전화 (보통 R열 등 뒤쪽에 위치) 찾기
              if (/업체|주문자/.test(mh) || c > 10) mVendorPhoneCol = c;
              else mPhoneCols.push(c);
          }
      }
      if (mPhoneCols.length === 0) mPhoneCols = [7, 8]; // H, I 기본값

      // 사전 인덱스 구축 (masterData 1회 순회)
      for (let mr = 1; mr < masterData.length; mr++) {
          let midRaw = String(masterData[mr][mIdCol] || "").trim();
          if (midRaw && !masterIdIndex.has(midRaw)) masterIdIndex.set(midRaw, mr);
          for (let pc of mPhoneCols) {
              let mp = String(masterData[mr][pc] || "").replace(/[^0-9]/g, "");
              if (mp.length >= 8) {
                  let last8 = mp.slice(-8);
                  if (!masterPhoneIndex.has(last8)) masterPhoneIndex.set(last8, []);
                  masterPhoneIndex.get(last8).push(mr);
              }
          }
      }
  }

  let startWriteRow = -1;
  
  if (updates.length > 0) {
      let logDataToAppend = [];
      
      // [P1 최적화] 업체 탭 trackCol 쓰기를 루프 중 setValue 반복 → 루프 끝에서 1회 setValues 배치로
      //   마스터 탭 쓰기도 (row, track) 페어를 모아 끝에서 배치 처리 (setBackground 포함)
      let currentSheetTrackWrites = new Map(); // rowIdx(0-based in data) → track
      let masterTrackWrites = new Map(); // masterRow(0-based in masterData) → track

      updates.forEach(up => {
         // 1️⃣ 현재 업체 탭 쓰기는 배치용 맵에 기록
         currentSheetTrackWrites.set(up.r, up.track);
         
         // 2️⃣ 마스터(판매중) 탭 동기화 및 정확한 데이터 추출
         let finalName  = nameCol !== -1 ? String(data[up.r][nameCol]) : "";
         let finalPhone = phoneCol !== -1 ? String(data[up.r][phoneCol]) : "";
         let finalProd  = prodCol !== -1 ? String(data[up.r][prodCol]) : "";
         let finalVendorPhone = ""; 
         let finalMasterVendor = ""; // 👈 판매중 시트의 업체명(Q열) 저장
         
         if (masterSheet && activeSheetName !== "판매중") {
             let matchFound = false;
             let matchedRow = -1;

             if (idCol !== -1) {
                 let targetId = String(data[up.r][idCol]).trim();
                 if (targetId.length > 0) {
                     let hit = masterIdIndex.get(targetId);
                     if (hit !== undefined) {
                         masterTrackWrites.set(hit, up.track);
                         syncCount++; matchFound = true; matchedRow = hit;
                     }
                 }
             }
             
             if (!matchFound && phoneCol !== -1 && prodCol !== -1) {
                 let targetPhone = String(data[up.r][phoneCol]).replace(/[^0-9]/g, "");
                 if (targetPhone.length >= 8) {
                     let targetLast8 = targetPhone.slice(-8); 
                     let candRows = []; let maxScore = -1;

                     // 선행 구축된 phoneIndex로 후보 행만 뽑아 fuzzy 점수 계산
                     let phoneCandidates = masterPhoneIndex.get(targetLast8) || [];
                     // 중복 제거 (같은 row가 여러 phoneCol에서 들어간 경우)
                     let seenCand = new Set();
                     for (let mr of phoneCandidates) {
                         if (seenCand.has(mr)) continue;
                         seenCand.add(mr);
                         let mProdClean = String(masterData[mr][mProdCol]).replace(/[^a-zA-Z가-힣]/g, "");
                         let tProdClean = String(data[up.r][prodCol]).replace(/[^a-zA-Z가-힣]/g, "");
                         let score = 0;
                         if (mProdClean === tProdClean) score += 1000;
                         if (mProdClean.includes(tProdClean) || tProdClean.includes(mProdClean)) score += 500;
                         for(let i = 0; i < tProdClean.length - 1; i++){
                             if(mProdClean.includes(tProdClean.substring(i, i+2))) score++;
                         }
                         if (score > maxScore) { maxScore = score; candRows = [mr]; }
                         else if (score === maxScore && score > 0) candRows.push(mr);
                     }
                     if (maxScore > 0 && candRows.length > 0) {
                         for(let candRow of candRows) {
                             masterTrackWrites.set(candRow, up.track);
                             syncCount++; matchedRow = candRow; // 마지막 candRow 기준
                         }
                     }
                 }
             }
             
             // ✨ 판매중 시트에서 찾았다면, 불완전한 업체 탭 데이터 대신 완벽한 마스터 데이터를 우선 채택!
             if (matchedRow !== -1) {
                 if (mNameCol !== -1) finalName = String(masterData[matchedRow][mNameCol]);
                 if (mProdCol !== -1) finalProd = String(masterData[matchedRow][mProdCol]);
                 if (mVendorPhoneCol !== -1) finalVendorPhone = String(masterData[matchedRow][mVendorPhoneCol]);
                 if (masterData[matchedRow].length > 16) finalMasterVendor = String(masterData[matchedRow][16]); // ✅ Q열(인덱스 16)에서 업체명 가져오기
                 
                 for(let pc of mPhoneCols) {
                     let ph = String(masterData[matchedRow][pc]);
                     if (ph.replace(/[^0-9]/g, "").length >= 8) { finalPhone = ph; break; }
                 }
             }
         }
         
         // 3️⃣ 외부 Level 0 '대리발송 송장데이타' 탭으로 로그 취합
         if (level0LogSheet) {
             let cTrack = up.track;
             let timestamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
             
             let cleanTrack = String(cTrack).replace(/[^0-9]/g, "");
             let existingRow = existingTrackingNumbers.get(cleanTrack);
             let flag = "";
             
             let rowData = [finalName, finalPhone, activeSheetName, finalVendorPhone, "", finalProd, cTrack, finalMasterVendor, flag, timestamp];
             
             if (existingRow && existingRow !== -1) {
                 // 📌 중복 발견 시: 밑에 새로 추가하지 않고 해당 줄을 덮어쓰기!
                 rowData[8] = "📌체크요망 (업데이트)"; // I열(비고)
                 try {
                     if (level0LogSheet) {
                         level0LogSheet.getRange(existingRow, 1, 1, 10).setValues([rowData]);
                         level0LogSheet.getRange(existingRow, 1, 1, 10).setBackground("#FCE8E6"); // 중복은 빨간색!
                         level0SyncCount++;
                     }
                 } catch(e) {}
             } else {
                 // 신규 데이터만 append 목록에 추가
                 logDataToAppend.push(rowData);
                 // 같은 스캔 루프 내에서 중복 방지를 위해 위치를 -1로 임시 지정
                 existingTrackingNumbers.set(cleanTrack, -1);
                 level0SyncCount++;
             }
         }
      });

      // [P1 최적화] 배치 쓰기: 현재 탭 trackCol / 마스터 탭 mTrackCol을 1회 setValues+setBackgrounds로
      //   ※ 기존 배경/값을 보존하기 위해 해당 열의 현재 상태를 먼저 읽은 뒤 인메모리 업데이트하여 써넣는다.
      if (currentSheetTrackWrites.size > 0) {
          let sheetLastRow = sheet.getLastRow();
          let numRows = sheetLastRow - 1;
          if (numRows > 0) {
              let rng = sheet.getRange(2, trackCol + 1, numRows, 1);
              let vals = rng.getValues();
              let bgs = rng.getBackgrounds();
              for (let [r, track] of currentSheetTrackWrites) {
                  let idx = r - 1; // data[r] (0-based with header at 0) → range offset from row 2
                  if (idx >= 0 && idx < vals.length) {
                      vals[idx][0] = track;
                      bgs[idx][0] = "#FFF2CC";
                  }
              }
              rng.setValues(vals);
              rng.setBackgrounds(bgs);
          }
      }
      if (masterSheet && masterTrackWrites.size > 0 && masterData.length > 1) {
          let mNumRows = masterData.length - 1;
          let mRng = masterSheet.getRange(2, mTrackCol + 1, mNumRows, 1);
          let mVals = mRng.getValues();
          let mBgs = mRng.getBackgrounds();
          for (let [mr, track] of masterTrackWrites) {
              let idx = mr - 1; // masterData[mr] → range offset from row 2
              if (idx >= 0 && idx < mVals.length) {
                  mVals[idx][0] = track;
                  mBgs[idx][0] = "#FFF2CC";
              }
          }
          mRng.setValues(mVals);
          mRng.setBackgrounds(mBgs);
      }

      startWriteRow = -1;
      if (level0LogSheet && logDataToAppend.length > 0) {
          try {
              startWriteRow = level0LogSheet.getLastRow() + 1;
              logDataToAppend.forEach(row => {
                  level0LogSheet.appendRow(row);
              });
              
              // 하이라이트 표시
              let endRow = level0LogSheet.getLastRow();
              level0LogSheet.getRange(startWriteRow, 1, logDataToAppend.length, logDataToAppend[0].length).setBackground("#FFF2CC");
          } catch(e) {
              level0Error = "데이터 쓰기 에러: " + e.message;
          }
      }
      SpreadsheetApp.flush();
  }
  
  let msg = `✅ 총 ${matchCount}건의 송장이 (1단계) 업체 탭에 입력되었습니다!<br><br>[디버깅 리포트]`;
  
  if (phoneCol === -1) msg += `<br>⚠️ 업체 탭 수취인 연락처열 누락! "번호|연락|휴대|전화|폰|모바일" 포함한 헤더(단, '업체' 제외) 필요.`;
  else msg += `<br>✔️ 업체 탭 스캔 (폰열:${phoneCol}, 품목열:${prodCol})`;

  if (!masterSheet) {
      msg += `<br>❌ 판매중 시트 못찾음`;
  } else {
      msg += `<br>✔️ 판매중 스캔 (폰열:${mPhoneCols}, 품목열:${mProdCol})`;
  }
  
  if (!level0LogSheet) {
      msg += `<br>❌ Level0 (대리발송 송장데이타) 접근 실패`;
  } else if (level0Error !== "") {
      msg += `<br>❌ Level0 에러: ${level0Error}`;
  }
  
  if (syncCount > 0) { msg += `<br><br>👉 내부 '판매중' 탭 ${syncCount}건 동기화 성공`; }
  else { msg += `<br><br>⚠️ '판매중' 탭 동기화 0건 (고객명/전화번호 불일치 의심)`; }
  
  if (level0SyncCount > 0) { 
      let rowInfo = startWriteRow !== -1 ? ` (입력 시작 줄: ${startWriteRow}행)` : "";
      msg += `<br>🚀 Level0 '송장데이타' DB로 ${level0SyncCount}건 전송 성공${rowInfo}`; 
  }
  
  let hasErrors = (syncCount === 0 || phoneCol === -1 || !masterSheet || !level0LogSheet);
  
  // 성공 여부와 별개로, html에서 자동 종료를 막기 위해 msg 마지막에 플래그 추가 가능(하지만 일단 문자열로 던짐)
  return { success: true, msg: msg, hasErrors: hasErrors };
}
