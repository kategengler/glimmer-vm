import { precompile as rawPrecompile, PrecompileOptions } from '@glimmer/compiler';
import { Opaque, Option, WireFormat } from '@glimmer/interfaces';
import { Environment } from '@glimmer/runtime';
import { EndTag, Token, tokenize } from 'simple-html-tokenizer';

// For Phantom
function toObject(val: Opaque) {
  if (val === null || val === undefined) {
    throw new TypeError('Object.assign cannot be called with null or undefined');
  }

  return Object(val);
}

if (typeof Object.assign !== 'function') {
  Object.assign = function(target: Opaque, _source: Opaque) {
    let from;
    let to = toObject(target);
    let symbols;

    for (let s = 1; s < arguments.length; s++) {
      from = Object(arguments[s]);

      for (let key in from) {
        if (Object.prototype.hasOwnProperty.call(from, key)) {
          to[key] = from[key];
        }
      }

      if (Object.getOwnPropertySymbols) {
        symbols = Object.getOwnPropertySymbols(from);
        for (let i = 0; i < symbols.length; i++) {
          if (Object.prototype.propertyIsEnumerable.call(from, symbols[i])) {
            to[symbols[i]] = from[symbols[i]];
          }
        }
      }
    }

    return to;
  };
}

export const assign = Object.assign;

function isMarker(node: Node) {
  const TextNode = window['Text'] as typeof Text;
  const CommentNode = window['Comment'] as typeof Comment;
  if (node instanceof CommentNode && node.textContent === '') {
    return true;
  }

  if (node instanceof TextNode && node.textContent === '') {
    return true;
  }

  return false;
}

export interface TestCompileOptions extends PrecompileOptions {
  env: Environment;
}

export function precompile(
  string: string,
  options?: TestCompileOptions
): WireFormat.SerializedTemplate<WireFormat.TemplateMeta> {
  let wrapper = JSON.parse(rawPrecompile(string, options));
  wrapper.block = JSON.parse(wrapper.block);
  return wrapper as WireFormat.SerializedTemplate<WireFormat.TemplateMeta>;
}

export function equalInnerHTML(fragment: { innerHTML: string }, html: string, message?: string) {
  let actualHTML = normalizeInnerHTML(fragment.innerHTML);
  QUnit.assert.pushResult({
    result: actualHTML === html,
    actual: actualHTML,
    expected: html,
    message: message || `unexpected innerHTML`,
  });
}

export function equalHTML(node: Node | Node[], html: string) {
  let fragment: DocumentFragment | Node;
  if (!node['nodeType'] && node['length']) {
    fragment = document.createDocumentFragment();
    while (node[0]) {
      fragment.appendChild(node[0]);
    }
  } else {
    fragment = node as Node;
  }

  let div = document.createElement('div');
  div.appendChild(fragment.cloneNode(true));

  equalInnerHTML(div, html);
}

function generateTokens(divOrHTML: Element | string): { tokens: Token[]; html: string } {
  let div;
  if (typeof divOrHTML === 'string') {
    div = document.createElement('div');
    div.innerHTML = divOrHTML;
  } else {
    div = divOrHTML;
  }

  let tokens = tokenize(div.innerHTML, {});

  tokens = tokens.reduce((tokens, token) => {
    if (token.type === 'StartTag') {
      if (token.attributes) {
        token.attributes.sort((a, b) => {
          if (a[0] > b[0]) {
            return 1;
          }
          if (a[0] < b[0]) {
            return -1;
          }
          return 0;
        });
      }

      if (token.selfClosing) {
        token.selfClosing = false;
        tokens.push(token);
        tokens.push({ type: 'EndTag', tagName: token.tagName } as EndTag);
      } else {
        tokens.push(token);
      }
    } else {
      tokens.push(token);
    }

    return tokens;
  }, new Array<Token>());

  return { tokens, html: div.innerHTML };
}

declare const QUnit: QUnit & {
  equiv(a: any, b: any): boolean;
};

export function equalTokens(
  testFragment: HTMLElement | string,
  testHTML: HTMLElement | string,
  message: Option<string> = null
) {
  let fragTokens = generateTokens(testFragment);
  let htmlTokens = generateTokens(testHTML);

  // let msg = "Expected: " + htmlTokens.html + "; Actual: " + fragTokens.html;

  // if (message) { msg += " (" + message + ")"; }

  let equiv = QUnit.equiv(fragTokens.tokens, htmlTokens.tokens);

  if (equiv && fragTokens.html !== htmlTokens.html) {
    QUnit.assert.deepEqual(
      fragTokens.tokens,
      htmlTokens.tokens,
      message || 'expected tokens to match'
    );
  } else {
    QUnit.assert.pushResult({
      result: QUnit.equiv(fragTokens.tokens, htmlTokens.tokens),
      actual: fragTokens.html,
      expected: htmlTokens.html,
      message: message || 'expected tokens to match',
    });
  }

  // QUnit.assert.deepEqual(fragTokens.tokens, htmlTokens.tokens, msg);
}

export function generateSnapshot(element: Element) {
  let snapshot: Node[] = [];
  let node: Option<Node> = element.firstChild;

  while (node) {
    if (!isMarker(node)) {
      snapshot.push(node);
    }
    node = node.nextSibling;
  }

  return snapshot;
}

