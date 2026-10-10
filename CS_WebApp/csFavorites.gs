/**
 * 상단 즐겨찾기 바 — 공용 목록
 * 파일: csFavorites.gs
 * ★ 2026-09-01 신규
 *
 * 왜 개인별이 아니라 공용인가.
 *   다섯 사람이 같은 업무를 하니 필요한 링크가 사실상 같다. 개인별로 두면
 *   새로 온 사람은 빈 바를 보고, 무엇을 넣어야 하는지도 모른다. 관리자가
 *   "이거 다들 쓰세요" 하고 밀어줄 방법도 없어진다.
 *   개인 취향의 북마크는 브라우저가 이미 잘 한다. 여기서 또 할 일이 아니다.
 *
 * 목록을 배포 없이 고치려면 스크립트 속성 CS_FAVORITES 에 JSON 배열을 넣는다.
 *   [{"icon":"📦","name":"사방넷","url":"https://..."}, ...]
 * 속성이 있으면 아래 기본 목록은 통째로 무시된다 — 허용계정(CS_ALLOWED_EMAILS)과
 * 같은 규칙이다. csShowFavorites() 로 지금 뭐가 적용 중인지 확인할 수 있다.
 */

var _CS_FAV_PROP_ = "CS_FAVORITES";

/**
 * 기본 목록.
 * 사방넷·이카운트처럼 주소를 확인하지 못한 것은 일부러 비워 뒀다 —
 * 틀린 링크를 넣어 두는 쪽이 더 나쁘다. 스크립트 속성으로 추가하면 된다.
 */
