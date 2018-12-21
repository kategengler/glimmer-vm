import {
  ResolvedLayout,
  Option,
  CompilableProgram,
  MaybeResolvedLayout,
  CompileTimeLookup,
} from '@glimmer/interfaces';

export function resolveLayoutForTag<Locator>(
  tag: string,
  resolver: CompileTimeLookup<Locator>,
  referrer: Locator
): MaybeResolvedLayout {
  let handle = resolver.lookupComponentDefinition(tag, referrer);

  if (handle === null) return { handle: null, capabilities: null, compilable: null };

  return resolveLayoutForHandle(resolver, handle);
}

export function resolveLayoutForHandle<Locator>(
  resolver: CompileTimeLookup<Locator>,
  handle: number
): ResolvedLayout {
  let capabilities = resolver.getCapabilities(handle);
  let compilable: Option<CompilableProgram> = null;

  if (!capabilities.dynamicLayout) {
    compilable = resolver.getLayout(handle)!;
  }

  return {
    handle,
    capabilities,
    compilable,
  };
}