export function equalSnapshots(a: Node[], b: Node[]) {
  QUnit.assert.strictEqual(a.length, b.length, 'Same number of nodes');
  for (let i = 0; i < b.length; i++) {
    QUnit.assert.strictEqual(a[i], b[i], 'Nodes are the same');
  }
}

// detect side-effects of cloning svg elements in IE9-11
let ieSVGInnerHTML = (function() {
  if (typeof document === 'undefined' || !document.createElementNS) {
    return false;
  }
  let div = document.createElement('div');
  let node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  div.appendChild(node);
  let clone = div.cloneNode(true) as HTMLDivElement;
  return clone.innerHTML === '<svg xmlns="http://www.w3.org/2000/svg" />';
})();

export function normalizeInnerHTML(actualHTML: string) {
  if (ieSVGInnerHTML) {
    // Replace `<svg xmlns="http://www.w3.org/2000/svg" height="50%" />` with `<svg height="50%"></svg>`, etc.
    // drop namespace attribute
    actualHTML = actualHTML.replace(/ xmlns="[^"]+"/, '');
    // replace self-closing elements
    actualHTML = actualHTML.replace(/<([^ >]+) [^\/>]*\/>/gi, function(tag, tagName) {
      return tag.slice(0, tag.length - 3) + '></' + tagName + '>';
    });
  }

  return actualHTML;
}

let isCheckedInputHTML: (element: Element) => void;

if (typeof document === 'undefined') {
  isCheckedInputHTML = function() {};
} else {
  // detect weird IE8 checked element string
  let checkedInput = document.createElement('input');
  checkedInput.setAttribute('checked', 'checked');
  let checkedInputString = checkedInput.outerHTML;

  isCheckedInputHTML = function(element) {
    QUnit.assert.equal(element.outerHTML, checkedInputString);
  };
}

export { isCheckedInputHTML };

// check which property has the node's text content
let textProperty =
  typeof document === 'object' && document.createElement('div').textContent === undefined
    ? 'innerText'
    : 'textContent';
export function getTextContent(el: Node) {
  // textNode
  if (el.nodeType === 3) {
    return el.nodeValue;
  } else {
    return el[textProperty];
  }
}

export function strip(strings: TemplateStringsArray, ...args: string[]) {
  return strings
    .map((str: string, i: number) => {
      return `${str
        .split('\n')
        .map(s => s.trim())
        .join('')}${args[i] ? args[i] : ''}`;
    })
    .join('');
}

export function stripTight(strings: TemplateStringsArray) {
  return strings[0]
    .split('\n')
    .map(s => s.trim())
    .join('');
}

export function trimLines(strings: TemplateStringsArray) {
  return strings[0]
    .trim()
    .split('\n')
    .map(s => s.trim())
    .join('\n');
}

export function assertIsElement(node: Node | null): node is Element {
  let nodeType = node === null ? null : node.nodeType;
  QUnit.assert.pushResult({
    result: nodeType === 1,
    expected: 1,
    actual: nodeType,
    message: 'expected node to be an element',
  });
  return nodeType === 1;
}

// TODO: Consider removing this
interface CompatibleTagNameMap extends ElementTagNameMap {
  foreignobject: SVGForeignObjectElement;
}

export function assertNodeTagName<
  T extends keyof CompatibleTagNameMap,
  U extends CompatibleTagNameMap[T]
>(node: Node | null, tagName: T): node is U {
  if (assertIsElement(node)) {
    const normalizedNodeTagName = node.tagName.toLowerCase();
    const nodeTagName = node.tagName;

    QUnit.assert.pushResult({
      result: normalizedNodeTagName === tagName || nodeTagName === tagName,
      expected: tagName,
      actual: nodeTagName,
      message: `expected tagName to be ${tagName} but was ${nodeTagName}`,
    });
    return nodeTagName === tagName || normalizedNodeTagName === tagName;
  }
  return false;
}

export function assertNodeProperty<
  T extends keyof HTMLElementTagNameMap,
  P extends keyof ElementTagNameMap[T],
  V extends HTMLElementTagNameMap[T][P]
>(node: Node | null, tagName: T, prop: P, value: V) {
  if (assertNodeTagName(node, tagName)) {
    QUnit.assert.strictEqual(node[prop], value);
  }
}

export function assertSerializedInElement(result: string, expected: string, message?: string) {
  let matched = result.match(/<script glmr="%cursor:[0-9]*.%"><\/script>/);

  if (matched) {
    QUnit.assert.ok(true, `has cursor ${matched[0]}`);
    let [, trimmed] = result.split(matched![0]);
    QUnit.assert.equal(trimmed, expected, message);
  } else {
    QUnit.assert.ok(false, `does not have a cursor`);
  }
}

export function blockStack() {
  let stack: number[] = [];

  return (id: number) => {
    if (stack.indexOf(id) > -1) {
      let close = `<!--%-b:${id}%-->`;
      stack.pop();
      return close;
    } else {
      stack.push(id);
      return `<!--%+b:${id}%-->`;
    }
  };
}
