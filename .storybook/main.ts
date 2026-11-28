import { defineStorybookMain } from '../src/storybook/main';

export default defineStorybookMain({
  stories: ['../src/**/*.stories.@(ts|tsx)'],
});
