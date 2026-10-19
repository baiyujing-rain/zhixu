'use client';

export type WeaknessAxis = {
  tag: string;
  event_count: number;
  session_count: number;
  again_count: number;
  again_rate: number;
  avg_step: number;
};

const W = 640, H = 360, CX = 320, CY = 180, R = 150;

function vertex(index: number, total: number, radius: number) {
  const angle = (-90 + (index / total) * 360) * (Math.PI / 180);
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

export default function WeaknessRadar({ axes }: { axes: WeaknessAxis[] }) {
  if (!axes.length) {
    return <div className="weakness-empty">复习记录还不够，多记录几次自评后再看薄弱点。</div>;
  }

  if (axes.length < 3) {
    return (
      <div className="weakness-bars" role="list">
        {axes.map(axis => (
          <div className="weakness-bar" role="listitem" key={axis.tag}>
            <span className="weakness-bar-head"><strong>{axis.tag}</strong><small>{Math.round(axis.again_rate * 100)}% 又忘</small></span>
            <span className="weakness-bar-track"><i style={{ width: `${Math.max(4, Math.round(axis.again_rate * 100))}%` }} /></span>
            <span className="weakness-bar-meta">{axis.event_count} 次自评 · 平均步数 {axis.avg_step}</span>
          </div>
        ))}
      </div>
    );
  }

  const total = axes.length;
  const ringPoints = (fraction: number) => axes.map((_, i) => vertex(i, total, R * fraction)).map(p => `${p.x},${p.y}`).join(' ');
  const dataPoints = axes.map((axis, i) => vertex(i, total, R * Math.max(0, Math.min(1, axis.again_rate)))).map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div className="weakness-radar">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="薄弱点雷达图">
        {[0.25, 0.5, 0.75, 1].map(fraction => (
          <polygon key={fraction} points={ringPoints(fraction)} className="radar-grid" />
        ))}
        {axes.map((_, i) => {
          const end = vertex(i, total, R);
          return <line key={i} x1={CX} y1={CY} x2={end.x} y2={end.y} className="radar-grid" />;
        })}
        <polygon points={dataPoints} className="radar-data" />
        {axes.map((axis, i) => {
          const p = vertex(i, total, R * Math.max(0, Math.min(1, axis.again_rate)));
          return <circle key={axis.tag} cx={p.x} cy={p.y} r={3.5} className="radar-dot" />;
        })}
        {axes.map((axis, i) => {
          const p = vertex(i, total, R + 22);
          const anchor = p.x < CX - 12 ? 'end' : p.x > CX + 12 ? 'start' : 'middle';
          return (
            <g key={axis.tag}>
              <text x={p.x} y={p.y - 2} textAnchor={anchor} className="radar-tag">{axis.tag}</text>
              <text x={p.x} y={p.y + 12} textAnchor={anchor} className="radar-pct">{Math.round(axis.again_rate * 100)}%</text>
            </g>
          );
        })}
      </svg>
      <div className="weakness-legend"><span />越靠外越薄弱（again 占比越高）</div>
    </div>
  );
}
