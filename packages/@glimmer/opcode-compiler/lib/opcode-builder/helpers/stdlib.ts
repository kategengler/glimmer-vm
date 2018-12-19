import { Op, $s0 } from '@glimmer/vm';

import { OpcodeBuilderEncoder } from '../interfaces';
import { invokePreparedComponent, invokeBareComponent } from './components';
import { StdLib } from '../builder';
import { EncoderImpl } from '../encoder';
import { ContentType, CompileTimeConstants, CompileTimeHeap } from '@glimmer/interfaces';
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

export function compileStd(constants: CompileTimeConstants, heap: CompileTimeHeap): StdLib {
  let mainHandle = build(constants, heap, main);
  let trustingGuardedAppend = build(constants, heap, e => stdAppend(e, true));
  let cautiousGuardedAppend = build(constants, heap, e => stdAppend(e, false));

  return new StdLib(mainHandle, trustingGuardedAppend, cautiousGuardedAppend);
}

function build(
  constants: CompileTimeConstants,
  heap: CompileTimeHeap,
  callback: (builder: OpcodeBuilderEncoder) => void
): number {
  let encoder = new EncoderImpl(constants, true, 0);
  callback(encoder);
  return encoder.commit(heap);
}
