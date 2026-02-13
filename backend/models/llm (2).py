from openai import OpenAI
from backend.config import settings


class DeepSeekClient:
    def __init__(self):
        self.client = OpenAI(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url
        )

    def chat_completion(self, messages: list, model: str = "deepseek-chat", **kwargs) -> str:
        response = self.client.chat.completions.create(
            model=model,
            messages=messages,
            **kwargs
        )
        return response.choices[0].message.content


deepseek_client = DeepSeekClient()
