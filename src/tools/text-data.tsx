// Text & Data tools. Loaded on demand by ToolRenderer in src/App.tsx.
import { useEffect, useRef, useState } from "react";
import { simpleMarkdownToHtml } from "../utils/format.js";
import { safeFilename, withExtension } from "../utils/safe-filename.js";
import { validateFiles } from "../services/file-validator.js";
import { downloadBytes, downloadText } from "../services/download.service.js";
import { csvToJson, jsonToCsv } from "../services/csv.service.js";
import { textToPdf } from "../services/pdf.service.js";
import { extractPdfText } from "../services/pdf-render.service.js";
import { diffToText, jsonToYaml, lineDiff, textStats, urlDecode, urlEncode } from "../services/text-tools.service.js";
import { csvToPdf, markdownToPdf } from "../services/convert.service.js";
import { createSpeechRecognizer, speechRecognitionSupport } from "../services/audio.service.js";
import { buildPassageIndex, chunkPages, highlightSegments, searchPassages, summarizeText } from "../services/nlp.service.js";
import { buildAnswerPrompt, buildSummaryPrompt, clearLlmSettings, endpointOrigin, isLlmConfigured, maskApiKey, readLlmSettings, requestChatCompletion, saveLlmSettings, translateDocument } from "../services/llm.service.js";
import { initialStatus, ToolForm, ProgressBar, StatusBox, ResultConsequenceNote, FileControl, Input, Textarea, Select, Checkbox, PrimaryButton, SecondaryButton, pageProgress, runSafely, requireOutput, copyText } from "./shared";
import type { Tool } from "./shared";

function ExtractTextTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setText(""); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Extract text" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const extracted = await extractPdfText(file);
      setText(extracted);
      return extracted.trim()
        ? "Extracted text from the PDF."
        : "No selectable text found — this PDF is likely scanned images.";
    })} />
    <Textarea label="Extracted text" value={text} onChange={setText} rows={12} />
    <div className="flex flex-wrap gap-2">
      <SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(text); return "Copied."; })} />
      <SecondaryButton label="Download .txt" onClick={() => runSafely(setStatus, async () => {
        downloadText(requireOutput(text), `${safeFilename(files[0]?.name || "extracted")}-text`, "txt");
        return "Text file ready to download.";
      })} />
    </div>
  </ToolForm>;
}

type LlmSettings = ReturnType<typeof readLlmSettings>;
type SummaryResult = ReturnType<typeof summarizeText>;
type PassageIndex = ReturnType<typeof buildPassageIndex>;
type PassageHit = ReturnType<typeof searchPassages>[number];
type QaEntry = { id: number; question: string; hits: PassageHit[]; answer: string };

const NO_PDF_TEXT_MESSAGE = "No selectable text found — this PDF is likely scanned images. Run the OCR / Searchable PDF tool first, then use the searchable PDF it produces.";

/**
 * Optional bring-your-own-LLM settings, stored in localStorage on this device.
 * Off by default; while it is off no tool in this app makes a network request.
 */