var _CS_FAV_DEFAULT_ = [
  {
    icon: "📊",
    name: "상품정보시트",
    url: "https://docs.google.com/spreadsheets/d/1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE/edit",
  },
  {
    icon: "🔄",
    name: "반품관리대장",
    url: "https://docs.google.com/spreadsheets/d/1aYxijxp_MHTa1ALmJoUM9FmeLRa1jdGepcCccVvepoU/edit",
  },
  {
    icon: "📖",
    name: "CS 매뉴얼 DB",
    url: "https://docs.google.com/spreadsheets/d/1LlNX-spTs-2WgWD8HEha90PYU0m7s8MqFh84vy_Fi_Q/edit",
  },
  {
    /*  롯데 ALPS → 로젠으로 갈았다  (2026-10-08)
        > "현재 롯데 알프스가 들어가있는데 로젠으로 바꿔주고"
        2026-09 에 택배사를 로젠으로 돌렸는데 북마크만 롯데에 남아 있었다.
        롯데 건을 되짚을 일이 생기면 그때 다시 넣는다. */
    icon: "🚚",
    name: "로젠택배",
    url: "https://logis.ilogen.com/common/html/main.html",
  },
  {
    // 계정 목록 시트. 링크만 둔다 — 열람 권한은 시트 공유 설정이 정한다.
    icon: "🔑",
    name: "아이디·패스워드",
    url: "https://docs.google.com/spreadsheets/d/1xziVmMIsQfwyDwleNmB0haRsiE5t24aMu2SHkuI_34U/edit?gid=0#gid=0",
  },
  {
    //  이카운트 — 품목·재고·판매현황이 사는 곳  (2026-10-08)
    icon: "📒",
    name: "이카운트",
    url: "https://login.ecount.com/Login/",
  },
  /*  ══════════════════════════════════════════════════════════
      ★ 쇼핑몰 관리자 ★  (2026-10-08)
      > "쇼필몰관리자 폴더를 만들어서 이미지의 사이트들 넣어줘"

      사장님이 보여 주신 「쇼핑몰 관리자」 시트를 그대로 옮겼다.
      시트의 「사이트 · 구분」 두 칸이 여기 「폴더 · 칩」이 된다 —
      구분이 하나뿐인 곳은 폴더를 안 만들고 칩 하나로 둔다.

      ★ 같은 주소가 여럿인 것은 «일부러» 둔다 ★
        옥션·지마켓은 esmplus 한 곳으로 들어가고, 쿠팡·배민도 법인과 인더샵이
        같은 주소다. 다른 것은 «어느 계정으로 들어가느냐»다. 주소가 같다고
        하나로 합치면 「어느 걸로 들어가야 하지」를 사람이 다시 떠올려야 한다.

      ★ 잘린 주소는 «지어내지 않았다» ★
        시트 화면에서 뒤가 잘려 보인 것은 확실한 데까지만 적었다
        (11번가 · 식봄 · 캐시딜 · 인더샵토스 · 개인 스마트스토어).
        들어가 보시고 다르면 말씀해 주시면 고칩니다 —
        틀린 주소를 적어 두면 모르는 것보다 나쁘다.
      ══════════════════════════════════════════════════════════ */
  {
    icon: "🛒",
    name: "쇼핑몰 관리자",
    children: [
      { icon: "🅽", name: "네이버페이 판매자센터", url: "https://admin.pay.naver.com/front/m/v2" },
      { icon: "📁", name: "스마트스토어", children: [
        { icon: "🏢", name: "법인 팩투유", url: "https://sell.smartstore.naver.com/#/login" },
        { icon: "👤", name: "개인 팩투유", url: "https://sell.smartstore.naver.com/#/login" },
        { icon: "🏷", name: "인더샵", url: "https://sell.smartstore.naver.com/#/login" },
      ]},
      { icon: "📁", name: "배민상회", children: [
        { icon: "🏢", name: "법인 배민", url: "https://seller-mart.baemin.com/goods" },
        { icon: "🏷", name: "인더샵 배민", url: "https://seller-mart.baemin.com/goods" },
      ]},
      { icon: "📁", name: "쿠팡", children: [
        { icon: "🏢", name: "법인 쿠팡", url: "https://wing.coupang.com/" },
        { icon: "🏷", name: "인더샵 쿠팡", url: "https://wing.coupang.com/" },
      ]},
      { icon: "📁", name: "옥션 · 지마켓", children: [
        { icon: "🏢", name: "법인 옥션", url: "https://www.esmplus.com/Home/Home" },
        { icon: "🏢", name: "법인 지마켓", url: "https://www.esmplus.com/Home/Home" },
        { icon: "👤", name: "개인 옥션", url: "https://www.esmplus.com/Home/Home" },
        { icon: "👤", name: "개인 지마켓", url: "https://www.esmplus.com/Home/Home" },
        { icon: "🏷", name: "인더샵 옥션", url: "https://signin.esmplus.com/login" },
        { icon: "🏷", name: "인더샵 지마켓", url: "https://signin.esmplus.com/login" },
      ]},
      { icon: "📁", name: "토스", children: [
        { icon: "🏢", name: "법인토스", url: "https://www.tosspayments.com/" },
        { icon: "🏷", name: "인더샵토스", url: "https://shopping-seller.toss.im/login" },
      ]},
      { icon: "👤", name: "개인 11번가", url: "https://login.11st.co.kr/" },
      { icon: "🥬", name: "식봄", url: "https://seller.foodspring.co.kr/" },
      { icon: "🏢", name: "법인 롯데온", url: "https://support.lotteon.com/" },
      { icon: "🏢", name: "법인 카카오톡스토어", url: "https://store-sell.kakao.com/" },
      { icon: "🏢", name: "법인 도매꾹", url: "https://domeggook.com/sc/" },
      { icon: "🏢", name: "법인 텐바이텐", url: "https://scm.10x10.co.kr/" },
      { icon: "🏢", name: "법인 캐시딜(신)", url: "https://partner.cashdeal.kr/login" },
      { icon: "🏢", name: "법인 오너클랜", url: "https://ownerclan.com/vender/" },
    ],
  },
  {
    // 팩투유 크롬(pack2u@pack2u.co.kr, Profile 10) 북마크바의 「협력업체 시트」 폴더.
    // 하위 폴더는 그대로 폴더칩이 되고, 눌러서 파고든다.
    // 원본이 바뀌면 여기도 손대야 한다 — 자동으로 따라오지 않는다.
    icon: "🤝",
    name: "협력업체 시트",
    children: [
    { icon: "📁", name: "대리공급업체", children: [
      { icon: "📄", name: "그린우드", url: "https://docs.google.com/spreadsheets/d/1iSfdsto3kzDlktndAS1L4NANSkN_kE6skXltuRLO7Kw/edit?gid=1599636577#gid=1599636577" },
      { icon: "📄", name: "뉴파츠", url: "https://docs.google.com/spreadsheets/d/1x_BoC8bGCmWve2un1fgJDSp6cP7VV8m658Pv7JeEdjk/edit?gid=0#gid=0" },
      { icon: "📄", name: "냅킨코리아", url: "https://docs.google.com/spreadsheets/d/13h9zfE5MWQhlZGj70rQukkjBxFOlVapSoAOByjaTpXA/edit?gid=0#gid=0" },
      { icon: "📄", name: "로엔그린", url: "https://docs.google.com/spreadsheets/d/1v0P7bDscjEWhzRA_41zHHdfSucIc-jZZjtzRHXWxvHo/edit?gid=200117025#gid=200117025" },
      { icon: "📄", name: "부원", url: "https://docs.google.com/spreadsheets/d/1lQerNCDuMdm8Y86NL5HX95807zrce_03dwerMlc5hDg/edit?gid=1837475398#gid=1837475398" },
      { icon: "📄", name: "부엉이커피", url: "https://docs.google.com/spreadsheets/d/1jXarv_YVKb8wsYqG67IS4nZdDjb-IKf5ePuw3HSb_G8/edit?gid=1386871999#gid=1386871999" },
      { icon: "📄", name: "아주팩", url: "https://docs.google.com/spreadsheets/d/1dWv2uLJ_zfZtlcoKySHxw_noXvlkY4Y57PZ77BM4ufU/edit?gid=0#gid=0" },
      { icon: "📄", name: "올팩", url: "https://docs.google.com/spreadsheets/d/1TfDyW1EG-m4JrDgsxLcr0D0bGGCNVr6tJ1MfvvGLZD8/edit?gid=0#gid=0" },
      { icon: "📄", name: "와이에스", url: "https://docs.google.com/spreadsheets/d/1x0l22ZJvYeVOQ1ZIntCb-rJIeh0AWZpwz2_waaf3yEg/edit?gid=57272741#gid=57272741" },
      { icon: "📄", name: "인터웍스", url: "https://docs.google.com/spreadsheets/d/1JHXUAvE2L1sC6diZ4ZtKFb4a5TNOhc8n6L5F62J1fds/edit?gid=866134729#gid=866134729" },
      { icon: "📄", name: "제이엠", url: "https://docs.google.com/spreadsheets/d/1YkcOTn2NaQrG3YCZnqGwdXtS8tTm2CRUtVePUPCCGRU/edit?gid=521552543#gid=521552543" },
      { icon: "📄", name: "준테크", url: "https://docs.google.com/spreadsheets/d/1FqwdG8YzV9A7a5JnepNbFAyprf61BS5yOzvazzKsIjo/edit?gid=982280087#gid=982280087" },
      { icon: "📄", name: "코라마", url: "https://docs.google.com/spreadsheets/d/1YrmYRZtOlvdNvwO-LG-IXt_soM5aR6W4PeDhWhByTYg/edit?gid=1480960616#gid=1480960616" },
      { icon: "📄", name: "태양", url: "https://docs.google.com/spreadsheets/d/1cbCIglVhAS6PMwghYMLy8rw3nOwzeAiplrHkHHSznyc/edit?gid=2083529255#gid=2083529255" },
      { icon: "📄", name: "하나팩", url: "https://docs.google.com/spreadsheets/d/16kYxkobbA92EQcpQ5V3ChiMy_M0wlF260iGmTNL8SZs/edit?gid=0#gid=0" },
      { icon: "📄", name: "후아코리아", url: "https://docs.google.com/spreadsheets/d/16iLc02oTXlRH-hyfyZ56TwJycT6eWuWtLt-cIuuKSTo/edit?gid=0#gid=0" },
      { icon: "📄", name: "선우", url: "https://docs.google.com/spreadsheets/d/1pe0OwBI9JpzDWf5wunGC34No8b_0WCODieGZUP7LcIg/edit?gid=1599636577#gid=1599636577" },
    ] },
    { icon: "📁", name: "대리판매업체", children: [
      { icon: "📄", name: "당장드림", url: "https://docs.google.com/spreadsheets/d/15Fk6-arrWa5aiJRbElP-qL9kxJN8sdWCyowvsGihBV8/edit?gid=0#gid=0" },
      { icon: "📄", name: "용기창고", url: "https://docs.google.com/spreadsheets/d/1cqZqatp0DlYBnD0KL8XhBpw7_CG7D6wONoeXAvlzrno/edit?gid=0#gid=0" },
      { icon: "📄", name: "엠케이테크", url: "https://docs.google.com/spreadsheets/d/1cTON96oibm1o9wXKnAhHAupBiS4-ML99_EhCrEXmvw4/edit?gid=0#gid=0" },
      { icon: "📄", name: "쉬움", url: "https://docs.google.com/spreadsheets/d/1zhrxcOygM17Th02IfuFB2yVH3jCdz0QXs29p8FoKz44/edit?gid=306671646#gid=306671646" },
      { icon: "📄", name: "리바이", url: "https://docs.google.com/spreadsheets/d/1jE089U-mxOIdvoMUp7ld1b3TQqfVh6ZHoW5O9Gsi2wA/edit?gid=1439833001#gid=1439833001" },
      { icon: "📄", name: "딸기언니", url: "https://docs.google.com/spreadsheets/d/1NGvgqRHdlfWiKGy5B46F--llJynk-iEnp6qPYs_skzE/edit?gid=0#gid=0" },
      { icon: "📄", name: "밥장인", url: "https://docs.google.com/spreadsheets/d/1oz3ZwG-hnOJ9w84HkEt6jp5NaPcWcSn1bEqcPOnpdPA/edit?gid=0#gid=0" },
      { icon: "📄", name: "보돌미역", url: "https://docs.google.com/spreadsheets/d/1IXkxJSxM_2DKRg1JVUcY15a6F8FE-NHM6faUOUFgKLg/edit?gid=0#gid=0" },
      { icon: "📄", name: "불쓰떡볶이", url: "https://docs.google.com/spreadsheets/d/1-m0zzSljNJp47EqTla0G-8SQASdSULuq1Noo6nMQFn8/edit?gid=897935266#gid=897935266" },
      { icon: "📄", name: "야야할매김치찜", url: "https://docs.google.com/spreadsheets/d/1Vs5XHUKvE8d07Xn5g3laG3999aueWv0AdsrdBRdNpFw/edit?gid=0#gid=0" },
      { icon: "📄", name: "삼호사", url: "https://docs.google.com/spreadsheets/d/1seLencmSdk7712gLyG1Z3E31Trg6iIbRBY89njT6ZWQ/edit?gid=0#gid=0" },
      { icon: "📄", name: "파로홀딩스", url: "https://docs.google.com/spreadsheets/d/104O2T6Ovp3iN3eJh1pn_5msBPMwmFH5xDADumCbuFao/edit?gid=612190657#gid=612190657" },
      { icon: "📄", name: "중앙닭발 8%DC", url: "https://docs.google.com/spreadsheets/d/1nfeWvxmCK9tjgPHzcIgFSo5z-yLtxX2o0Dn-BD5AW50/edit?gid=0#gid=0" },
      { icon: "📄", name: "지니팩", url: "https://docs.google.com/spreadsheets/d/1Y-QXz0QRVGZ8w5KzQ8AVSdW7jNVnwcay6l6p5z4CRUA/edit?gid=1395025131#gid=1395025131" },
      { icon: "📄", name: "하이픈", url: "https://docs.google.com/spreadsheets/d/1xBH92170PbSgryqh39mqZntqKNkyZEFW80PmzLTQnW8/edit?gid=0#gid=0" },
      { icon: "📄", name: "다원", url: "https://docs.google.com/spreadsheets/d/1P31yIXt0esNrZbzAnueLO2SZcsLGnn1vypBHpx1zfCI/edit?gid=39699799#gid=39699799" },
      { icon: "📄", name: "허니네 (소비자용) 5%DC", url: "https://docs.google.com/spreadsheets/d/1ax7WAMyahGET4tivOW74TT0bI6fwiU_2ac8nQi0XjYM/edit?gid=1763514813#gid=1763514813" },
      { icon: "📄", name: "용진종합", url: "https://docs.google.com/spreadsheets/d/11eV9YEjg5ggRtbkd9IpF6-ktw4ILBuLZGlCiFnFkvAs/edit?gid=2065764981#gid=2065764981" },
      { icon: "📄", name: "성우플러스", url: "https://docs.google.com/spreadsheets/d/1Hq4nK-7K_UQwL_79zOA07jyFQu4FXoXimP4fVUrje7Q/edit?gid=2107587544#gid=2107587544" },
    ] },
    { icon: "📁", name: "직매입", children: [
      { icon: "📄", name: "직매입-냅킨코리아", url: "https://docs.google.com/spreadsheets/d/1xBGudTJdmDx4n5c2axNqllZ7DTnz4ZmC0kqGkr1qhxY/edit?gid=0#gid=0" },
      { icon: "📄", name: "직매입-그린우드", url: "https://docs.google.com/spreadsheets/d/1w0yCTEMJYKbdNXy8B60Xwm3Y5wjrOjdvSpbMBiwBQV4/edit?gid=60277540#gid=60277540" },
      { icon: "📄", name: "직매입-성우플러스", url: "https://docs.google.com/spreadsheets/d/1tuv_2xMIpyaUx1yhXuZxocPfdEE3qX7ksBvldCgwPck/edit" },
    ] },
    { icon: "📄", name: "상품정보", url: "https://docs.google.com/spreadsheets/d/1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE/edit?gid=1026076873#gid=1026076873" },
    { icon: "📄", name: "[Pack2U] 통합 관리 HUB (최종 완성본)", url: "https://docs.google.com/spreadsheets/d/1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk/edit?gid=0#gid=0" },
    { icon: "📄", name: "(사용중)세트분리", url: "https://docs.google.com/spreadsheets/d/1vWdJgmbW_Gwm_2b1pP8mVBxpfYBbUiAduSwkStXxs0Y/edit?gid=312828664#gid=312828664" },
    { icon: "📄", name: "거래관리시스템송장", url: "https://docs.google.com/spreadsheets/d/1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs/edit?gid=656421383#gid=656421383" },
    { icon: "📄", name: "팩투유_이카운트입력(사방넷주문)", url: "https://docs.google.com/spreadsheets/d/1Rc-zzNtGKzdFEVW4pIyzy-JogC3Nkvvy7EWm5XcydlU/edit?gid=873417697#gid=873417697" },
    { icon: "🔗", name: "팩투유 CS업무new", url: "https://www.appsheet.com/start/d45af596-e7f7-4474-934a-89f2dfcca507?platform=desktop#appName=%ED%8C%A9%ED%88%AC%EC%9C%A0CS%EC%97%85%EB%AC%B4-494663399&vss=H4sIAAAAAAAAA6VSsU7DMBD9l5tAypCUiiEbpAghREEEdamrym0uKMKxq8SmVFG2Dgx8AAxIoE4wVgz8U8o_YIcCrdqBlNF39969d34ZXEc49CXtX4Hbzn5fxzgCFzICF6MBEnAJeILLRDACFoEmjedFv3h9KZ4ft868bQI55FZ1jtnTeDZ96zZQ0oiVJB3rm0RiCm5WXYf7fysWRAFyGYURJobPoDXPHKvbBmkKCzjtH2IlaY9hKV7jcl2qfoIN9K9w_NXAEnCNAzgXwy8Nnl-za7t2fcd2nLrjOJrjMBFqsD8qw-MJpmJezs0exsXkTvdPk8Bsh720jzyI-GUZkZ_JruZuqrinZ9bO6iT4IpGrC4rp7cf9-wKogUuoBoZUMdmiTJkItTu5-YhQ9FWKQUufdtOTpkf84GZAeXAiAn2dkLIU809OqZjJRwMAAA==&row=CS20260430114111&view=%EC%A0%84%EC%B2%B4_Detail" },
    { icon: "📄", name: "반품관리대장", url: "https://docs.google.com/spreadsheets/d/1aYxijxp_MHTa1ALmJoUM9FmeLRa1jdGepcCccVvepoU/edit?gid=1981858412#gid=1981858412" },
    { icon: "📄", name: "업체별대리발송", url: "https://docs.google.com/spreadsheets/d/1CH-OXyC-u57PCDzU7u7b-qCPMMUMlQK17iDlFx1XgjQ/edit?gid=0#gid=0" },
    { icon: "🔗", name: "Pack2U 협력업체 관리", url: "https://www.siot.com/pack2u/" },
    { icon: "🔗", name: "Pack2U 이카운트 매출 분석", url: "https://www.siot.com/pack2u-sales/" },
    // 원본 북마크의 ALPS 주소에는 로그인 세션 토큰(JWT)이 통째로 박혀 있었다.
    // 그대로 두면 만료된 토큰으로 로그인 오류가 나고, 무엇보다 자격증명을
    // 저장소에 남기는 짓이다. 로그인 화면 주소만 남긴다.
    //  ALPS → 로젠으로 갈았다 (2026-10-08). 위 「로젠택배」와 같은 곳이다 —
    //  크롬 북마크바를 베껴 온 이 폴더에만 롯데가 남아 갈래가 둘이었다.
    { icon: "🚚", name: "로젠택배", url: "https://logis.ilogen.com/common/html/main.html" },
    { icon: "🔗", name: "사방넷", url: "https://www.sabangnet.co.kr/" },
    { icon: "🔗", name: "Pack2U 모바일", url: "https://script.google.com/a/macros/pack2u.co.kr/s/AKfycbxvDzpleqHey7gm0aHILVdALGAuCaymCXlFUfyVKNYt8Je2qhOPbCoKFtgLKMmeXBdpTA/exec" },
    { icon: "📄", name: "Google Sheets", url: "https://docs.google.com/spreadsheets/u/0/?tgif=d" },
  ] },
];

