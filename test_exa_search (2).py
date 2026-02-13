#!/usr/bin/env python3
"""
测试 Exa.ai 搜索API
"""

import sys
from pathlib import Path

# 添加项目根目录到Python路径
sys.path.insert(0, str(Path(__file__).parent))

from backend.tools.search import search_tool


def test_exa_search():
    """测试 Exa.ai 搜索功能"""
    print("=== 测试 Exa.ai 搜索API ===\n")
    
    # 测试搜索
    query = "Python programming"
    print(f"搜索关键词: {query}")
    print("-" * 50)
    
    try:
        results = search_tool.search(query, num_results=3)
        
        if not results:
            print("⚠️ 未返回搜索结果")
            return False
        
        print(f"✓ 成功获取 {len(results)} 条搜索结果\n")
        
        for i, result in enumerate(results, 1):
            print(f"--- 结果 {i} ---")
            print(f"标题: {result.get('title', 'N/A')}")
            print(f"链接: {result.get('link', 'N/A')}")
            snippet = result.get('snippet', '')
            if snippet:
                print(f"摘要: {snippet[:200]}..." if len(snippet) > 200 else f"摘要: {snippet}")
            print()
        
        return True
        
    except Exception as e:
        print(f"✗ 搜索失败: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = test_exa_search()
    sys.exit(0 if success else 1)
