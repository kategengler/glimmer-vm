import { Macros, staticComponent, invokeStaticBlock } from '@glimmer/opcode-compiler';
import { Option, WireFormat } from '@glimmer/interfaces';
import { EMPTY_BLOCKS } from '@glimmer/opcode-compiler';
import { resolveLayoutForTag } from '@glimmer/opcode-compiler';

export default class TestMacros<Locator> extends Macros<Locator> {
  constructor() {
    super();

    let { blocks, inlines } = this;

    blocks.add('identity', (_params, _hash, blocks, encoder, _resolver, _compiler, _meta) => {
      encoder.concat(invokeStaticBlock(blocks.get('default')!, encoder.isEager));
    });

    blocks.add('render-else', (_params, _hash, blocks, encoder, _resolver, _compiler, _meta) => {
      encoder.concat(invokeStaticBlock(blocks.get('else')!, encoder.isEager));
    });

    blocks.addMissing((name, params, hash, blocks, encoder, resolver, compiler, meta) => {
      if (!params) {
        params = [];
      }

      let { handle } = resolveLayoutForTag(name, resolver, meta.referrer);

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
      let { handle } = resolveLayoutForTag(name, resolver, meta.referrer);

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
