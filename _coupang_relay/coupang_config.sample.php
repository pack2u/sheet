<?php
/**
 *  쿠팡 중계기 설정 — 본            (2026-10-25)
 *
 *  ★ 이 파일을 coupang_config.php 로 복사해 값을 채우고, 그것만 올립니다 ★
 *    sample 은 git 에 올라가고 coupang_config.php 는 안 올라갑니다(.gitignore).
 *
 *  ★ 쿠팡 비밀키(secretKey)는 여기 «안» 둡니다 ★
 *    서명은 v2 가 만듭니다. 공용 호스팅에 비밀키를 두지 않으려고 그렇게 짰습니다.
 *    이 파일에 있는 것은 중계기 열쇠 하나뿐입니다.
 */
return [
    /*  v2 와 맞춰 둘 열쇠. 길고 아무 뜻 없는 글자로.
        Vercel 환경변수 COUPANG_PROXY_TOKEN 과 «똑같아야» 합니다. */
    'token'   => 'CHANGE-ME-아무-뜻-없는-긴-글자',

    /*  쿠팡이 느릴 때를 봐서 넉넉히. 창을 짧게 잡으면 30초를 넘기지 않습니다. */
    'timeout' => 30,
];
