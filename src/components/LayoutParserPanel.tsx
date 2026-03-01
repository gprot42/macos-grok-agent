import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Search, Database, Copy, Check, Download, X, Loader2, Trash2 } from "lucide-react";

type ParserMode = "ocr" | "rag" | "structured";

interface ParseResult {
  id: string;
  mode: ParserMode;
  filename: string;
  result: string;
  timestamp: number;
}

interface LayoutParserPanelProps {
  apiKey: string;
  activeProject: string | null;
}

const MODE_CONFIG: Record<ParserMode, {
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  activeColor: string;
  prompt: string;
}> = {
  ocr: {
    label: "Document OCR",
    description: "Parse text, headings, headers, footers, tables, and figures",
    icon: <FileText className="h-4 w-4" />,
    color: "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800",
    activeColor: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-medium",
    prompt: `You are a document layout parser. Analyze this document and extract ALL content with full layout awareness.

For each element you find, identify its type and preserve the document hierarchy:

1. **Headings** (H1-H6): Mark heading level and text
2. **Headers/Footers**: Identify page headers and footers
3. **Body Text**: Paragraphs with their parent heading context
4. **Tables**: Parse into structured rows and columns, preserving headers
5. **Figures/Images**: Describe any figures, charts, or diagrams with their captions
6. **Lists**: Ordered and unordered lists with nesting
7. **Footnotes/References**: Any citations or footnotes

Output format - use this structured layout:

## Document Structure

### [Page N]

#### Heading: [heading text] (Level: H1/H2/H3...)

**Body Text:**
[paragraph text]

**Table: [caption if any]**
| Column 1 | Column 2 | ... |
|----------|----------|-----|
| data     | data     | ... |

**Figure: [figure number/caption]**
Description: [what the figure shows]

**Header:** [header text]
**Footer:** [footer text]

Be exhaustive. Extract every piece of text and structural element from the document.`,
  },
  rag: {
    label: "Search & RAG",
    description: "Context-aware chunks with ancestral headings for retrieval",
    icon: <Search className="h-4 w-4" />,
    color: "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800",
    activeColor: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium",
    prompt: `You are a document chunking engine optimized for Search and Retrieval Augmented Generation (RAG) pipelines.

Analyze this document and produce context-aware chunks that maximize retrieval quality. Each chunk must be self-contained and include enough context for accurate LLM-generated answers.

Rules for chunking:
1. Each chunk should be 200-500 tokens
2. Include ancestral headings with each chunk (the heading hierarchy above the content)
3. Tables should be kept as complete chunks with their headers
4. Figures/charts should include their captions and surrounding context
5. Never split a paragraph across chunks
6. Each chunk should make sense when read in isolation

Output format:

---
CHUNK 1
Metadata:
  - headings: [H1] > [H2] > [H3] (the heading path)
  - page: N
  - type: text | table | figure | list
  - tokens: ~N

Content:
[The actual chunk content with full heading context prepended]

---
CHUNK 2
Metadata:
  - headings: [H1] > [H2]
  - page: N
  - type: text
  - tokens: ~N

Content:
[chunk content]

---

Continue until the entire document is chunked. Aim for high retrieval quality - each chunk should answer a specific question about the document.`,
  },
  structured: {
    label: "Structured Data",
    description: "Extract tables, figures, and data into structured JSON",
    icon: <Database className="h-4 w-4" />,
    color: "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800",
    activeColor: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-medium",
    prompt: `You are a structured data extraction engine. Analyze this document and extract all structured data into a machine-readable JSON format suitable for database ingestion (e.g., BigQuery, PostgreSQL).

Extract the following into structured JSON:

1. **Document Metadata**: title, author, date, document type, page count
2. **Tables**: Each table as an array of objects with column headers as keys
3. **Key-Value Data**: Any form fields, labeled data pairs, or metrics
4. **Figures & Charts**: Description, type (bar/line/pie/etc.), data points if readable
5. **Financial Data**: If present (e.g., 10-K filings), extract line items with values and periods
6. **Lists & Enumerations**: Structured as arrays
7. **Sections**: Document outline with section titles and page ranges

Output as a single JSON object:

\`\`\`json
{
  "metadata": {
    "title": "",
    "author": "",
    "date": "",
    "type": "",
    "pages": 0
  },
  "sections": [
    { "title": "", "level": 1, "page": 1 }
  ],
  "tables": [
    {
      "id": "table_1",
      "caption": "",
      "page": 1,
      "headers": ["col1", "col2"],
      "rows": [
        { "col1": "val", "col2": "val" }
      ]
    }
  ],
  "figures": [
    {
      "id": "fig_1",
      "caption": "",
      "page": 1,
      "type": "chart|diagram|photo",
      "description": ""
    }
  ],
  "key_value_pairs": [
    { "key": "", "value": "", "context": "" }
  ],
  "financial_data": [],
  "lists": []
}
\`\`\`

Be precise. Extract every data point. Use null for missing fields. Ensure valid JSON output.`,
  },
};

