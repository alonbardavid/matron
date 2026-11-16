import { Anchor, Box, Typography } from "@mantine/core";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightedCode } from "./code/Code";
import "./markdown.css";

const components: Components = {
  a: ({ href, children }) => (
    <Anchor href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Anchor>
  ),
  img: ({ src, alt }) => (
    <Anchor href={src} target="_blank" rel="noopener noreferrer">
      {alt || src}
    </Anchor>
  ),
  // A fence that names its language is coloured; inline code and other fences stay plain.
  code: ({ className, children }) => {
    const language = /\blanguage-([\w+#.-]+)/.exec(className ?? "")?.[1];
    if (!language || typeof children !== "string") {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className={className}>
        <HighlightedCode text={children.replace(/\n$/, "")} language={language} />
      </code>
    );
  },
};

const inlineComponents: Components = {
  ...components,
  p: ({ children }) => <>{children}</>,
};

interface MarkdownProps {
  text: string;
  /** Render without block spacing, for a single line of text. */
  inline?: boolean;
}

export function Markdown({ text, inline = false }: MarkdownProps) {
  if (inline) {
    return (
      <Box component="span">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineComponents}>
          {text}
        </ReactMarkdown>
      </Box>
    );
  }
  return (
    <Typography fz="sm" className="matron-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </Typography>
  );
}
