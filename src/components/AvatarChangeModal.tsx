import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Check, Link, Loader2, Sparkles, User, RefreshCw } from 'lucide-react';
import { UserProfile } from '../types';
import { UserAvatar, BUILTIN_AVATAR_STYLES, BUILTIN_ROLE_PHOTOS } from './UserAvatar';
import { authApi } from '../api';

interface AvatarChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onAvatarUpdated: (newAvatarUrl: string) => void;
}

export const AvatarChangeModal: React.FC<AvatarChangeModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onAvatarUpdated,
}) => {
  const [selectedPhotoId, setSelectedPhotoId] = useState<string>('');
  const [selectedBuiltinId, setSelectedBuiltinId] = useState<string>('');
  const [styleTab, setStyleTab] = useState<'photos' | 'vectors'>('photos');
  const [customUrl, setCustomUrl] = useState<string>('');
  const [uploadedBase64, setUploadedBase64] = useState<string>('');
  const [previewAvatar, setPreviewAvatar] = useState<string>(currentUser.avatar || '');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectPhoto = (photo: typeof BUILTIN_ROLE_PHOTOS[0]) => {
    setSelectedPhotoId(photo.id);
    setSelectedBuiltinId('');
    setCustomUrl('');
    setUploadedBase64('');
    setPreviewAvatar(photo.photoUrl);
    setErrorMsg(null);
  };

  const handleSelectBuiltin = (style: typeof BUILTIN_AVATAR_STYLES[0]) => {
    setSelectedBuiltinId(style.id);
    setSelectedPhotoId('');
    setCustomUrl('');
    setUploadedBase64('');
    setPreviewAvatar(style.svgDataUri);
    setErrorMsg(null);
  };

  const handleCustomUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomUrl(val);
    setSelectedBuiltinId('');
    setUploadedBase64('');
    setPreviewAvatar(val);
    setErrorMsg(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('图片大小不得超过 5MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setUploadedBase64(result);
      setSelectedBuiltinId('');
      setCustomUrl('');
      setPreviewAvatar(result);
      setErrorMsg(null);
    };
    reader.onerror = () => {
      setErrorMsg('读取文件失败，请重试');
    };
    reader.readAsDataURL(file);
  };

  const handleResetToDefaultInitial = async () => {
    setIsSaving(true);
    setErrorMsg(null);
    try {
      // 保存为空头像走姓名首字兜底
      await authApi.updateAvatar({ avatarUrl: '' });
      onAvatarUpdated('');
      setSuccessMsg('已恢复为纯净姓名首字头像！');
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || '恢复默认头像失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      let payload: { imageBase64?: string; avatarUrl?: string } = {};

      if (uploadedBase64) {
        payload = { imageBase64: uploadedBase64 };
      } else if (selectedPhotoId) {
        const found = BUILTIN_ROLE_PHOTOS.find((p) => p.id === selectedPhotoId);
        payload = { avatarUrl: found?.photoUrl || previewAvatar };
      } else if (selectedBuiltinId) {
        const found = BUILTIN_AVATAR_STYLES.find((s) => s.id === selectedBuiltinId);
        payload = { avatarUrl: found?.svgDataUri || previewAvatar };
      } else if (customUrl.trim()) {
        payload = { avatarUrl: customUrl.trim() };
      } else if (previewAvatar) {
        payload = { avatarUrl: previewAvatar };
      } else {
        payload = { avatarUrl: '' };
      }

      const res = await authApi.updateAvatar(payload);
      const newUrl = res.url || res.avatarUrl || previewAvatar;
      onAvatarUpdated(newUrl);
      setSuccessMsg('头像更新成功，全站已即时同步！');
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || '头像更新失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl space-y-4 text-slate-800 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150 scrollbar-thin">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">更换运维个人头像</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">提供专属工业角色矢量风格，亦支持自定义图片</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Preview */}
        <div className="p-3.5 bg-slate-50/80 border border-slate-200/80 rounded-xl flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="relative">
              <UserAvatar
                user={{ ...currentUser, avatar: previewAvatar }}
                size={48}
                showBorder
                className="shadow-sm"
              />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <span>{currentUser.name}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200 font-mono">
                  {currentUser.roleTitle || currentUser.role}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {previewAvatar ? '实时头像预览' : '当前生效：姓名首字 + 角色色渐变头像'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleResetToDefaultInitial}
            disabled={isSaving}
            className="text-xs text-slate-600 hover:text-blue-600 bg-white hover:bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 transition-colors flex items-center gap-1 cursor-pointer"
            title="清空自定义头像，恢复使用纯净姓名首字头像"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>首字兜底</span>
          </button>
        </div>

        {/* Style Category Tabs */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center space-x-1.5 p-1 bg-slate-100/80 rounded-lg border border-slate-200/60">
              <button
                type="button"
                onClick={() => setStyleTab('photos')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                  styleTab === 'photos'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>官方职业照片 (推荐)</span>
              </button>
              <button
                type="button"
                onClick={() => setStyleTab('vectors')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                  styleTab === 'vectors'
                    ? 'bg-white text-cyan-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>工业科技矢量</span>
              </button>
            </div>
            <span className="text-[11px] text-slate-500">共 6 类岗位标杆</span>
          </div>

          {styleTab === 'photos' ? (
            /* 12 Built-in Role Photos: 分组展示第一套与第二套 */
            <div className="space-y-3">
              {/* 第一套 */}
              <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200/60 space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    <span>第一套：标准岗风经典照 (6类标杆岗位)</span>
                  </span>
                  <span className="text-[10px] text-slate-500">标准款 · 清爽正面</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {BUILTIN_ROLE_PHOTOS.filter((p) => p.series === 'set1').map((photo) => {
                    const isSelected = selectedPhotoId === photo.id || previewAvatar === photo.photoUrl;
                    return (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => handleSelectPhoto(photo)}
                        className={`p-2 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                          isSelected
                            ? 'bg-blue-50/80 border-blue-500 shadow-xs ring-2 ring-blue-500/20'
                            : 'bg-white hover:bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="relative">
                          <img
                            src={photo.photoUrl}
                            alt={photo.name}
                            className="w-12 h-12 rounded-full object-cover shadow-xs ring-1 ring-black/5"
                          />
                          {isSelected && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] shadow-xs">
                              <Check className="w-2.5 h-2.5" />
                            </span>
                          )}
                        </div>
                        <div className="w-full">
                          <span className={`text-[11px] font-bold block truncate ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                            {photo.name.split('/')[0].trim()}
                          </span>
                          <span className="text-[9px] text-slate-500 block truncate">{photo.roleLabel.split('·')[0]}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 第二套 */}
              <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200/60 space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    <span>第二套：多元变体工作照 (工装 / 现场督导)</span>
                  </span>
                  <span className="text-[10px] text-slate-500">同岗错位区分 · 现场风貌</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {BUILTIN_ROLE_PHOTOS.filter((p) => p.series === 'set2').map((photo) => {
                    const isSelected = selectedPhotoId === photo.id || previewAvatar === photo.photoUrl;
                    return (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => handleSelectPhoto(photo)}
                        className={`p-2 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                          isSelected
                            ? 'bg-blue-50/80 border-blue-500 shadow-xs ring-2 ring-blue-500/20'
                            : 'bg-white hover:bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="relative">
                          <img
                            src={photo.photoUrl}
                            alt={photo.name}
                            className="w-12 h-12 rounded-full object-cover shadow-xs ring-1 ring-black/5"
                          />
                          {isSelected && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] shadow-xs">
                              <Check className="w-2.5 h-2.5" />
                            </span>
                          )}
                        </div>
                        <div className="w-full">
                          <span className={`text-[11px] font-bold block truncate ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                            {photo.name.split('/')[0].trim()}
                          </span>
                          <span className="text-[9px] text-slate-500 block truncate">{photo.roleLabel.split('·')[0]}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* 第三套：扩池变体（technician 专属岗 + 多人岗位补充款） */}
              <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200/60 space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>第三套：扩池变体照 (技师专岗 / 多人岗位补充)</span>
                  </span>
                  <span className="text-[10px] text-slate-500">同岗多人 · 面孔互斥</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {BUILTIN_ROLE_PHOTOS.filter((p) => p.series === 'set3').map((photo) => {
                    const isSelected = selectedPhotoId === photo.id || previewAvatar === photo.photoUrl;
                    return (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => handleSelectPhoto(photo)}
                        className={`p-2 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                          isSelected
                            ? 'bg-blue-50/80 border-blue-500 shadow-xs ring-2 ring-blue-500/20'
                            : 'bg-white hover:bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="relative">
                          <img
                            src={photo.photoUrl}
                            alt={photo.name}
                            className="w-12 h-12 rounded-full object-cover shadow-xs ring-1 ring-black/5"
                          />
                          {isSelected && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] shadow-xs">
                              <Check className="w-2.5 h-2.5" />
                            </span>
                          )}
                        </div>
                        <div className="w-full">
                          <span className={`text-[11px] font-bold block truncate ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                            {photo.name.split('/')[0].trim()}
                          </span>
                          <span className="text-[9px] text-slate-500 block truncate">{photo.roleLabel.split('·')[0]}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* 6 Built-in Vector Styles */
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {BUILTIN_AVATAR_STYLES.map((style) => {
                const isSelected = selectedBuiltinId === style.id || previewAvatar === style.svgDataUri;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => handleSelectBuiltin(style)}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                      isSelected
                        ? 'bg-cyan-50/80 border-cyan-500 shadow-xs ring-2 ring-cyan-500/20'
                        : 'bg-white hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="relative">
                      <img
                        src={style.svgDataUri}
                        alt={style.name}
                        className="w-12 h-12 rounded-full shadow-xs"
                      />
                      {isSelected && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-cyan-600 text-white rounded-full flex items-center justify-center text-[10px] shadow-xs">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <div className="w-full">
                      <span className={`text-[10px] font-bold block truncate ${isSelected ? 'text-cyan-700' : 'text-slate-800'}`}>
                        {style.name}
                      </span>
                      <span className="text-[9px] text-slate-500 block truncate">{style.roleLabel.split(' ')[0]}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Option 2: Upload or URL */}
        <div className="space-y-2.5 pt-1">
          <label className="text-xs font-bold text-slate-700 block flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5 text-blue-600" />
            <span>或者：本地文件上传 / 在线图片链接</span>
          </label>

          <div className="flex gap-2">
            <label className="flex-1 py-2 px-3 border border-dashed border-slate-300 hover:border-blue-400 rounded-lg text-xs text-slate-600 hover:text-blue-600 flex items-center justify-center gap-1.5 cursor-pointer bg-slate-50/50 hover:bg-blue-50/30 transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>选择本地图片 (PNG/JPG/SVG)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <div className="flex-1 relative">
              <Link className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="粘贴图片链接 URL..."
                value={customUrl}
                onChange={handleCustomUrlChange}
                className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Feedback messages */}
        {errorMsg && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs animate-in fade-in">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs animate-in fade-in">
            {successMsg}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-xs cursor-pointer transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 transition-all shadow-xs flex items-center space-x-1.5"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>保存中...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>保存并应用头像</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
