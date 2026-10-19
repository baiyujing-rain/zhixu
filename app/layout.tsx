import type { Metadata } from 'next';
import './globals.css';
import InkAtmosphere from '@/components/ink-atmosphere';
export const metadata: Metadata = { title: '知序 · 把思路，一步步想清楚', description: '为 C++ 与 Python 学习者设计的算法引导工作台。理解题目，发现思路，独立解题。' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body><InkAtmosphere />{children}</body></html>; }
