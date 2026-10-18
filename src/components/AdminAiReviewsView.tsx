import React from 'react';
import { XCircle } from 'lucide-react';
import { useAdminAiReviews } from './admin-reviews/useAdminAiReviews';
import { AdminReviewsHeader } from './admin-reviews/AdminReviewsHeader';
import { AdminReviewsStatCards } from './admin-reviews/AdminReviewsStatCards';
import { AdminReviewsProcessFlow } from './admin-reviews/AdminReviewsProcessFlow';
import { AdminReviewsTraceControlBar } from './admin-reviews/AdminReviewsTraceControlBar';
import { AdminReviewsList } from './admin-reviews/AdminReviewsList';
import { AdminReviewsTraceList } from './admin-reviews/AdminReviewsTraceList';
import { AdminReviewDetailDrawer } from './admin-reviews/AdminReviewDetailDrawer';
import { AdminTraceDetailDrawer } from './admin-reviews/AdminTraceDetailDrawer';

export interface AdminAiReviewsViewProps {
  onNavigate?: (tab: string) => void;
}

export const AdminAiReviewsView: React.FC<AdminAiReviewsViewProps> = ({ onNavigate }) => {
  const ar = useAdminAiReviews();

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto">
      <AdminReviewsHeader
        mainTab={ar.mainTab}
        onMainTabChange={ar.setMainTab}
        pendingCount={ar.counts.pending}
        statusFilter={ar.statusFilter}
        onStatusFilterChange={ar.setStatusFilter}
      />

      {ar.mainTab === 'reviews' ? (
        <>
          <AdminReviewsStatCards
            statusFilter={ar.statusFilter}
            onStatusFilterChange={ar.setStatusFilter}
            counts={ar.counts}
          />
          <AdminReviewsProcessFlow />
        </>
      ) : (
        <AdminReviewsTraceControlBar
          modelFilter={ar.modelFilter}
          onModelFilterChange={ar.setModelFilter}
          onRefresh={() => ar.fetchTraceLogs(ar.modelFilter)}
        />
      )}

      {ar.error && (
        <p className="mb-3 text-xs text-rose-600 flex items-center">
          <XCircle className="w-3.5 h-3.5 mr-1" />
          {ar.error}
        </p>
      )}

      {ar.mainTab === 'reviews' ? (
        <AdminReviewsList
          loading={ar.loading}
          reviews={ar.reviews}
          statusFilter={ar.statusFilter}
          pendingCount={ar.counts.pending}
          acting={ar.acting}
          onSelectReview={ar.setDetail}
          onApprove={ar.handleApprove}
          onOpenReject={(r) => {
            ar.setDetail(r);
            ar.setRejectOpen(true);
          }}
          onNavigate={onNavigate}
        />
      ) : (
        <AdminReviewsTraceList
          loading={ar.traceLoading}
          traceLogs={ar.traceLogs}
          onSelectTrace={ar.setTraceDetail}
        />
      )}

      <AdminReviewDetailDrawer
        detail={ar.detail}
        onClose={() => {
          ar.setDetail(null);
          ar.setRejectOpen(false);
        }}
        rejectOpen={ar.rejectOpen}
        onOpenReject={() => ar.setRejectOpen(true)}
        rejectNote={ar.rejectNote}
        onRejectNoteChange={ar.setRejectNote}
        acting={ar.acting}
        onApprove={ar.handleApprove}
        onReject={ar.handleReject}
      />

      <AdminTraceDetailDrawer
        traceDetail={ar.traceDetail}
        onClose={() => ar.setTraceDetail(null)}
      />
    </div>
  );
};
