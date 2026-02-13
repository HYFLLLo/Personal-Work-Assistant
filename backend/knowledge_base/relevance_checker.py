"""
相关性检查器
评估知识库内容是否足以回答用户查询
"""

import time
from typing import List, Dict, Any
import logging

from .models import SearchResult, RelevanceCheckResult
from .vector_store import VectorStore

logger = logging.getLogger(__name__)


class RelevanceChecker:
    """相关性检查器类"""
    
    def __init__(
        self,
        vector_store: VectorStore = None,
        min_similarity_threshold: float = 0.3,
        min_coverage_score: float = 0.3,
        confidence_threshold: float = 0.6
    ):
        """
        初始化相关性检查器
        
        Args:
            vector_store: 向量存储实例
            min_similarity_threshold: 最小相似度阈值
            min_coverage_score: 最小覆盖分数阈值
            confidence_threshold: 置信度阈值
        """
        self.vector_store = vector_store or VectorStore()
        self.min_similarity_threshold = min_similarity_threshold
        self.min_coverage_score = min_coverage_score
        self.confidence_threshold = confidence_threshold
    
    def check_relevance(
        self,
        query: str,
        top_k: int = 5,
        max_response_time_ms: int = 500
    ) -> RelevanceCheckResult:
        """
        检查知识库内容是否与查询相关且足够回答问题
        
        Args:
            query: 用户查询
            top_k: 检索结果数量
            max_response_time_ms: 最大响应时间（毫秒）
            
        Returns:
            相关性检查结果
        """
        start_time = time.time()
        
        try:
            # 1. 执行向量检索
            search_results = self.vector_store.search(
                query=query,
                top_k=top_k,
                score_threshold=self.min_similarity_threshold
            )
            
            # 2. 如果没有检索到任何结果
            if not search_results:
                return RelevanceCheckResult(
                    is_sufficient=False,
                    confidence=0.0,
                    reason="知识库中未找到相关内容",
                    relevant_chunks=[],
                    coverage_score=0.0
                )
            
            # 3. 计算覆盖分数
            coverage_score = self._calculate_coverage(query, search_results)
            
            # 4. 评估相关性质量
            quality_score = self._assess_quality(search_results)
            
            # 5. 综合判断是否足够
            is_sufficient = self._is_sufficient(search_results, coverage_score, quality_score)
            
            # 6. 计算置信度
            confidence = self._calculate_confidence(search_results, coverage_score, quality_score)
            
            # 7. 生成原因说明
            reason = self._generate_reason(is_sufficient, search_results, coverage_score, confidence)
            
            elapsed_ms = (time.time() - start_time) * 1000
            logger.info(f"相关性检查完成，耗时: {elapsed_ms:.2f}ms，结果: {'足够' if is_sufficient else '不足'}")
            
            return RelevanceCheckResult(
                is_sufficient=is_sufficient,
                confidence=confidence,
                reason=reason,
                relevant_chunks=search_results,
                coverage_score=coverage_score
            )
            
        except Exception as e:
            logger.error(f"相关性检查失败: {str(e)}")
            elapsed_ms = (time.time() - start_time) * 1000
            
            # 如果超时，返回不确定结果，触发API搜索
            if elapsed_ms > max_response_time_ms:
                return RelevanceCheckResult(
                    is_sufficient=False,
                    confidence=0.0,
                    reason=f"检索超时 ({elapsed_ms:.0f}ms)，为确保准确性将使用API搜索",
                    relevant_chunks=[],
                    coverage_score=0.0
                )
            
            return RelevanceCheckResult(
                is_sufficient=False,
                confidence=0.0,
                reason=f"检索过程出错: {str(e)}",
                relevant_chunks=[],
                coverage_score=0.0
            )
    
    def _calculate_coverage(self, query: str, results: List[SearchResult]) -> float:
        """
        计算查询覆盖分数
        
        评估检索结果对查询的覆盖程度
        """
        if not results:
            return 0.0
        
        # 提取查询关键词（简单实现）
        query_keywords = set(self._extract_keywords(query))
        
        if not query_keywords:
            return 0.5  # 默认中等覆盖
        
        # 统计被覆盖的关键词
        covered_keywords = set()
        total_content = ""
        
        for result in results:
            total_content += result.chunk.content + " "
        
        content_keywords = set(self._extract_keywords(total_content))
        
        for keyword in query_keywords:
            if keyword in content_keywords:
                covered_keywords.add(keyword)
        
        # 计算覆盖率
        coverage = len(covered_keywords) / len(query_keywords)
        
        # 结合相似度分数加权
        avg_similarity = sum(r.score for r in results) / len(results)
        
        # 最终覆盖分数 = 覆盖率 * 0.6 + 平均相似度 * 0.4
        final_coverage = coverage * 0.6 + avg_similarity * 0.4
        
        return min(final_coverage, 1.0)
    
    def _assess_quality(self, results: List[SearchResult]) -> float:
        """
        评估检索结果质量
        
        考虑因素：
        - 相似度分数分布
        - 结果多样性
        - 内容长度
        """
        if not results:
            return 0.0
        
        # 1. 相似度分数 (40%)
        avg_similarity = sum(r.score for r in results) / len(results)
        similarity_score = avg_similarity
        
        # 2. 结果多样性 (30%)
        # 检查是否来自不同文档
        doc_ids = set(r.chunk.document_id for r in results)
        diversity_score = min(len(doc_ids) / min(len(results), 3), 1.0)
        
        # 3. 内容充分性 (30%)
        total_length = sum(len(r.chunk.content) for r in results)
        # 假设1000字符为理想长度
        adequacy_score = min(total_length / 1000, 1.0)
        
        # 综合质量分数
        quality_score = (
            similarity_score * 0.4 +
            diversity_score * 0.3 +
            adequacy_score * 0.3
        )
        
        return quality_score
    
    def _is_sufficient(
        self,
        results: List[SearchResult],
        coverage_score: float,
        quality_score: float
    ) -> bool:
        """
        判断知识库内容是否足够回答问题
        
        判断标准：
        1. 至少有一个高相似度结果 (>0.75)
        2. 覆盖分数 >= min_coverage_score
        3. 质量分数 >= 0.6
        """
        # 检查是否有高相似度结果
        has_high_similarity = any(r.score > 0.75 for r in results)
        
        # 检查平均相似度
        avg_similarity = sum(r.score for r in results) / len(results)
        has_good_similarity = avg_similarity >= self.min_similarity_threshold
        
        # 综合判断
        is_sufficient = (
            has_high_similarity or
            (has_good_similarity and coverage_score >= self.min_coverage_score and quality_score >= 0.6)
        )
        
        return is_sufficient
    
    def _calculate_confidence(
        self,
        results: List[SearchResult],
        coverage_score: float,
        quality_score: float
    ) -> float:
        """计算置信度"""
        if not results:
            return 0.0
        
        # 基于相似度、覆盖率和质量计算置信度
        avg_similarity = sum(r.score for r in results) / len(results)
        max_similarity = max(r.score for r in results)
        
        # 置信度 = 最大相似度*0.3 + 平均相似度*0.3 + 覆盖率*0.2 + 质量*0.2
        confidence = (
            max_similarity * 0.3 +
            avg_similarity * 0.3 +
            coverage_score * 0.2 +
            quality_score * 0.2
        )
        
        return min(confidence, 1.0)
    
    def _generate_reason(
        self,
        is_sufficient: bool,
        results: List[SearchResult],
        coverage_score: float,
        confidence: float
    ) -> str:
        """生成原因说明"""
        if is_sufficient:
            avg_similarity = sum(r.score for r in results) / len(results)
            return (
                f"知识库内容足够回答问题。"
                f"找到 {len(results)} 个相关片段，"
                f"平均相似度: {avg_similarity:.2f}，"
                f"覆盖分数: {coverage_score:.2f}，"
                f"置信度: {confidence:.2f}"
            )
        else:
            if not results:
                return "知识库中未找到相关内容，需要调用API搜索"
            
            avg_similarity = sum(r.score for r in results) / len(results)
            reasons = []
            
            if avg_similarity < self.min_similarity_threshold:
                reasons.append(f"相似度较低 ({avg_similarity:.2f})")
            if coverage_score < self.min_coverage_score:
                reasons.append(f"覆盖不足 ({coverage_score:.2f})")
            
            reason_str = "，".join(reasons) if reasons else "内容相关性不足"
            return f"知识库内容不足以完整回答问题: {reason_str}，将调用API搜索补充"
    
    def _extract_keywords(self, text: str) -> List[str]:
        """提取关键词（简化实现）"""
        import re
        
        # 移除标点符号和特殊字符
        text = re.sub(r'[^\w\s]', ' ', text)
        
        # 分词并过滤停用词
        words = text.lower().split()
        
        # 简单停用词列表
        stop_words = {
            '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那',
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should'
        }
        
        # 过滤短词和停用词
        keywords = [w for w in words if len(w) > 1 and w not in stop_words]
        
        return keywords
    
    def quick_check(self, query: str) -> bool:
        """
        快速检查（仅返回是否足够，用于性能敏感场景）
        
        Args:
            query: 用户查询
            
        Returns:
            知识库是否足够
        """
        result = self.check_relevance(query, top_k=3, max_response_time_ms=300)
        return result.is_sufficient and result.confidence >= self.confidence_threshold


# 全局相关性检查器实例
relevance_checker = RelevanceChecker()