function _cs_fav_str_(v) {
  return String(v == null ? "" : v).trim();
}

/** 링크로 내보내도 되는 주소인가. javascript: 같은 것을 막는다 */
function _cs_fav_okUrl_(u) {
  var s = _cs_fav_str_(u);
  return s.indexOf("https://") === 0 || s.indexOf("http://") === 0;
}

/**
 * 항목 하나를 다듬는다. 쓸 수 없으면 null.
 * children 이 있으면 폴더로 본다 — 바에는 칩 하나로 접히고 눌러야 펼쳐진다.
 * 협력업체 시트처럼 여러 개가 한 묶음일 때 바가 가로로 넘치지 않게 하려는 것이다.
 */
function _cs_fav_clean_(raw, depth) {
  if (!raw) return null;
  depth = depth || 0;

  if (raw.children && raw.children.length) {
    // 폴더 안의 폴더도 받는다 (협력업체 시트가 실제로 두 겹이다).
    // 다만 끝없이 깊어지면 파고들다 길을 잃으므로 세 겹에서 끊는다.
    if (depth >= 3) return null;
    var kids = [];
    for (var i = 0; i < raw.children.length; i++) {
      var k = _cs_fav_clean_(raw.children[i], depth + 1);
      if (k) kids.push(k);
    }
    if (!kids.length) return null;
    return {
      icon: _cs_fav_str_(raw.icon) || "📁",
      name: _cs_fav_str_(raw.name) || "폴더",
      children: kids,
    };
  }

  var url = _cs_fav_str_(raw.url);
  if (!_cs_fav_okUrl_(url)) return null;
  var name = _cs_fav_str_(raw.name) || url;
  var icon = _cs_fav_str_(raw.icon) || "🔗";
  return { icon: icon, name: name, url: url };
}

