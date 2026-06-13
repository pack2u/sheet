import re

filepath = r"f:\Pack2U_상품정보sheet\_partnerExclusivePush.gs"

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Find and replace the broken function
old_pattern = r"""   \}\r?\n\r?\n  try \{\r?\n    var url = "https://dapi\.kakao\.com/v2/local/search/address\.json" \+\r?\n              "\?query=" \+ encodeURIComponent\(address\);\r?\n    var response = UrlFetchApp\.fetch\(url, \{\r?\n      headers: \{ "Authorization": "KakaoAK " \+ apiKey \},\r?\n      muteHttpExceptions: true\r?\n    \}\);\r?\n\r?\n    var code = response\.getResponseCode\(\);\r?\n    if \(code !== 200\) \{\r?\n      Logger\.log\("\[PEP\] 카카오 API 응답 오류: HTTP " \+ code\);\r?\n      return "";\r?\n    \}\r?\n\r?\n    var json = JSON\.parse\(response\.getContentText\(\)\);\r?\n    if \(json\.documents && json\.documents\.length > 0\) \{\r?\n      var doc = json\.documents\[0\];\r?\n      // 도로명주소에 zone_no\(우편번호\) 있음\r?\n      if \(doc\.road_address && doc\.road_address\.zone_no\) \{\r?\n        return doc\.road_address\.zone_no;\r?\n      \}\r?\n      // 지번주소 펴백\r?\n      if \(doc\.address && doc\.address\.zip_code\) \{\r?\n        return doc\.address\.zip_code;\r?\n      \}\r?\n    \}\r?\n\r?\n    // 주소 검색 실패 시 키워드 검색 시도\r?\n    var url2 = "https://dapi\.kakao\.com/v2/local/search/keyword\.json" \+\r?\n               "\?query=" \+ encodeURIComponent\(address\);\r?\n    var response2 = UrlFetchApp\.fetch\(url2, \{\r?\n      headers: \{ "Authorization": "KakaoAK " \+ apiKey \},\r?\n      muteHttpExceptions: true\r?\n    \}\);\r?\n    if \(response2\.getResponseCode\(\) === 200\) \{\r?\n      var json2 = JSON\.parse\(response2\.getContentText\(\)\);\r?\n      if \(json2\.documents && json2\.documents\.length > 0\) \{\r?\n        var doc2 = json2\.documents\[0\];\r?\n        if \(doc2\.road_address_name\) \{\r?\n          // 키워드 결과의 도로명주소로 재검색\r?\n          return _pep_getZipCodeFromKakao_\(doc2\.road_address_name\);\r?\n        \}\r?\n      \}\r?\n    \}\r?\n\r?\n    return "";\r?\n  \} catch \(e\) \{\r?\n    Logger\.log\("\[PEP\] 카카오 API 오류: " \+ e\.message\);\r?\n    return "";\r?\n  \}\r?\n\}"""

