<?php
/**
 * 사방넷 중계기 설정 — 견본.
 *
 * ★ 쓰는 법 ★
 *   이 파일을 **sabang_config.php** 라는 이름으로 복사해서 값을 채운 뒤,
 *   sabang.php 와 **같은 폴더**에 올린다.
 *
 * ★ git 에 올리지 않는다 ★
 *   sabang_config.php 는 .gitignore 에 넣어 뒀다. 견본(이 파일)만 올라간다.
 *   _logen_relay/relay_config.php · CS_WebApp/_secrets.gs 와 같은 규칙이다.
 *
 * ★ 토큰은 «양쪽이 같아야» 한다 ★
 *   여기의 token 과 허브 _secrets.gs 의 SABANG_PROXY_TOKEN 이 같은 값이어야
 *   중계기가 요청을 받아 준다. 한쪽만 바꾸면 401 이 난다.
 */

return [
    /**
     * GAS 가 이 중계기를 부를 때 쓰는 열쇠말.
     * 사방넷 시크릿이 아니다 — 우리끼리 쓰는 값이다.
     * 아무 문자열이나 길게. 만들 땐 예를 들어:
     *   php -r "echo bin2hex(random_bytes(24));"
     */
    'token' => '',

    /**
     * 사방넷 개발자센터 > 마이페이지 > 연동관리 > 앱 상세.
     *
     * ★ clientCd 는 「앱 코드」다 ★
     *   문서에는 「Base62 20자리」라고 돼 있지만 실제는 UUID 36자다
     *   (2026-10-12 실측 — _docs/사방넷_API3.0_규격.md 0장).
     *   예) c889137c-45e4-45e3-b686-dc9e254b8a8b
     */
    'clientCd'   => '',
    'clientType' => 'SB_APP',   // 자체개발 앱. 제휴 파트너사 솔루션이면 SB_SOLUTION

    /**
     * 「인증 정보」 탭의 Client Secret.
     * 프로덕션과 샌드박스가 «다른 키» 다. 둘 다 bcrypt salt 모양이다 ($2a$10$ + 22자).
     *
     * ⚠ 2026-10-12 프로덕션 시크릿이 대화 기록에 노출됐다.
     *   개발자센터에서 재발급한 값을 넣을 것.
     */
    'secretSandbox'    => '',
    'secretProduction' => '',

    /**
     * 모든 API 호출에 붙는 X-Svc-Acnt-Id 헤더 값.
     * 고객사 서비스코드다. 팩투유는 mw57640 (개발자센터 「고객사 서비스코드」).
     */
    'svcAcntId' => 'mw57640',

    /**
     * ★ 운영계 «쓰기» 잠금 ★
     *
     * false 면 PRODUCTION 으로 오는 POST 를 중계기가 거절한다(조회는 통과).
     * 설치 직후에는 false 로 두고, 샌드박스로 충분히 돌려 본 뒤 사람이 연다.
     *
     * 운송장은 한 번 나가면 쇼핑몰까지 번진다. 「설정 하나 안 켠 것」이
     * 「실수로 운영계에 쏜 것」보다 낫다.
     */
    'allowProdWrite' => false,

    /**
     * 사방넷 응답을 기다리는 시간(초).
     * 사방넷 게이트웨이 타임아웃이 10초이므로 그보다는 넉넉하게,
     * 다만 GAS 쪽 제한이 있으니 너무 길게 잡지 않는다.
     */
    'timeout' => 20,
];