/** 지금 적용되는 목록 + 그 출처 */
function _cs_fav_list_() {
  var raw = "";
  try {
    raw = _cs_fav_str_(PropertiesService.getScriptProperties().getProperty(_CS_FAV_PROP_));
  } catch (eP) {}

  var src = _CS_FAV_DEFAULT_;
  var from = "코드 기본 목록";

  if (raw) {
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (eJ) {
      parsed = null;
    }
    // JSON 이 깨졌으면 기본 목록으로 돌아간다. 오타 하나로 바가 통째로
    // 사라지면 사람들은 기능이 죽은 줄 안다.
    if (parsed && parsed.length) {
      src = parsed;
      from = "스크립트 속성 " + _CS_FAV_PROP_;
    } else {
      from = "코드 기본 목록 (속성 " + _CS_FAV_PROP_ + " 이 비었거나 JSON 이 깨졌음)";
    }
  }

  var out = _cs_fav_cleanList_(src);
  out = _cs_fav_addAllPartners_(out);

  // JSON 은 멀쩡한데 쓸 수 있는 항목이 하나도 안 남는 경우도 있다(전부 http 아닌
  // 주소 등). 그때도 빈 바보다 기본 목록이 낫다 — 깨진 JSON 과 같은 이유다.
  if (!out.length && src !== _CS_FAV_DEFAULT_) {
    out = _cs_fav_cleanList_(_CS_FAV_DEFAULT_);
    from = "코드 기본 목록 (속성 " + _CS_FAV_PROP_ + " 에 쓸 수 있는 항목이 없음)";
  }
  return { items: out, from: from };
}