function LlmEndpointPanel({ settings, onChange }: { settings: LlmSettings; onChange: (next: LlmSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [panelStatus, setPanelStatus] = useState(initialStatus);
  const configured = isLlmConfigured(settings);
  const origin = endpointOrigin(settings.baseUrl);

  return (
    <div className="surface-muted wabi-card-edge grid gap-3 p-4 text-sm font-semibold leading-6 text-neutral-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase text-neutral-500">Optional AI endpoint — {configured ? "on" : "off"}</p>
        <button className="secondary-button" type="button" onClick={() => setOpen(!open)}>{open ? "Hide settings" : "Settings"}</button>
      </div>
      <p>
        {configured
          ? `Your own endpoint is switched on. When you press an AI button, the document text is sent to ${origin} and is no longer local. Nothing is sent until you press one.`
          : "This tool is fully local. You can optionally point it at your own OpenAI-compatible endpoint; until you do, nothing leaves this device."}
      </p>
      {open && (
        <div className="grid gap-3">
          <p className="text-xs font-semibold text-neutral-500">
            The key is stored only in this browser's localStorage, is never placed in a URL, and is only ever sent as an Authorization header to the endpoint you enter.
            MyFileKit ships a strict Content-Security-Policy that blocks every outbound connection, so a custom endpoint only works on a deploy where you have added
            <span className="whitespace-pre"> connect-src 'self' &lt;your origin&gt; </span>
            to index.html and public/_headers.
          </p>
          <Input label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com/v1" helper="Requests go to <base URL>/chat/completions." />
          <Input label="Model" value={model} onChange={setModel} placeholder="gpt-4o-mini" />
          <Input label="API key" value={apiKey} onChange={setApiKey} type="password" helper={settings.apiKey ? `Saved key: ${maskApiKey(settings.apiKey)}. Leave blank to keep it.` : "Stored on this device only."} />
          <StatusBox status={panelStatus} />
          <div className="flex flex-wrap gap-2">
            <SecondaryButton label="Save and enable" onClick={() => runSafely(setPanelStatus, async () => {
              const next = saveLlmSettings({ enabled: true, baseUrl, model, apiKey: apiKey || settings.apiKey });
              onChange(next);
              setApiKey("");
              return `Enabled. AI actions will send text to ${endpointOrigin(next.baseUrl)}.`;
            })} />
            <SecondaryButton label="Turn off and forget" onClick={() => runSafely(setPanelStatus, async () => {
              onChange(clearLlmSettings());
              setBaseUrl("");
              setModel("");
              setApiKey("");
              return "Endpoint cleared. Everything is local again.";
            })} />
          </div>
        </div>
      )}
    </div>
  );
}

function KeywordChips({ keywords }: { keywords: SummaryResult["keywords"] }) {
  if (!keywords.length) return null;
  return (
    <div className="grid gap-2">
      <p className="text-xs font-bold uppercase text-neutral-500">Top keywords</p>
      <div className="flex flex-wrap gap-2">
        {keywords.map((keyword) => (
          <span key={keyword.term} className="tag-badge rounded-full px-3 py-1 text-xs font-bold">{keyword.term} · {keyword.count}</span>
        ))}
      </div>
    </div>
  );
}

/** Highlights matched terms with React nodes, so document text is never raw HTML. */
function HighlightedPassage({ text, terms }: { text: string; terms: string[] }) {
  return (
    <p className="text-sm font-semibold leading-6 text-[var(--foreground)]">
      {highlightSegments(text, terms).map((segment, position) => (
        segment.match
          ? <mark key={position} className="rounded bg-[color-mix(in_srgb,var(--primary)_22%,transparent)] px-0.5 text-[var(--foreground)]">{segment.text}</mark>
          : <span key={position}>{segment.text}</span>
      ))}
    </p>
  );
}

function SummarizePdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [length, setLength] = useState("5");
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [aiSummary, setAiSummary] = useState("");
  const [settings, setSettings] = useState<LlmSettings>(() => readLlmSettings());
  const [status, setStatus] = useState(initialStatus);

  const lengthOptions = ["3", "5", "10", "p10", "p25"];
  const lengthLabels = ["3 sentences", "5 sentences", "10 sentences", "10% of the document", "25% of the document"];
  const baseName = safeFilename(files[0]?.name || "document");

  const summaryDocument = () => {
    if (!result) throw new Error("Summarise a PDF first.");
    const lines = [
      `Summary of ${files[0]?.name || "document"}`,
      `${result.stats.returned} of ${result.stats.sentenceCount} sentences · ${result.stats.wordCount} words in the source`,
      "",
      ...result.sentences.map((sentence, position) => `${position + 1}. ${sentence.text}`),
      "",
      `Keywords: ${result.keywords.map((keyword) => keyword.term).join(", ")}`,
    ];
    if (aiSummary) lines.push("", "Abstractive summary from your own endpoint:", aiSummary);
    return lines.join("\n");
  };

  const reset = () => {
    setFiles([]);
    setText("");
    setResult(null);
    setAiSummary("");
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Extracts the PDF's text, then ranks its sentences with a local TextRank graph over TF-IDF similarity and returns the most central ones, skipping near-duplicates. This is an <strong>extractive</strong> summary: every sentence is copied verbatim from the document, so nothing is invented — but it will not read like freshly written prose.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setText(""); setResult(null); setAiSummary(""); }} />
    <Select label="Summary length" value={length} onChange={setLength} options={lengthOptions} labels={lengthLabels} />
    <PrimaryButton label="Summarise PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      let source = text;
      if (!source.trim()) {
        source = await extractPdfText(file, { onProgress: pageProgress(setStatus, "Reading") });
        if (!source.trim()) throw new Error(NO_PDF_TEXT_MESSAGE);
        setText(source);
      }
      setStatus({ tone: "idle", message: "Ranking sentences…" });
      const options = length.startsWith("p") ? { percent: Number(length.slice(1)) } : { sentences: Number(length) };
      const summary = summarizeText(source, options);
      setResult(summary);
      setAiSummary("");
      return `Kept ${summary.stats.returned} of ${summary.stats.sentenceCount} sentences.`;
    })} />
    {result && (
      <div className="surface-card grid gap-4 rounded-3xl p-5">
        <div>
          <p className="text-xs font-bold uppercase text-neutral-500">Extractive summary</p>
          <ol className="mt-2 grid list-decimal gap-2 pl-5 text-sm font-semibold leading-6 text-[var(--foreground)]">
            {result.sentences.map((sentence) => <li key={sentence.index}>{sentence.text}</li>)}
          </ol>
        </div>
        <KeywordChips keywords={result.keywords} />
        <p className="text-xs font-semibold text-neutral-500">
          {result.stats.wordCount} words · {result.stats.sentenceCount} sentences · ranked {result.stats.graphSentences} candidates
        </p>
      </div>
    )}
    <div className="flex flex-wrap gap-2">
      <SecondaryButton label="Copy summary" onClick={() => runSafely(setStatus, async () => { await copyText(result?.summary || ""); return "Copied."; })} />
      <SecondaryButton label="Download .txt" onClick={() => runSafely(setStatus, async () => {
        downloadText(requireOutput(summaryDocument()), `${baseName}-summary`, "txt");
        return "Text file ready to download.";
      })} />
      <SecondaryButton label="Download .pdf" onClick={() => runSafely(setStatus, async () => {
        downloadBytes(await textToPdf(requireOutput(summaryDocument())), withExtension(`${baseName}-summary`, "pdf"), "application/pdf");
        return "Summary PDF ready to download.";
      })} />
    </div>
    <LlmEndpointPanel settings={settings} onChange={setSettings} />
    {isLlmConfigured(settings) && (
      <div className="grid gap-3">
        <PrimaryButton label={`Abstractive summary (sends text to ${endpointOrigin(settings.baseUrl)})`} onClick={() => runSafely(setStatus, async () => {
          const source = requireOutput(text);
          const { system, prompt, truncated } = buildSummaryPrompt(source);
          setStatus({ tone: "idle", message: `Sending the document text to ${endpointOrigin(settings.baseUrl)}…` });
          const answer = await requestChatCompletion({ settings, system, prompt });
          setAiSummary(answer);
          return truncated ? "Abstractive summary received (the document was truncated to fit)." : "Abstractive summary received.";
        })} />
        {aiSummary && (
          <div className="surface-card grid gap-2 rounded-3xl p-5">
            <p className="text-xs font-bold uppercase text-neutral-500">Abstractive summary — generated off this device</p>
            <p className="whitespace-pre-line text-sm font-semibold leading-6 text-[var(--foreground)]">{aiSummary}</p>
          </div>
        )}
      </div>
    )}
  </ToolForm>;
}

function ChatWithPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [index, setIndex] = useState<PassageIndex | null>(null);
  const [question, setQuestion] = useState("");
  const [topN, setTopN] = useState("3");
  const [history, setHistory] = useState<QaEntry[]>([]);
  const [settings, setSettings] = useState<LlmSettings>(() => readLlmSettings());
  const [status, setStatus] = useState(initialStatus);

  const baseName = safeFilename(files[0]?.name || "document");
  const configured = isLlmConfigured(settings);

  const transcript = () => {
    if (!history.length) throw new Error("Ask a question first.");
    return [`Questions about ${files[0]?.name || "document"}`, ""].concat(
      [...history].reverse().flatMap((entry) => [
        `Q: ${entry.question}`,
        ...entry.hits.map((hit) => `  [page ${hit.page}] ${hit.chunk.text}`),
        ...(entry.answer ? ["", `  Generated answer (from your endpoint): ${entry.answer}`] : []),
        "",
      ])
    ).join("\n");
  };

  const generateAnswer = (entry: QaEntry) => runSafely(setStatus, async () => {
    const { system, prompt } = buildAnswerPrompt(entry.question, entry.hits);
    setStatus({ tone: "idle", message: `Sending ${entry.hits.length} passages to ${endpointOrigin(settings.baseUrl)}…` });
    const answer = await requestChatCompletion({ settings, system, prompt });
    setHistory((current) => current.map((item) => (item.id === entry.id ? { ...item, answer } : item)));
    return "Answer generated from the retrieved passages.";
  });

  const reset = () => {
    setFiles([]);
    setIndex(null);
    setQuestion("");
    setHistory([]);
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      By default this is a <strong>local search</strong>, not a chatbot. It indexes the PDF page by page with BM25 and returns the passages that best match your question, with page numbers and matched terms highlighted. It does not write prose and it never invents an answer — you read the source text and judge it yourself.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setIndex(null); setHistory([]); }} />
    <PrimaryButton label="Index this PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const pages: { page: number; text: string }[] = [];
      await extractPdfText(file, {
        onProgress: pageProgress(setStatus, "Reading"),
        onPage: (page: number, pageText: string) => pages.push({ page, text: pageText }),
      });
      if (!pages.some((page) => page.text.trim())) throw new Error(NO_PDF_TEXT_MESSAGE);
      setStatus({ tone: "idle", message: "Building the search index…" });
      const built = buildPassageIndex(chunkPages(pages));
      if (!built.count) throw new Error("This PDF has text but no passages long enough to search.");
      setIndex(built);
      setHistory([]);
      return `Indexed ${built.count} passage${built.count === 1 ? "" : "s"} across ${built.pageCount} page${built.pageCount === 1 ? "" : "s"}. Ask a question.`;
    })} />
    <Input label="Your question" value={question} onChange={setQuestion} placeholder="What is the payment deadline?" helper={index ? `${index.count} passages indexed. Follow-up questions re-search the same index.` : "Index a PDF first."} />
    <Select label="Passages to return" value={topN} onChange={setTopN} options={["3", "5", "8"]} labels={["Top 3", "Top 5", "Top 8"]} />
    <PrimaryButton label="Find answer passages" disabled={!index} onClick={() => runSafely(setStatus, async () => {
      if (!index) throw new Error("Index a PDF before asking a question.");
      if (!question.trim()) throw new Error("Type a question first.");
      const hits = searchPassages(index, question, { limit: Number(topN) });
      if (!hits.length) throw new Error("No passage in this PDF matches those words. Try different terms.");
      setHistory((current) => [{ id: current.length + 1, question: question.trim(), hits, answer: "" }, ...current]);
      return `Found ${hits.length} passage${hits.length === 1 ? "" : "s"} on page${hits.length === 1 ? "" : "s"} ${[...new Set(hits.map((hit) => hit.page))].join(", ")}.`;
    })} />
    {history.map((entry) => (
      <div key={entry.id} className="surface-card grid gap-3 rounded-3xl p-5">
        <p className="text-xs font-bold uppercase text-neutral-500">Question</p>
        <p className="text-sm font-bold text-[var(--foreground)]">{entry.question}</p>
        {entry.hits.map((hit) => (
          <div key={hit.chunk.id} className="surface-muted wabi-card-edge grid gap-1 p-4">
            <p className="text-xs font-bold uppercase text-neutral-500">Page {hit.page} · relevance {hit.score.toFixed(2)}</p>
            <HighlightedPassage text={hit.chunk.text} terms={hit.matchedTerms} />
          </div>
        ))}
        {configured && <SecondaryButton label={`Generate an answer from these passages (sends them to ${endpointOrigin(settings.baseUrl)})`} onClick={() => generateAnswer(entry)} />}
        {entry.answer && (
          <div className="surface-muted wabi-card-edge grid gap-1 p-4">
            <p className="text-xs font-bold uppercase text-neutral-500">Generated answer — produced off this device</p>
            <p className="whitespace-pre-line text-sm font-semibold leading-6 text-[var(--foreground)]">{entry.answer}</p>
          </div>
        )}
      </div>
    ))}
    <div className="flex flex-wrap gap-2">
      <SecondaryButton label="Copy history" onClick={() => runSafely(setStatus, async () => { await copyText(transcript()); return "Copied."; })} />
      <SecondaryButton label="Download .txt" onClick={() => runSafely(setStatus, async () => {
        downloadText(requireOutput(transcript()), `${baseName}-questions`, "txt");
        return "Text file ready to download.";
      })} />
      <SecondaryButton label="Download .pdf" onClick={() => runSafely(setStatus, async () => {
        downloadBytes(await textToPdf(requireOutput(transcript())), withExtension(`${baseName}-questions`, "pdf"), "application/pdf");
        return "Q&A PDF ready to download.";
      })} />
    </div>
    <LlmEndpointPanel settings={settings} onChange={setSettings} />
  </ToolForm>;
}

