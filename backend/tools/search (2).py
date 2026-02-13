from backend.config import settings
from typing import List, Dict, Any
import logging
import requests

logger = logging.getLogger(__name__)


class SearchTool:
    def __init__(self):
        self.api_key = settings.exa_api_key
        self.base_url = "https://api.exa.ai/search"

    def search(self, query: str, num_results: int = 5) -> List[Dict[str, Any]]:
        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json"
        }
        
        payload = {
            "query": query,
            "type": "auto",
            "num_results": num_results,
            "contents": {
                "highlights": {
                    "max_characters": 2000
                }
            }
        }
        
        try:
            response = requests.post(
                self.base_url,
                headers=headers,
                json=payload,
                timeout=30
            )
            response.raise_for_status()
            results = response.json()
            
            organic_results = []
            if "results" in results:
                for item in results["results"]:
                    # 获取highlights数组的第一个元素作为摘要
                    highlights = item.get("highlights", [])
                    snippet = highlights[0] if highlights else ""
                    
                    organic_results.append({
                        "title": item.get("title", ""),
                        "link": item.get("url", ""),
                        "snippet": snippet,
                        "query": query
                    })
            
            logger.info(f"搜索 '{query}' 返回 {len(organic_results)} 条结果")
            return organic_results
            
        except requests.exceptions.RequestException as e:
            logger.error(f"搜索请求失败: {e}")
            return []
        except Exception as e:
            logger.error(f"搜索失败: {e}")
            return []


search_tool = SearchTool()
