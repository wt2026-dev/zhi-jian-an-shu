import { useState } from 'react';
import { aiApi } from '../../api';
import { logger } from '../../utils/logger';

interface UseAiVisionOptions {
  diagCategory: string;
  showToast: (toast: { type: 'success' | 'error' | 'warning' | 'info'; title: string; message?: string }) => void;
}

export function useAiVision({ diagCategory, showToast }: UseAiVisionOptions) {
  const [selectedSampleImage, setSelectedSampleImage] = useState<string>('bearing_pitting');
  const [customImageBase64, setCustomImageBase64] = useState<string | null>(null);
  const [customImagePreview, setCustomImagePreview] = useState<string | null>(null);
  const [uploadedImageInfo, setUploadedImageInfo] = useState<{ url: string; filename: string; size: number } | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [visionPrompt, setVisionPrompt] = useState('请分析此轴承滚动体损伤类型、严重程度、失效机理及检修建议');
  const [visionResult, setVisionResult] = useState<Record<string, unknown> | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [isVisionAnalyzing, setIsVisionAnalyzing] = useState(false);
  // 功能④：多模态相似案例检索状态
  const [isSearchingMultimodal, setIsSearchingMultimodal] = useState(false);
  const [multimodalCases, setMultimodalCases] = useState<Array<{
    id: string;
    title: string;
    category: string;
    targetEquipment?: string;
    summary: string;
    content: string;
  }> | null>(null);
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [multimodalVisionDesc, setMultimodalVisionDesc] = useState<string | null>(null);
  const [multimodalSafetyHint, setMultimodalSafetyHint] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingImage(true);
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setCustomImageBase64(base64);
      setCustomImagePreview(dataUrl);

      try {
        const uploadRes = await aiApi.uploadImage(base64, file.name);
        if (uploadRes && uploadRes.success) {
          setUploadedImageInfo({
            url: uploadRes.url,
            filename: uploadRes.filename,
            size: uploadRes.size,
          });
        }
      } catch (err: unknown) {
        logger.warn('Image upload backend error:', err);
        setUploadError((err as Error)?.message || '图片上传至服务器失败');
      } finally {
        setIsUploadingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRunVisionAnalysis = async () => {
    setIsVisionAnalyzing(true);
    setVisionResult(null);
    setVisionError(null);

    try {
      const res = await aiApi.detectVisionDefects({
        imageBase64: customImageBase64 || '',
        imageUrl: uploadedImageInfo?.url,
        promptText: visionPrompt,
        equipmentType: diagCategory,
      });

      if (res && res.defectResult) {
        setVisionResult({
          ...res.defectResult,
          modelEngine: res.modelEngine,
          rawAnalysis: res.rawAnalysis,
        });
      } else {
        throw new Error('未获取到结构化判损分析');
      }
    } catch (e: unknown) {
      setVisionError((e as Error)?.message || '未获取到结构化判损分析');
      setVisionResult(null);
    } finally {
      setIsVisionAnalyzing(false);
    }
  };

  const handleRunMultimodalSearch = async () => {
    if (!customImageBase64 && !customImagePreview) {
      showToast({ type: 'warning', title: '请先上传图片', message: '请先上传或选择待检索的设备现场图片' });
      return;
    }
    setIsSearchingMultimodal(true);
    setMultimodalCases(null);
    try {
      const res = await aiApi.multimodalSearch({
        imageBase64: customImageBase64 || '',
        userText: visionPrompt || (visionResult?.defectType as string) || '',
      });
      if (res.success) {
        setMultimodalVisionDesc(res.visionDescription || null);
        setMultimodalSafetyHint(res.safetyHint || null);
        setMultimodalCases(res.cases || []);
      } else {
        showToast({ type: 'warning', title: '多模态检索未返回有效案例', message: '未找到匹配的相似案例' });
      }
    } catch (e: unknown) {
      showToast({ type: 'error', title: '多模态检索失败', message: (e as Error)?.message || '网络异常' });
    } finally {
      setIsSearchingMultimodal(false);
    }
  };

  return {
    selectedSampleImage,
    setSelectedSampleImage,
    customImageBase64,
    customImagePreview,
    uploadedImageInfo,
    isUploadingImage,
    uploadError,
    visionPrompt,
    setVisionPrompt,
    visionResult,
    visionError,
    isVisionAnalyzing,
    isSearchingMultimodal,
    multimodalCases,
    expandedCaseId,
    setExpandedCaseId,
    multimodalVisionDesc,
    multimodalSafetyHint,
    handleFileUpload,
    handleRunVisionAnalysis,
    handleRunMultimodalSearch,
  };
}