const TRANSLATE_LANGUAGES = [
  "Arabic", "Bengali", "Chinese (Simplified)", "Dutch", "English", "French", "German",
  "Gujarati", "Hindi", "Indonesian", "Italian", "Japanese", "Kannada", "Korean",
  "Malayalam", "Marathi", "Portuguese", "Punjabi", "Russian", "Spanish", "Tamil",
  "Telugu", "Thai", "Turkish", "Ukrainian", "Vietnamese",
];

function TranslatePdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("Spanish");
  const [translation, setTranslation] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [settings, setSettings] = useState<LlmSettings>(() => readLlmSettings());
  const [status, setStatus] = useState(initialStatus);

  const configured = isLlmConfigured(settings);
  const baseName = safeFilename(files[0]?.name || "document");

  const reset = () => {
    setFiles([]); setText(""); setTranslation(""); setProgress(null); setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Extracting the PDF's text is <strong>100% local</strong>. Translation is not: it needs your own OpenAI-compatible endpoint, configured below and <strong>off by default</strong>. Until you turn one on, nothing is sent and no translation happens — this tool does not pretend to translate offline. Long documents are split into ordered chunks that fit the model, translated one at a time, and reassembled.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setText(""); setTranslation(""); setProgress(null); }} label="Choose the PDF to translate" />
    <Select label="Translate into" value={language} onChange={setLanguage} options={TRANSLATE_LANGUAGES} />
    <SecondaryButton label="Extract text (local)" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const source = await extractPdfText(file, { onProgress: pageProgress(setStatus, "Reading") });
      if (!source.trim()) throw new Error(NO_PDF_TEXT_MESSAGE);
      setText(source);
      setTranslation("");
      return `Extracted ${source.length.toLocaleString()} characters. ${configured ? "Press Translate to send them to your endpoint." : "Configure your endpoint below to translate."}`;
    })} />
    {text && (
      <div className="surface-card grid gap-2 rounded-3xl p-5">
        <p className="text-xs font-bold uppercase text-neutral-500">Extracted text (local, not yet sent anywhere)</p>
        <p className="max-h-40 overflow-auto whitespace-pre-line text-sm font-semibold leading-6 text-[var(--foreground)]">{text.slice(0, 2000)}{text.length > 2000 ? "\n…" : ""}</p>
      </div>
    )}
    <LlmEndpointPanel settings={settings} onChange={setSettings} />
    {configured ? (
      <PrimaryButton label={`Translate to ${language} (sends text to ${endpointOrigin(settings.baseUrl)})`} onClick={() => runSafely(setStatus, async () => {
        let source = text;
        if (!source.trim()) {
          const [file] = validateFiles(files, tool.file);
          source = await extractPdfText(file, { onProgress: pageProgress(setStatus, "Reading") });
          if (!source.trim()) throw new Error(NO_PDF_TEXT_MESSAGE);
          setText(source);
        }
        setTranslation("");
        setProgress({ done: 0, total: 1 });
        const result = await translateDocument(source, {
          settings,
          targetLanguage: language,
          onProgress: (done: number, total: number) => setProgress({ done, total }),
        });
        setTranslation(result.text);
        setProgress(null);
        return `Translated ${result.chunks} chunk${result.chunks === 1 ? "" : "s"} into ${language} via ${endpointOrigin(settings.baseUrl)}.`;
      })} />
    ) : (
      <p className="text-sm font-semibold leading-6 text-neutral-600">
        No endpoint is configured, so translation is unavailable. Open the panel above, add your own OpenAI-compatible endpoint, and allow its origin in <span className="whitespace-pre">connect-src</span>. Nothing leaves this device until you do.
      </p>
    )}
    {progress && <ProgressBar value={progress.done} total={progress.total} label={`Translating chunk ${Math.min(progress.done + 1, progress.total)} of ${progress.total} into ${language}`} />}
    {translation && (
      <div className="surface-card grid gap-3 rounded-3xl p-5">
        <p className="text-xs font-bold uppercase text-neutral-500">Translation — {language} · generated off this device</p>
        <p className="whitespace-pre-line text-sm font-semibold leading-6 text-[var(--foreground)]">{translation}</p>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton label="Copy translation" onClick={() => runSafely(setStatus, async () => { await copyText(translation); return "Copied."; })} />
          <SecondaryButton label="Download .txt" onClick={() => runSafely(setStatus, async () => {
            downloadText(requireOutput(translation), `${baseName}-${safeFilename(language)}`, "txt");
            return "Text file ready to download.";
          })} />
          <SecondaryButton label="Download .pdf" onClick={() => runSafely(setStatus, async () => {
            downloadBytes(await textToPdf(requireOutput(translation)), withExtension(`${baseName}-${safeFilename(language)}`, "pdf"), "application/pdf");
            return "Translated PDF ready to download.";
          })} />
        </div>
      </div>
    )}
    {translation && <ResultConsequenceNote>This translation was produced by <strong>your own endpoint</strong>, off this device — its accuracy and privacy are whatever that endpoint provides. A machine translation is a draft, not a certified translation. The text export uses Latin-1 fonts, so a PDF export of a non-Latin script may not render; use the .txt export for those.</ResultConsequenceNote>}
  </ToolForm>;
}

