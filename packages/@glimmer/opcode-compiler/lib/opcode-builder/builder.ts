import OpcodeBuilder, { OpcodeBuilderCompiler } from './interfaces';
import { ContainingMetadata } from '@glimmer/interfaces';
import { EncoderImpl } from './encoder';

export class StdLib {
  constructor(
    public main: number,
    private trustingGuardedAppend: number,
    private cautiousGuardedAppend: number
  ) {}

  get 'trusting-append'() {
    return this.trustingGuardedAppend;
  }

  get 'cautious-append'() {
    return this.cautiousGuardedAppend;
  }

  getAppend(trusting: boolean) {
    return trusting ? this.trustingGuardedAppend : this.cautiousGuardedAppend;
  }
}

export default function builder<Locator>(
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  size: number
): OpcodeBuilder<Locator> {
  return {
    resolver: compiler.resolver,
    compiler,
    encoder: new EncoderImpl(compiler.constants, compiler.isEager, size),
    meta,
  };
}
