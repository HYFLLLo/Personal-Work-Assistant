#!/usr/bin/env python3
"""
测试数眼智能搜索API是否可用
"""

import sys
from pathlib import Path

# 添加项目根目录到Python路径
sys.path.insert(0, str(Path(__file__).parent))

import requests
import json
from backend.config import settings


def test_shuyanai_api():
    """直接测试数眼智能搜索API"""
    print("=== 测试数眼智能搜索API ===\n")
    
    # API配置
    api_key = settings.shuyanai_api_key
    base_url = "https://api.shuyanai.com/v1/search"
    
    print(f"API Key: {api_key[:20]}...")
    print(f"API URL: {base_url}\n")
    
    # 请求头
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    # 请求体
    payload = {
        "query": "Python编程",
        "num_results": 3
    }
    
    print(f"请求参数: {json.dumps(payload, ensure_ascii=False)}")
    print(f"请求头: {headers}\n")
    
    try:
        print("正在发送请求...")
        response = requests.post(
            base_url,
            headers=headers,
            json=payload,
            timeout=30
        )
        
        print(f"\n状态码: {response.status_code}")
        print(f"响应头: {dict(response.headers)}\n")
        
        if response.status_code == 200:
            results = response.json()
            print(f"✓ API请求成功！")
            print(f"\n完整响应:\n{json.dumps(results, ensure_ascii=False, indent=2)}\n")
            
            # 检查结果结构
            if "results" in results:
                print(f"✓ 找到 'results' 字段，包含 {len(results['results'])} 条结果")
                for i, item in enumerate(results['results'][:3], 1):
                    print(f"\n结果 {i}:")
                    print(f"  标题: {item.get('title', 'N/A')}")
                    print(f"  链接: {item.get('link', 'N/A')}")
                    print(f"  摘要: {item.get('snippet', 'N/A')[:100]}...")
            elif "organic_results" in results:
                print(f"✓ 找到 'organic_results' 字段，包含 {len(results['organic_results'])} 条结果")
            else:
                print("⚠ 未找到预期的结果字段，可用字段:")
                print(f"  {list(results.keys())}")
            
            return True
        else:
            print(f"✗ API请求失败")
            print(f"错误响应: {response.text}")
            return False
            
    except requests.exceptions.Timeout:
        print("✗ 请求超时")
        return False
    except requests.exceptions.ConnectionError as e:
        print(f"✗ 连接错误: {e}")
        return False
    except requests.exceptions.RequestException as e:
        print(f"✗ 请求异常: {e}")
        return False
    except Exception as e:
        print(f"✗ 未知错误: {e}")
        return False


def test_search_tool():
    """测试SearchTool类"""
    print("\n=== 测试SearchTool类 ===\n")
    
    from backend.tools.search import search_tool
    
    try:
        results = search_tool.search("人工智能", num_results=3)
        
        if results:
            print(f"✓ SearchTool测试成功！返回 {len(results)} 条结果\n")
            for i, item in enumerate(results[:3], 1):
                print(f"结果 {i}:")
                print(f"  标题: {item.get('title', 'N/A')}")
                print(f"  链接: {item.get('link', 'N/A')}")
                print(f"  摘要: {item.get('snippet', 'N/A')[:100]}...")
                print()
            return True
        else:
            print("✗ SearchTool返回空结果")
            return False
            
    except Exception as e:
        print(f"✗ SearchTool测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("开始测试数眼智能搜索API...\n")
    
    # 测试1: 直接API调用
    api_result = test_shuyanai_api()
    
    # 测试2: SearchTool类
    tool_result = test_search_tool()
    
    print("\n=== 测试结果汇总 ===")
    print(f"直接API调用: {'✓ 通过' if api_result else '✗ 失败'}")
    print(f"SearchTool类: {'✓ 通过' if tool_result else '✗ 失败'}")
    
    if api_result and tool_result:
        print("\n🎉 所有测试通过！API可用。")
    else:
        print("\n❌ 部分测试失败，请检查配置或API服务状态。")
