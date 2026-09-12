import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.api.deps import get_db, get_current_user
from backend.app.models.models import KnowledgeArticleModel, KnowledgeChunkModel, UserModel
from backend.app.services.rag_service import chunk_document_text, rag_vector_store

router = APIRouter(prefix="/knowledge", tags=["RAG检修知识库与向量检索"])

class CreateArticleRequest(BaseModel):
    title: str
    category: str = "检修SOP规程"
    targetEquipment: Optional[str] = "通用设备"
    tags: List[str] = []
    summary: str
    content: str
    chunkSize: Optional[int] = 500
    chunkOverlap: Optional[int] = 50

class RagSearchRequest(BaseModel):
    query: str
    limit: Optional[int] = 4

def _map_article(a: KnowledgeArticleModel) -> dict:
    return {
        "id": a.id,
        "title": a.title,
        "category": a.category,
        "targetEquipment": a.target_equipment,
        "tags": a.tags or [],
        "summary": a.summary,
        "content": a.content,
        "author": a.author,
        "updatedAt": a.updated_at,
        "viewCount": a.view_count,
        "likes": a.likes,
        "fileType": a.file_type,
        "chunksCount": a.chunks_count,
    }

@router.get("", summary="获取知识库文档列表")
async def list_knowledge(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    query = select(KnowledgeArticleModel).order_by(KnowledgeArticleModel.created_at.desc())
    if category and category != "all":
        query = query.where(KnowledgeArticleModel.category == category)
    result = await db.execute(query)
    articles = result.scalars().all()
    
    if search:
        s = search.lower()
        articles = [
            a for a in articles 
            if s in a.title.lower() or s in a.summary.lower() or s in a.target_equipment.lower()
        ]
        
    return [_map_article(a) for a in articles]

@router.post("", summary="手动录入规程文档并自动分块向量化")
async def create_knowledge_article(
    req: CreateArticleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    art_id = f"kb-{uuid.uuid4().hex[:10]}"
    chunks = chunk_document_text(req.content, req.chunkSize or 500, req.chunkOverlap or 50)
    
    article = KnowledgeArticleModel(
        id=art_id,
        title=req.title,
        category=req.category,
        target_equipment=req.targetEquipment or "通用设备",
        tags=req.tags,
        summary=req.summary,
        content=req.content,
        author=f"{current_user.name} ({current_user.role_title})",
        updated_at=datetime.now().strftime("%Y-%m-%d"),
        view_count=1,
        likes=0,
        file_type="manual",
        chunks_count=len(chunks),
    )
    db.add(article)
    
    # 保存切片分块
    for idx, text in enumerate(chunks):
        chunk_model = KnowledgeChunkModel(
            id=f"{art_id}_chunk_{idx}",
            article_id=art_id,
            chunk_index=idx,
            text=text,
            char_length=len(text),
            metadata_json={"title": req.title, "category": req.category, "author": current_user.name},
        )
        db.add(chunk_model)
        
    await db.commit()
    await db.refresh(article)
    
    # 写入向量存储引擎
    rag_vector_store.add_chunks(art_id, req.title, req.category, chunks)
    return _map_article(article)

@router.post("/upload", summary="上传规程文件 (PDF/Word/TXT/MD) 并全链路解析、分块与向量化入库")
async def upload_document(
    file: UploadFile = File(...),
    category: str = Form("检修SOP规程"),
    targetEquipment: str = Form("通用设备"),
    tags: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """支持 PDF、Word (.docx)、Markdown、纯文本上传并切片入库"""
    filename = file.filename or "未命名文档.txt"
    content_bytes = await file.read()
    text_content = ""
    file_type = "txt"

    if filename.endswith(".pdf"):
        file_type = "pdf"
        try:
            from pypdf import PdfReader
            import io
            reader = PdfReader(io.BytesIO(content_bytes))
            text_content = "\n".join([page.extract_text() or "" for page in reader.pages])
        except Exception as e:
            text_content = content_bytes.decode("utf-8", errors="ignore")
    elif filename.endswith(".docx"):
        file_type = "docx"
        try:
            import docx
            import io
            doc = docx.Document(io.BytesIO(content_bytes))
            text_content = "\n".join([p.text for p in doc.paragraphs if p.text.strip()])
        except Exception as e:
            text_content = content_bytes.decode("utf-8", errors="ignore")
    else:
        file_type = "txt" if not filename.endswith(".md") else "md"
        text_content = content_bytes.decode("utf-8", errors="ignore")

    if not text_content.strip():
        raise HTTPException(status_code=400, detail="未能解析出文档有效文本，请确认文件格式无损")

    art_id = f"kb-{uuid.uuid4().hex[:10]}"
    doc_title = filename.rsplit(".", 1)[0]
    chunks = chunk_document_text(text_content, 500, 50)
    summary_text = text_content.strip()[:180] + ("..." if len(text_content) > 180 else "")

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else ["导入文档", file_type.upper()]

    article = KnowledgeArticleModel(
        id=art_id,
        title=doc_title,
        category=category,
        target_equipment=targetEquipment,
        tags=tag_list,
        summary=summary_text,
        content=text_content,
        author=f"{current_user.name} ({current_user.role_title})",
        updated_at=datetime.now().strftime("%Y-%m-%d"),
        view_count=1,
        likes=0,
        file_type=file_type,
        chunks_count=len(chunks),
    )
    db.add(article)

    for idx, c_text in enumerate(chunks):
        chunk_model = KnowledgeChunkModel(
            id=f"{art_id}_chunk_{idx}",
            article_id=art_id,
            chunk_index=idx,
            text=c_text,
            char_length=len(c_text),
            metadata_json={"title": doc_title, "category": category, "filename": filename},
        )
        db.add(chunk_model)

    await db.commit()
    await db.refresh(article)

    # 向量化注入 Chroma 向量库
    rag_vector_store.add_chunks(art_id, doc_title, category, chunks)
    return {
        "success": True,
        "message": f"文档【{filename}】解析入库成功，已切分 {len(chunks)} 个高维向量切片并注入 Chroma 知识库",
        "article": _map_article(article),
        "chunksCount": len(chunks),
    }

@router.post("/search", summary="RAG 知识库向量语义检索 (召回 Top-K 相关切片)")
async def rag_semantic_search(
    req: RagSearchRequest,
    current_user: UserModel = Depends(get_current_user),
):
    results = rag_vector_store.search_similar(req.query, top_k=req.limit or 4)
    return {
        "success": True,
        "query": req.query,
        "matchedCount": len(results),
        "results": results,
    }
