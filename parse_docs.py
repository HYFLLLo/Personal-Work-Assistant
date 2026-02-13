#!/usr/bin/env python3
"""
解析数眼智能文档页面，提取API信息
"""

import requests
import re
import json


def parse_docs():
    """解析文档页面"""
    url = "https://shuyanai.com/docs"
    
    try:
        response = requests.get(url, timeout=10)
        print(f"状态码: {response.status_code}")
        
        if response.status_code == 200:
            html = response.text
            
            # 查找API端点
            api_patterns = [
                r'api[_-]?url["\']?\s*[:=]\s*["\']([^"\']+)["\']',
                r'base[_-]?url["\']?\s*[:=]\s*["\']([^"\']+)["\']',
                r'endpoint["\']?\s*[:=]\s*["\']([^"\']+)["\']',
                r'https?://[^\s"\']+api[^\s"\']*',
                r'https?://api\.[^\s"\']+',
            ]
            
            print("\n=== 查找API端点 ===")
            found_urls = set()
            for pattern in api_patterns:
                matches = re.findall(pattern, html, re.IGNORECASE)
                for match in matches:
                    if 'shuyanai' in match or 'xujian' in match:
                        found_urls.add(match)
            
            for url in found_urls:
                print(f"  {url}")
            
            # 查找JavaScript配置
            print("\n=== 查找JavaScript配置 ===")
            js_patterns = [
                r'<script[^>]*>(.*?)</script>',
                r'window\.__INITIAL_STATE__\s*=\s*(\{.*?\});',
                r'window\.__DATA__\s*=\s*(\{.*?\});',
            ]
            
            for pattern in js_patterns:
                matches = re.findall(pattern, html, re.DOTALL)
                for match in matches[:3]:  # 只显示前3个
                    if 'api' in match.lower() or 'key' in match.lower():
                        snippet = match[:500].replace('\n', ' ')
                        print(f"  {snippet}...")
            
            # 查找JSON数据
            print("\n=== 查找JSON数据 ===")
            json_patterns = [
                r'"api[_-]?key"\s*:\s*"([^"]+)"',
                r'"base[_-]?url"\s*:\s*"([^"]+)"',
                r'"endpoint"\s*:\s*"([^"]+)"',
            ]
            
            for pattern in json_patterns:
                matches = re.findall(pattern, html, re.IGNORECASE)
                for match in matches[:5]:
                    print(f"  {match}")
            
            # 查找fetch/axios调用
            print("\n=== 查找API调用 ===")
            fetch_patterns = [
                r'fetch\(["\']([^"\']+)["\']',
                r'axios\.[getpost]+\(["\']([^"\']+)["\']',
                r'url\s*:\s*["\']([^"\']+api[^"\']*)["\']',
            ]
            
            for pattern in fetch_patterns:
                matches = re.findall(pattern, html, re.IGNORECASE)
                for match in set(matches):
                    if 'shuyanai' in match or 'xujian' in match:
                        print(f"  {match}")
            
            # 保存HTML以便进一步分析
            with open('docs_page.html', 'w', encoding='utf-8') as f:
                f.write(html)
            print("\n✓ 已保存文档页面到 docs_page.html")
            
    except Exception as e:
        print(f"错误: {e}")


if __name__ == "__main__":
    parse_docs()
