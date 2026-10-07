<?php
/**
 * 로젠 중계기 설정 — 견본.
 *
 * ★ 쓰는 법 ★
 *   이 파일을 **relay_config.php** 라는 이름으로 복사해서 값을 채운 뒤,
 *   relay.php 와 **같은 폴더**에 올린다.
 *
 * ★ git 에 올리지 않는다 ★
 *   relay_config.php 는 .gitignore 에 넣어 뒀다. 견본(이 파일)만 올라간다.
 *   CS_WebApp/_secrets.gs 와 같은 규칙이다.
 *
 * ★ 토큰은 «양쪽이 같아야» 한다 ★
 *   여기의 token 과 CS_WebApp/_secrets.gs 의 LOGEN_PROXY_TOKEN 이 같은 값이어야
 *   중계기가 요청을 받아 준다. 한쪽만 바꾸면 401 이 난다.
 */

return [
    /**
     * CS웹앱이 이 중계기를 부를 때 쓰는 열쇠말.
     * 로젠 인증키가 아니다 — 우리끼리 쓰는 값이다.
     * 아무 문자열이나 길게. 만들 땐 예를 들어:
     *   php -r "echo bin2hex(random_bytes(24));"
     */
    'token' => '',

    /**
     * 로젠이 발급한 인증키.
     * 개발계(topenapi)와 운영계(openapi)가 «다른 키» 다.
     *
     * ⚠ 로젠은 개발계에서 화물추적·반품을 지원하지 않는다(2026-09-28 회신).
     *   우리가 쓸 기능은 운영계로만 검증할 수 있다 — Prod 가 실제로 쓰이는 값이다.
     */
    'secretKeyDev'  => '',
    'secretKeyProd' => '',

    /**
     * 로젠 응답을 기다리는 시간(초).
     * GAS 쪽에도 제한이 있으니 너무 길게 잡지 않는다.
     */
    'timeout' => 20,
];
