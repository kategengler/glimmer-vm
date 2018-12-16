import { Op, $s0 } from '@glimmer/vm';
import { InstructionEncoder } from '@glimmer/encoder';

import { OpcodeBuilderEncoder, OpcodeBuilderCompiler } from '../interfaces';
import { invokePreparedComponent, invokeBareComponent } from './components';
import { StdLib } from '../builder';
import { EncoderImpl } from '../encoder';
import { ContentType } from '@glimmer/interfaces';
import { switchCases } from './conditional';

export function main(encoder: OpcodeBuilderEncoder) {
  encoder.push(Op.Main, $s0);
  invokePreparedComponent(encoder, false, false, true);
}

export function stdAppend(encoder: OpcodeBuilderEncoder, trusting: boolean) {
  encoder.push(Op.ContentType);

  switchCases(encoder, when => {
    when(ContentType.String, () => {
      if (trusting) {
        encoder.push(Op.AssertSame);
        encoder.push(Op.AppendHTML);
      } else {
        encoder.push(Op.AppendText);
      }
    });

    when(ContentType.Component, () => {
      encoder.push(Op.PushCurriedComponent);
      encoder.push(Op.PushDynamicComponentInstance);
      invokeBareComponent(encoder);
    });

    when(ContentType.SafeString, () => {
      encoder.push(Op.AssertSame);
      encoder.push(Op.AppendSafeHTML);
    });

    when(ContentType.Fragment, () => {
      encoder.push(Op.AssertSame);
      encoder.push(Op.AppendDocumentFragment);
    });

    when(ContentType.Node, () => {
      encoder.push(Op.AssertSame);
      encoder.push(Op.AppendNode);
    });
  });
}

export function compileStd<Locator>(compiler: OpcodeBuilderCompiler<Locator>): StdLib {
  let mainHandle = build(compiler, main);
  let trustingGuardedAppend = build(compiler, encoder => stdAppend(encoder, true));
  let cautiousGuardedAppend = build(compiler, encoder => stdAppend(encoder, false));
  return new StdLib(mainHandle, trustingGuardedAppend, cautiousGuardedAppend);
}

function build<Locator>(
  compiler: OpcodeBuilderCompiler<Locator>,
  callback: (builder: OpcodeBuilderEncoder) => void
): number {
  let instructionEncoder = new InstructionEncoder([]);
  let encoder = new EncoderImpl(
    instructionEncoder,
    compiler.constants,
    compiler.stdLib,
    compiler.isEager
  );
  callback(encoder);
  return encoder.commit(compiler, 0);
}
