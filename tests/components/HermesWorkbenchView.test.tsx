// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HermesWorkbenchView } from '../../src/components/hermes/HermesWorkbenchView';
import { ToastProvider } from '../../src/context/ToastContext';

describe('HermesWorkbenchView Component', () => {
  afterEach(() => {
    cleanup();
  });

  const renderComponent = () => {
    const onNavigateTab = vi.fn();
    const result = render(
      <ToastProvider>
        <HermesWorkbenchView onNavigateTab={onNavigateTab} />
      </ToastProvider>
    );
    return { ...result, onNavigateTab };
  };

  it('renders business overview card with target goal and equipment details', () => {
    renderComponent();
    expect(screen.getByText(/3号空压机轴承温度高，帮我走检修流程/i)).toBeInTheDocument();
    expect(screen.getByText(/PL-28250618-042/i)).toBeInTheDocument();
    expect(screen.getAllByText(/3#离心式空压机/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/陈主管/i).length).toBeGreaterThan(0);
  });

  it('renders the 6 closed-loop stages in the stepper', () => {
    renderComponent();
    expect(screen.getAllByText('现场报修').length).toBeGreaterThan(0);
    expect(screen.getAllByText('高危作业票').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LOTO能量隔离').length).toBeGreaterThan(0);
    expect(screen.getAllByText('检修执行').length).toBeGreaterThan(0);
    expect(screen.getAllByText('完工').length).toBeGreaterThan(0);
    expect(screen.getAllByText('质检归档').length).toBeGreaterThan(0);
  });

  it('displays LOTO workbench with AI prefilled card and confirmation items', () => {
    renderComponent();
    expect(screen.getByText(/AI 已预填/i)).toBeInTheDocument();
    expect(screen.getAllByText(/QF-03/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/V-301/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0MPa/i).length).toBeGreaterThan(0);
  });

  it('renders bottom sections: artifacts, AI suggestions, and history loops', () => {
    renderComponent();
    expect(screen.getByText(/业务闭环产出物档案/i)).toBeInTheDocument();
    expect(screen.getByText(/AI 智能管家行动建议/i)).toBeInTheDocument();
    expect(screen.getByText(/近期已归档业务闭环/i)).toBeInTheDocument();
  });

  it('switches to goal input hero when clicking new business goal', () => {
    renderComponent();
    const newGoalBtn = screen.getByText('新建业务目标');
    fireEvent.click(newGoalBtn);
    expect(screen.getByText(/生成业务路线图/i)).toBeInTheDocument();

    const returnBtn = screen.getByText('返回当前闭环');
    fireEvent.click(returnBtn);
    expect(screen.getByText(/业务闭环全景路线/i)).toBeInTheDocument();
  });
});
