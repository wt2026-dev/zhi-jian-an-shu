import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ size = 'md', className = '' }) => {
  const dimension = size === 'sm' ? 32 : size === 'lg' ? 48 : 40;
  const iconDim = size === 'sm' ? 18 : size === 'lg' ? 28 : 22;

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-xl bg-white/85 backdrop-blur-md border border-blue-200/70 text-blue-600 shadow-[0_4px_16px_rgba(15,23,42,0.08)] shrink-0 transition-all ${className}`}
      style={{ width: dimension, height: dimension }}
    >
      {/* 蓝青科技微角点缀 */}
      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-cyan-400 opacity-90 shadow-[0_0_4px_rgba(6,182,212,0.6)]" />
      
      {/* 精致线性电路+齿轮+扳手组合矢量 SVG */}
      <svg
        width={iconDim}
        height={iconDim}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-blue-600"
      >
        {/* 背景轻科技信号微弧环 */}
        <path
          d="M3 12C3 7.02944 7.02944 3 12 3C14.5 3 16.7 4 18.3 5.7"
          stroke="#06b6d4"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="2 3"
          opacity="0.85"
        />
        <path
          d="M21 12C21 16.9706 16.9706 21 12 21C9.5 21 7.3 20 5.7 18.3"
          stroke="#3b82f6"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="2 3"
          opacity="0.85"
        />
        {/* 齿轮轮廓线 (纤细精工) */}
        <circle cx="12" cy="12" r="7.5" stroke="#93c5fd" strokeWidth="1.2" opacity="0.6" />
        <path
          d="M12 2.5V4.5M12 19.5V21.5M2.5 12H4.5M19.5 12H21.5M5.3 5.3L6.7 6.7M17.3 17.3L18.7 18.7M5.3 18.7L6.7 17.3M17.3 6.7L18.7 5.3"
          stroke="#60a5fa"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.75"
        />
        {/* 精工线性扳手 (倾斜主视觉，深蓝亮蓝结合) */}
        <path
          d="M14.8 6.5C13.2 4.9 10.6 4.9 9 6.5C8.4 7.1 8.1 7.9 8.1 8.7C8.1 9.3 8.3 9.9 8.6 10.4L5.2 13.8C4.6 14.4 4.6 15.4 5.2 16L7.2 18C7.8 18.6 8.8 18.6 9.4 18L12.8 14.6C13.3 14.9 13.9 15.1 14.5 15.1C15.3 15.1 16.1 14.8 16.7 14.2C18.3 12.6 18.3 10 16.7 8.4L15.2 9.9L13.3 8L14.8 6.5Z"
          stroke="#1d4ed8"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 扳手轴心精密青色测控点 */}
        <circle cx="14" cy="10" r="1.2" fill="#06b6d4" />
      </svg>
    </div>
  );
};
