#!/usr/bin/env python3
"""
尝试找到数眼智能API的详细信息
"""

import requests
import json


def try_api_variations():
    """尝试各种可能的API端点和认证方式"""
    
    code = "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq"
    
    # 可能的API端点
    endpoints = [
        # 基础路径 + code作为路径参数
        ("GET", f"https://api.shuyanai.com/search/{code}"),
        ("GET", f"https://api.shuyanai.com/v1/search/{code}"),
        ("GET", f"https://api.shuyanai.com/api/search/{code}"),
        
        # 基础路径 + code作为查询参数
        ("GET", f"https://api.shuyanai.com/search?code={code}"),
        ("GET", f"https://api.shuyanai.com/v1/search?code={code}"),
        ("GET", f"https://api.shuyanai.com/api/search?code={code}"),
        ("GET", f"https://api.shuyanai.com/search?key={code}"),
        ("GET", f"https://api.shuyanai.com/search?token={code}"),
        ("GET", f"https://api.shuyanai.com/search?api_key={code}"),
        
        # POST请求
        ("POST", "https://api.shuyanai.com/search"),
        ("POST", "https://api.shuyanai.com/v1/search"),
        ("POST", "https://api.shuyanai.com/api/search"),
    ]
    
    headers_base = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
    }
    
    for method, url in endpoints:
        print(f"\n{'='*60}")
        print(f"方法: {method}")
        print(f"URL: {url}")
        
        try:
            if method == "GET":
                response = requests.get(
                    url, 
                    headers=headers_base, 
                    params={"q": "测试", "num": 3},
                    timeout=10
                )
            else:
                # POST请求 - 尝试不同的body格式
                headers_post = {**headers_base, "Content-Type": "application/json"}
                
                # 尝试1: code在body中
                body1 = {"code": code, "query": "测试", "num": 3}
                response = requests.post(url, headers=headers_post, json=body1, timeout=10)
                print(f"尝试1 (code在body中) 状态码: {response.status_code}")
                if response.status_code == 200:
                    print(f"✓ 成功! 响应: {response.text[:500]}")
                    continue
                
                # 尝试2: api_key在body中
                body2 = {"api_key": code, "query": "测试", "num": 3}
                response = requests.post(url, headers=headers_post, json=body2, timeout=10)
                print(f"尝试2 (api_key在body中) 状态码: {response.status_code}")
                if response.status_code == 200:
                    print(f"✓ 成功! 响应: {response.text[:500]}")
                    continue
                
                # 尝试3: 只有query
                body3 = {"query": "测试", "num_results": 3}
                headers_with_auth = {**headers_post, "Authorization": f"Bearer {code}"}
                response = requests.post(url, headers=headers_with_auth, json=body3, timeout=10)
                print(f"尝试3 (Bearer Token) 状态码: {response.status_code}")
                if response.status_code == 200:
                    print(f"✓ 成功! 响应: {response.text[:500]}")
                    continue
            
            print(f"状态码: {response.status_code}")
            print(f"响应: {response.text[:500]}")
            
            if response.status_code == 200:
                print("✓ 找到有效的端点和认证方式!")
                
        except Exception as e:
            print(f"错误: {e}")


def check_shuyanai_console():
    """检查控制台页面"""
    print("\n\n=== 检查控制台页面 ===\n")
    
    urls = [
        "https://shuyanai.com/console",
        "https://shuyanai.com/dashboard",
        "https://shuyanai.com/api-keys",
    ]
    
    for url in urls:
        print(f"\n尝试: {url}")
        try:
            response = requests.get(url, timeout=5, allow_redirects=True)
            print(f"状态码: {response.status_code}")
            print(f"最终URL: {response.url}")
        except Exception as e:
            print(f"错误: {e}")


def check_search_endpoint_with_x_api_key():
    """测试X-API-Key头部"""
    print("\n\n=== 测试X-API-Key头部 ===\n")
    
    code = "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq"
    url = "https://api.shuyanai.com/v1/search"
    
    headers = {
        "X-API-Key": code,
        "Content-Type": "application/json"
    }
    
    payload = {
        "query": "Python编程",
        "num_results": 3
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        print(f"状态码: {response.status_code}")
        print(f"响应: {response.text[:500]}")
    except Exception as e:
        print(f"错误: {e}")


if __name__ == "__main__":
    print("尝试各种API端点和认证方式...")
    try_api_variations()
    check_shuyanai_console()
    check_search_endpoint_with_x_api_key()
