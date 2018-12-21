export * from './lib/core';
export * from './lib/compile';
export * from './lib/components';
export * from './lib/dom/tree-construction';
export * from './lib/dom/bounds';
export * from './lib/program';
export * from './lib/module-locators';
export * from './lib/tier1/symbol-table';
export * from './lib/template';
export * from './lib/serialize';
export * from './lib/content';
export * from './lib/vm-opcodes';
export { default as ComponentCapabilities } from './lib/component-capabilities';

import * as Simple from './lib/dom/simple';
export { Simple };

import * as WireFormat from './lib/compile/wire-format';
export { WireFormat };
