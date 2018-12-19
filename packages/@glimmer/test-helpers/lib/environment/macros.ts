import { Macros, staticComponent, invokeStaticBlock } from '@glimmer/opcode-compiler';
import { Option } from '@glimmer/interfaces';
import * as WireFormat from '@glimmer/wire-format';
import { EMPTY_BLOCKS } from '@glimmer/opcode-compiler';
import { resolveLayoutForTag } from '@glimmer/opcode-compiler';

export default class TestMacros<Locator> extends Macros<Locator> {
  constructor() {
    super();

    let { blocks, inlines } = this;

    blocks.add('identity', (_params, _hash, blocks, encoder, _resolver, compiler, _meta) => {
      invokeStaticBlock(encoder, compiler, blocks.get('default')!);
    });

    blocks.add('render-else', (_params, _hash, blocks, encoder, _resolver, compiler, _meta) => {
      invokeStaticBlock(encoder, compiler, blocks.get('else')!);
    });

    blocks.addMissing((name, params, hash, blocks, encoder, resolver, compiler, meta) => {
      if (!params) {
        params = [];
      }

      let { handle } = resolveLayoutForTag(resolver, name, meta.referrer);

      if (handle !== null) {
        staticComponent(encoder, resolver, compiler, meta, handle, [
          params,
          hashToArgs(hash),
          blocks,
        ]);
        return true;
      }

      return false;
    });

    inlines.addMissing((name, params, hash, encoder, resolver, compiler, meta) => {
      let { handle } = resolveLayoutForTag(resolver, name, meta.referrer);

      if (handle !== null) {
        staticComponent(encoder, resolver, compiler, meta, handle, [
          params!,
          hashToArgs(hash),
          EMPTY_BLOCKS,
        ]);
        return true;
      }

      return false;
    });
  }
}

function hashToArgs(hash: Option<WireFormat.Core.Hash>): Option<WireFormat.Core.Hash> {
  if (hash === null) return null;
  let names = hash[0].map(key => `@${key}`);
  return [names, hash[1]];
}
