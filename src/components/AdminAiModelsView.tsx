import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AiModelsHeader,
  AiModelsFailoverBanner,
  AiModelsStatBar,
  AiModelList,
  AiModelFormModal,
  useAdminAiModels,
} from './admin-ai-models';

export const AdminAiModelsView: React.FC = () => {
  const {
    models,
    loading,
    error,
    testing,
    testResults,
    acting,
    formOpen,
    editing,
    form,
    refresh,
    toggleEnabled,
    move,
    handleTest,
    openForm,
    closeForm,
    handleSave,
    toggleCap,
    setFormField,
    totalCount,
    enabledCount,
    healthyCount,
    unhealthyCount,
    unknownCount,
  } = useAdminAiModels();

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto">
      {/* 页头 */}
      <AiModelsHeader
        loading={loading}
        onRefresh={refresh}
        onAddNew={() => openForm()}
      />

      {/* 路由与降级机制流程示意 */}
      <AiModelsFailoverBanner />

      {/* 统计摘要行 */}
      <AiModelsStatBar
        totalCount={totalCount}
        enabledCount={enabledCount}
        healthyCount={healthyCount}
        unhealthyCount={unhealthyCount}
        unknownCount={unknownCount}
      />

      {error && (
        <p className="mb-3 text-xs text-rose-600 flex items-center">
          <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" />
          {error}
        </p>
      )}

      {/* 模型卡片列表（按降级优先级排序） */}
      <AiModelList
        models={models}
        loading={loading}
        testing={testing}
        acting={acting}
        testResults={testResults}
        onMove={move}
        onTest={handleTest}
        onToggleEnabled={toggleEnabled}
        onEdit={openForm}
        onAddNew={() => openForm()}
      />

      {/* 新增/编辑表单弹层 */}
      <AiModelFormModal
        isOpen={formOpen}
        editing={editing}
        form={form}
        acting={acting}
        onClose={closeForm}
        onSave={handleSave}
        onChangeField={setFormField}
        onToggleCap={toggleCap}
      />
    </div>
  );
};