/* ══════════════════════════════════════════════════════════════
    ★ 협력업체 시트 «전체» — 손으로 안 베낀다 ★  (2026-10-08)

    > "우리 상단에 북마크에 협력업체 시트 전체를 넣어주면 좋겠어"

    ★ 왜 손으로 베끼면 안 되나 ★
      코드 기본 목록의 「협력업체 시트」는 크롬 북마크바에서 베껴 온 것이고,
      그 자리에 이렇게 적혀 있다 — 「원본이 바뀌면 여기도 손대야 한다.
      자동으로 따라오지 않는다」. 실제로 늦었다. 업체는 늘고 줄고,
      시트 이름도 바뀐다. 사람이 그때마다 옮겨 적는 일은 반드시 빠뜨린다.

    ★ 그래서 드라이브를 본다 ★
      업체 시트는 두 폴더에 「[협력업체] 이름」으로 산다 — 허브(_partnerDeploy.gs
      의 _pt_listFiles)가 보는 바로 그 폴더다. 같은 곳을 보니 허브가 미는 곳과
      사장님이 여는 곳이 어긋나지 않는다. 한 값에 주인은 하나다.

    ★ 손으로 묶은 것은 안 건드린다 ★
      「대리공급업체 · 대리판매업체 · 직매입」 갈래는 사람이 정한 것이라 쓸모가
      있다. 그것을 지우지 않고 «전체» 폴더를 맨 앞에 하나 더 둔다.
      자주 쓰는 길은 그대로 두고, 빠진 곳이 없다는 보장만 더한다.

    ★ 느리면 안 된다 ★ 즐겨찾기는 화면이 뜰 때마다 부른다. 드라이브 훑기는
      느리므로 여섯 시간 담아 둔다. 못 읽으면 «조용히 넘어간다» —
      바가 통째로 사라지는 것보다 전체 폴더가 없는 편이 낫다.
   ══════════════════════════════════════════════════════════════ */