function TextToPdfTool() {
  const [text, setText] = useState("Paste text here...");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setText(""); setStatus(initialStatus); }}>
    <Textarea label="Text" value={text} onChange={setText} rows={14} />
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => { downloadBytes(await textToPdf(text), "myfilekit-text.pdf", "application/pdf"); return "PDF downloaded."; })} />
  </ToolForm>;
}

function MarkdownTool() {
  const [markdown, setMarkdown] = useState("# Heading\n\n- Item");
  const html = simpleMarkdownToHtml(markdown);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setMarkdown(""); setStatus(initialStatus); }}>
    <Textarea label="Markdown" value={markdown} onChange={setMarkdown} rows={10} />
    <div className="surface-card wabi-card-edge grid gap-3 p-4">{renderMarkdownPreview(markdown)}</div>
    <PrimaryButton label="Download HTML" onClick={() => runSafely(setStatus, async () => {
      if (!markdown.trim()) throw new Error("Add Markdown before downloading.");
      downloadText(html, "markdown-preview", "html", "text/html;charset=utf-8");
      return "HTML downloaded.";
    })} />
  </ToolForm>;
}

function renderMarkdownPreview(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    listItems = [];
    nodes.push(<ul key={`list-${nodes.length}`} className="list-disc pl-5 text-sm font-semibold leading-7 text-neutral-700">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>);
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    if (trimmed.startsWith("- ")) {
      listItems.push(trimmed.slice(2));
      return;
    }
    flushList();
    if (trimmed.startsWith("# ")) {
      nodes.push(<h1 key={index} className="font-display text-2xl font-black">{trimmed.slice(2)}</h1>);
    } else if (trimmed.startsWith("## ")) {
      nodes.push(<h2 key={index} className="font-display text-xl font-black">{trimmed.slice(3)}</h2>);
    } else {
      nodes.push(<p key={index} className="text-sm font-semibold leading-7 text-neutral-700">{trimmed}</p>);
    }
  });
  flushList();

  return nodes.length ? nodes : <p className="text-sm font-semibold text-neutral-500">Markdown preview will appear here.</p>;
}

