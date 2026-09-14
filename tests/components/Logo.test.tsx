// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Logo } from "../../src/components/Logo";

describe("Logo 组件", () => {
  it("默认渲染 (md 尺寸)", () => {
    const { container } = render(<Logo />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.style.width).toBe("40px");
    expect(el.style.height).toBe("40px");
  });

  it("sm 尺寸渲染 32px", () => {
    const { container } = render(<Logo size="sm" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("32px");
  });

  it("lg 尺寸渲染 48px", () => {
    const { container } = render(<Logo size="lg" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("48px");
  });

  it("自定义 className 传递", () => {
    const { container } = render(<Logo className="custom-class" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("custom-class");
  });

  it("包含 SVG 图标", () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });
});
