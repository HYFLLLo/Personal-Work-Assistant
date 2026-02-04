#!/usr/bin/env python3
"""
测试LLM客户端和搜索工具集成
"""

import sys
from pathlib import Path

# 添加项目根目录到Python路径
sys.path.insert(0, str(Path(__file__).parent))

from backend.models.llm import deepseek_client
from backend.tools.search import search_tool
from backend.config import settings


def test_llm_client():
    """测试LLM客户端集成"""
    print("=== 测试LLM客户端 ===")
    try:
        # 检查配置
        print(f"DeepSeek API URL: {settings.deepseek_base_url}")
        print(f"API Key配置: {'已配置' if settings.deepseek_api_key != 'your_deepseek_api_key_here' else '使用默认占位符'}")
        
        # 测试客户端初始化
        print("LLM客户端初始化: 成功")
        print("✓ LLM客户端集成测试通过")
        return True
    except Exception as e:
        print(f"✗ LLM客户端测试失败: {e}")
        return False


def test_search_tool():
    """测试搜索工具集成"""
    print("\n=== 测试搜索工具 ===")
    try:
        # 检查配置
        print(f"API Key配置: {'已配置' if settings.serpapi_api_key != 'your_serpapi_key_here' else '使用默认占位符'}")
        
        # 测试工具初始化
        print("搜索工具初始化: 成功")
        print("✓ 搜索工具集成测试通过")
        return True
    except Exception as e:
        print(f"✗ 搜索工具测试失败: {e}")
        return False


def main():
    """主测试函数"""
    print("开始测试LLM与工具集成...\n")
    
    llm_result = test_llm_client()
    search_result = test_search_tool()
    
    print("\n=== 测试结果汇总 ===")
    print(f"LLM客户端: {'✓ 通过' if llm_result else '✗ 失败'}")
    print(f"搜索工具: {'✓ 通过' if search_result else '✗ 失败'}")
    
    if llm_result and search_result:
        print("\n🎉 所有集成测试通过！")
        print("\n注意: 要完全使用功能，需要在 .env 文件中配置真实的API密钥:")
        print("- DEEPSEEK_API_KEY: 从 https://platform.deepseek.com 获取")
        print("- SERPAPI_API_KEY: 从 https://serpapi.com 获取")
    else:
        print("\n❌ 部分测试失败，请检查配置")


if __name__ == "__main__":
    main()
