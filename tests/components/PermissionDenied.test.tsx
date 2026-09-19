// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { PermissionDenied } from '../../src/components/PermissionDenied';
import { FORBIDDEN_HINT } from '../../src/utils/rbac';

describe('PermissionDenied（无权限友好提示，不白屏）', () => {
  it('显示统一提示语，而不是空白页或堆栈', () => {
    render(<PermissionDenied tabId="users" role="technician" userName="张建国" />);
    expect(screen.getByTestId('permission-denied')).toBeTruthy();
    expect(screen.getByText(FORBIDDEN_HINT)).toBeTruthy();
    // 说清楚"哪一页"和"谁能看"，让提示可操作
    expect(screen.getByText('用户与权限')).toBeTruthy();
    expect(screen.getByText(/仅/)).toBeTruthy();
  });

  it("'user' 角色按操作工展示", () => {
    render(<PermissionDenied tabId="cockpit" role="user" userName="周大伟" />);
    expect(screen.getAllByText(/操作工/).length).toBeGreaterThan(0);
    // 数据驾驶舱的可见角色是总工/车间主管，提示里要说清楚
    expect(screen.getAllByText(/总工/).length).toBeGreaterThan(0);
  });

  it('未登记的 tab 也不会崩（回退成显示 tabId）', () => {
    render(<PermissionDenied tabId="some_page" role="operator" />);
    expect(screen.getByText('some_page')).toBeTruthy();
  });

  it('点击"返回我的首页"按角色跳回对应首页', () => {
    const onBack = vi.fn();
    render(<PermissionDenied tabId="users" role="technician" onBackHome={onBack} />);
    const btn = screen.getByTestId('btn-permission-back-home');
    btn.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