var _CS_FAV_PARTNER_FOLDERS_ = [
  "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl",
  "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v",
];
var _CS_FAV_PARTNER_PREFIX_ = "[협력업체]";
var _CS_FAV_PARTNER_CACHE_ = "CS_FAV_PARTNER_ALL_V1";
var _CS_FAV_PARTNER_TTL_ = 21600;   // 6시간

/** 드라이브에서 업체 시트를 모은다. 못 읽으면 빈 배열 — 터뜨리지 않는다. */
function _cs_fav_partnerSheets_() {
  //  시험은 GAS 바깥에서 돈다 — 드라이브도 캐시도 없다. 그때는 조용히 비운다.
  if (typeof DriveApp === "undefined") return [];

  try {
    var cache = (typeof CacheService !== "undefined")
      ? CacheService.getScriptCache() : null;
    if (cache) {
      var hit = cache.get(_CS_FAV_PARTNER_CACHE_);
      if (hit) {
        var 담긴것 = JSON.parse(hit);
        if (담긴것 && 담긴것.length) return 담긴것;
      }
    }
  } catch (eC) {}

  var 본것 = {}, 모음 = [];
  for (var i = 0; i < _CS_FAV_PARTNER_FOLDERS_.length; i++) {
    try {
      var files = DriveApp.getFolderById(_CS_FAV_PARTNER_FOLDERS_[i]).getFiles();
      while (files.hasNext()) {
        var f = files.next();
        var nm = String(f.getName() || "");
        //  「[협력업체] 」와 「[협력업체]_」 둘 다 쓰인다 (_pt_listFiles 와 같은 규칙)
        if (nm.indexOf(_CS_FAV_PARTNER_PREFIX_) !== 0) continue;
        var id = f.getId();
        if (본것[id]) continue;
        본것[id] = true;
        모음.push({
          icon: "📄",
          name: nm.substring(_CS_FAV_PARTNER_PREFIX_.length).replace(/^[\s_]+/, "") || nm,
          url: "https://docs.google.com/spreadsheets/d/" + id + "/edit",
        });
      }
    } catch (eF) {
      //  한 폴더를 못 읽어도 다른 폴더는 본다. 반쪽이라도 없는 것보다 낫다.
      try { Logger.log("[CS_FAV] 폴더 " + _CS_FAV_PARTNER_FOLDERS_[i] + " 못 읽음: " + eF.message); } catch (_) {}
    }
  }
  모음.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

  try {
    var c2 = (typeof CacheService !== "undefined") ? CacheService.getScriptCache() : null;
    if (c2 && 모음.length) {
      c2.put(_CS_FAV_PARTNER_CACHE_, JSON.stringify(모음), _CS_FAV_PARTNER_TTL_);
    }
  } catch (eP2) {}
  return 모음;
}

