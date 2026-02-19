// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { ColorPickerInput } from '../color-picker-input';

afterEach(cleanup);

describe('ColorPickerInput', () => {
  it('renders label and hex input', () => {
    render(
      <ColorPickerInput
        value="#FF0000"
        onChange={vi.fn()}
        label="Brand color"
        id="brand-color"
      />,
    );

    expect(screen.getByText('Brand color')).toBeInTheDocument();
    expect(screen.getByLabelText('Brand color hex value')).toBeInTheDocument();
  });

  it('displays hex value without # prefix', () => {
    render(
      <ColorPickerInput
        value="#3366FF"
        onChange={vi.fn()}
        label="Color"
        id="color"
      />,
    );

    const input = screen.getByLabelText('Color hex value');
    expect(input).toHaveValue('3366FF');
  });

  it('calls onChange with uppercased hex value on text input', () => {
    const onChange = vi.fn();
    render(
      <ColorPickerInput
        value="#000000"
        onChange={onChange}
        label="Color"
        id="color"
      />,
    );

    const input = screen.getByLabelText('Color hex value');
    fireEvent.change(input, { target: { value: 'ff00aa' } });

    expect(onChange).toHaveBeenCalledWith('#FF00AA');
  });

  it('strips non-hex characters from text input', () => {
    const onChange = vi.fn();
    render(
      <ColorPickerInput
        value="#000000"
        onChange={onChange}
        label="Color"
        id="color"
      />,
    );

    const input = screen.getByLabelText('Color hex value');
    fireEvent.change(input, { target: { value: 'GG00ZZ' } });

    expect(onChange).toHaveBeenCalledWith('#00');
  });

  it('truncates text input to 6 characters', () => {
    const onChange = vi.fn();
    render(
      <ColorPickerInput
        value="#000000"
        onChange={onChange}
        label="Color"
        id="color"
      />,
    );

    const input = screen.getByLabelText('Color hex value');
    fireEvent.change(input, { target: { value: 'AABBCCDD' } });

    expect(onChange).toHaveBeenCalledWith('#AABBCC');
  });

  it('calls onChange with uppercased value from native color picker', () => {
    const onChange = vi.fn();
    render(
      <ColorPickerInput
        value="#000000"
        onChange={onChange}
        label="Color"
        id="color"
      />,
    );

    const hiddenInput = document.querySelector('input[type="color"]');
    expect(hiddenInput).toBeTruthy();
    if (hiddenInput) {
      fireEvent.change(hiddenInput, { target: { value: '#ff5533' } });
    }

    expect(onChange).toHaveBeenCalledWith('#FF5533');
  });

  it('renders swatch with current color', () => {
    render(
      <ColorPickerInput
        value="#FF0000"
        onChange={vi.fn()}
        label="Color"
        id="color"
      />,
    );

    const swatch = screen.getByLabelText('Pick color');
    expect(swatch).toHaveStyle({ backgroundColor: '#FF0000' });
  });

  it('renders white swatch for invalid hex value', () => {
    render(
      <ColorPickerInput
        value="#ZZZ"
        onChange={vi.fn()}
        label="Color"
        id="color"
      />,
    );

    const swatch = screen.getByLabelText('Pick color');
    expect(swatch).toHaveStyle({ backgroundColor: '#FFFFFF' });
  });

  it('associates label with input via id', () => {
    render(
      <ColorPickerInput
        value="#000000"
        onChange={vi.fn()}
        label="Accent color"
        id="accent"
      />,
    );

    const label = screen.getByText('Accent color');
    expect(label).toHaveAttribute('for', 'accent');
  });
});