function MarkdownToPdfTool() {
  const [markdown, setMarkdown] = useState("# MyFileKit\n\nThis Markdown becomes a clean, crisp PDF.\n\n## Features\n\n- Headings render larger and bold\n- Bullet lists are indented\n- Long paragraphs wrap neatly inside the page margins");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setMarkdown(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Builds vector text with pdf-lib, so the PDF stays crisp at any zoom. Supports Latin-1 characters only (no CJK/emoji).
    </div>
    <Textarea label="Markdown" value={markdown} onChange={setMarkdown} rows={12} />
    <div className="surface-card wabi-card-edge grid gap-3 p-4">{renderMarkdownPreview(markdown)}</div>
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      downloadBytes(await markdownToPdf(markdown), "myfilekit-markdown.pdf", "application/pdf");
      return "Markdown PDF downloaded.";
    })} />
  </ToolForm>;
}

function CsvToPdfTool() {
  const [csv, setCsv] = useState("name,role,city\nAlex,Engineer,London\nSam,Designer,Berlin\nJordan,Product Manager,San Francisco");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setCsv(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      The first row becomes a bold header. Long cells wrap and the table paginates across pages. Supports Latin-1 characters only.
    </div>
    <Textarea label="CSV" value={csv} onChange={setCsv} rows={12} />
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      downloadBytes(await csvToPdf(csv), "myfilekit-table.pdf", "application/pdf");
      return "CSV table PDF downloaded.";
    })} />
  </ToolForm>;
}

