import asyncio
import httpx
import json

async def test_sse_endpoint():
    """测试SSE端点是否正常工作"""
    url = "http://localhost:8000/api/stream"
    params = {
        "query": "生成2024年AI行业趋势报告"
    }
    
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream('GET', url, params=params) as response:
                if response.status_code != 200:
                    print(f"HTTP错误: {response.status_code}")
                    return
                
                print("开始接收SSE事件...")
                event_buffer = []
                
                async for chunk in response.aiter_text():
                    lines = chunk.split('\n')
                    for line in lines:
                        line = line.strip()
                        if not line:
                            continue
                        if line.startswith('event:'):
                            event_type = line.split(':', 1)[1].strip()
                        elif line.startswith('data:'):
                            data = line.split(':', 1)[1].strip()
                            if data:
                                try:
                                    json_data = json.loads(data)
                                    print(f"事件类型: {event_type}, 数据: {json_data}")
                                except json.JSONDecodeError:
                                    print(f"事件类型: {event_type}, 原始数据: {data}")
                
                print("SSE事件接收完成")
                
    except Exception as e:
        print(f"测试过程中发生错误: {e}")

if __name__ == "__main__":
    asyncio.run(test_sse_endpoint())
