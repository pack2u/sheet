const ROOT_FOLDER_ID = "YOUR_ROOT_FOLDER_ID_HERE"; // 여기에 기본 루트 폴더 ID를 입력하세요. (예: 1A2b3C4d5E6f7G8h9I0j)

/**
 * 특정 상품명 폴더를 찾아 이미지를 저장합니다.
 * @param {string} productName 상품명 (폴더명)
 * @param {string} base64Data 이미지 Base64 데이터
 * @param {string} mimeType 저장할 이미지의 MIME 타입
 * @returns {string} 저장된 파일의 URL
 */
function saveImageToDrive(productName, base64Data, mimeType) {
  if (!productName) {
    throw new Error("상품명이 입력되지 않았습니다.");
  }

  // 1. 루트 폴더 가져오기
  let rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  } catch (e) {
    throw new Error("루트 폴더를 찾을 수 없습니다. ROOT_FOLDER_ID를 확인해주세요.");
  }

  // 2. 상품명(폴더명)과 일치하는 하위 폴더 찾기
  let folderIter = rootFolder.getFoldersByName(productName);
  let targetFolder = null;
  
  if (folderIter.hasNext()) {
    targetFolder = folderIter.next();
  } else {
    throw new Error(`'${productName}' 이름의 하위 폴더가 존재하지 않습니다. 먼저 폴더를 생성해주세요.`);
  }

  // 3. 해당 폴더 안의 AI 이미지 파일 개수 파악하여 넘버링 결정
  let files = targetFolder.getFiles();
  let maxNumber = 0;
  let filePrefix = `${productName}_AI_`;

  while (files.hasNext()) {
    let file = files.next();
    let name = file.getName();
    if (name.startsWith(filePrefix)) {
      // 파일명에서 숫자 추출 (예: 샐러드용기_AI_1.jpg -> 1)
      let numStr = name.substring(filePrefix.length).split('.')[0];
      let num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  let nextNumber = maxNumber + 1;
  
  // 4. Base64 데이터를 Blob으로 변환하여 저장
  let ext = mimeType === 'image/png' ? 'png' : 'jpg';
  let fileName = `${productName}_AI_${nextNumber}.${ext}`;
  
  let cleanBase64 = base64Data;
  if (base64Data.indexOf("base64,") !== -1) {
    cleanBase64 = base64Data.split("base64,")[1];
  }
  
  let blob = Utilities.newBlob(Utilities.base64Decode(cleanBase64), mimeType || 'image/jpeg', fileName);
  let savedFile = targetFolder.createFile(blob);
  
  return savedFile.getUrl();
}
