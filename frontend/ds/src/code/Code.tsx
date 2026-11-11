import { Fragment, useMemo } from "react";
import { highlightLines, languageNamed, type Token } from "./highlight";
import "./code.css";

/** One line of highlighted code, as coloured spans. */
export function CodeTokens({ tokens }: { tokens: readonly Token[] }) {
  return (
    <>
      {tokens.map((token, i) =>
        token.className ? (
          <span key={i} className={token.className}>
            {token.text}
          </span>
        ) : (
          <Fragment key={i}>{token.text}</Fragment>
        ),
      )}
    </>
  );
}

/** A block of code in the colours of `language` (a fence's name, such as "ts"); plain when it is not one we know. */
export function HighlightedCode({
  text,
  language,
}: {
  text: string;
  language: string | null | undefined;
}) {
  const lines = useMemo(
    () => highlightLines(text, languageNamed(language)),
    [text, language],
  );
  return (
    <>
      {lines.map((tokens, i) => (
        <Fragment key={i}>
          {i > 0 && "\n"}
          <CodeTokens tokens={tokens} />
        </Fragment>
      ))}
    </>
  );
}