function AudioToPdfTool() {
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [title, setTitle] = useState("Transcript");
  const [listening, setListening] = useState(false);
  const [onDeviceOnly, setOnDeviceOnly] = useState(true);
  const [status, setStatus] = useState(initialStatus);
  const recognizer = useRef<any>(null);
  const support = speechRecognitionSupport();

  // Capability is detected synchronously; the note is plain honesty about what
  // pressing "Start dictation" will actually do in this browser.
  const engineNote = !support.supported
    ? "This browser has no built-in speech recognition, so dictation is unavailable here. Paste or type the transcript below — that path is fully offline."
    : onDeviceOnly
      ? support.canRunOnDevice
        ? "Dictation will ask this browser to recognise speech on your device. If it cannot, it stops with an error rather than sending your audio anywhere."
        : "This browser cannot keep recognition on your device, so dictation is blocked while the box below is ticked. Untick it to allow cloud recognition, or paste the transcript instead."
      : "Heads up: with on-device recognition off, this browser may send your audio to its vendor's servers. Every other MyFileKit tool stays local — paste or type the transcript instead if you need a fully offline path.";

  const stopListening = () => {
    recognizer.current?.stop();
    recognizer.current = null;
    setListening(false);
    setInterim("");
  };

  // Always release the microphone when the tool unmounts.
  useEffect(() => () => { recognizer.current?.stop(); recognizer.current = null; }, []);

  const reset = () => {
    stopListening();
    setTranscript("");
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Two ways in: dictate with your microphone using the browser's own speech recognition, or paste a transcript you already have. The PDF is always built locally. The microphone is released as soon as you stop or leave this tool.
    </div>
    <StatusBox status={{ tone: support.supported ? "idle" : "error", message: engineNote }} />
    <Checkbox label="Require on-device recognition (never send audio to a server)" checked={onDeviceOnly} onChange={setOnDeviceOnly} />
    <div className="flex flex-wrap gap-2">
      {listening
        ? <SecondaryButton label="Stop dictation" onClick={stopListening} />
        : <SecondaryButton label="Start dictation" onClick={() => runSafely(setStatus, async () => {
            if (recognizer.current) throw new Error("Already listening.");
            const instance = await createSpeechRecognizer({
              requireOnDevice: onDeviceOnly,
              onTranscript: ({ final, interim: partial }: { final: string; interim: string }) => {
                if (final.trim()) setTranscript((previous) => (previous ? `${previous} ${final.trim()}` : final.trim()));
                setInterim(partial);
              },
              onError: (message: string) => setStatus({ tone: "error", message }),
              onEnd: () => { setListening(false); setInterim(""); },
            });
            recognizer.current = instance;
            instance.start();
            setListening(true);
            return instance.local
              ? "Listening on-device. Speak, then stop when you are done."
              : "Listening. Speak, then stop when you are done.";
          })} />}
    </div>
    {listening && interim && <p className="text-sm font-semibold italic text-neutral-500">Hearing: {interim}</p>}
    <Input label="PDF title" value={title} onChange={setTitle} placeholder="Transcript" />
    <Textarea label="Transcript" value={transcript} onChange={setTranscript} rows={12} />
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      const body = requireOutput(transcript);
      const heading = title.trim() || "Transcript";
      const document = `${heading}\n${new Date().toLocaleString()}\n\n${body.trim()}\n`;
      downloadBytes(await textToPdf(document), withExtension(heading, "pdf"), "application/pdf");
      return "Transcript PDF ready.";
    })} />
  </ToolForm>;
}

function JsonTool() {
  const [input, setInput] = useState('{"hello":"world"}');
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const transform = (spaces: number) => runSafely(setStatus, async () => { const next = JSON.stringify(JSON.parse(input), null, spaces); setOutput(next); return spaces ? "JSON formatted." : "JSON minified."; });
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="JSON input" value={input} onChange={setInput} rows={10} />
    <Textarea label="Result" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Format" onClick={() => transform(2)} />
      <SecondaryButton label="Minify" onClick={() => transform(0)} />
      <SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output || input)); return "Copied."; })} />
      <SecondaryButton label="Download JSON" onClick={() => runSafely(setStatus, async () => { downloadText(requireOutput(output || input), "formatted", "json", "application/json;charset=utf-8"); return "JSON ready to download."; })} />
    </div>
  </ToolForm>;
}

function CsvToJsonTool() {
  const [input, setInput] = useState("name,email\nAlex,alex@example.com");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="CSV input" value={input} onChange={setInput} rows={9} />
    <Textarea label="JSON output" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Convert" onClick={() => runSafely(setStatus, async () => { setOutput(JSON.stringify(csvToJson(input), null, 2)); return "CSV converted."; })} />
      <SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return "Copied."; })} />
      <SecondaryButton label="Download JSON" onClick={() => runSafely(setStatus, async () => { downloadText(requireOutput(output), "converted", "json", "application/json;charset=utf-8"); return "JSON ready to download."; })} />
    </div>
  </ToolForm>;
}

function JsonToCsvTool() {
  const [input, setInput] = useState('[{"name":"Alex","email":"alex@example.com"}]');
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="JSON input" value={input} onChange={setInput} rows={9} />
    <Textarea label="CSV output" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2"><PrimaryButton label="Convert" onClick={() => runSafely(setStatus, async () => { setOutput(jsonToCsv(input)); return "JSON converted."; })} /><SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return "Copied."; })} /><SecondaryButton label="Download CSV" onClick={() => runSafely(setStatus, async () => { downloadText(requireOutput(output), "converted", "csv", "text/csv;charset=utf-8"); return "CSV ready to download."; })} /></div>
  </ToolForm>;
}

