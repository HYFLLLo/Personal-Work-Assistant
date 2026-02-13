"""
对话管理模块 - 支持多轮对话的会话管理
"""
import uuid
import json
import os
from datetime import datetime
from typing import List, Dict, Optional, Literal
from pydantic import BaseModel
from enum import Enum


class MessageType(str, Enum):
    QUERY = "query"
    FOLLOW_UP = "follow_up"
    MODIFICATION = "modification"
    SUPPLEMENT = "supplement"
    REPORT = "report"
    ANSWER = "answer"


class Message(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    type: MessageType
    timestamp: str
    metadata: Dict = {}


class Conversation(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    messages: List[Message]
    current_report: str = ""
    report_versions: List[Dict] = []
    search_results: List[Dict] = []
    metadata: Dict = {}


class ConversationManager:
    """对话管理器 - 管理会话的创建、更新、查询"""
    
    def __init__(self, storage_file: str = "conversations.json"):
        self.conversations: Dict[str, Conversation] = {}
        self.max_messages = 20  # 最多保留20条消息（10轮对话）
        self.max_versions = 5   # 最多保留5个报告版本
        # 使用绝对路径，确保文件保存在项目根目录
        self.storage_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), storage_file)
        print(f"会话存储文件路径: {self.storage_file}")
        self.load_from_file()  # 启动时从文件加载
    
    def create_conversation(self, query: str) -> Conversation:
        """创建新会话"""
        conversation_id = f"conv_{uuid.uuid4().hex[:8]}"
        now = datetime.now().isoformat()
        
        # 自动生成标题（取查询前20字）
        title = query[:20] + "..." if len(query) > 20 else query
        
        conversation = Conversation(
            id=conversation_id,
            title=title,
            created_at=now,
            updated_at=now,
            messages=[],
            current_report="",
            report_versions=[],
            search_results=[]
        )
        
        self.conversations[conversation_id] = conversation
        self.save_to_file()  # 自动保存
        return conversation
    
    def get_conversation(self, conversation_id: str) -> Optional[Conversation]:
        """获取会话"""
        return self.conversations.get(conversation_id)
    
    def add_message(self, conversation_id: str, role: str, content: str, 
                    msg_type: MessageType, metadata: Dict = None) -> Optional[Message]:
        """添加消息到会话"""
        conversation = self.get_conversation(conversation_id)
        if not conversation:
            return None
        
        message = Message(
            id=f"msg_{uuid.uuid4().hex[:8]}",
            role=role,
            content=content,
            type=msg_type,
            timestamp=datetime.now().isoformat(),
            metadata=metadata or {}
        )
        
        conversation.messages.append(message)
        
        # 限制消息数量，保留最近的
        if len(conversation.messages) > self.max_messages:
            conversation.messages = conversation.messages[-self.max_messages:]
        
        conversation.updated_at = datetime.now().isoformat()
        self.save_to_file()  # 自动保存
        return message
    
    def update_report(self, conversation_id: str, report: str, 
                      operation_type: str = "generate") -> bool:
        """更新报告并保存版本历史"""
        conversation = self.get_conversation(conversation_id)
        if not conversation:
            return False
        
        # 保存当前版本到历史
        if conversation.current_report:
            version = {
                "version": len(conversation.report_versions) + 1,
                "content": conversation.current_report,
                "timestamp": datetime.now().isoformat(),
                "operation": operation_type
            }
            conversation.report_versions.append(version)
            
            # 限制版本数量
            if len(conversation.report_versions) > self.max_versions:
                conversation.report_versions = conversation.report_versions[-self.max_versions:]
        
        # 更新当前报告
        conversation.current_report = report
        conversation.updated_at = datetime.now().isoformat()
        self.save_to_file()  # 自动保存
        return True
    
    def save_search_results(self, conversation_id: str, results: List[Dict]) -> bool:
        """保存搜索结果到会话"""
        conversation = self.get_conversation(conversation_id)
        if not conversation:
            return False
        
        conversation.search_results = results
        return True
    
    def get_context_for_llm(self, conversation_id: str, max_tokens: int = 4000) -> Dict:
        """获取用于LLM的上下文信息"""
        conversation = self.get_conversation(conversation_id)
        if not conversation:
            return {}
        
        # 构建上下文
        context = {
            "conversation_id": conversation_id,
            "current_report": conversation.current_report,
            "search_results": conversation.search_results,
            "message_history": []
        }
        
        # 添加消息历史（最近10条）
        recent_messages = conversation.messages[-10:] if len(conversation.messages) > 10 else conversation.messages
        for msg in recent_messages:
            context["message_history"].append({
                "role": msg.role,
                "content": msg.content,
                "type": msg.type
            })
        
        return context
    
    def list_conversations(self) -> List[Dict]:
        """列出所有会话（用于前端展示列表）"""
        return [
            {
                "id": conv.id,
                "title": conv.title,
                "created_at": conv.created_at,
                "updated_at": conv.updated_at,
                "message_count": len(conv.messages)
            }
            for conv in sorted(
                self.conversations.values(), 
                key=lambda x: x.updated_at, 
                reverse=True
            )
        ]
    
    def delete_conversation(self, conversation_id: str) -> bool:
        """删除会话"""
        if conversation_id in self.conversations:
            del self.conversations[conversation_id]
            self.save_to_file()  # 自动保存
            return True
        return False
    
    def update_conversation(self, conversation_id: str, updates: Dict) -> bool:
        """更新会话属性（v5.0 新增）"""
        conversation = self.get_conversation(conversation_id)
        if not conversation:
            return False
        
        # 更新会话的元数据字段
        if not hasattr(conversation, 'metadata'):
            conversation.metadata = {}
        
        # 将更新保存到metadata中
        for key, value in updates.items():
            conversation.metadata[key] = value
        
        conversation.updated_at = datetime.now().isoformat()
        self.save_to_file()  # 自动保存
        return True
    
    def to_dict(self) -> Dict:
        """导出所有会话为字典（用于序列化）"""
        return {
            conv_id: conv.model_dump()
            for conv_id, conv in self.conversations.items()
        }
    
    def load_from_dict(self, data: Dict):
        """从字典加载会话（用于反序列化）"""
        self.conversations = {}
        for conv_id, conv_data in data.items():
            try:
                self.conversations[conv_id] = Conversation(**conv_data)
            except Exception as e:
                print(f"加载会话 {conv_id} 失败: {e}")

    def save_to_file(self):
        """保存所有会话到文件"""
        try:
            data = self.to_dict()
            with open(self.storage_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"保存会话到文件失败: {e}")
            return False

    def load_from_file(self):
        """从文件加载所有会话"""
        if not os.path.exists(self.storage_file):
            return
        try:
            with open(self.storage_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self.load_from_dict(data)
            print(f"从文件加载了 {len(self.conversations)} 个会话")
        except Exception as e:
            print(f"从文件加载会话失败: {e}")


# 全局对话管理器实例
conversation_manager = ConversationManager()
