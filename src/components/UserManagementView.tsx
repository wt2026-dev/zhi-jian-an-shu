import React from 'react';
import { UserProfile } from '../types';
import {
  ROLES_LIST,
  PERMISSIONS_MATRIX,
  UserManagementHeader,
  RoleCardsGrid,
  RbacMatrixTable,
  UserDirectoryTable,
  AddUserModal,
  useUserManagement,
} from './user-management';

interface UserManagementViewProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  onAddUser: (user: UserProfile) => void;
  onSwitchUser: (user: UserProfile) => void;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  currentUser,
  allUsers,
  onAddUser,
  onSwitchUser,
}) => {
  const {
    searchQuery,
    setSearchQuery,
    selectedRoleFilter,
    setSelectedRoleFilter,
    showAddModal,
    newUserForm,
    isCreatingUser,
    createUserError,
    statusUpdatingId,
    displayUsers,
    filteredUsers,
    handleToggleUserStatus,
    handleCreateUser,
    updateFormField,
    openAddModal,
    closeAddModal,
  } = useUserManagement(allUsers);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <UserManagementHeader
        canAddUser={currentUser.role === 'admin'}
        onOpenAddModal={openAddModal}
      />

      {/* Role Cards Definition */}
      <RoleCardsGrid
        currentUser={currentUser}
        allUsers={displayUsers}
        rolesList={ROLES_LIST}
        onSwitchUser={onSwitchUser}
      />

      {/* RBAC Permission Matrix Table */}
      <RbacMatrixTable matrix={PERMISSIONS_MATRIX} />

      {/* User Accounts Directory */}
      <UserDirectoryTable
        currentUser={currentUser}
        users={filteredUsers}
        totalCount={displayUsers.length}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedRoleFilter={selectedRoleFilter}
        onRoleFilterChange={setSelectedRoleFilter}
        statusUpdatingId={statusUpdatingId}
        onToggleUserStatus={handleToggleUserStatus}
        onSwitchUser={onSwitchUser}
      />

      {/* Modal: Add User */}
      <AddUserModal
        isOpen={showAddModal}
        form={newUserForm}
        isSubmitting={isCreatingUser}
        error={createUserError}
        onClose={closeAddModal}
        onSubmit={(e) => void handleCreateUser(e, onAddUser)}
        onChangeField={updateFormField}
      />
    </div>
  );
};
