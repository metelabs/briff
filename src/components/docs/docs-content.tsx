import type { Root } from "hast";
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import Link from "next/link";
import type { ComponentProps } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

import { CopyCode } from "./copy-code";

// Renders a docs page's HTML tree (src/lib/docs/build.ts) with the site's own pieces: code
// blocks with a language label and Copy, tables that scroll inside their box, heading anchors,
// and links that stay in the app (next/link) or open GitHub in a new tab.

function CodeBlock(
  props: ComponentProps<"pre"> & { "data-language"?: string; "data-code"?: string }
) {
  const { "data-language": language, "data-code": code = "", children } = props;
  return (
    <figure className="docs-code">
      <figcaption className="docs-code-bar">
        <span className="font-mono text-[12px]">{language ?? "text"}</span>
        <CopyCode text={code} />
      </figcaption>
      <pre tabIndex={0}>{children}</pre>
    </figure>
  );
}

function Table(props: ComponentProps<"table">) {
  return (
    <div className="docs-table" tabIndex={0} role="region" aria-label="Table">
      <table {...props} />
    </div>
  );
}

function anchored(Tag: "h2" | "h3" | "h4") {
  return function Heading({ id, children }: ComponentProps<"h2">) {
    return (
      <Tag id={id}>
        {children}
        {id && (
          <a href={`#${id}`} className="docs-anchor" aria-hidden tabIndex={-1}>
            #
          </a>
        )}
      </Tag>
    );
  };
}

function DocLink({ href = "", children, ...rest }: ComponentProps<"a">) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    );
  }
  const external = /^https?:/.test(href);
  return (
    <a href={href} {...rest} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}

const COMPONENTS: Partial<Components> = {
  pre: CodeBlock as Components["pre"],
  table: Table,
  h2: anchored("h2"),
  h3: anchored("h3"),
  h4: anchored("h4"),
  a: DocLink,
};

export function DocsContent({ tree }: { tree: Root }) {
  return (
    <div className="docs-prose">
      {toJsxRuntime(tree, { Fragment, jsx, jsxs, components: COMPONENTS })}
    </div>
  );
}
