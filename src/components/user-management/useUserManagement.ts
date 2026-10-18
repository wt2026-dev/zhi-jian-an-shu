import { useState, useMemo } from 'react';
import { UserProfile } from '../../types';
import { authApi } from '../../api';
import { useToast } from '../../context/ToastContext';
import {
  INITIAL_USER_FORM,
  NewUserFormState,
  ROLES_LIST,
} from './userManagementTypes';

export function useUserManagement(allUsers: UserProfile[]) {
  const { show: showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUserForm, setNewUserForm] = useState<NewUserFormState>(INITIAL_USER_FORM);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, 'active' | 'disabled'>>({});

  const displayUsers = useMemo(() => {
    return (allUsers || []).map((u) => {
      const overridden = statusOverrides[u.id];
      return overridden ? { ...u, status: overridden } : u;
    });
  }, [allUsers, statusOverrides]);

  const filteredUsers = useMemo(() => {
    const q = (searchQuery || '').toLowerCase().trim();
    return displayUsers.filter((u) => {
      const matchesRole = selectedRoleFilter === 'all' || u.role === selectedRoleFilter;
      const matchesSearch =
        !q ||
        (u.name || '').toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q) ||
        (u.department || '').toLowerCase().includes(q) ||
        (u.roleTitle || '').toLowerCase().includes(q);

      return matchesRole && matchesSearch;
    });
  }, [displayUsers, searchQuery, selectedRoleFilter]);

  const handleToggleUserStatus = async (targetUser: UserProfile) => {
    const nextStatus = targetUser.status === 'disabled' ? 'active' : 'disabled';
    setStatusUpdatingId(targetUser.id);
    try {
      const res = await authApi.updateUserStatus(targetUser.id, nextStatus);
      if (res && res.user) {
        setStatusOverrides((prev) => ({
          ...prev,
          [targetUser.id]: nextStatus,
        }));
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      showToast({ type: 'error', title: '修改用户状态失败', message: err?.message });
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleCreateUser = async (
    e: React.FormEvent,
    onAddUser: (u: UserProfile) => void
  ) => {
    e.preventDefault();
    const roleObj = ROLES_LIST.find((r) => r.role === newUserForm.role);
    setIsCreatingUser(true);
    setCreateUserError(null);
    try {
      const created = await authApi.createUser({
        username: newUserForm.username.trim() || `user_${Date.now().toString().slice(-4)}`,
        name: newUserForm.name.trim(),
        password: 'User@2026#New',
        role: newUserForm.role,
        roleTitle: roleObj?.title || '普通用户',
        department: newUserForm.department.trim(),
        phone: newUserForm.phone.trim(),
        email: newUserForm.email.trim(),
        permissions: ['read', 'create_order'],
      });
      onAddUser(created);
      setShowAddModal(false);
      setNewUserForm(INITIAL_USER_FORM);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setCreateUserError(err?.message || '创建用户失败，请稍后重试');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const updateFormField = <K extends keyof NewUserFormState>(
    field: K,
    value: NewUserFormState[K]
  ) => {
    setNewUserForm((prev) => ({ ...prev, [field]: value }));
  };

  const openAddModal = () => {
    setNewUserForm(INITIAL_USER_FORM);
    setCreateUserError(null);
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
  };

  return {
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
  };
}
