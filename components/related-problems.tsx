'use client';

import { useMemo } from 'react';
import { ArrowRight, BookOpen, FlaskConical, History } from 'lucide-react';
import { buildRelated, type GraphItem } from '@/lib/problem-graph';

const GROUP_ICON = { algorithm: FlaskConical, practice: BookOpen, seen: History } as const;

export default function RelatedProblems({ current, items, onOpenLab, onOpenSession }: {
  current: GraphItem;
  items: GraphItem[];
  onOpenLab: (algorithm: string) => void;
  onOpenSession: (id: number) => void;
}) {
  const groups = useMemo(() => buildRelated(current, items), [current, items]);
  if (!groups.length) return null;
  const heading = current.status === 'mastered' ? '做完这道题，接着练…' : '相关题目';

  return (
    <section className="related-problems" aria-label="相关题目">
      <h3>{heading}</h3>
      {groups.map(group => {
        const Icon = GROUP_ICON[group.kind];
        return (
          <div className="related-group" key={group.kind}>
            <div className="related-group-title"><Icon size={14} /><span>{group.title}</span></div>
            <ul className="related-list">
              {group.items.map(item => {
                const inner = <>
                  <div className="related-item-title">{item.title}{item.kind !== 'practice' && <ArrowRight size={13} />}</div>
                  <div className="related-item-sub">{item.subtitle}</div>
                  {item.hint && <div className="related-item-hint">{item.hint}</div>}
                </>;
                if (item.kind === 'algorithm') {
                  return <li key={item.id}><button type="button" onClick={() => onOpenLab(item.algorithm!)}>{inner}</button></li>;
                }
                if (item.kind === 'seen') {
                  return <li key={item.id}><button type="button" onClick={() => onOpenSession(item.sessionId!)}>{inner}</button></li>;
                }
                return <li key={item.id}><div>{inner}</div></li>;
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
