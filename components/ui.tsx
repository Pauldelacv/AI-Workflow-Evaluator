import Link from 'next/link';
import type { ReactNode } from 'react';
import { pct, scoreBarTone, scoreTone } from '../lib/display';

export function Panel({
  title,
  action,
  children,
  description,
}: {
  title: string;
  action?: ReactNode;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
      <header className="flex items-baseline justify-between gap-4 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-stone-700 dark:text-stone-300">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-md text-xs text-stone-500 dark:text-stone-400">{hint}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

export function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
      <div className={`num mt-1 text-2xl font-semibold ${tone ?? ''}`}>{value}</div>
      {sub ? <div className="num mt-0.5 text-xs text-stone-500 dark:text-stone-400">{sub}</div> : null}
    </div>
  );
}

export function ScoreBar({ score, label }: { score: number; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
        <div className={`h-full ${scoreBarTone(score)}`} style={{ width: `${Math.round(score * 100)}%` }} />
      </div>
      <span className={`num text-xs font-medium ${scoreTone(score)}`}>{label ?? pct(score, 0)}</span>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'pass' | 'fail' | 'warn' | 'info';
}) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
    pass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    fail: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
    warn: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
    info: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  } as const;
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:text-stone-400">
          {head}
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={`px-4 py-2 font-medium ${right ? 'text-right' : ''}`}>{children}</th>;
}

export function Td({ children, right, mono }: { children: ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td className={`px-4 py-2 ${right ? 'text-right' : ''} ${mono ? 'num font-mono text-xs' : ''}`}>{children}</td>
  );
}

export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
    >
      {children}
    </Link>
  );
}
