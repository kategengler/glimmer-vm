import { CompileTimeLookup, ContainingMetadata } from '@glimmer/interfaces';
import { OpcodeBuilderEncoder, OpcodeBuilderCompiler } from '../interfaces';

export interface OpcodeBuilderState<Locator> {
  encoder: OpcodeBuilderEncoder;
  resolver: CompileTimeLookup<Locator>;
  compiler: OpcodeBuilderCompiler<Locator>;
  meta: ContainingMetadata<Locator>;
}
