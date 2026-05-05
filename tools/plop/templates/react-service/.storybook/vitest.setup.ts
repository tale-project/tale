import { setProjectAnnotations } from '@storybook/react-vite';
import { beforeAll } from 'vitest';

import preview from './preview';

const project = setProjectAnnotations([preview]);
beforeAll(project.beforeAll);
