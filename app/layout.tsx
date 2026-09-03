import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Workflow Evaluator',
  description: 'Evaluation and regression testing for production LLM workflows.',
};

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/runs', label: 'Runs' },
  { href: '/compare', label: 'Compare' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-6xl px-4 py-6">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
            <div>
              <Link href="/" className="text-base font-semibold tracking-tight">
                AI Workflow Evaluator
              </Link>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Evaluation and regression testing for LLM workflows
              </p>
            </div>
            <nav className="flex gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2.5 py-1 text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="space-y-6">{children}</main>
          <footer className="mt-10 border-t border-stone-200 pt-4 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
            Scores are heuristic proxies, not ground truth. Read{' '}
            <code className="font-mono">docs/evaluation.md</code> for the methodology and its limits.
          </footer>
        </div>
      </body>
    </html>
  );
}
