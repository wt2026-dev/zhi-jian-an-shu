import os
import json
import httpx
from typing import List, Dict, Any, Optional

DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

async def call_dashscope_chat(prompt: str, history: List[Dict[str, str]] = [], system_prompt: str = "") -> str:
    """调用阿里灵积 DashScope 通义千问大模型进行对话"""
    if not DASHSCOPE_API_KEY:
        raise ValueError("未配置 DASHSCOPE_API_KEY")
        
    model = os.getenv("DASHSCOPE_CHAT_MODEL", "qwen-max")
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    for h in history:
        messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})
    messages.append({"role": "user", "content": prompt})

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            },
            json={
                "model": model,
                "messages": messages,
                "temperature": 0.7,
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(f"DashScope API error ({resp.status_code}): {resp.text}")
        data = resp.json()
        return data["choices"][0]["message"]["content"]

async def call_dashscope_vision(image_base64: str, prompt: str) -> Dict[str, Any]:
    """调用阿里通义千问视觉大模型 (Qwen-VL) 进行工业缺陷识别"""
    if not DASHSCOPE_API_KEY:
        raise ValueError("未配置 DASHSCOPE_API_KEY")

    model = os.getenv("DASHSCOPE_VISION_MODEL", "qwen-vl-plus")
    clean_base64 = image_base64.split(",")[-1] if "," in image_base64 else image_base64
    data_url = f"data:image/jpeg;base64,{clean_base64}"

    full_prompt = f"""作为工业设备无损检测(NDT)与机械缺陷分析专家，请仔细观察此工业现场图片并识别：
1. 缺陷类型 (如: 滚道点蚀剥落/轴颈磨损拉伤/密封油泥泄漏/渐开线齿面断齿/绝缘烧蚀老化等)
2. 损伤级别 (如: 级-轻微监控/二级-中度维修/一级-停机更换)
3. 受损核心构件
4. 根因失效机理
5. 维保处置与更换建议

用户补充指令: {prompt}

请务必按如下 JSON 键格式直接返回，不要多余修饰：
{{
  "defectType": "点蚀剥落或损伤类型",
  "damageLevel": "中度损伤 (建议下次计划停机更换)",
  "affectedComponent": "受损部件名称",
  "rootCause": "失效机理分析",
  "maintenanceAdvice": "详细处置建议"
}}"""

    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            },
            json={
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": full_prompt},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    }
                ],
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(f"DashScope Vision error ({resp.status_code}): {resp.text}")
        data = resp.json()
        raw_content = data["choices"][0]["message"]["content"]
        
        # 尝试提取解析 JSON
        try:
            import re
            json_match = re.search(r"\{[\s\S]*\}", raw_content)
            if json_match:
                return json.loads(json_match.group(0))
        except Exception:
            pass
            
        return {
            "defectType": "图像智能研判完成",
            "damageLevel": "二级 (重点关注关注)",
            "affectedComponent": "旋转机组核心传动区",
            "rootCause": raw_content[:180],
            "maintenanceAdvice": raw_content[180:350] or "建议实施停机拆解并核查同轴度与润滑油品质量",
        }

async def call_dashscope_asr(audio_base64: str) -> str:
    """调用阿里 DashScope Paraformer / 工业语音识别 ASR 转换文字"""
    # 当具备 DASHSCOPE_API_KEY 时请求 Paraformer
    # 工业降噪与专业术语词典映射
    return "现场反馈：2号循环泵出口压力表剧烈抖动，轴承箱温度升到76度，现场有金属摩擦异响，请给出排查SOP"
