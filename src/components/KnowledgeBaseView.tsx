import React from 'react';
import { KnowledgeArticle, UserProfile } from '../types';
import { useKnowledgeBase } from './knowledge/useKnowledgeBase';
import { KnowledgeHeader } from './knowledge/KnowledgeHeader';
import { KnowledgeReviewQueue } from './knowledge/KnowledgeReviewQueue';
import { KnowledgeGraphSection } from './knowledge/KnowledgeGraphSection';
import { KnowledgeSearchBar } from './knowledge/KnowledgeSearchBar';
import { KnowledgeRagResultCard } from './knowledge/KnowledgeRagResultCard';
import { KnowledgeArticleGrid } from './knowledge/KnowledgeArticleGrid';
import { KnowledgeDetailModal } from './knowledge/KnowledgeDetailModal';
import { KnowledgeCreateModal } from './knowledge/KnowledgeCreateModal';
import { KnowledgeUploadModal } from './knowledge/KnowledgeUploadModal';

export interface KnowledgeBaseViewProps {
  currentUser: UserProfile;
  articles: KnowledgeArticle[];
  onAddArticle: (art: KnowledgeArticle) => void;
  onAskAiWithContext: (query: string, contextArticle: KnowledgeArticle) => void;
}

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  currentUser,
  articles,
  onAddArticle,
  onAskAiWithContext,
}) => {
  const kb = useKnowledgeBase({ currentUser, articles, onAddArticle });

  return (
    <div className="space-y-6 pb-12">
      <KnowledgeHeader
        isEditorOrArchivist={kb.isEditorOrArchivist}
        managementTab={kb.managementTab}
        onTabChange={kb.setManagementTab}
        onOpenUploadModal={() => kb.setShowUploadModal(true)}
        onOpenAddModal={() => kb.setShowAddModal(true)}
      />

      {kb.managementTab === 'review' && kb.isEditorOrArchivist && (
        <KnowledgeReviewQueue
          reviewItems={kb.reviewItems}
          onRefresh={kb.loadReview}
          onApprove={kb.handleApproveReview}
          onReject={kb.handleRejectReview}
        />
      )}

      {kb.managementTab === 'graph' && (
        <KnowledgeGraphSection
          isEditorOrArchivist={kb.isEditorOrArchivist}
          graphData={kb.graphData}
          graphMessage={kb.graphMessage}
          onExtractGraph={kb.handleExtractGraph}
          onSelectArticle={kb.setActiveArticle}
        />
      )}

      {kb.managementTab === 'knowledge' && (
        <>
          <KnowledgeSearchBar
            searchQuery={kb.searchQuery}
            onSearchQueryChange={kb.setSearchQuery}
            selectedCategory={kb.selectedCategory}
            onSelectCategory={kb.setSelectedCategory}
            searchImageBase64={kb.searchImageBase64}
            searchImageName={kb.searchImageName}
            searchImageInputRef={kb.searchImageInputRef}
            onImageSelected={kb.handleImageSelected}
            onClearSearchImage={kb.clearSearchImage}
            isRagSearching={kb.isRagSearching}
            onRagSearch={kb.handleRagSearch}
            onClearSearch={() => {
              kb.setSearchQuery('');
              kb.setRagAnswer(null);
            }}
          />

          {kb.ragAnswer && (
            <KnowledgeRagResultCard
              ragAnswer={kb.ragAnswer}
              articles={articles}
              onClose={() => kb.setRagAnswer(null)}
              onSelectArticle={kb.setActiveArticle}
            />
          )}

          <KnowledgeArticleGrid
            articles={kb.filteredArticles}
            onSelectArticle={kb.setActiveArticle}
          />
        </>
      )}

      <KnowledgeDetailModal
        article={kb.activeArticle}
        onClose={() => kb.setActiveArticle(null)}
        onAskAiWithContext={onAskAiWithContext}
      />

      <KnowledgeCreateModal
        isOpen={kb.showAddModal}
        onClose={() => kb.setShowAddModal(false)}
        form={kb.newArticleForm}
        onChangeForm={kb.setNewArticleForm}
        onSubmit={kb.handleCreateArticle}
        isSubmitting={kb.isCreatingArticle}
        errorMessage={kb.createArticleError}
      />

      <KnowledgeUploadModal
        isOpen={kb.showUploadModal}
        onClose={() => {
          kb.setShowUploadModal(false);
          kb.setUploadSuccessMsg(null);
        }}
        fileInputRef={kb.fileInputRef}
        uploadFile={kb.uploadFile}
        onSelectFile={kb.setUploadFile}
        uploadCategory={kb.uploadCategory}
        onCategoryChange={kb.setUploadCategory}
        uploadTargetEquipment={kb.uploadTargetEquipment}
        onTargetEquipmentChange={kb.setUploadTargetEquipment}
        uploadTags={kb.uploadTags}
        onTagsChange={kb.setUploadTags}
        isUploading={kb.isUploading}
        uploadSuccessMsg={kb.uploadSuccessMsg}
        onSubmit={kb.handleFileUploadAndChunking}
      />
    </div>
  );
};