new_code = """/**
 * 카카오 로컬 API로 주소 → 우편번호(5자리) 변환
 * 특별자치도 등 신규 행정구역명 자동 정규화 포함
 * @param {string} address 주소 문자열
 * @return {string} 우편번호 (없으면 "")
 */
function _pep_getZipCodeFromKakao_(address) {
  if (!address) return "";
  var apiKey = _pep_getKakaoApiKey_();
  if (!apiKey) { Logger.log("[PEP] 카카오 API 키 미설정"); return ""; }

  var ADDR_NORM = [
    [/강원특별자치도/g, "강원도"],
    [/전북특별자치도/g, "전라북도"],
    [/전남특별자치도/g, "전라남도"],
    [/경북특별자치도/g, "경상북도"],
    [/충북특별자치도/g, "충청북도"],
    [/제주특별자치도/g, "제주도"],
    [/세종특별자치시/g, "세종시"]
  ];

  function _tryAddr(q) {
    var u = "https://dapi.kakao.com/v2/local/search/address.json?query=" + encodeURIComponent(q);
    var r = UrlFetchApp.fetch(u, { headers: { "Authorization": "KakaoAK " + apiKey }, muteHttpExceptions: true });
    var c = r.getResponseCode();
    Logger.log("[PEP] 카카오: HTTP " + c + " q=[" + q.substring(0, 30) + "]");
    if (c !== 200) { Logger.log("[PEP] 카카오 body: " + r.getContentText().substring(0, 200)); return null; }
    var j = JSON.parse(r.getContentText());
    if (j.documents && j.documents.length > 0) {
      var d = j.documents[0];
      if (d.road_address && d.road_address.zone_no) return d.road_address.zone_no;
      if (d.address && d.address.zip_code) return d.address.zip_code;
    }
    return null;
  }

  try {
    // 1차: 원본 주소
    var result = _tryAddr(address);
    if (result) return result;

    // 2차: 정규화 (특별자치도 → 구형명)
    var norm = address;
    for (var i = 0; i < ADDR_NORM.length; i++) norm = norm.replace(ADDR_NORM[i][0], ADDR_NORM[i][1]);
    if (norm !== address) {
      Logger.log("[PEP] 주소 정규화 재시도: " + norm.substring(0, 30));
      result = _tryAddr(norm);
      if (result) return result;
    }

    // 3차: 키워드 검색 폴백
    var u2 = "https://dapi.kakao.com/v2/local/search/keyword.json?query=" + encodeURIComponent(address);
    var r2 = UrlFetchApp.fetch(u2, { headers: { "Authorization": "KakaoAK " + apiKey }, muteHttpExceptions: true });
    if (r2.getResponseCode() === 200) {
      var j2 = JSON.parse(r2.getContentText());
      if (j2.documents && j2.documents.length > 0 && j2.documents[0].road_address_name) {
        return _tryAddr(j2.documents[0].road_address_name) || "";
      }
    }
    return "";
  } catch (e) {
    Logger.log("[PEP] 카카오 API 오류: " + e.message);
    return "";
  }
}"""

# Simple string replacement approach - find the broken section
# Look for the orphan "  }\n\n  try {" after _pep_getKakaoApiKey_ function end
broken_start = "} catch (e) { return _DEFAULT_KEY; }\n}\r\n\r\n   }\r\n"
broken_start2 = "} catch (e) { return _DEFAULT_KEY; }\r\n}\r\n\r\n   }\r\n"

# Find the end of _pep_getKakaoApiKey_ and the broken orphan code
idx1 = content.find("} catch (e) { return _DEFAULT_KEY; }")
if idx1 == -1:
    print("ERROR: Cannot find _DEFAULT_KEY marker")
    exit(1)

# Find next function boundary after _DEFAULT_KEY
# The broken code ends at the closing "}" before "/**\n * 우편번호 조회 테스트"
idx_test_func = content.find("/**\r\n * 우편번호 조회 테스트")
if idx_test_func == -1:
    idx_test_func = content.find("/**\n * 우편번호 조회 테스트")
if idx_test_func == -1:
    print("ERROR: Cannot find test function marker")
    exit(1)

# Find the end of _pep_getKakaoApiKey_ function (the "}" + newline after _DEFAULT_KEY)
# Go forward from idx1 to find "}\n" or "}\r\n"  
end_of_key_func = content.find("\n", idx1)
# Then skip the "}" line
next_line = content.find("\n", end_of_key_func + 1)

# Everything between end of _pep_getKakaoApiKey_ and the test function should be replaced
replace_start = next_line + 1  # After the newline
replace_end = idx_test_func

old_section = content[replace_start:replace_end]
print(f"Replacing {len(old_section)} chars from pos {replace_start} to {replace_end}")
print(f"First 100 chars of old: {repr(old_section[:100])}")
print(f"Last 100 chars of old: {repr(old_section[-100:])}")

new_content = content[:replace_start] + "\n" + new_code + "\n\n" + content[replace_end:]

with open(filepath, "w", encoding="utf-8") as f:
    f.write(new_content)

print("SUCCESS: File updated")