export function LayoutParserPanel({ apiKey, activeProject }: LayoutParserPanelProps) {
  const [mode, setMode] = useState<ParserMode>("ocr");
  const [results, setResults] = useState<ParseResult[]>([]);
  const [runningTasks, setRunningTasks] = useState<{ id: string; filename: string; mode: ParserMode }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLoading = runningTasks.length > 0;

  const handleFileSelect = useCallback(async (file: File) => {
    if (!apiKey) {
      setError("API key required. Set your AI Studio key in Settings.");
      return;
    }

    const ext = file.name.toLowerCase().split(".").pop() || "";
    const supportedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"];
    const supportedExts = ["pdf", "jpg", "jpeg", "png", "webp", "gif", "bmp"];
    if (!supportedTypes.includes(file.type) && !supportedExts.includes(ext)) {
      setError("Supported formats: PDF, JPG, PNG, WebP, GIF, BMP");
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setError("File size must be under 50MB.");
      return;
    }

    setError(null);

    const taskId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const currentMode = mode;
    setRunningTasks((prev) => [...prev, { id: taskId, filename: file.name, mode: currentMode }]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const result = await invoke<string>("layout_parse", {
        fileData: base64,
        mimeType: file.type || "application/pdf",
        mode: currentMode,
        apiKey,
        systemPrompt: MODE_CONFIG[currentMode].prompt,
      });

      setResults((prev) => [{
        id: taskId,
        mode: currentMode,
        filename: file.name,
        result,
        timestamp: Date.now(),
      }, ...prev]);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunningTasks((prev) => prev.filter((t) => t.id !== taskId));
    }
  }, [apiKey, mode]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCopy = async (content: string, id: string) => {
    try {
      await writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  };

  const handleSave = async (content: string, id: string, filename: string) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const ext = mode === "structured" ? "json" : "md";
      const outFilename = `parsed-${filename.replace(/\.pdf$/i, "")}-${timestamp}.${ext}`;

      if (activeProject) {
        const projectPath = await invoke<string>("get_project_path", { projectName: activeProject });
        await invoke("save_to_project", { projectPath, subfolder: "outputs", filename: outFilename, content });
      } else {
        await invoke("save_output", { content, filename: outFilename });
      }

      setSavedId(id);
      setTimeout(() => setSavedId(null), 2000);
    } catch (e) {
      console.error("Save failed:", e);
    }
  };

  const removeResult = (id: string) => {
    setResults((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0">
        {runningTasks.map((task) => (
          <div key={task.id} className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
            <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <div>
                <div className="font-medium">Parsing {task.filename}...</div>
                <div className="text-sm opacity-75">
                  Mode: {MODE_CONFIG[task.mode].label} — This may take a moment for large documents
                </div>
              </div>
            </div>
          </div>
        ))}

        {results.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full theme-text-muted gap-8">
            <div className="text-8xl">📄</div>
            <div className="text-center max-w-xl">
              <div className="text-2xl font-semibold mb-2">Gemini Layout Parser</div>
              <div className="text-lg mb-6">
                Advanced document parsing powered by Gemini's OCR and generative AI
              </div>
              <div className="grid grid-cols-3 gap-4 text-left">
                {(Object.keys(MODE_CONFIG) as ParserMode[]).map((m) => (
                  <div
                    key={m}
                    className="p-4 rounded-xl border theme-border theme-surface hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors cursor-pointer"
                    onClick={() => setMode(m)}
                  >
                    <div className="flex items-center gap-2 mb-2 font-medium theme-text">
                      {MODE_CONFIG[m].icon}
                      {MODE_CONFIG[m].label}
                    </div>
                    <div className="text-sm theme-text-muted leading-relaxed">
                      {MODE_CONFIG[m].description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {results.map((r) => (
            <div key={r.id} className="theme-surface border theme-border rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b theme-border bg-gray-50 dark:bg-gray-800/50">
                {MODE_CONFIG[r.mode].icon}
                <span className="text-sm font-medium theme-text flex-1 truncate">
                  {r.filename}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {MODE_CONFIG[r.mode].label}
                </Badge>
                <span className="text-xs theme-text-muted">
                  {new Date(r.timestamp).toLocaleTimeString()}
                </span>
              </div>

              <div className="p-4 max-h-[600px] overflow-y-auto">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed theme-text">
                  {r.result}
                </pre>
              </div>

              <div className="flex items-center gap-2 px-4 py-2 border-t theme-border bg-gray-50 dark:bg-gray-800/50">
                <button
                  onClick={() => handleCopy(r.result, r.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text transition-colors"
                >
                  {copiedId === r.id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedId === r.id ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={() => handleSave(r.result, r.id, r.filename)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text transition-colors"
                >
                  {savedId === r.id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Download className="h-3.5 w-3.5" />}
                  {savedId === r.id ? "Saved!" : "Save"}
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => removeResult(r.id)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t theme-border p-3 theme-surface space-y-3">
        {error && (
          <div className="p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs theme-text-muted font-medium">Mode:</span>
          <div className="flex gap-1">
            {(Object.keys(MODE_CONFIG) as ParserMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                  mode === m ? MODE_CONFIG[m].activeColor : MODE_CONFIG[m].color
                }`}
              >
                {MODE_CONFIG[m].icon}
                {MODE_CONFIG[m].label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {(results.length > 0 || runningTasks.length > 0) && (
            <button
              onClick={() => { setResults([]); setError(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear All
            </button>
          )}
        </div>

        <div
          className={`relative border-2 border-dashed rounded-xl transition-colors ${
            dragOver
              ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20"
              : "theme-border hover:border-gray-400 dark:hover:border-gray-600"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,application/pdf,image/*"
            onChange={handleInputChange}
            className="hidden"
          />
          <div className="flex items-center justify-center gap-3 py-4 px-4">
            <Upload className="h-5 w-5 theme-text-muted" />
            <span className="text-sm theme-text-muted">
              Drop a PDF or image here, or{" "}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 font-medium underline underline-offset-2"
                disabled={isLoading}
              >
                browse
              </button>
            </span>
            <span className="text-xs theme-text-muted opacity-60">Max 50MB</span>
          </div>
        </div>
      </div>
    </div>
  );
}