/**
 * 「협력업체 시트」 폴더 맨 앞에 «전체» 를 끼운다.
 * 그 폴더가 없으면 맨 뒤에 새로 만든다 — 속성으로 목록을 갈아 끼운 사람도 받는다.
 */
function _cs_fav_addAllPartners_(items) {
  var 전부 = _cs_fav_partnerSheets_();
  if (!전부.length) return items;      // 못 읽었으면 여태 모습 그대로

  var 전체칸 = {
    icon: "🗂",
    name: "전체 (자동 · " + 전부.length + "곳)",
    children: 전부,
  };

  for (var i = 0; i < items.length; i++) {
    if (items[i] && items[i].children && String(items[i].name).indexOf("협력업체") >= 0) {
      //  두 번 눌러도 두 개가 되지 않게 — 옛 「전체」가 있으면 갈아 끼운다
      var kids = [];
      for (var k = 0; k < items[i].children.length; k++) {
        if (String(items[i].children[k].name).indexOf("전체 (자동") !== 0) {
          kids.push(items[i].children[k]);
        }
      }
      kids.unshift(전체칸);
      items[i].children = kids;
      return items;
    }
  }
  items.push({ icon: "🤝", name: "협력업체 시트", children: [전체칸] });
  return items;
}

function _cs_fav_cleanList_(src) {
  var out = [];
  for (var i = 0; i < src.length; i++) {
    var one = _cs_fav_clean_(src[i], 0);
    if (one) out.push(one);
  }
  return out;
}

