import type { CSSProperties, ReactNode } from "react";
import { Code2 } from "lucide-react";

/** Decorative code is revealed once in sequence; the real form never waits for it. */
export function LoginCodePreview({ comment }: { comment: string }) {
  const lines: { text: string; content: ReactNode }[] = [
    { text: `// ${comment}`, content: <span className="adm-login-code-comment">{"//"} {comment}</span> },
    { text: "const workspace = {", content: <><span className="adm-login-code-keyword">const</span>{" workspace = {"}</> },
    { text: '  name: "AlleyBiz",', content: <>{"  name: "}<span className="adm-login-code-string">&quot;AlleyBiz&quot;</span>,</> },
    { text: "  leads: true,", content: <>{"  leads: "}<span className="adm-login-code-value">true</span>,</> },
    { text: "  conversations: true,", content: <>{"  conversations: "}<span className="adm-login-code-value">true</span>,</> },
    { text: "  reviews: true,", content: <>{"  reviews: "}<span className="adm-login-code-value">true</span>,</> },
    { text: "};", content: "};" },
  ];
  let delay = 120;

  return (
    <div className="adm-login-editor" aria-hidden="true">
      <div className="adm-login-editor-bar">
        <span className="adm-login-window-dots"><i /><i /><i /></span>
        <span>alleybiz.workspace</span><Code2 size={16} />
      </div>
      <div className="adm-login-code">
        {lines.map((line, index) => {
          const duration = Math.max(80, line.text.length * 9);
          const style = { "--code-chars": line.text.length, "--code-delay": `${delay}ms`, "--code-duration": `${duration}ms` } as CSSProperties;
          delay += duration + 35;
          return (
            <div key={line.text}>
              <span className="adm-login-line-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="adm-login-code-text" data-final={index === lines.length - 1 || undefined} style={style}>{line.content}</span>
            </div>
          );
        })}
      </div>
      <div className="adm-login-editor-footer"><span>TypeScript</span><span>UTF-8 <span>⌘</span></span></div>
    </div>
  );
}
