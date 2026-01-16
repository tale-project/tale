import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../lib/i18n/i18n-provider';
import enMessages from '../../messages/en.json';
import globalMessages from '../../messages/global.json';

const messages = { ...globalMessages, ...enMessages };

interface WrapperProps {
  children: ReactNode;
}

function AllProviders({ children }: WrapperProps) {
  return (
    <I18nProvider locale="en" messages={messages}>
      {children}
    </I18nProvider>
  );
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  locale?: string;
}

function customRender(ui: ReactElement, options?: CustomRenderOptions) {
  return {
    user: userEvent.setup(),
    ...render(ui, { wrapper: AllProviders, ...options }),
  };
}

export * from '@testing-library/react';
export { customRender as render };
