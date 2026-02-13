#!/usr/bin/env python3
"""
详细测试 Exa.ai 搜索API响应结构
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from backend.config import settings
import requests
import json


def test_exa_api_detail():
    """详细测试Exa API响应"""
    print("=== 详细测试 Exa.ai API响应 ===\n")
    
    headers = {
        "x-api-key": settings.exa_api_key,
        "Content-Type": "application/json"
    }
    
    payload = {
        "query": "Python programming",
        "type": "auto",
        "num_results": 2,
        "contents": {
            "highlights": {
                "max_characters": 2000
            }
        }
    }
    
    try:
        response = requests.post(
            "https://api.exa.ai/search",
            headers=headers,
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        results = response.json()
        
        print("API响应结构:")
        print(json.dumps(results, indent=2, ensure_ascii=False))
        
    except Exception as e:
        print(f"请求失败: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    test_exa_api_detail()
