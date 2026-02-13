#!/usr/bin/env python3
"""
测试数眼智能搜索API - 尝试不同的认证方式
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import requests
import json


def test_with_code_in_url():
    """测试将code作为URL路径参数"""
    print("=== 测试方式1: code作为URL路径参数 ===\n")
    
    # 使用用户提供的API Key作为code
    code = "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq"
    
    # 根据搜索结果中的示例URL格式
    base_url = f"https://www.xujian.tech/atlapi/data/c/search/web/{code}"
    
    print(f"API URL: {base_url}")
    
    headers = {
        "Content-Type": "application/json"
    }
    
    payload = {
        "q": "Python编程",
        "num": 3
    }
    
    try:
        response = requests.post(
            base_url,
            headers=headers,
            json=payload,
            timeout=30
        )
        
        print(f"状态码: {response.status_code}")
        print(f"响应: {response.text[:500]}\n")
        
        if response.status_code == 200:
            print("✓ 此方式可用！")
            return True
        else:
            print("✗ 此方式失败")
            return False
            
    except Exception as e:
        print(f"✗ 错误: {e}\n")
        return False


def test_with_api_key_header():
    """测试使用X-API-Key头部"""
    print("=== 测试方式2: X-API-Key头部 ===\n")
    
    api_key = "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq"
    base_url = "https://api.shuyanai.com/v1/search"
    
    headers = {
        "X-API-Key": api_key,
        "Content-Type": "application/json"
    }
    
    payload = {
        "query": "Python编程",
        "num_results": 3
    }
    
    try:
        response = requests.post(
            base_url,
            headers=headers,
            json=payload,
            timeout=30
        )
        
        print(f"状态码: {response.status_code}")
        print(f"响应: {response.text[:500]}\n")
        
        if response.status_code == 200:
            print("✓ 此方式可用！")
            return True
        else:
            print("✗ 此方式失败")
            return False
            
    except Exception as e:
        print(f"✗ 错误: {e}\n")
        return False


def test_with_access_key():
    """测试使用Access Key和Secret Key"""
    print("=== 测试方式3: Access Key + Secret Key ===\n")
    
    # 尝试从API Key中提取或使用不同格式
    access_key = "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq"
    
    base_url = "https://api.shuyanai.com/v1/search"
    
    headers = {
        "Access-Key": access_key,
        "Content-Type": "application/json"
    }
    
    payload = {
        "query": "Python编程",
        "num_results": 3
    }
    
    try:
        response = requests.post(
            base_url,
            headers=headers,
            json=payload,
            timeout=30
        )
        
        print(f"状态码: {response.status_code}")
        print(f"响应: {response.text[:500]}\n")
        
        if response.status_code == 200:
            print("✓ 此方式可用！")
            return True
        else:
            print("✗ 此方式失败")
            return False
            
    except Exception as e:
        print(f"✗ 错误: {e}\n")
        return False


def test_get_request():
    """测试GET请求方式"""
    print("=== 测试方式4: GET请求 ===\n")
    
    api_key = "sk-oXO8lgCdvUX957qJ9uKspG2Ca0UD9o4wLX3vxCVzTfuT9XGq"
    base_url = "https://api.shuyanai.com/v1/search"
    
    headers = {
        "Authorization": f"Bearer {api_key}"
    }
    
    params = {
        "query": "Python编程",
        "num_results": 3
    }
    
    try:
        response = requests.get(
            base_url,
            headers=headers,
            params=params,
            timeout=30
        )
        
        print(f"状态码: {response.status_code}")
        print(f"响应: {response.text[:500]}\n")
        
        if response.status_code == 200:
            print("✓ 此方式可用！")
            return True
        else:
            print("✗ 此方式失败")
            return False
            
    except Exception as e:
        print(f"✗ 错误: {e}\n")
        return False


def test_shuyanai_website():
    """测试官网是否可访问"""
    print("=== 测试官网可访问性 ===\n")
    
    try:
        response = requests.get("https://shuyanai.com", timeout=10)
        print(f"官网状态码: {response.status_code}")
        if response.status_code == 200:
            print("✓ 官网可访问\n")
            return True
        else:
            print("✗ 官网访问异常\n")
            return False
    except Exception as e:
        print(f"✗ 官网访问失败: {e}\n")
        return False


if __name__ == "__main__":
    print("开始测试数眼智能API的不同认证方式...\n")
    
    # 测试官网
    test_shuyanai_website()
    
    # 测试各种认证方式
    results = []
    results.append(("URL路径参数", test_with_code_in_url()))
    results.append(("X-API-Key头部", test_with_api_key_header()))
    results.append(("Access Key", test_with_access_key()))
    results.append(("GET请求", test_get_request()))
    
    print("\n=== 测试结果汇总 ===")
    for name, result in results:
        print(f"{name}: {'✓ 通过' if result else '✗ 失败'}")
