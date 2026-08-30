import { useState } from "react";
import { EyeOff, FileLock2, Upload, WifiOff } from "lucide-react";
import { tools } from "../registry/tools.registry.js";
import { stashWorkspaceFiles } from "../lib/workspace-handoff";

/**
 * View A — the acquisition surface.
 *
 * Deliberately a different surface from the workspace, the way Adobe splits
 * adobe.com/acrobat/online/... (marketing) from acrobat.adobe.com (the editor).
 * Its typography is scoped under `.landing` so the large marketing scale can
 * never leak into the application chrome, which stays dense at 13px.
 */
type Props = { featured: { id: string; name: string; description: string; route: string }[] };

export function LandingPage({ featured }: Props) {
  const [isOver, setIsOver] = useState(false);

  const open = (list: FileList | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    // Straight into the editor for the file's own type.
    stashWorkspaceFiles(files, "editor");
    window.location.hash = "#editor";
  };

  return (
    <div className="landing">
      <section className="landing-hero">
        <p className="landing-eyebrow">Local-first document tools</p>
        <h1 className="landing-title">Work on your PDFs<br />without uploading them.</h1>
        <p className="landing-lede">
          {tools.length} tools that run entirely in your browser. Your files are never sent to a
          server — not ours, not anyone's.
        </p>

        <label
          className={`landing-drop ${isOver ? "landing-drop-over" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setIsOver(true); }}
          onDragOver={(event) => { event.preventDefault(); setIsOver(true); }}
          onDragLeave={(event) => { event.preventDefault(); setIsOver(false); }}
          onDrop={(event) => { event.preventDefault(); setIsOver(false); open(event.dataTransfer.files); }}
        >
          <input className="sr-only" type="file" aria-label="Select a file to work on" onChange={(event) => open(event.target.files)} />
          <span className="landing-drop-cta"><Upload size={17} aria-hidden="true" /> Select a file</span>
          <span className="landing-drop-hint">or drag and drop it here</span>
        </label>

        <ul className="landing-trust">
          <li><WifiOff size={15} aria-hidden="true" /> Works offline</li>
          <li><FileLock2 size={15} aria-hidden="true" /> Nothing is uploaded</li>
          <li><EyeOff size={15} aria-hidden="true" /> No account, no tracking</li>
        </ul>
      </section>

      <section className="landing-tools" aria-labelledby="landing-tools-title">
        <h2 id="landing-tools-title" className="landing-h2">Start with a common task</h2>
        <div className="landing-grid">
          {featured.map((tool) => (
            <a className="landing-card" key={tool.id} href={tool.route}>
              <span className="landing-card-name">{tool.name}</span>
              <span className="landing-card-desc">{tool.description}</span>
            </a>
          ))}
        </div>
        <p className="landing-more"><a href="#browse-tools">See all {tools.length} tools</a></p>
      </section>

      <section className="landing-why" aria-labelledby="landing-why-title">
        <h2 id="landing-why-title" className="landing-h2">Why local-first matters</h2>
        <div className="landing-why-grid">
          <div>
            <h3 className="landing-h3">Confidential by construction</h3>
            <p className="landing-body">
              Other online tools upload your document to their servers and promise to delete it
              later. There is no server here to promise anything — the work happens in the page
              you are already looking at.
            </p>
          </div>
          <div>
            <h3 className="landing-h3">Usable where the cloud is not</h3>
            <p className="landing-body">
              Legal, finance, healthcare and security teams often cannot send a file to a third
              party at all. This runs inside the browser they already have, with no egress.
            </p>
          </div>
          <div>
            <h3 className="landing-h3">Verifiable, not just claimed</h3>
            <p className="landing-body">
              Open your browser's network tab while you work. Nothing leaves. The content security
              policy blocks outbound connections, and a test in the repository enforces it.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default LandingPage;
