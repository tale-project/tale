import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { stubWidth } from '@/tests/utils/width';

import { useFitsWidth, useWidthValue } from './use-fits-width';

let stub: ReturnType<typeof stubWidth> | undefined;

afterEach(() => {
  stub?.restore();
  stub = undefined;
});

/** What the box measures at first, before any resize. */
function measures(width: number) {
  stub = stubWidth(() => true, width);
  return stub;
}

function Box({ minWidth }: { minWidth: number }) {
  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref}>{useFitsWidth(ref, minWidth) ? 'fits' : 'narrow'}</div>;
}

describe('useFitsWidth', () => {
  it('fits where nothing can be measured, so a page without layout gets the full layout', () => {
    render(<Box minWidth={900} />);
    expect(screen.getByText('fits')).toBeInTheDocument();
  });

  it('knows at the first paint that the box is too narrow', () => {
    measures(600);
    render(<Box minWidth={900} />);
    expect(screen.getByText('narrow')).toBeInTheDocument();
  });

  it('fits a box exactly as wide as it needs', () => {
    measures(900);
    render(<Box minWidth={900} />);
    expect(screen.getByText('fits')).toBeInTheDocument();
  });

  it('follows the box as it is resized, both ways', () => {
    const width = measures(1200);
    render(<Box minWidth={900} />);
    expect(screen.getByText('fits')).toBeInTheDocument();

    act(() => width.resize(899));
    expect(screen.getByText('narrow')).toBeInTheDocument();

    act(() => width.resize(900));
    expect(screen.getByText('fits')).toBeInTheDocument();
  });

  it('ignores an empty measure: a hidden box is not a narrow one', () => {
    const width = measures(1200);
    render(<Box minWidth={900} />);
    act(() => width.resize(500));
    expect(screen.getByText('narrow')).toBeInTheDocument();

    act(() => width.resize(0));
    expect(screen.getByText('narrow')).toBeInTheDocument();
  });

  it('asks again when what it needs changes', () => {
    measures(800);
    const { rerender } = render(<Box minWidth={700} />);
    expect(screen.getByText('fits')).toBeInTheDocument();

    rerender(<Box minWidth={900} />);
    expect(screen.getByText('narrow')).toBeInTheDocument();
  });

  it('stops watching when the box goes', () => {
    const width = measures(1200);
    const { unmount } = render(<Box minWidth={900} />);
    const observer = width.observers[0];
    expect(observer?.observe).toHaveBeenCalledTimes(1);

    unmount();
    expect(observer?.disconnect).toHaveBeenCalled();
  });
});

/** The half of the pixels above 1000, from 0 to 40: a value that follows the width. */
const growth = (width: number) =>
  Math.min(40, Math.max(0, Math.round((width - 1000) / 2)));

function Grower() {
  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref}>{`growth ${useWidthValue(ref, growth, 0)}`}</div>;
}

describe('useWidthValue', () => {
  it('has the first value where nothing can be measured', () => {
    render(<Grower />);
    expect(screen.getByText('growth 0')).toBeInTheDocument();
  });

  it('knows the value of the box at the first paint', () => {
    measures(1040);
    render(<Grower />);
    expect(screen.getByText('growth 20')).toBeInTheDocument();
  });

  it('follows the box as it is resized, both ways, and keeps the last value of an empty measure', () => {
    const width = measures(1000);
    render(<Grower />);
    expect(screen.getByText('growth 0')).toBeInTheDocument();

    act(() => width.resize(1060));
    expect(screen.getByText('growth 30')).toBeInTheDocument();

    act(() => width.resize(1500));
    expect(screen.getByText('growth 40')).toBeInTheDocument();

    act(() => width.resize(0));
    expect(screen.getByText('growth 40')).toBeInTheDocument();

    act(() => width.resize(900));
    expect(screen.getByText('growth 0')).toBeInTheDocument();
  });
});
