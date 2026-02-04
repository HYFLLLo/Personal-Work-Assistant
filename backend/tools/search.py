from serpapi import GoogleSearch
from backend.config import settings
from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)


class SearchTool:
    def __init__(self):
        self.api_key = settings.serpapi_api_key

    def search(self, query: str, num_results: int = 5) -> List[Dict[str, Any]]:
        params = {
            "engine": "google",
            "q": query,
            "api_key": self.api_key,
            "num": num_results
        }
        
        try:
            search = GoogleSearch(params)
            results = search.get_dict()
            
            organic_results = []
            if "organic_results" in results:
                for item in results["organic_results"]:
                    organic_results.append({
                        "title": item.get("title", ""),
                        "link": item.get("link", ""),
                        "snippet": item.get("snippet", ""),
                        "query": query
                    })
            
            logger.info(f"搜索 '{query}' 返回 {len(organic_results)} 条结果")
            return organic_results
            
        except Exception as e:
            logger.error(f"搜索失败: {e}")
            return []


search_tool = SearchTool()
