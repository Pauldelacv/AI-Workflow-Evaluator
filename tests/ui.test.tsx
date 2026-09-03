// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, EmptyState, Metric, ScoreBar, Table, Td, Th } from '../components/ui';
import { pct, points, relativePct, scoreTone, seconds, timestamp, usd } from '../lib/display';

/**
 * The UI's job is to make a bad number impossible to misread. These tests cover
 * the two places that would silently lie: the formatters, and the colour scale
 * that tells a reader at a glance whether a score is fine.
 */

describe('display formatting', () => {
  it('formats scores, latency and cost consistently', () => {
    expect(pct(0.933)).toBe('93.3%');
    expect(pct(0.933, 0)).toBe('93%');
    expect(seconds(1531)).toBe('1.53s');
    expect(usd(0.00042)).toBe('$0.0004');
  });

  it('always signs a delta so direction is unambiguous', () => {
    expect(points(0.05)).toBe('+5.0 pts');
    expect(points(-0.166)).toBe('-16.6 pts');
    expect(relativePct(-0.69)).toBe('-69%');
    expect(relativePct(null)).toBe('-');
  });

  it('shows an absolute timestamp rather than a relative one', () => {
    expect(timestamp('2026-09-03T18:14:07.932Z')).toBe('2026-09-03 18:14 UTC');
  });

  it('uses one colour scale for scores everywhere', () => {
    expect(scoreTone(0.95)).toContain('emerald');
    expect(scoreTone(0.8)).toContain('amber');
    expect(scoreTone(0.42)).toContain('rose');
  });
});

describe('components', () => {
  it('renders a metric with its label, value and sub-label', () => {
    render(<Metric label="Pass rate" value="93.3%" sub="28/30 cases" />);
    expect(screen.getByText('Pass rate')).toBeDefined();
    expect(screen.getByText('93.3%')).toBeDefined();
    expect(screen.getByText('28/30 cases')).toBeDefined();
  });

  it('renders a score bar clamped to the score width', () => {
    const { container } = render(<ScoreBar score={0.42} />);
    const bar = container.querySelector('div[style]') as HTMLElement;
    expect(bar.style.width).toBe('42%');
    expect(screen.getByText('42%')).toBeDefined();
  });

  it('distinguishes pass and fail badges', () => {
    const { container } = render(
      <>
        <Badge tone="pass">pass</Badge>
        <Badge tone="fail">fail</Badge>
      </>,
    );
    expect(container.innerHTML).toContain('emerald');
    expect(container.innerHTML).toContain('rose');
  });

  it('gives an empty state a next action rather than a dead end', () => {
    render(<EmptyState title="No runs yet" hint="npm run eval -- run acme-support v1-baseline" />);
    expect(screen.getByText('No runs yet')).toBeDefined();
    expect(screen.getByText(/npm run eval/)).toBeDefined();
  });

  it('renders a table with headers and rows', () => {
    render(
      <Table head={<tr><Th>Case</Th><Th right>Score</Th></tr>}>
        <tr><Td mono>case-001</Td><Td right mono>93%</Td></tr>
      </Table>,
    );
    expect(screen.getByText('case-001')).toBeDefined();
    expect(screen.getByText('93%')).toBeDefined();
  });
});