/**
 * 프런트 진입점.
 * 실패해도 앱이 죽으면 안 된다 — 즐겨찾기는 있으면 좋은 것이지 필수가 아니다.
 * @return {{ok:boolean, items:Array}}
 */
function csGetFavorites() {
  var _acg_ = _cs_ac_guard_();
  if (_acg_) return _acg_;

  try {
    return { ok: true, items: _cs_fav_list_().items };
  } catch (e) {
    return { ok: true, items: [] };
  }
}

/** 지금 무엇이 적용 중인지 편집기에서 확인한다 */
function csShowFavorites() {
  var r = _cs_fav_list_();
  var out = [];
  out.push("═══ CS 웹앱 즐겨찾기 ═══");
  out.push("적용 출처: " + r.from);
  out.push("");
  out.push("적용 중 " + r.items.length + "개:");
  for (var i = 0; i < r.items.length; i++) {
    out.push("  " + r.items[i].icon + " " + r.items[i].name + "  →  " + r.items[i].url);
  }
  out.push("");
  out.push("바꾸려면 스크립트 속성 " + _CS_FAV_PROP_ + " 에 JSON 배열을 넣습니다:");
  out.push('[{"icon":"📦","name":"사방넷","url":"https://..."}]');

  var text = out.join("\n");
  Logger.log(text);
  return text;
}
