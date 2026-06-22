import functions_framework
import requests
import json
import os

PROXY_KEY = os.environ.get('PROXY_KEY', 'pack2u-ecount-proxy-2026')

@functions_framework.http
def ecount_proxy(request):
    """이카운트 OAPI 프록시 - 고정 IP를 통해 요청 전달"""
    
    # CORS 헤더
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Key',
    }
    if request.method == 'OPTIONS':
        return ('', 204, headers)
    
    # 보안: 프록시 키 검증
    proxy_key = request.headers.get('X-Proxy-Key', '')
    if proxy_key != PROXY_KEY:
        return (json.dumps({'error': 'Unauthorized'}), 403, headers)
    
    # 요청 본문 파싱
    req_data = request.get_json(silent=True)
    if not req_data or 'url' not in req_data:
        return (json.dumps({'error': 'Missing url'}), 400, headers)
    
    target_url = req_data['url']
    payload = req_data.get('payload', {})
    method = req_data.get('method', 'POST').upper()
    
    # 이카운트 API 호출 (고정 IP를 통해)
    try:
        if method == 'POST':
            resp = requests.post(
                target_url,
                json=payload,
                headers={'Accept': 'application/json', 'Content-Type': 'application/json'},
                timeout=30
            )
        else:
            resp = requests.get(target_url, timeout=30)
        
        response_headers = dict(headers)
        response_headers['Content-Type'] = 'application/json'
        return (resp.text, resp.status_code, response_headers)
    
    except Exception as e:
        return (json.dumps({'error': str(e)}), 500, headers)
