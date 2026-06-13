import urllib.request
import json

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

print("1. Login to SBOAPI...")
test_login = post_json("https://sboapicd.ecount.com/OAPI/V2/OAPILogin", login_payload)
s_id = test_login['Data']['Datas']['SESSION_ID']

target_payload = {
    "ProductList": [
        {
            "BulkDatas": {
                "PROD_CD": "test_auth_002",
                "PROD_DES": "Validation Modified",
                "PROD_TYPE": "3",
                "UNIT": "EA",
                "SET_FLAG": "0" 
            }
        }
    ]
}

print("\n2. Validate ModifyBasicProduct...")
test_target = post_json(
    f"https://sboapicd.ecount.com/OAPI/V2/InventoryBasic/ModifyBasicProduct?SESSION_ID={s_id}",
    target_payload
)
print(test_target)
