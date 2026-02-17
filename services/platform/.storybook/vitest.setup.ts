import { setProjectAnnotations } from '@storybook/react';

import * as previewAnnotations from './preview';

const project = setProjectAnnotations([previewAnnotations]);

globalThis.globalProjectAnnotations = project;
