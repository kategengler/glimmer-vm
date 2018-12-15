export * from './lib/interfaces';

export { ATTRS_BLOCK, Macros } from './lib/syntax';

export { compile } from './lib/compile';
export { CompilerImpl, debugCompiler } from './lib/compiler';

export { CompilableBlockImpl, CompilableProgram } from './lib/compilable-template';
export { staticComponent } from './lib/opcode-builder/helpers/index';

export {
  default as OpcodeBuilder,
  OpcodeBuilderConstructor,
  OpcodeBuilderCompiler,
  OpcodeBuilderEncoder,
} from './lib/opcode-builder/interfaces';

export { invokeStaticBlock } from './lib/opcode-builder/helpers/blocks';

export { default as builder } from './lib/opcode-builder/builder';

export { PartialDefinition } from './lib/partial-template';

export { default as templateFactory, TemplateFactory } from './lib/template';

export { debug, debugSlice, logOpcode } from './lib/debug';

export { WrappedBuilder } from './lib/wrapped-component';

export { EMPTY_BLOCKS } from './lib/utils';

export { resolveLayoutForTag } from './lib/resolver';
