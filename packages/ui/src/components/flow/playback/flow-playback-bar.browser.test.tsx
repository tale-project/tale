import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

import { render, screen, waitFor } from '@/tests/utils/render';

import { branchRun, triageFailedRun } from '../testing/flow-fixtures';
import { buildPlaybackTimeline } from './build-timeline';
import { FlowPlaybackBar } from './flow-playback-bar';
import type { FlowPlaybackTimeline } from './types';
import { usePlaybackClock } from './use-playback-clock';

import '../../../globals.css';

beforeEach(async () => {
  await page.viewport(1280, 900);
});

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

function Harness({ timeline }: { timeline: FlowPlaybackTimeline }) {
  const clock = usePlaybackClock({ timeline });
  return (
    <div style={{ width: 720 }}>
      <button type="button">Before the bar</button>
      <FlowPlaybackBar
        timeline={timeline}
        t={clock.t}
        onTChange={clock.setT}
        playing={clock.playing}
        onPlayingChange={clock.setPlaying}
        speed={clock.speed}
        onSpeedChange={clock.setSpeed}
        activity={clock.t >= timeline.duration ? 'Score (Failed)' : undefined}
        onFollowLive={clock.follow}
      />
      <output data-testid="t">{Math.round(clock.t)}</output>
      <output data-testid="speed">{clock.speed}</output>
    </div>
  );
}

const shownT = () => Number(screen.getByTestId('t').textContent);

describe('FlowPlaybackBar', () => {
  it('names the scrubber and says where it is, in words', async () => {
    const timeline = buildPlaybackTimeline(triageFailedRun());
    render(<Harness timeline={timeline} />);
    const slider = screen.getByRole('slider', { name: 'Run timeline' });
    // A replay opens on the end of the run: the whole story.
    expect(shownT()).toBe(Math.round(timeline.duration));
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/^\d\d:\d\d of \d\d:\d\d — Score \(Failed\)$/),
    );
    expect(
      screen.getByRole('group', { name: 'Run timeline' }),
    ).toBeInTheDocument();
    // A tick for every event, one in the error red for the failure.
    expect(document.querySelectorAll('[data-flow-mark="event"]')).toHaveLength(
      timeline.events.length,
    );
    expect(
      document.querySelectorAll('[data-flow-mark="failure"]'),
    ).toHaveLength(1);
  });

  it('moves with the keys: arrows 1 %, pages 10 %, Home and End, brackets by event', async () => {
    const timeline = buildPlaybackTimeline(branchRun());
    render(<Harness timeline={timeline} />);
    const slider = screen.getByRole('slider', { name: 'Run timeline' });
    slider.focus();
    await userEvent.keyboard('{Home}');
    expect(shownT()).toBe(0);
    await userEvent.keyboard('{ArrowRight}');
    expect(shownT()).toBe(Math.round(timeline.duration * 0.01));
    await userEvent.keyboard('{PageUp}');
    expect(shownT()).toBe(Math.round(timeline.duration * 0.11));
    await userEvent.keyboard('{Home}]');
    const first = timeline.events.find((at) => at > 0.5) ?? 0;
    expect(shownT()).toBe(Math.round(first));
    await userEvent.keyboard(']');
    const second = timeline.events.find((at) => at > first + 0.5) ?? 0;
    expect(shownT()).toBe(Math.round(second));
    await userEvent.keyboard('[[');
    expect(shownT()).toBe(Math.round(first));
    await userEvent.keyboard('{End}');
    expect(shownT()).toBe(Math.round(timeline.duration));
    // The wait shows as a band.
    expect(document.querySelector('[data-flow-mark="wait"]')).not.toBeNull();
  });

  it('plays with Space and the button, whose name says what it does', async () => {
    const timeline = buildPlaybackTimeline(branchRun());
    render(<Harness timeline={timeline} />);
    const slider = screen.getByRole('slider', { name: 'Run timeline' });
    slider.focus();
    await userEvent.keyboard('{Home}');
    await userEvent.keyboard(' ');
    const pause = await screen.findByRole('button', { name: 'Pause' });
    await waitFor(() => expect(shownT()).toBeGreaterThan(50));
    await userEvent.click(pause);
    const stopped = shownT();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(shownT()).toBe(stopped);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('changes speed, and steps event to event under reduced motion', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const timeline = buildPlaybackTimeline(branchRun());
    render(<Harness timeline={timeline} />);
    await userEvent.click(screen.getByRole('radio', { name: '2×' }));
    expect(screen.getByTestId('speed')).toHaveTextContent('2');
    screen.getByRole('slider', { name: 'Run timeline' }).focus();
    await userEvent.keyboard('{Home}');
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    const first = timeline.events.find((at) => at > 0.5) ?? 0;
    // No sweep: the first change lands exactly on the next event.
    await waitFor(() => expect(shownT()).toBe(Math.round(first)), {
      timeout: 2_000,
    });
  });

  it('offers to follow a live run once the reader moved back', async () => {
    const timeline = buildPlaybackTimeline({
      ...triageFailedRun(),
      endedAt: undefined,
    });
    render(<Harness timeline={timeline} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Follow live' })).toBeNull();
    screen.getByRole('slider', { name: 'Run timeline' }).focus();
    await userEvent.keyboard('{Home}');
    await userEvent.click(screen.getByRole('button', { name: 'Follow live' }));
    expect(shownT()).toBe(Math.round(timeline.duration));
  });

  it('folds the speed into a menu on a phone', async () => {
    await page.viewport(390, 844);
    const timeline = buildPlaybackTimeline(branchRun());
    render(<Harness timeline={timeline} />);
    expect(
      screen.getByRole('combobox', { name: 'Playback speed' }),
    ).toBeVisible();
    expect(screen.queryByRole('radio', { name: '2×' })).toBeNull();
  });

  it.each(['light', 'dark'])('passes axe (%s)', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const timeline = buildPlaybackTimeline(triageFailedRun());
    const { container } = render(<Harness timeline={timeline} />);
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa'],
    });
    expect(result.violations).toEqual([]);
  });
});
