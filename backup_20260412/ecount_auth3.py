import urllib.request
import json
import time

def post_json(url, data):
    req = urllib.request.Request(url, method='POST')
    req.add_header('Content-Type', 'application/json')
    jsondata = json.dumps(data).encode('utf-8')
    try:
        with urllib.request.urlopen(req, data=jsondata) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        if hasattr(e, 'read'):
            return json.loads(e.read().decode('utf-8'))
        return str(e)

login_payload = {
    "COM_CODE": "176341",
    "USER_ID": "PACK2U",
    "API_CERT_KEY": "319ea1f4b9f1f4427ae8d6b8aeb52cc5d3",
    "ZONE": "CD"
}

print("Logging in to TEST SERVER...")
test_login = post_json("https://sboapicd.ecount.com/OAPI/V2/OAPILogin", login_payload)

session_id = test_login['Data']['Datas']['SESSION_ID']

target_payload = {
    "ProductList": [
        {
            "BulkDatas": {
                "PROD_CD": "test_auth_002",
                "PROD_DES": "Validation Test Product",
                "PROD_TYPE": "3",
                "UNIT": "EA",
                "OUT_PRICE": "1000",
                "IN_PRICE": "500",
                "REMARKS": "test",
                "SET_FLAG": "0",
                "BAL_FLAG": "1"
            }
        }
    ]
}

print("\nCalling Target API on TEST SERVER...")
test_target = post_json(
    f"https://sboapicd.ecount.com/OAPI/V2/InventoryBasic/SaveBasicProduct?SESSION_ID={session_id}",
    target_payload
)
print(test_target)
