import requests

print("Testing SSE endpoint...")
try:
    response = requests.get('http://127.0.0.1:8000/api/stream?query=测试', stream=True, timeout=30)
    print(f"Status code: {response.status_code}")
    print(f"Headers: {dict(response.headers)}")
    
    if response.status_code == 200:
        print("Streaming response:")
        for chunk in response.iter_content(chunk_size=1024):
            if chunk:
                print(chunk.decode('utf-8'))
    else:
        print(f"Error: {response.text}")
except Exception as e:
    print(f"Exception: {e}")
