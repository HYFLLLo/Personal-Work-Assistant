#!/usr/bin/env python3
"""
测试数眼智能搜索API - 尝试api.shuyanai.com的不同路径格式
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import requests
import json


def test_various_urls():
    """测试不同的URL格式"""
    
    code = "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq"
    
    # 测试不同的URL格式
    url_formats = [
        f"https://api.shuyanai.com/v1/search/{code}",
        f"https://api.shuyanai.com/v1/search?code={code}",
        f"https://api.shuyanai.com/search/{code}",
        f"https://api.shuyanai.com/search?api_key={code}",
        f"https://api.shuyanai.com/v1/search?key={code}",
        f"https://api.shuyanai.com/v1/search?token={code}",
    ]
    
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    
    payload = {
        "query": "Python编程",
        "num_results": 3
    }
    
    for i, url in enumerate(url_formats, 1):
        print(f"\n=== 测试URL格式 {i} ===")
        print(f"URL: {url}")
        
        # 测试POST
        try:
            print("\n-- POST请求 --")
            response = requests.post(url, headers=headers, json=payload, timeout=10)
            print(f"状态码: {response.status_code}")
            print(f"响应: {response.text[:500]}")
            
            if response.status_code == 200:
                print("✓ POST成功！")
                return url, "POST"
        except Exception as e:
            print(f"POST错误: {e}")
        
        # 测试GET
        try:
            print("\n-- GET请求 --")
            response = requests.get(url, headers=headers, params={"q": "Python", "num": 3}, timeout=10)
            print(f"状态码: {response.status_code}")
            print(f"响应: {response.text[:500]}")
            
            if response.status_code == 200:
                print("✓ GET成功！")
                return url, "GET"
        except Exception as e:
            print(f"GET错误: {e}")


def test_with_body_code():
    """测试在请求体中放置code"""
    print("\n=== 测试请求体中包含code ===\n")
    
    code = "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq"
    url = "https://api.shuyanai.com/v1/search"
    
    headers = {
        "Content-Type": "application/json"
    }
    
    payload = {
        "code": code,
        "query": "Python编程",
        "num_results": 3
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        print(f"状态码: {response.status_code}")
        print(f"响应: {response.text[:500]}")
        
        if response.status_code == 200:
            print("✓ 此方式成功！")
            return True
    except Exception as e:
        print(f"错误: {e}")
    
    return False


def test_api_key_variations():
    """测试不同的API Key格式"""
    print("\n=== 测试不同API Key格式 ===\n")
    
    # 尝试不同的key格式
    keys = [
        "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq",
        "oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq",  # 去掉sk-前缀
    ]
    
    url = "https://api.shuyanai.com/v1/search"
    
    for i, key in enumerate(keys, 1):
        print(f"\n-- 测试Key格式 {i}: {key[:20]}... --")
        
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "query": "Python",
            "num_results": 3
        }
        
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=10)
            print(f"状态码: {response.status_code}")
            print(f"响应: {response.text[:200]}")
            
            if response.status_code == 200:
                print("✓ 此Key格式成功！")
                return key
        except Exception as e:
            print(f"错误: {e}")
    
    return None


if __name__ == "__main__":
    print("开始测试数眼智能API的不同URL格式...\n")
    
    # 测试各种URL格式
    result = test_various_urls()
    
    # 测试请求体中包含code
    test_with_body_code()
    
    # 测试不同Key格式
    test_api_key_variations()
    
    if result:
        print(f"\n✓ 找到可用格式: {result}")
    else:
        print("\n❌ 所有格式都失败")
