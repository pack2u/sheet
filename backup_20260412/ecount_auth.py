import urllib.request
import json

def post_json(url, data):
    req = urllib.request.Request(url, method='POST')
    req.add_header('Content-Type', 'application/json')
    jsondata = json.dumps(data).encode('utf-8')
    try:
        with urllib.request.urlopen(req, data=jsondata) as response:
            return response.read().decode('utf-8')
    except Exception as e:
        if hasattr(e, 'read'):
            return e.read().decode('utf-8')
        return str(e)

print("=== 1. ZONE CHECK ===")
zone_res = post_json("https://oapi.ecount.com/OAPI/V2/Zone", {"COM_CODE": "176341"})
print(zone_res)

login_payload = {
    "COM_CODE": "176341",
    "USER_ID": "PACK2U",
    "API_CERT_KEY": "319ea1f4b9f1f4427ae8d6b8aeb52cc5d3",
    "ZONE": "CD"
}

print("\n=== 2. PROD LOGIN ===")
prod_login = post_json("https://oapicd.ecount.com/OAPI/V2/OAPILogin", login_payload)
print(prod_login)

print("\n=== 3. TEST LOGIN ===")
test_login = post_json("https://sboapicd.ecount.com/OAPI/V2/OAPILogin", login_payload)
print(test_login)

target_payload = {
    "ProductList": [
        {
            "BulkDatas": {
                "PROD_CD": "test_auth_001",
                "PROD_DES": "Validation Test Product",
                "PROD_TYPE": "3",
                "UNIT": "EA",
                "SET_FLAG": "N"
            }
        }
    ]
}

print("\n=== 4. PROD TARGET API ===")
prod_target = post_json(
    "https://oapicd.ecount.com/OAPI/V2/InventoryBasic/SaveBasicProduct?SESSION_ID=319ea1f4b9f1f4427ae8d6b8aeb52cc5d3",
    target_payload
)
print(prod_target)

print("\n=== 5. TEST TARGET API ===")
test_target = post_json(
    "https://sboapicd.ecount.com/OAPI/V2/InventoryBasic/SaveBasicProduct?SESSION_ID=319ea1f4b9f1f4427ae8d6b8aeb52cc5d3",
    target_payload
)
print(test_target)
