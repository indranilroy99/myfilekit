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
        <p className="landing-eyebrow">Local-first file tools</p>
        {/*
          The headline carries the one claim competitors cannot make; the lede
          carries the breadth. It used to be the other way round, which spent the
          headline on "PDFs" — half the catalogue — and demoted the differentiator
          to a subordinate clause. No manual line break: 18ch and text-wrap do it
          at every width, and a <br/> lands mid-phrase once the type scale shifts.
        */}
        {/*
          This headline changed when the conversion server arrived, and it had to.
          "Your files never leave this device" was the strongest line in the
          product and it is no longer absolutely true: an Office document can be
          converted on our server, because a browser can only turn it into a
          picture. The claim now states the guarantee that IS absolute — nothing
          is uploaded unless the user picks the server for that one conversion —
          and the lede names the exception rather than burying it. Weakening a
          true claim is better than keeping a strong false one.
        */}
        <h1 className="landing-title">Nothing is uploaded unless you choose to.</h1>
        <p className="landing-lede">
          {tools.length} tools for PDFs, images, spreadsheets and text, running in this browser
          tab. Only Office conversions can use our server — for real, selectable text instead of
          a picture — and they ask you first.
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
          {/* Was "Nothing is uploaded", which the headline now says. A trust list
              should add evidence, not repeat the claim above it. */}
          <li><FileLock2 size={15} aria-hidden="true" /> Verifiable in your network tab</li>
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
              Other online tools upload your document before you have decided anything. Here the
              work happens in the page you are already looking at, and the one exception —
              converting an Office file — is a button you press, not a default.
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
              Open your browser's network tab while you work. The content security policy names
              exactly one outbound host — the converter — and blocks everything else, so there is
              nowhere else a file could go. A test in the repository enforces it.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default LandingPage;
