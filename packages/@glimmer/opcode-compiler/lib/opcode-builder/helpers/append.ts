import { Op, MachineOp } from '@glimmer/vm';

import { ContentType, CompileTimeLookup, ContainingMetadata, STDLib } from '@glimmer/interfaces';
import * as WireFormat from '@glimmer/wire-format';

import { OpcodeBuilderEncoder, OpcodeBuilderCompiler } from '../interfaces';
import { invokeBareComponent } from './components';
import { expr } from './shared';
import { switchCases } from './conditional';

export function guardedAppend<Locator>(
  encoder: OpcodeBuilderEncoder,
  resolver: CompileTimeLookup<Locator>,
  compiler: OpcodeBuilderCompiler<Locator>,
  meta: ContainingMetadata<Locator>,
  stdlib: STDLib,
  expression: WireFormat.Expression,
  trusting: boolean
): void {
  encoder.pushMachine(MachineOp.PushFrame);

  expr(encoder, resolver, compiler, meta, expression);

  encoder.pushMachine(MachineOp.InvokeStatic, stdlib.getAppend(trusting));

  encoder.pushMachine(MachineOp.PopFrame);
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
