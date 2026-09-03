import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-10 text-center dark:border-stone-800 dark:bg-stone-900">
      <p className="text-sm font-medium">Not found</p>
      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
        That run, case or dataset does not exist. Runs live in <code className="font-mono">.data/runs</code> and are not
        checked into git, so a fresh clone starts empty.
      </p>
      <Link href="/" className="mt-4 inline-block text-xs underline underline-offset-2">
        Back to dashboard
      </Link>
    </div>
  );
}
