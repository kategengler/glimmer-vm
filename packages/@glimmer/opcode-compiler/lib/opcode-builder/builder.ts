import OpcodeBuilder, { OpcodeBuilderCompiler } from './interfaces';
import { ContainingMetadata } from '@glimmer/interfaces';
import { EncoderImpl } from './encoder';
import { InstructionEncoder } from '@glimmer/encoder';

export class StdLib {
  constructor(
    public main: number,
    private trustingGuardedAppend: number,
    private cautiousGuardedAppend: number
  ) {}

  getAppend(trusting: boolean) {
    return trusting ? this.trustingGuardedAppend : this.cautiousGuardedAppend;
  }
}

export default function builder<Locator>(
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>
): OpcodeBuilder<Locator> {
  return {
    resolver: compiler,
    compiler,
    encoder: new EncoderImpl(new InstructionEncoder([]), compiler.constants),
    meta,
    stdLib: compiler.stdLib,
  };
}