function JsonToYamlTool() {
  const [input, setInput] = useState('{"name":"MyFileKit","local":true,"tools":["pdf","image","data"]}');
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="JSON input" value={input} onChange={setInput} rows={9} />
    <Textarea label="YAML output" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Convert to YAML" onClick={() => runSafely(setStatus, async () => { setOutput(jsonToYaml(input)); return "JSON converted to YAML."; })} />
      <SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return "Copied."; })} />
      <SecondaryButton label="Download YAML" onClick={() => runSafely(setStatus, async () => { downloadText(requireOutput(output), "converted", "yaml", "text/yaml;charset=utf-8"); return "YAML ready to download."; })} />
    </div>
  </ToolForm>;
}

function UrlCodecTool() {
  const [input, setInput] = useState("https://example.com/search?q=MyFileKit tools");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="Input" value={input} onChange={setInput} rows={7} />
    <Textarea label="Output" value={output} onChange={setOutput} rows={7} />
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Encode URL text" onClick={() => runSafely(setStatus, async () => { if (!input.trim()) throw new Error("Enter text to encode."); setOutput(urlEncode(input)); return "URL text encoded."; })} />
      <SecondaryButton label="Decode URL text" onClick={() => runSafely(setStatus, async () => { setOutput(urlDecode(input)); return "URL text decoded."; })} />
    </div>
  </ToolForm>;
}

function DiffCheckerTool() {
  const [left, setLeft] = useState("Line one\nLine two");
  const [right, setRight] = useState("Line one\nLine two updated");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setLeft(""); setRight(""); setOutput(""); setStatus(initialStatus); }}>
    <div className="grid gap-4 lg:grid-cols-2">
      <Textarea label="Original" value={left} onChange={setLeft} rows={9} />
      <Textarea label="Changed" value={right} onChange={setRight} rows={9} />
    </div>
    <Textarea label="Diff output" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Compare text" onClick={() => runSafely(setStatus, async () => { const rows = lineDiff(left, right); setOutput(diffToText(rows)); return `${rows.filter((row) => row.type !== "same").length} changed line entries found.`; })} />
      <SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return "Copied."; })} />
      <SecondaryButton label="Download diff" onClick={() => runSafely(setStatus, async () => { downloadText(requireOutput(output), "text-diff", "diff", "text/plain;charset=utf-8"); return "Diff ready to download."; })} />
    </div>
  </ToolForm>;
}

function WordCounterTool() {
  const [input, setInput] = useState("Paste or type text here.");
  const stats = textStats(input);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setStatus(initialStatus); }}>
    <Textarea label="Text" value={input} onChange={setInput} rows={12} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[
        ["Words", stats.words],
        ["Characters", stats.characters],
        ["No spaces", stats.charactersNoSpaces],
        ["Lines", stats.lines],
        ["Read time", `${stats.readingMinutes} min`],
      ].map(([label, value]) => (
        <div key={label} className="surface-card wabi-card-edge p-4">
          <p className="text-xs font-bold uppercase text-neutral-500">{label}</p>
          <p className="mt-1 font-display text-2xl font-black">{value}</p>
        </div>
      ))}
    </div>
  </ToolForm>;
}

export default function TextDataTools({ tool }: { tool: Tool }) {
  if (tool.id === "extract-text-tool") return <ExtractTextTool tool={tool} />;
  if (tool.id === "summarize-pdf-tool") return <SummarizePdfTool tool={tool} />;
  if (tool.id === "chat-with-pdf-tool") return <ChatWithPdfTool tool={tool} />;
  if (tool.id === "translate-pdf-tool") return <TranslatePdfTool tool={tool} />;
  if (tool.id === "text-to-pdf-tool") return <TextToPdfTool />;
  if (tool.id === "markdown-preview-tool") return <MarkdownTool />;
  if (tool.id === "markdown-to-pdf-tool") return <MarkdownToPdfTool />;
  if (tool.id === "csv-to-pdf-tool") return <CsvToPdfTool />;
  if (tool.id === "audio-to-pdf-tool") return <AudioToPdfTool />;
  if (tool.id === "json-formatter-tool") return <JsonTool />;
  if (tool.id === "csv-to-json-tool") return <CsvToJsonTool />;
  if (tool.id === "json-to-csv-tool") return <JsonToCsvTool />;
  if (tool.id === "json-to-yaml-tool") return <JsonToYamlTool />;
  if (tool.id === "url-codec-tool") return <UrlCodecTool />;
  if (tool.id === "diff-checker-tool") return <DiffCheckerTool />;
  if (tool.id === "word-counter-tool") return <WordCounterTool />;
  return <StatusBox status={{ tone: "error", message: "This tool renderer is missing." }} />;
}
