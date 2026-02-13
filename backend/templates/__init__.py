"""
报告模板模块
"""

from .report_templates import (
    ReportTemplate,
    TemplateType,
    REPORT_TEMPLATES,
    get_template,
    get_all_templates,
    get_templates_by_category,
    get_template_categories,
    get_default_template
)

__all__ = [
    'ReportTemplate',
    'TemplateType',
    'REPORT_TEMPLATES',
    'get_template',
    'get_all_templates',
    'get_templates_by_category',
    'get_template_categories',
    'get_default_template'
]
