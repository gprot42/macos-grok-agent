import { useState } from 'react';

// ── Error pattern definitions ────────────────────────────────────────────────

interface ErrorPattern {
  /** Regex that matches the raw output */
  pattern: RegExp;
  /** Short label shown in the sub-agent badge */
  label: string;
  /** Actionable hint surfaced to the developer */
  hint: (match: RegExpMatchArray, output: string) => string;
}

/** Extract the "* What went wrong:" block from Gradle output (handles blank lines). */
function extractWhatWentWrong(output: string): string | null {
  const m = output.match(/\*\s*What went wrong:\s*\n([\s\S]*?)(?:\n\s*\*\s*Try:|\n\s*\*\s*Exception is:|\n\s*BUILD FAILED|\z)/);
  return m ? m[1].trim() : null;
}

/** Last N non-blank lines of output, joined. */
function tailLines(output: string, n: number): string {
  return output.split('\n').filter((l) => l.trim().length > 0).slice(-n).join('\n');
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // Gradle: repository conflict (specific & actionable)
  {
    pattern: /Build was configured to prefer settings repositories over project repositories but repository '([^']+)' was added by build file/,
    label: "Gradle repo conflict",
    hint: (m) =>
      `Repository '${m[1]}' is declared in build.gradle but Gradle settings require all repositories to be declared in settings.gradle. Move the '${m[1]}' repository block from build.gradle into dependencyResolutionManagement { repositories { … } } in settings.gradle.`,
  },
  // Gradle: deprecated DependencyHandler.module (Gradle 9+ removal)
  {
    pattern: /'org\.gradle\.api\.artifacts\.Dependency org\.gradle\.api\.artifacts\.dsl\.DependencyHandler\.module\(java\.lang\.Object\)'/,
    label: "Gradle DependencyHandler.module() removed",
    hint: () =>
      `The DependencyHandler.module(Object) DSL was removed in Gradle 9.x. ` +
      `This is a problem in the project's Gradle build files (build.gradle / settings.gradle / app/build.gradle), NOT in build.sh. ` +
      `Editing build.sh will not fix this — the offending Groovy/Kotlin code is in the .gradle files.\n\n` +
      `Required steps (run these as run_command + read_file + edit_file tool calls):\n` +
      `  1. grep -rn 'module(' build.gradle settings.gradle app/build.gradle buildSrc 2>/dev/null\n` +
      `  2. read_file each .gradle file the grep flagged\n` +
      `  3. edit_file to replace each \`module("group:name:version")\` with the plain string \`"group:name:version"\` (drop the module() wrapper)\n` +
      `     and replace each \`module(":module-name")\` (project ref) with \`project(":module-name")\`\n` +
      `  4. Re-run ./build.sh and verify BUILD SUCCESSFUL\n\n` +
      `Alternative fix: if removing module() is risky, downgrade Gradle to 8.x by editing gradle/wrapper/gradle-wrapper.properties (\`distributionUrl\`) to a Gradle 8.x distribution, or install Gradle 8 and update build.sh to use it.`,
  },
  // Gradle: generic build failure — extract "What went wrong" block
  {
    pattern: /\*\s*What went wrong:/,
    label: "Gradle build failure",
    hint: (_m, output) => {
      const what = extractWhatWentWrong(output);
      if (what) {
        return `Gradle's "What went wrong" reports:\n\n${what}\n\nFix the underlying cause shown above. ` +
          `If it's a missing/removed API, search for that symbol in your build files and replace with the modern equivalent.`;
      }
      return `Gradle build failed. Last lines of output:\n\n${tailLines(output, 12)}`;
    },
  },
  // Gradle/Maven generic BUILD FAILED (only fires if "What went wrong" pattern didn't)
  {
    pattern: /BUILD FAILED/,
    label: "Build failed",
    hint: (_m, output) => {
      const what = extractWhatWentWrong(output);
      const where = output.match(/\*\s*Where:\s*\n([\s\S]*?)(?:\n\s*\*|\z)/);
      const parts: string[] = [];
      if (where) parts.push(`Location: ${where[1].trim()}`);
      if (what) parts.push(`Cause: ${what}`);
      if (parts.length === 0) {
        parts.push(`Last lines of output:\n${tailLines(output, 12)}`);
      }
      return parts.join('\n\n');
    },
  },
  // TypeScript compilation errors
  {
    pattern: /([^\s:]+\.tsx?)\((\d+),(\d+)\):\s+error\s+TS(\d+):\s*(.+)/,
    label: "TypeScript error",
    hint: (m) => `TS${m[4]} in ${m[1]} at line ${m[2]}:${m[3]} — ${m[5].trim()}`,
  },
  {
    pattern: /error TS(\d+):\s*(.+)/,
    label: "TypeScript error",
    hint: (m) => `TS${m[1]}: ${m[2].trim()}`,
  },
  // npm/Node errors
  {
    pattern: /npm ERR!\s+(.+)/,
    label: "npm error",
    hint: (_m, output) => {
      const lines = output
        .split('\n')
        .filter((l) => l.includes('npm ERR!'))
        .map((l) => l.replace(/.*npm ERR!\s*/, ''))
        .filter((l) => l.trim().length > 0)
        .slice(0, 6);
      return lines.length > 0 ? `npm errors:\n${lines.join('\n')}` : 'npm reported an error.';
    },
  },
  // Python traceback
  {
    pattern: /Traceback \(most recent call last\)/,
    label: "Python exception",
    hint: (_m, output) => {
      const idx = output.indexOf('Traceback (most recent call last)');
      const tb = output.slice(idx);
      return `Python traceback:\n\n${tailLines(tb, 10)}`;
    },
  },
  // ModuleNotFoundError / ImportError
  {
    pattern: /(ModuleNotFoundError|ImportError): (.+)/,
    label: "Python import error",
    hint: (m) => `${m[1]}: ${m[2].trim()} — install the missing package or check your PYTHONPATH.`,
  },
  // Rust / cargo
  {
    pattern: /error\[E(\d+)\]:\s*(.+)/,
    label: "Rust compiler error",
    hint: (m) => `E${m[1]}: ${m[2].trim()} — run \`rustc --explain E${m[1]}\` for details.`,
  },
  // Shell: command not found
  {
    pattern: /(?:bash|sh|zsh|fish):\s*(.+):\s*command not found/,
    label: "Command not found",
    hint: (m, output) => {
      const cmd = m[1].trim();
      const lineMatch = output.match(new RegExp(`(?:bash|sh|zsh|fish):\\s*${cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*command not found`));
      const context = lineMatch ? `\nContext: ${lineMatch[0]}` : '';
      const extra = cmd === 'python'
        ? " On macOS / modern Linux, try using `python3` instead of `python`."
        : '';
      return `'${cmd}' is not installed or not on PATH.${extra}${context}\nFix: install '${cmd}' or adjust the command/shell environment.`;
    },
  },
  // Permission denied
  {
    pattern: /permission denied/i,
    label: "Permission denied",
    hint: (_m, output) => {
      // Look for a real file path: must start with / ./ ~/ or contain a path separator
      const pathMatch = output.match(/permission denied[^:\n]*:\s*((?:\.{0,2}\/|~\/)[^\s'")\n]+)/i)
        ?? output.match(/(?:open|access|stat|chmod|exec|cannot open|failed to open)\s+((?:\.{0,2}\/|~\/|\/)[^\s'")\n]+)[^\n]*permission denied/i);
      if (pathMatch) {
        const path = pathMatch[1].trim();
        return `Permission denied on file: ${path}\nRun \`ls -la ${path}\` to check permissions, or \`chmod +x ${path}\` if the file needs to be executable.`;
      }
      // No path found — show the raw line so the user can see the actual context
      const line = output.split('\n').find((l) => /permission denied/i.test(l))?.trim();
      return line
        ? `Permission denied — raw error: ${line}\nCheck the file or directory involved and verify read/write/execute permissions.`
        : "Permission denied — check file or directory permissions.";
    },
  },
  // Generic "error:" line (catch-all, lowest priority)
  {
    pattern: /\berror\b[:\s]+(.{10,200})/i,
    label: "Error detected",
    hint: (m, output) => `${m[1].trim()}\n\nLast lines of output:\n${tailLines(output, 8)}`,
  },
];

// ── Public API ───────────────────────────────────────────────────────────────

export interface SubAgentFinding {
  label: string;
  hint: string;
  /** Tail of the raw output that triggered the finding (for retry context). */
  rawOutput: string;
}

export function useSubAgent() {
  const [reviews, setReviews] = useState<string[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);

  /** Review an LLM response text (called after each chat/agent assistant message). */
  const runReview = async (codeSnippet: string): Promise<string> => {
    setIsReviewing(true);
    const finding = detectErrors(codeSnippet);
    const review = finding
      ? `Sub-agent: ${finding.label} — ${finding.hint}`
      : `Sub-agent review: response looks clean.`;
    setReviews((prev) => [...prev, review]);
    setIsReviewing(false);
    return review;
  };

  /**
   * Analyse raw command/tool output for known error signatures.
   * Returns a finding when an actionable problem is detected, null otherwise.
   */
  const analyzeCommandOutput = (output: string): SubAgentFinding | null => {
    return detectErrors(output);
  };

  return { reviews, isReviewing, runReview, analyzeCommandOutput };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function detectErrors(text: string): SubAgentFinding | null {
  for (const ep of ERROR_PATTERNS) {
    const m = text.match(ep.pattern);
    if (m) {
      return {
        label: ep.label,
        hint: ep.hint(m, text),
        // Cap raw output at last 4 KB to keep retry prompts manageable.
        rawOutput: text.length > 4000 ? text.slice(-4000) : text,
      };
    }
  }
  return null;
}
