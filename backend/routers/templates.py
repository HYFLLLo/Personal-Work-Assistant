"""
报告模板API路由
"""

from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from backend.templates import (
    get_all_templates,
    get_template,
    get_templates_by_category,
    get_template_categories,
    get_default_template,
    ReportTemplate
)
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/templates", response_model=List[Dict[str, Any]])
async def list_templates():
    """获取所有报告模板列表"""
    try:
        templates = get_all_templates()
        return [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "icon": t.icon,
                "category": t.category,
                "structure": t.structure,
                "default_sections": t.default_sections
            }
            for t in templates
        ]
    except Exception as e:
        logger.error(f"获取模板列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取模板列表失败: {str(e)}")


@router.get("/templates/{template_id}", response_model=Dict[str, Any])
async def get_template_detail(template_id: str):
    """获取指定模板的详细信息"""
    try:
        template = get_template(template_id)
        return {
            "id": template.id,
            "name": template.name,
            "description": template.description,
            "icon": template.icon,
            "category": template.category,
            "structure": template.structure,
            "planner_prompt": template.planner_prompt,
            "report_prompt": template.report_prompt,
            "default_sections": template.default_sections
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"获取模板详情失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取模板详情失败: {str(e)}")


@router.get("/templates/categories", response_model=List[str])
async def list_categories():
    """获取所有模板分类"""
    try:
        categories = get_template_categories()
        return categories
    except Exception as e:
        logger.error(f"获取模板分类失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取模板分类失败: {str(e)}")


@router.get("/templates/category/{category}", response_model=List[Dict[str, Any]])
async def get_templates_by_cat(category: str):
    """按分类获取模板"""
    try:
        templates = get_templates_by_category(category)
        return [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "icon": t.icon,
                "category": t.category,
                "structure": t.structure,
                "default_sections": t.default_sections
            }
            for t in templates
        ]
    except Exception as e:
        logger.error(f"获取分类模板失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取分类模板失败: {str(e)}")


@router.get("/templates/default", response_model=Dict[str, Any])
async def get_default_template_endpoint():
    """获取默认模板"""
    try:
        template = get_default_template()
        return {
            "id": template.id,
            "name": template.name,
            "description": template.description,
            "icon": template.icon,
            "category": template.category,
            "structure": template.structure,
            "default_sections": template.default_sections
        }
    except Exception as e:
        logger.error(f"获取默认模板失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取默认模板失败: {str(e)}")
