'use client';

import { localDateTime } from '@/lib/dates';

export type CurvePoint = {
  reviewed_at: string;
  rating: string;
  rating_ordinal: number;
  step: number;
  interval_minutes: number;
};

const ratingNames: Record<string, string> = { again: '忘了', hard: '还不熟', good: '基本想起', easy: '很熟悉' };

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

const W = 640, H = 240, LEFT = 72, RIGHT = 24, TOP = 24, BOTTOM = 56;
const PLOT_W = W - LEFT - RIGHT, PLOT_H = H - TOP - BOTTOM;
const yFor = (ordinal: number) => TOP + (3 - ordinal) * (PLOT_H / 3);

export default function MemoryCurve({ points, daySteps }: { points: CurvePoint[]; daySteps: number[] }) {
  if (!points.length) {
    return <div className="memory-curve-empty">还没有复习记录，先完成一次回想自评。</div>;
  }

  const xs = points.map((_, index) => points.length === 1 ? LEFT + PLOT_W / 2 : LEFT + (index / (points.length - 1)) * PLOT_W);
  const line = points.map((point, index) => `${xs[index]},${yFor(point.rating_ordinal)}`).join(' ');

  return (
    <div className="memory-curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="记忆曲线">
        {[3, 2, 1, 0].map(ordinal => (
          <g key={ordinal}>
            <line x1={LEFT} y1={yFor(ordinal)} x2={W - RIGHT} y2={yFor(ordinal)} className="memory-grid" />
            <text x={LEFT - 10} y={yFor(ordinal) + 3} textAnchor="end" className="memory-axis-label">
              {ratingNames[['again', 'hard', 'good', 'easy'][ordinal]]}
            </text>
          </g>
        ))}
        {points.length > 1 && <polyline points={line} className="memory-line" />}
        {points.map((point, index) => (
          <g key={index}>
            <circle cx={xs[index]} cy={yFor(point.rating_ordinal)} r={4.5} className="memory-dot" />
            <text x={xs[index]} y={yFor(point.rating_ordinal) - 11} textAnchor="middle" className="memory-rating-label">
              {ratingNames[point.rating] || point.rating}
            </text>
            <text x={xs[index]} y={yFor(point.rating_ordinal) + 17} textAnchor="middle" className="memory-date-label">
              {localDateTime(point.reviewed_at)}
            </text>
            <text x={xs[index]} y={yFor(point.rating_ordinal) + 31} textAnchor="middle" className="memory-interval-label">
              间隔 {formatInterval(point.interval_minutes)}
            </text>
          </g>
        ))}
      </svg>
      <div className="memory-curve-foot">
        <span>计划间隔：{daySteps.join(' / ')} 天</span>
        {points.length === 1 && <span>再复习几次，曲线会慢慢成形。</span>}
      </div>
    </div>
  );
}
