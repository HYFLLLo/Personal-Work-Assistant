#!/usr/bin/env python3
"""
尝试获取数眼智能API文档
"""

import requests


def check_docs():
    """检查文档页面"""
    urls = [
        "https://shuyanai.com/docs",
        "https://www.shuyanai.com/docs",
        "https://shuyanai.com/api-docs",
        "https://shuyanai.com/documentation",
    ]
    
    for url in urls:
        print(f"\n尝试访问: {url}")
        try:
            response = requests.get(url, timeout=10, allow_redirects=True)
            print(f"状态码: {response.status_code}")
            print(f"最终URL: {response.url}")
            
            if response.status_code == 200:
                print(f"页面内容长度: {len(response.text)}")
                print(f"内容预览:\n{response.text[:2000]}")
                return True
        except Exception as e:
            print(f"错误: {e}")
    
    return False


def check_api_endpoints():
    """检查可能的API端点"""
    print("\n\n=== 检查API端点 ===\n")
    
    endpoints = [
        "https://api.shuyanai.com",
        "https://api.shuyanai.com/v1",
        "https://api.shuyanai.com/health",
        "https://api.shuyanai.com/status",
    ]
    
    for url in endpoints:
        print(f"\n尝试: {url}")
        try:
            response = requests.get(url, timeout=5)
            print(f"状态码: {response.status_code}")
            print(f"响应: {response.text[:500]}")
        except Exception as e:
            print(f"错误: {e}")


if __name__ == "__main__":
    print("尝试获取数眼智能API信息...\n")
    check_docs()
    check_api_endpoints()
