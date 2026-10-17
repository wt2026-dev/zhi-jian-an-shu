import React from 'react';
import { Radio } from 'lucide-react';

export interface CockpitTickerProps {
  eventTicker: {
    id: string;
    time: string;
    tag: string;
    level: string;
    text: string;
  }[];
  lastRefreshedAt: Date;
}

export const CockpitTicker: React.FC<CockpitTickerProps> = ({
  eventTicker,
  lastRefreshedAt,
}) => {
  return (
    <div className="glass-card p-2.5 px-4 flex items-center space-x-3 shadow-sm">
      <div className="flex items-center space-x-1.5 text-blue-600 text-xs font-bold shrink-0">
        <Radio className="w-3.5 h-3.5" />
        <span>现场实时动态流:</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center space-x-6 animate-marquee whitespace-nowrap text-xs text-slate-700">
          {eventTicker.map((item) => (
            <div key={item.id} className="inline-flex items-center space-x-2">
              <span className="font-mono text-slate-500 text-[11px]">[{item.time}]</span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  item.level === 'major'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : item.level === 'warning'
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : item.level === 'info'
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                }`}
              >
                {item.tag}
              </span>
              <span className="text-slate-700">{item.text}</span>
              <span className="text-slate-300">✦</span>
            </div>
          ))}
        </div>
      </div>
      <div className="text-[10px] text-slate-500 shrink-0 font-mono hidden md:block">
        上次刷新: {lastRefreshedAt.toLocaleTimeString()}
      </div>
    </div>
  );
};
