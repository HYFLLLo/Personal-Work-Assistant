#!/usr/bin/env python3
"""
测试数眼智能搜索API - URL路径参数 + GET请求
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import requests
import json


def test_get_with_code():
    """测试GET请求 + code作为URL路径参数"""
    print("=== 测试GET请求 + URL路径参数 ===\n")
    
    code = "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq"
    
    # 基础URL
    base_url = f"https://www.xujian.tech/atlapi/data/c/search/web/{code}"
    
    print(f"API URL: {base_url}")
    
    # 测试不同的参数格式
    params_list = [
        {"q": "Python编程", "num": 3},
        {"query": "Python编程", "num_results": 3},
        {"keyword": "Python编程", "limit": 3},
        {"search": "Python编程", "count": 3},
    ]
    
    for i, params in enumerate(params_list, 1):
        print(f"\n--- 测试参数格式 {i}: {params} ---")
        try:
            response = requests.get(
                base_url,
                params=params,
                timeout=30
            )
            
            print(f"状态码: {response.status_code}")
            print(f"完整URL: {response.url}")
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    print(f"响应: {json.dumps(data, ensure_ascii=False, indent=2)[:1000]}")
                    
                    if data.get("code") == 200 or "data" in data:
                        print("\n✓ 找到正确的参数格式！")
                        return params, data
                except:
                    print(f"响应文本: {response.text[:500]}")
            else:
                print(f"响应: {response.text[:500]}")
                
        except Exception as e:
            print(f"错误: {e}")
    
    return None, None


def test_with_headers():
    """测试添加请求头"""
    print("\n=== 测试添加不同请求头 ===\n")
    
    code = "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq"
    base_url = f"https://www.xujian.tech/atlapi/data/c/search/web/{code}"
    
    headers_list = [
        {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
        {"Content-Type": "application/json"},
        {"Accept": "application/json"},
    ]
    
    for i, headers in enumerate(headers_list, 1):
        print(f"\n--- 测试请求头 {i}: {headers} ---")
        try:
            response = requests.get(
                base_url,
                headers=headers,
                params={"q": "Python"},
                timeout=30
            )
            
            print(f"状态码: {response.status_code}")
            if response.status_code == 200:
                data = response.json()
                print(f"响应: {json.dumps(data, ensure_ascii=False, indent=2)[:500]}")
                
        except Exception as e:
            print(f"错误: {e}")


def test_full_request():
    """测试完整的请求"""
    print("\n=== 测试完整请求 ===\n")
    
    code = "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq"
    base_url = f"https://www.xujian.tech/atlapi/data/c/search/web/{code}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }
    
    params = {
        "q": "人工智能最新发展",
        "num": 5
    }
    
    try:
        response = requests.get(
            base_url,
            headers=headers,
            params=params,
            timeout=30
        )
        
        print(f"状态码: {response.status_code}")
        print(f"完整URL: {response.url}\n")
        
        if response.status_code == 200:
            data = response.json()
            print(f"完整响应:\n{json.dumps(data, ensure_ascii=False, indent=2)}\n")
            
            # 解析结果
            if "data" in data and data["data"]:
                print("✓ 搜索成功！")
                print(f"结果数量: {len(data['data']) if isinstance(data['data'], list) else 'N/A'}")
                return True
            else:
                print(f"响应结构: {list(data.keys())}")
                return False
        else:
            print(f"请求失败: {response.text}")
            return False
            
    except Exception as e:
        print(f"错误: {e}")
        return False


if __name__ == "__main__":
    print("开始测试数眼智能API - URL路径参数方式...\n")
    
    # 测试不同参数格式
    params, data = test_get_with_code()
    
    # 测试请求头
    test_with_headers()
    
    # 完整测试
    success = test_full_request()
    
    if success:
        print("\n🎉 API测试成功！可以正常使用。")
    else:
        print("\n❌ 需要进一步调整参数格式。")
