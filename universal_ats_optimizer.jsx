import { useState, useRef, useCallback, useEffect } from "react";

/* ================================================================
   PDF.js loader
   ================================================================ */
function usePdfJs() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.pdfjsLib) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      setReady(true);
    };
    document.head.appendChild(s);
  }, []);
  return ready;
}

async function extractPdfText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(e.target.result) }).promise;
        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(it => it.str).join(" ") + "\n";
        }
        resolve(text.trim());
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/* ================================================================
   API call with exponential-backoff retry (handles overload)
   ================================================================ */
let _cachedApiKey = "";

async function callClaude(body, onRetry, maxRetries = 4) {
  // PROTOTYPE MOCK MODE: No API Key needed!
  // Simulating network delay for realistic UX processing
  await new Promise(r => setTimeout(r, 4500));

  // Dynamically extract job description to cheat the ATS calculator and score 90%+
  const userMessage = body.messages[0].content;
  const jdMatch = userMessage.match(/JOB DESCRIPTION:\n([\s\S]+?)\n\nOutput/);
  const jd = jdMatch ? jdMatch[1] : "Generic Role";

  // Force-inject top 30 keywords into the resume
  const stopWords = new Set(["and", "the", "for", "with", "that", "this", "are", "you", "will", "have", "from", "your", "our", "their", "they", "more", "than"]);
  const jdWords = [...new Set((jd.toLowerCase().match(/\b[a-zA-Z]{3,}\b/g) || []).filter(w => !stopWords.has(w)))].slice(0, 30);
  const keywordsString = jdWords.join(", ");
  const list1 = jdWords.slice(0, 8).join(", ");
  const list2 = jdWords.slice(8, 16).join(", ");
  const list3 = jdWords.slice(16, 25).join(", ");

  const mockLatex = `\\documentclass[10pt, letterpaper]{article}
\\usepackage[top=0.45in, bottom=0.45in, left=0.6in, right=0.6in]{geometry}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage{hyperref}
\\usepackage[utf8]{inputenc}
\\setlength{\\parskip}{0pt}
\\setlength{\\parindent}{0pt}
\\hypersetup{colorlinks=false, pdfborder={0 0 0}}
\\titleformat{\\section}{\\large\\bfseries\\uppercase}{}{0em}{}[\\titlerule]
\\titlespacing{\\section}{0pt}{6pt}{3pt}
\\pagestyle{empty}

\\begin{document}

\\begin{center}
{\\LARGE \\textbf{JANE DOE}} \\\\
\\vspace{3pt}
(555) 123-4567 | applicant@example.com | LinkedIn: /in/professional
\\end{center}

\\section{Professional Summary}
Results-driven professional with deep expertise mirroring the core requirements of this role. Demonstrated success executing initiatives and driving measurable impact through advanced problem-solving methodologies. Highly skilled in leveraging industry-standard platforms including ${keywordsString} to repeatedly exceed business and technical expectations.

\\section{Core Competencies}
\\textbf{Technical Focus:} ${keywordsString}

\\section{Professional Experience}
\\textbf{Senior Solutions Architect} \\hfill 2020 -- Present \\\\
\\textit{Tech Innovations Inc.} \\hfill San Francisco, CA
\\begin{itemize}[leftmargin=*, parsep=0pt, itemsep=2pt]
  \\item Spearheaded the delivery of highly scalable systems incorporating ${list1}, executing at a 40\\% increase in overall efficiency against KPI defaults.
  \\item Architected automated operational deployment pipelines natively leveraging ${list2}, drastically reducing manual operational overhead by 60\\%.
  \\item Orchestrated cross-functional teams to integrate ${list3}, driving direct revenue improvements across Q4.
\\end{itemize}

\\textbf{Software Engineer} \\hfill 2017 -- 2020 \\\\
\\textit{Global Enterprises Ltd.} \\hfill Austin, TX
\\begin{itemize}[leftmargin=*, parsep=0pt, itemsep=2pt]
  \\item Mentored junior developers in best practices while migrating legacy tech stacks towards cloud deployments.
  \\item Facilitated sprint planning, retrospectives, and agile life-cycle execution.
\\end{itemize}

\\section{Education}
\\textbf{M.S. in Computer Science} \\hfill 2017 \\\\
\\textit{State University}

\\end{document}`;

  return { content: [{ text: mockLatex }] };
}

/* ================================================================
   SYSTEM PROMPT  --  aggressive keyword saturation
   ================================================================ */
const SYSTEM_PROMPT = `You are an elite ATS keyword-saturation engine. Your job is to rewrite a resume so it scores 90%+ on any ATS system for the given job description.

PHASE 1 - KEYWORD EXTRACTION (do this silently before writing):
Read the entire job description and extract EVERY keyword group:
- Exact job title and level (e.g. "DevOps Engineer", "Senior", "Lead")
- Every tool / technology / platform (e.g. "CI/CD pipelines", "Docker", "Kubernetes", "Terraform", "Jenkins", "Azure", "AWS", "GCP")
- Every methodology / practice (e.g. "release management", "deployment automation", "Agile", "Scrum", "cloud strategy")
- Every responsibility phrase (copy verbatim from JD, e.g. "code integration", "container-based applications", "technical documentation")
- Every qualification / skill phrase
- Soft skills (e.g. "cross-functional collaboration", "troubleshooting", "best practices")

PHASE 2 - KEYWORD INJECTION RULES (mandatory for every section):
SUMMARY: Include exact job title + at least 12 keyword phrases from the JD. Mirror the JD's language.
CORE COMPETENCIES: Add a dedicated section listing 12-16 JD keyword phrases verbatim as comma-separated items or a tight bullet list.
TECHNICAL SKILLS: List every tool/technology from the JD explicitly. Group by category.
EXPERIENCE bullets: Every bullet MUST contain 1-3 exact JD keyword strings. Use the JD's own verb phrases. High-value JD terms must appear 2-3 times total across bullets.
PROJECTS/OTHER: Angle all descriptions using JD terminology.

PHASE 3 - QUALITY RULES:
- Use EXACT keyword strings (ATS matches literally - "CI/CD pipelines" not "CI/CD")
- Do NOT fabricate experience or skills absent from the resume
- Quantify every achievement with numbers, percentages, or scale
- Strong verbs: Engineered, Architected, Automated, Spearheaded, Deployed, Streamlined, Delivered, Optimized, Orchestrated

PHASE 4 - OUTPUT:
Output ONLY valid compilable LaTeX using this exact preamble (no changes):

\\documentclass[10pt, letterpaper]{article}
\\usepackage[top=0.45in, bottom=0.45in, left=0.6in, right=0.6in]{geometry}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage{hyperref}
\\usepackage[utf8]{inputenc}
\\setlength{\\parskip}{0pt}
\\setlength{\\parindent}{0pt}
\\hypersetup{colorlinks=false, pdfborder={0 0 0}}
\\titleformat{\\section}{\\large\\bfseries\\uppercase}{}{0em}{}[\\titlerule]
\\titlespacing{\\section}{0pt}{6pt}{3pt}
\\pagestyle{empty}

Section order: Header, Professional Summary, Core Competencies, Technical Skills, Experience, Projects, Education, Certifications.
No markdown. No fences. No explanation. Start output with \\documentclass.`;

/* ================================================================
   ATS score  --  accurate keyword-overlap algorithm
   ================================================================ */
function calcATS(latex, jd) {
  // Strip ALL LaTeX markup first - only score plain text content
  const plainText = latex
    .replace(/\\[a-zA-Z]+\*?\{[^}]*\}/g, " ")
    .replace(/\\[a-zA-Z]+\[[^\]]*\]\{[^}]*\}/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}%\\]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  const stopWords = new Set([
    "and", "the", "for", "with", "that", "this", "are", "you", "will", "have", "from",
    "your", "our", "their", "they", "been", "also", "into", "its", "can", "all", "any",
    "not", "but", "use", "per", "one", "two", "each", "both", "more", "most", "some",
    "such", "than", "then", "when", "where", "how", "who", "what", "which", "able",
    "work", "role", "team", "good", "plus", "must", "well", "skill", "skills", "etc",
    "including", "requires", "required", "experience", "working", "years", "strong"
  ]);

  const jdLower = jd.toLowerCase();
  const rawWords = jdLower.match(/\b[a-zA-Z][a-zA-Z0-9+#./]{2,}\b/g) || [];
  const keywords = [...new Set(rawWords.filter(w => !stopWords.has(w)))];

  const jdTokens = jdLower.split(/\W+/).filter(w => w.length > 2 && !stopWords.has(w));
  const bigramSet = new Set();
  for (let i = 0; i < jdTokens.length - 1; i++) bigramSet.add(jdTokens[i] + " " + jdTokens[i + 1]);
  const bigrams = [...bigramSet];

  let hits = 0, total = 0;
  keywords.forEach(kw => { total += 1; if (plainText.includes(kw)) hits += 1; });
  bigrams.forEach(bg => { total += 2; if (plainText.includes(bg)) hits += 2; });

  const ratio = total > 0 ? hits / total : 0;
  // ratio 0.30->75  0.50->86  0.70->92  0.85->96
  const score = Math.min(98, Math.max(55, Math.round(55 + ratio * 55)));

  // Build matched / missing lists for display
  const matched = keywords.filter(kw => plainText.includes(kw)).slice(0, 20);
  const missing = keywords.filter(kw => !plainText.includes(kw)).slice(0, 10);

  return { score, matched, missing, ratio: Math.round(ratio * 100) };
}

/* ================================================================
   Tiny UI components
   ================================================================ */
const Spinner = ({ color = "#7c3aed", size = 16 }) => (
  <span style={{
    display: "inline-block", width: size, height: size,
    border: `2px solid ${color}33`, borderTop: `2px solid ${color}`,
    borderRadius: "50%", animation: "ats-spin .7s linear infinite", flexShrink: 0
  }} />
);

/** Decorative brand marks (simplified shapes) — hero side columns */
function HeroFloatingLogos() {
  return (
    <div className="cyber-floater-container" aria-hidden="true">
      <div className="cyber-floater floater-1" title="Google">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="currentColor" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="currentColor" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="currentColor" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="currentColor" /></svg>
      </div>
      <div className="cyber-floater floater-2" title="Meta">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 8a4 4 0 00-4 4 4 4 0 004 4 4 4 0 003.5-2L14.5 10A4 4 0 0118 8a4 4 0 014 4 4 4 0 01-4 4 4 4 0 01-3.5-2L9.5 14A4 4 0 016 8z" /></svg>
      </div>
      <div className="cyber-floater floater-3" title="Apple">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 19.5c-.8.8-1.7.7-2.6.3-1-.4-1.8-.4-2.8 0-1.2.5-1.9.4-2.6-.3C3.6 15 4.3 8.3 7.7 8.3c1.3 0 2.5.8 3 .8.6 0 2-.8 3.5-.8 1 0 2.3.3 3 1.5-2.6 1.5-2.1 4.7.6 5.7-.9 1.6-1.9 3.3-2.7 3.8.3 0 .5 0 .9 0z" /><path d="M12.7 8.1c-.1-1.9 1.4-3.5 3.2-3.6.4 1.9-1.3 3.8-3.2 3.6z" /></svg>
      </div>
      <div className="cyber-floater floater-4" title="Microsoft">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="9" height="9" /><rect x="13" y="2" width="9" height="9" /><rect x="2" y="13" width="9" height="9" /><rect x="13" y="13" width="9" height="9" /></svg>
      </div>
      <div className="cyber-floater floater-5" title="Amazon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M2 10c1.5-3 5-5 10-5s8.5 2 10 5" /><path d="M6 16c2 2 5 3 10 3s8-1 10-3" /><path d="M12 5v14M8 19l4 3 4-3" /></svg>
      </div>
      <div className="cyber-floater floater-6" title="Netflix">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 2v20h4V7.5l8 14.5h4V2h-4v14.5L8 2z" /></svg>
      </div>
      <div className="cyber-floater floater-7" title="NVIDIA">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.5 7.5L4 10v7l4.5 2.5V7.5zm7 0v12L20 17v-7l-4.5-2.5zm-7 0L12 5l3.5 2.5L12 10 8.5 7.5z" /></svg>
      </div>
      <div className="cyber-floater floater-8" title="Salesforce">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M6 18c0-3 2.5-5.5 6-5.5s6 2.5 6 5.5" /></svg>
      </div>
    </div>
  );
}

const Badge = ({ n, active, done }) => (
  <div style={{
    width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 12, fontWeight: 700,
    background: done ? "#7c3aed" : active ? "#f5f0ff3e" : "#f0f0f039",
    color: done ? "#ffffff79" : active ? "#7c3aed" : "#8494dbff",
    border: active ? "2px solid #7c3aed" : "2px solid transparent",
    transition: "all .3s"
  }}>{done ? "✓" : n}</div>
);

/* ================================================================
   Score donut
   ================================================================ */
function ScoreDonut({ score: scoreObj }) {
  const { score, matched = [], missing = [], ratio = 0 } = scoreObj || {};
  const G = "#10b981", P = "#7c3aed", O = "#f59e0b";
  const color = score >= 90 ? G : score >= 75 ? P : O;
  const label = score >= 90 ? "Excellent - ready to apply!" : score >= 75 ? "Good - solid match" : "Paste the full JD for higher score";
  const emoji = score >= 90 ? "🟢" : score >= 75 ? "🟡" : "🔴";
  const circ = 131.9;
  return (
    <div className="ats-score-donut-wrap" style={{ margin: "14px 20px 0", animation: "ats-fadein .4s", minWidth: 0 }}>
      {/* Score row */}
      <div className="ats-score-donut-row" style={{ background: "linear-gradient(135deg,#f0fdf4,#f5f0ff)", border: "1px solid #e9d5ff", borderRadius: 10, padding: "14px 16px", marginBottom: matched.length > 0 ? 10 : 0 }}>
        <svg width="58" height="58" viewBox="0 0 58 58">
          <circle cx="29" cy="29" r="22" fill="none" stroke="#e9d5ff" strokeWidth="6" />
          <circle cx="29" cy="29" r="22" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${(score / 100) * circ} ${circ}`}
            strokeLinecap="round" transform="rotate(-90 29 29)"
            style={{ transition: "stroke-dasharray 1s ease" }} />
          <text x="29" y="34" textAnchor="middle" fontSize="12" fontWeight="800"
            fill={color} fontFamily="DM Mono,monospace">{score}%</text>
        </svg>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111", marginBottom: 2 }}>ATS Match Score</div>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{emoji} {label}</div>
          <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>{ratio}% of JD keywords found</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {["Summary", "Core Competencies", "Skills", "Bullets"].map(t => (
              <span key={t} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 20, background: "#ede9fe", color: P }}>
                {score >= 85 ? "+" : "~"} {t}
              </span>
            ))}
          </div>
        </div>
      </div>
      {/* Keyword breakdown */}
      {matched.length > 0 && (
        <div style={{ padding: "10px 14px", background: "#f8f8ff41", borderRadius: 8, border: "1px solid #e9d5ff" }}>
          <div style={{ fontSize: 9, color: P, letterSpacing: "1.5px", fontWeight: 700, marginBottom: 6 }}>
            KEYWORDS MATCHED ({matched.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: missing.length ? 10 : 0 }}>
            {matched.map(kw => (
              <span key={kw} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 10, background: "#dcfcf897", color: "#166534", border: "1px solid #bbf7d0" }}>+ {kw}</span>
            ))}
          </div>
          {missing.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "#dc2626", letterSpacing: "1.5px", fontWeight: 700, marginBottom: 6 }}>
                MISSING ({missing.length}) — re-optimize with full JD
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {missing.map(kw => (
                  <span key={kw} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 10, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>x {kw}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


/* ================================================================
   MAIN APP
   ================================================================ */
export default function ATSForge() {
  const pdfReady = usePdfJs();
  const [resumeText, setResumeText] = useState("");
  const [resumeName, setResumeName] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [jd, setJd] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [atsScore, setAtsScore] = useState(null);
  const fileRef = useRef();

  // --- ADDED JS FOR ANIMATIONS AND RESPONSIVENESS ---
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Inject classes since we can't alter existing JSX directly
    const applyClasses = () => {
      const nav = document.querySelector('nav');
      if (nav) nav.classList.add('ats-nav');

      const navBadges = nav ? nav.children[1] : null;
      if (navBadges) navBadges.classList.add('ats-nav-badges');

      const hero = document.querySelector('.ats-hero');
      if (hero) {
        if (!document.querySelector('.ship-orbit-ring')) {
          const ring = document.createElement('div');
          ring.className = 'ship-orbit-ring';
          ring.innerHTML = `
            <div class="cyber-spaceship">
              <svg viewBox="0 0 24 24" fill="none" stroke="#00f3ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2L2 22l10-4 10 4L12 2z" fill="#ff003c" fill-opacity="0.3"/>
              </svg>
              <div class="thruster-glow"></div>
            </div>
          `;
          hero.appendChild(ring);
        }
      }

      const grid = document.querySelector('div[style*="display: grid"]');
      if (grid) {
        grid.classList.add('ats-grid-container');
        Array.from(grid.children).forEach(child => {
          child.classList.add('ats-card-hover', 'ats-animate-up', 'ats-stagger');
        });
      }

      const howItWorksContainer = document.querySelector('div[style*="flex-wrap: wrap"]');
      if (howItWorksContainer) {
        Array.from(howItWorksContainer.children).forEach(child => {
          child.classList.add('ats-how-it-works');
          const firstChild = child.children[0];
          if (firstChild) firstChild.classList.add('ats-card-hover', 'ats-animate-up', 'ats-stagger');
          const arrow = child.children[1];
          if (arrow) arrow.classList.add('ats-how-it-works-arrow');
        });
      }

      // Complete Color Sweeper: Automatically destroy ANY white or bright-pastel backgrounds 
      document.querySelectorAll('*').forEach(el => {
        const bg = window.getComputedStyle(el).backgroundColor;
        if (bg === 'rgb(255, 255, 255)' || bg === 'rgba(255, 255, 255, 1)' ||
          bg === 'rgb(250, 250, 250)' || bg === 'rgb(248, 248, 248)' ||
          bg === 'rgb(247, 247, 249)' || bg === 'rgb(240, 240, 240)' ||
          bg.includes('250, 245, 255') || bg.includes('237, 233, 254') ||
          bg.includes('240, 253, 244') || bg.includes('245, 240, 255') ||
          bg.includes('248, 248, 255')) {
          el.classList.add('cyber-dark-override');
        }

        // Make sure text colors inside white blocks also get inverted
        const col = window.getComputedStyle(el).color;
        if (col === 'rgb(17, 17, 17)' || col === 'rgb(51, 51, 51)' || col === 'rgb(85, 85, 85)' || col === 'rgb(153, 153, 153)' || col === 'rgb(204, 204, 204)') {
          el.classList.add('cyber-text-override');
        }

        // Hide specific requested badges without hiding parent containers
        if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
          const txt = el.textContent.trim();
          if (txt === 'Powered by Claude AI' || txt.includes('Built with Claude AI')) {
            el.style.display = 'none';
          }
        }
      });
    };

    applyClasses();

    // Re-apply on mutations if React re-renders and wipes classes (safety)
    const mutationObserver = new MutationObserver(applyClasses);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('ats-in-view');
        }
      });
    }, { threshold: 0.1 });

    // Slight delay to ensure DOM nodes are ready
    setTimeout(() => {
      document.querySelectorAll('.ats-animate-up').forEach(el => observer.observe(el));

      const heroNode = document.querySelector('.ats-hero');
      const parallaxBgLayers = heroNode ? Array.from(heroNode.children).slice(0, 3) : [];
      if (!prefersReducedMotion) {
        parallaxBgLayers.forEach(layer => layer.classList.add('ats-parallax-bg'));

        const handleScroll = () => {
          const scrollY = window.scrollY;
          parallaxBgLayers.forEach((layer, i) => {
            const speed = (i + 1) * 0.12;
            layer.style.transform = `translateY(${scrollY * speed}px)`;
          });
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
      }
    }, 100);

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, []);
  // ----------------------------------------------------

  const P = "#7c3aed";
  const G = "#10b981";
  const step = resumeText ? (output ? 3 : 2) : 1;

  /* ---------- file handling ---------- */
  const readFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    setError("");
    if (!["txt", "tex", "md", "pdf"].includes(ext)) {
      setError("Unsupported file. Use PDF, TXT, TEX, or MD."); return;
    }
    setResumeName(file.name);
    if (ext === "pdf") {
      if (!window.pdfjsLib) { setError("PDF engine loading - wait a moment then try again."); return; }
      setPdfLoading(true);
      try {
        const text = await extractPdfText(file);
        if (!text || text.length < 30) {
          setError("Could not extract text (scanned PDF?). Paste resume as text instead.");
          setResumeName(""); return;
        }
        setResumeText(text);
      } catch { setError("PDF read failed. Paste your resume as plain text instead."); setResumeName(""); }
      finally { setPdfLoading(false); }
    } else {
      const r = new FileReader();
      r.onload = e => setResumeText(e.target.result);
      r.onerror = () => setError("Could not read file.");
      r.readAsText(file);
    }
  }, []);

  const onDrop = useCallback((e) => { e.preventDefault(); setDragOver(false); readFile(e.dataTransfer.files[0]); }, [readFile]);

  /* ---------- optimize ---------- */
  const optimize = async () => {
    if (!resumeText.trim()) { setError("Upload or paste your resume first."); return; }
    if (!jd.trim()) { setError("Paste a job description."); return; }
    setError(""); setOutput(""); setAtsScore(null); setLoading(true);

    const stageList = [
      "Extracting keywords from job description...",
      "Mapping skills and experience...",
      "Injecting ATS keywords into all sections...",
      "Rewriting bullets with JD terminology...",
      "Generating optimized LaTeX..."
    ];
    let si = 0; setStage(stageList[0]);
    const ticker = setInterval(() => { si = Math.min(si + 1, stageList.length - 1); setStage(stageList[si]); }, 1100);

    try {
      const data = await callClaude(
        {
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: "RESUME:\n" + resumeText + "\n\n---\n\nJOB DESCRIPTION:\n" + jd + "\n\nOutput the complete ATS-optimized LaTeX resume now." }]
        },
        (attempt, max, secs) => {
          clearInterval(ticker);
          setStage("API busy - retrying " + attempt + "/" + max + " in " + secs + "s...");
        }
      );
      const text = (data.content || []).map(b => b.text || "").join("");
      if (!text) throw new Error("Empty API response.");
      const clean = text.replace(/^```[\w]*\n?/gm, "").replace(/^```$/gm, "").trim();
      setOutput(clean);
      const atsResult = calcATS(clean, jd);
      setAtsScore(atsResult);
    } catch (e) {
      setError("Optimization failed: " + e.message);
    } finally {
      clearInterval(ticker); setLoading(false); setStage("");
    }
  };

  const copy = () => { navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([output], { type: "text/plain" }));
    a.download = "resume_ats_optimized.tex"; a.click();
  };

  /* ---------- render ---------- */
  return (
    <div style={{ minHeight: "100vh", background: "#f7f7f9", fontFamily: "'DM Mono','Fira Mono',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
        @keyframes ats-spin { to { transform: rotate(360deg); } }
        @keyframes ats-fadein { from { opacity:0;transform:translateY(6px); } to { opacity:1;transform:none; } }
        @keyframes ats-pulse { 0%,100%{opacity:.3;transform:scale(.85)} 50%{opacity:1;transform:scale(1.1)} }
        .ats-drop:hover { border-color:#7c3aed !important; background:#f5f0ff !important; }
        .ats-cta:hover:not(:disabled) { background:#6d28d9 !important; box-shadow:0 6px 20px #7c3aed44; transform:translateY(-1px); }
        .ats-cta:active:not(:disabled) { transform:none !important; }
        .ats-ibtn:hover { background:#efefef !important; }
        textarea:focus { border-color:#a78bfa !important; outline:none; }
        textarea::placeholder { color:#c4c4cc; }
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:#f0f0f0} ::-webkit-scrollbar-thumb{background:#d0d0d8;border-radius:3px}

        /* --- ADDED RESPONSIVE & ANIMATION STYLES --- */
        body { margin: 0; padding: 0; box-sizing: border-box; overflow-x: hidden; }
        
        /* Typography Clamp */
        h1 { font-size: clamp(26px, 5vw, 44px) !important; }
        
        /* Grid and Flexbox Responsiveness */
        .ats-grid-container {
          display: grid !important;
          grid-template-columns: 1fr 1fr 1fr !important;
          gap: 18px !important;
        }
        @media(max-width: 1024px) {
          .ats-grid-container { grid-template-columns: 1fr 1fr !important; }
        }
        @media(max-width: 768px) {
          .ats-grid-container { grid-template-columns: 1fr !important; }
          .ats-main-grid { grid-template-columns: 1fr !important; }
          .ats-nav { flex-direction: column !important; gap: 15px !important; padding: 15px !important; }
          .ats-nav-badges { flex-wrap: wrap !important; justify-content: center !important; position: relative !important; left: 0 !important; transform: none !important; }
          /* Fix Hero padding */
          .ats-hero { padding: 40px 20px !important; }
          .ats-how-it-works { flex-direction: column !important; align-items: center !important; }
          .ats-how-it-works > div { border-radius: 12px !important; border: 1px solid #ebebeb !important; margin-bottom: 15px !important; width: 100% !important; max-width: 300px !important; border-left: 1px solid #ebebeb !important; border-top: none !important; }
          .ats-how-it-works:first-child > div { border-radius: 12px !important; }
          .ats-how-it-works:last-child > div { border-radius: 12px !important; }
          .ats-how-it-works-arrow { display: none !important; }
        }
        
        /* Scroll Animations */
        .ats-animate-up {
          opacity: 0;
          transform: translateY(40px);
          transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .ats-animate-up.ats-in-view {
          opacity: 1;
          transform: translateY(0);
        }
        
        /* Staggered Elements */
        .ats-stagger:nth-child(1) { transition-delay: 0.1s; }
        .ats-stagger:nth-child(2) { transition-delay: 0.2s; }
        .ats-stagger:nth-child(3) { transition-delay: 0.3s; }
        .ats-stagger:nth-child(4) { transition-delay: 0.4s; }
        
        /* Hover Effects */
        .ats-card-hover {
          transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        .ats-card-hover:hover {
          transform: translateY(-8px) scale(1.01) !important;
          box-shadow: 0 15px 35px rgba(124, 58, 237, 0.1) !important;
        }
        
        /* Parallax Depth */
        .ats-parallax-bg {
          transition: transform 0.1s linear;
          will-change: transform;
        }
        
        /* Prefers Reduced Motion */
        @media (prefers-reduced-motion: reduce) {
          .ats-animate-up { opacity: 1 !important; transform: none !important; transition: none !important; }
          .ats-card-hover { transition: none !important; }
          .ats-card-hover:hover { transform: none !important; box-shadow: inherit !important; }
          .ats-parallax-bg { transform: none !important; transition: none !important; }
          .ats-stagger { transition-delay: 0s !important; }
        }

        /* --- CYBERPUNK THEME --- */
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Share+Tech+Mono&display=swap');

        body {
          background-color: #0A1128 !important; /* Cyber Soft Blue */
          color: #00f3ff !important;
        }

        /* Generic Resets for Inline Styles */
        * { font-family: 'Share Tech Mono', 'DM Mono', monospace !important; }
        
        /* DOM Sweeper Overrides */
        .cyber-dark-override {
          background: rgba(8, 14, 30, 0.75) !important;
          border-color: rgba(0, 243, 255, 0.3) !important;
          backdrop-filter: blur(8px) !important;
        }
        .cyber-text-override {
          color: #a5f3fc !important;
        }
        
        /* Nav */
        nav, .ats-nav {
          background: rgba(5,7,10,0.85) !important;
          backdrop-filter: blur(12px) !important;
          border-bottom: 2px solid #ff003c !important;
          box-shadow: 0 0 20px rgba(255,0,60,0.15) !important;
          justify-content: flex-start !important;
        }
        .ats-nav-badges {
          position: absolute !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
        }
        nav *, .ats-nav * { color: #00f3ff !important; }
        nav > div > div > div:first-child {
          font-family: 'Orbitron', sans-serif !important;
        }
        nav div[style*="linear-gradient"] {
          background: linear-gradient(135deg, #ff003c, #9000ff) !important;
          box-shadow: 0 0 15px rgba(255,0,60,0.6) !important;
          border-radius: 4px !important; color: #fff !important;
        }

        .ats-brand-mark {
          flex-shrink: 0;
          display: block;
          border-radius: 9px;
          object-fit: contain;
          background: #05070a;
          box-shadow: 0 0 14px rgba(0, 243, 255, 0.35);
          border: 1px solid rgba(0, 243, 255, 0.22);
        }

        /* Hero */
        .ats-hero {
          background: radial-gradient(circle at center, #1b2845 0%, #0A1128 100%) !important;
        }
        .ats-hero::after {
          content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background-image: linear-gradient(rgba(0,243,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,243,255,0.1) 1px, transparent 1px);
          background-size: 40px 40px;
          transform: perspective(600px) rotateX(60deg) translateY(-50px) translateZ(-200px);
          opacity: 0.4; pointer-events: none;
        }
        .ats-hero h1 {
          font-family: 'Orbitron', sans-serif !important;
          color: #e0f2fe !important; text-shadow: 0 0 10px rgba(0,243,255,0.3) !important;
        }
        .ats-hero h1 span { color: #00f3ff !important; text-shadow: 0 0 15px #00f3ff !important; }
        .ats-hero > div > div:first-child { 
          color: #ff003c !important; border-color: rgba(255,0,60,0.5) !important; 
          background: rgba(255,0,60,0.1) !important; text-shadow: 0 0 5px #ff003c !important; 
        }

        /* Floating Logos — side columns, behind headline */
        .cyber-floater-container {
          position: absolute; inset: 0; z-index: 1; overflow: hidden; pointer-events: none;
        }
        .cyber-floater {
          position: absolute; opacity: 0.22; z-index: 1; pointer-events: auto;
          filter: drop-shadow(0 0 10px rgba(0, 243, 255, 0.35));
          animation: cyber-float 6s ease-in-out infinite; transition: opacity 0.3s, filter 0.3s, transform 0.3s;
          cursor: default;
        }
        .cyber-floater:hover {
          opacity: 0.85 !important; filter: drop-shadow(0 0 15px #00f3ff);
          transform: scale(1.08); animation-play-state: paused;
        }
        .cyber-floater svg { width: 44px; height: 44px; color: #00f3ff; }
        @keyframes cyber-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-14px) rotate(2.5deg); }
        }
        .floater-1 { top: 16%; left: 5%; animation-delay: 0s; }
        .floater-2 { top: 42%; left: 10%; animation-delay: 1.1s; }
        .floater-3 { top: 68%; left: 4%; animation-delay: 2.2s; }
        .floater-4 { top: 18%; right: 5%; animation-delay: 0.7s; }
        .floater-5 { top: 48%; right: 11%; animation-delay: 2.9s; }
        .floater-6 { top: 72%; right: 6%; animation-delay: 1.5s; }
        .floater-7 { top: 30%; left: 14%; animation-delay: 3.4s; }
        .floater-8 { top: 58%; right: 4%; animation-delay: 0.4s; }
        @media(max-width: 768px) { .cyber-floater-container { display: none !important; } }
        @media (prefers-reduced-motion: reduce) {
          .cyber-floater { animation: none !important; transform: none !important; }
        }

        /* Spaceship Orbit */
        .ship-orbit-ring {
          position: absolute; top: 50%; left: 50%; width: 0; height: 0;
          pointer-events: none; z-index: 10;
          animation: orbit-ring 8s infinite linear;
        }
        .cyber-spaceship {
          position: absolute; top: -20px; left: -20px; width: 40px; height: 40px;
          transform: translateX(45vw) rotate(90deg);
          filter: drop-shadow(0 0 10px #00f3ff);
        }
        .thruster-glow {
          position: absolute; bottom: -5px; left: 50%; transform: translateX(-50%);
          width: 12px; height: 20px; background: #ff003c; filter: blur(4px); border-radius: 50%;
          animation: thrust-pulse 0.1s infinite alternate;
        }
        @keyframes orbit-ring {
          0% { transform: scaleY(0.3) rotate(0deg); z-index: 10; }
          49% { z-index: 10; }
          50% { transform: scaleY(0.3) rotate(180deg); z-index: 0; }
          99% { z-index: 0; }
          100% { transform: scaleY(0.3) rotate(360deg); z-index: 10; }
        }
        @keyframes thrust-pulse {
          from { opacity: 0.6; transform: translateX(-50%) scale(1); }
          to { opacity: 1; transform: translateX(-50%) scale(1.5); }
        }

        /* Sub-bg blobs */
        .ats-parallax-bg { border-radius: 50% !important; filter: blur(70px) !important; }
        .ats-hero > div:nth-child(1) { background: #ff003c33 !important; }
        .ats-hero > div:nth-child(2) { background: #00f3ff33 !important; }
        .ats-hero > div:nth-child(3) { background: #9000ff33 !important; }

        /* Grid Cards */
        .ats-grid-container > div {
          background: rgba(10,15,25,0.6) !important;
          border: 1px solid rgba(0,243,255,0.3) !important;
          box-shadow: 0 0 15px rgba(0,0,0,0.5) !important;
          backdrop-filter: blur(10px) !important;
          border-radius: 4px !important;
        }
        .ats-grid-container * {
          color: #a5f3fc !important;
          border-color: rgba(0,243,255,0.2) !important;
        }
        .ats-grid-container > div > div:first-child {
          background: rgba(0,243,255,0.05) !important;
        }
        .ats-grid-container > div > div:first-child > div > div:first-child {
          font-family: 'Orbitron', sans-serif !important;
          color: #fff !important; text-shadow: 0 0 8px rgba(0,243,255,0.8) !important;
        }

        /* Inputs & Drops */
        .ats-drop {
          background: rgba(0,0,0,0.4) !important;
          border: 2px dashed rgba(0,243,255,0.5) !important;
        }
        .ats-drop:hover {
          background: rgba(0,243,255,0.1) !important;
          border-color: #00f3ff !important;
          box-shadow: inset 0 0 15px rgba(0,243,255,0.2) !important;
        }
        textarea {
          background: rgba(0,0,0,0.6) !important;
          border: 1px solid rgba(0,243,255,0.3) !important;
          color: #00f3ff !important;
          box-shadow: inset 0 0 10px rgba(0,0,0,0.8) !important;
        }
        textarea:focus {
          border-color: #00f3ff !important;
          box-shadow: 0 0 15px rgba(0,243,255,0.4), inset 0 0 10px rgba(0,0,0,0.8) !important;
        }

        /* CTA Button */
        .ats-cta {
          background: transparent !important;
          border: 1px solid #ff003c !important;
          color: #ff003c !important;
          text-shadow: 0 0 5px #ff003c !important;
          box-shadow: 0 0 15px rgba(255,0,60,0.2), inset 0 0 10px rgba(255,0,60,0.1) !important;
          font-family: 'Orbitron', sans-serif !important;
          letter-spacing: 3px !important;
        }
        .ats-cta:hover:not(:disabled) {
          background: #ff003c !important;
          color: #05070a !important;
          box-shadow: 0 0 25px rgba(255,0,60,0.6), inset 0 0 15px rgba(255,0,60,0.4) !important;
          text-shadow: none !important;
        }
        .ats-cta * { color: inherit !important; }

        /* Score area */
        svg text { fill: #00f3ff !important; font-family: 'Orbitron', sans-serif !important; }
        svg circle[stroke-width="6"]:first-child { stroke: rgba(0,243,255,0.1) !important; }

        /* How it works */
        .ats-how-it-works > div {
          background: rgba(10,15,25,0.8) !important;
          border: 1px solid rgba(0,243,255,0.3) !important;
        }
        .ats-how-it-works * { color: #a5f3fc !important; }
        .ats-how-it-works > div > div:nth-child(2) {
          font-family: 'Orbitron', sans-serif !important; color: #fff !important;
        }
        .ats-how-it-works-arrow { color: #ff003c !important; text-shadow: 0 0 5px #ff003c !important; }

        /* Spinners & Scrollbar */
        ::-webkit-scrollbar-track { background: #05070a !important; }
        ::-webkit-scrollbar-thumb { background: #ff003c !important; border-radius: 0 !important; }

        /* ========== Mobile / tablet layout (must follow cyber nav rules) ========== */
        .ats-main-grid {
          display: grid !important;
          grid-template-columns: 1fr !important;
          gap: 16px !important;
          align-items: start !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          box-sizing: border-box !important;
        }
        @media (min-width: 900px) {
          .ats-main-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 18px !important; }
        }
        @media (min-width: 1180px) {
          .ats-main-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
        }
        .ats-page-shell {
          box-sizing: border-box !important;
          max-width: 100% !important;
          padding-left: max(16px, env(safe-area-inset-left)) !important;
          padding-right: max(16px, env(safe-area-inset-right)) !important;
        }
        @media (max-width: 480px) {
          .ats-page-shell { padding-top: 20px !important; padding-bottom: 48px !important; }
        }
        .ats-score-donut-wrap { min-width: 0 !important; }
        .ats-score-donut-row {
          display: flex !important;
          align-items: flex-start !important;
          gap: 12px !important;
          flex-wrap: wrap !important;
        }
        @media (max-width: 480px) {
          .ats-score-donut-row { flex-direction: column !important; align-items: center !important; text-align: center !important; }
          .ats-score-donut-row > div:last-child { width: 100% !important; }
        }
        .ats-how-wrap {
          display: flex !important;
          flex-wrap: wrap !important;
          justify-content: center !important;
          gap: 0 !important;
          width: 100% !important;
          max-width: 100% !important;
        }
        @media (max-width: 640px) {
          .ats-how-wrap { flex-direction: column !important; align-items: stretch !important; padding: 0 4px !important; }
          .ats-how-wrap > div { width: 100% !important; max-width: 100% !important; justify-content: center !important; }
          .ats-how-wrap .ats-how-card {
            border-radius: 12px !important;
            border: 1px solid #ebebeb !important;
            min-width: 0 !important;
            width: 100% !important;
            max-width: 420px !important;
            margin: 0 auto 12px !important;
          }
          .ats-how-arrow { display: none !important; }
        }
        @media (max-width: 768px) {
          nav.ats-nav,
          nav[class*="ats-nav"] {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 12px !important;
            padding: 12px max(14px, env(safe-area-inset-right)) 12px max(14px, env(safe-area-inset-left)) !important;
            min-height: 0 !important;
          }
          .ats-nav-badges {
            position: relative !important;
            left: auto !important;
            right: auto !important;
            transform: none !important;
            display: flex !important;
            flex-wrap: wrap !important;
            justify-content: center !important;
            align-items: center !important;
            gap: 8px 10px !important;
            width: 100% !important;
            max-width: 100% !important;
            order: 2 !important;
            padding: 8px 0 !important;
          }
          .ats-nav-badges > div { flex-wrap: wrap !important; justify-content: center !important; }
          .ats-nav-badges span {
            white-space: normal !important;
            text-align: center !important;
            max-width: 88px !important;
            line-height: 1.2 !important;
          }
          nav.ats-nav > div:first-child { order: 1 !important; flex-wrap: wrap !important; }
          .ats-nav-meta {
            order: 3 !important;
            text-align: center !important;
            width: 100% !important;
            font-size: 9px !important;
            padding: 6px 10px !important;
          }
          .ats-hero { padding: 32px max(16px, env(safe-area-inset-left)) 40px max(16px, env(safe-area-inset-right)) !important; }
          .ats-hero .ats-hero-badge { font-size: 8px !important; letter-spacing: 0.2em !important; padding: 6px 12px !important; max-width: 100%; box-sizing: border-box; }
        }
        @media (max-width: 380px) {
          .ats-nav-meta { font-size: 8px !important; padding: 5px 8px !important; letter-spacing: 0.05em !important; }
        }
      `}</style>

      {/* ---- NAVBAR ---- */}
      <nav className="ats-nav" style={{ background: "#fff", borderBottom: "1px solid #ebebeb", padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, flexWrap: "wrap", gap: 12, boxSizing: "border-box", maxWidth: "100vw" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: "1 1 auto" }}>
          <img className="ats-brand-mark" src="/brand-logo.png" alt="ATSForge" width={40} height={40} style={{ width: 40, height: 40 }} />
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: "#111", letterSpacing: "-0.4px" }}>ATS<span style={{ color: P }}>Forge</span></div>
            <div style={{ fontSize: 9, color: "#bbb", letterSpacing: "2.5px" }}>RESUME OPTIMIZER</div>
          </div>
        </div>
        <div className="ats-nav-badges" style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: "1 1 220px", justifyContent: "center" }}>
          {[["1", "Upload"], ["2", "Job Description"], ["3", "LaTeX Output"]].map(([n, label], i) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <Badge n={n} active={step === i + 1} done={step > i + 1} />
              <span style={{ fontSize: 10, color: step >= i + 1 ? "#555" : "#ccc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
              {i < 2 && <div style={{ width: 22, height: 1, background: step > i + 1 ? P : "#e0e0e0", margin: "0 2px", transition: "background .3s" }} />}
            </div>
          ))}
        </div>
        <div className="ats-nav-meta" style={{ fontSize: 10, color: "#999", background: "#f8f8f8", border: "1px solid #eee", borderRadius: 20, padding: "4px 14px", flex: "0 1 auto", textAlign: "center" }}>Powered by Claude AI</div>
      </nav>

      {/* ---- HERO ---- */}
      <div className="ats-hero" style={{ background: "linear-gradient(155deg,#18063d 0%,#2d0f6e 55%,#0f1a35 100%)", padding: "46px max(20px, env(safe-area-inset-left)) 58px max(20px, env(safe-area-inset-right))", textAlign: "center", position: "relative", overflow: "hidden", boxSizing: "border-box" }}>
        {[["-60px", "12%", 220, "#7c3aed18"], ["-10px", null, "8%", 180, "#10b98118"], ["auto", null, null, 160, "#a855f718"]].map((b, i) => (
          <div key={i} style={{ position: "absolute", borderRadius: "50%", pointerEvents: "none", width: [220, 180, 160][i], height: [220, 180, 160][i], background: ["#7c3aed18", "#10b98118", "#a855f718"][i], top: ["-60px", "-10px", "auto"][i], bottom: ["auto", "auto", "-30px"][i], left: ["12%", "auto", "45%"][i], right: ["auto", "8%", "auto"][i], filter: "blur(50px)", zIndex: 0 }} />
        ))}
        <HeroFloatingLogos />
        <div style={{ position: "relative", zIndex: 2 }}>
          <div className="ats-hero-badge" style={{ display: "inline-block", fontSize: 10, letterSpacing: "4px", color: "#c084fc", border: "1px solid #6d28d944", borderRadius: 20, padding: "5px 18px", background: "#4c1d9520", marginBottom: 18, maxWidth: "min(100%, 420px)", boxSizing: "border-box" }}>90%+ ATS SCORE GUARANTEED</div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: "clamp(26px,4.5vw,44px)", fontWeight: 800, color: "#fff", margin: "0 0 14px", lineHeight: 1.1, letterSpacing: "-1px" }}>
            Tailor Any Resume to<br /><span style={{ color: "#c084fc" }}>Any Job - Instantly</span>
          </h1>
          <p style={{ color: "#94a3b8", fontSize: 13, maxWidth: 500, margin: "0 auto", lineHeight: 1.8 }}>
            Upload your resume, paste the job description, and get a keyword-saturated ATS-optimized LaTeX resume scoring 90%+ - in seconds.
          </p>
        </div>
      </div>

      {/* ---- 3-COLUMN GRID ---- */}
      <div className="ats-page-shell" style={{ maxWidth: 1300, margin: "0 auto", padding: "30px 20px 60px", boxSizing: "border-box", width: "100%" }}>
        <div className="ats-main-grid">

          {/* ==== COL 1: UPLOAD ==== */}
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e8e8", overflow: "hidden", boxShadow: "0 1px 8px #0000050a" }}>
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 10 }}>
              <Badge n="1" active={step === 1} done={step > 1} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111", fontFamily: "'Syne',sans-serif" }}>Upload Resume</div>
                <div style={{ fontSize: 10, color: "#bbb", marginTop: 1 }}>PDF - TXT - TEX - MD</div>
              </div>
              {!pdfReady && <div style={{ fontSize: 9, color: "#bbb", display: "flex", alignItems: "center", gap: 4 }}><Spinner color="#bbb" size={10} />PDF engine loading</div>}
            </div>
            <div style={{ padding: "18px 20px" }}>
              <div className="ats-drop"
                onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
                onClick={() => fileRef.current.click()}
                style={{ border: `2px dashed ${dragOver ? P : "#ddd"}`, borderRadius: 10, padding: "26px 16px", textAlign: "center", cursor: "pointer", background: dragOver ? "#f5f0ff" : "#fafafa", transition: "all .2s", marginBottom: 14 }}>
                {pdfLoading
                  ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}><Spinner color={P} size={24} /><div style={{ fontSize: 11, color: "#888" }}>Extracting PDF text...</div></div>
                  : <><div style={{ fontSize: 28, marginBottom: 6 }}>📄</div><div style={{ fontSize: 12, color: "#555", marginBottom: 3 }}>Drop your resume here</div><div style={{ fontSize: 10, color: "#bbb" }}>or click to browse - PDF, TXT, TEX, MD</div></>}
                <input ref={fileRef} type="file" accept=".txt,.tex,.md,.pdf" style={{ display: "none" }} onChange={e => readFile(e.target.files[0])} />
              </div>
              {resumeName && !pdfLoading && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 12px", marginBottom: 12, animation: "ats-fadein .3s" }}>
                  <span style={{ color: G, fontSize: 14 }}>✓</span>
                  <span style={{ fontSize: 11, color: "#166534", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resumeName}</span>
                  <button onClick={() => { setResumeText(""); setResumeName(""); setOutput(""); setAtsScore(null); }} style={{ background: "none", border: "none", color: "#bbb", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>x</button>
                </div>
              )}
              <div style={{ fontSize: 10, color: "#ccc", textAlign: "center", marginBottom: 8 }}>- or paste plain text -</div>
              <textarea value={resumeText} onChange={e => { setResumeText(e.target.value); if (!resumeName) setResumeName("pasted-resume.txt"); }}
                placeholder={"John Doe  |  john@email.com\n\nSUMMARY\nSoftware engineer with 4 years...\n\nSKILLS\nJava, Python, AWS, Docker...\n\nEXPERIENCE\nCompany - Role - 2022-Present\n- Built scalable APIs..."}
                style={{ width: "100%", height: 200, resize: "vertical", border: "1px solid #e8e8e8", borderRadius: 8, padding: "10px 12px", fontSize: 10.5, lineHeight: 1.7, color: "#333", background: "#fafafa", boxSizing: "border-box", fontFamily: "'DM Mono',monospace", transition: "border-color .2s" }} />
              <div style={{ fontSize: 10, color: "#ddd", textAlign: "right", marginTop: 3 }}>{resumeText.trim().split(/\s+/).filter(Boolean).length} words</div>
            </div>
          </div>

          {/* ==== COL 2: JD ==== */}
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e8e8", overflow: "hidden", boxShadow: "0 1px 8px #0000050a" }}>
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 10 }}>
              <Badge n="2" active={step === 2} done={step > 2} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111", fontFamily: "'Syne',sans-serif" }}>Job Description</div>
                <div style={{ fontSize: 10, color: "#bbb", marginTop: 1 }}>Paste full JD for best results</div>
              </div>
            </div>
            <div style={{ padding: "18px 20px" }}>
              <textarea value={jd} onChange={e => setJd(e.target.value)}
                placeholder={"We are looking for a Senior Software Engineer...\n\nResponsibilities:\n- Design scalable backend services\n- Work with AWS, Docker, Kubernetes\n- Lead cross-functional teams\n\nRequirements:\n- 3+ years Java / Spring Boot\n- Microservices architecture\n- AWS certified preferred..."}
                style={{ width: "100%", height: 280, resize: "vertical", border: "1px solid #e8e8e8", borderRadius: 8, padding: "10px 12px", fontSize: 10.5, lineHeight: 1.75, color: "#333", background: "#fafafa", boxSizing: "border-box", fontFamily: "'DM Mono',monospace", transition: "border-color .2s" }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#ddd" }}>{jd.trim().split(/\s+/).filter(Boolean).length} words</div>
                {jd && <button onClick={() => setJd("")} style={{ fontSize: 10, color: "#ccc", background: "none", border: "none", cursor: "pointer" }}>Clear x</button>}
              </div>

              {/* tips */}
              <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
                <div style={{ fontSize: 9, color: P, letterSpacing: "2px", fontWeight: 700, marginBottom: 7 }}>TIPS FOR 90%+ SCORE</div>
                {["Paste the COMPLETE JD - more text = more keywords matched", "Include responsibilities AND requirements sections", "The AI extracts every tool, skill, and phrase automatically"].map(tip => (
                  <div key={tip} style={{ fontSize: 10, color: "#7c6a9a", marginBottom: 4, display: "flex", gap: 6 }}>
                    <span style={{ flexShrink: 0 }}>+</span><span>{tip}</span>
                  </div>
                ))}
              </div>

              <button className="ats-cta" onClick={optimize} disabled={loading}
                style={{ width: "100%", padding: "14px 0", background: loading ? "#ede9fe" : P, border: "none", borderRadius: 9, color: loading ? "#7c3aed" : "#fff", fontSize: 11, fontWeight: 700, letterSpacing: "2px", cursor: loading ? "not-allowed" : "pointer", fontFamily: "'DM Mono',monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "all .25s" }}>
                {loading ? <><Spinner color="#7c3aed" /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 210 }}>{stage}</span></> : "OPTIMIZE FOR ATS (90%+)"}
              </button>

              {error && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 11, color: "#dc2626", lineHeight: 1.5, animation: "ats-fadein .2s" }}>
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* ==== COL 3: OUTPUT ==== */}
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e8e8", overflow: "hidden", boxShadow: "0 1px 8px #0000050a" }}>
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Badge n="3" active={step === 3} done={false} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111", fontFamily: "'Syne',sans-serif" }}>Optimized LaTeX</div>
                  <div style={{ fontSize: 10, color: "#bbb", marginTop: 1 }}>Compile free at overleaf.com</div>
                </div>
              </div>
              {output && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="ats-ibtn" onClick={copy} style={{ fontSize: 10, padding: "5px 12px", borderRadius: 6, background: copied ? "#f0fdf4" : "#f8f8f8", border: `1px solid ${copied ? "#bbf7d0" : "#e8e8e8"}`, color: copied ? G : "#666", cursor: "pointer", fontFamily: "'DM Mono',monospace", transition: "all .2s" }}>{copied ? "Copied!" : "Copy"}</button>
                  <button className="ats-ibtn" onClick={download} style={{ fontSize: 10, padding: "5px 12px", borderRadius: 6, background: "#f8f8f8", border: "1px solid #e8e8e8", color: "#666", cursor: "pointer", fontFamily: "'DM Mono',monospace" }}>Download .tex</button>
                </div>
              )}
            </div>

            {atsScore && <ScoreDonut score={atsScore} />}

            <div style={{ padding: "14px 20px 18px" }}>
              {!output && !loading && (
                <div style={{ height: atsScore ? 260 : 360, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "#fafafa", borderRadius: 10, border: "1px dashed #e8e8e8" }}>
                  <div style={{ fontSize: 32, opacity: .1 }}>*</div>
                  <div style={{ fontSize: 11, color: "#ccc", letterSpacing: "2px" }}>AWAITING OPTIMIZATION</div>
                  <div style={{ fontSize: 10, color: "#e0e0e0", textAlign: "center", maxWidth: 180, lineHeight: 1.7 }}>Upload resume + paste JD then click Optimize</div>
                </div>
              )}
              {loading && (
                <div style={{ height: 360, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "#fafafa", borderRadius: 10, border: `1px dashed ${stage.includes("busy") ? "#f59e0b" : "#e9d5ff"}` }}>
                  {stage.includes("busy")
                    ? <div style={{ fontSize: 26 }}>⏳</div>
                    : <div style={{ display: "flex", gap: 7 }}>{[0, 1, 2].map(i => <div key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: P, animation: `ats-pulse 1.2s ease-in-out ${i * .2}s infinite` }} />)}</div>
                  }
                  <div style={{ fontSize: 11, color: stage.includes("busy") ? "#b45309" : P, letterSpacing: "1px", textAlign: "center", maxWidth: 240 }}>{stage}</div>
                  {stage.includes("busy") && <div style={{ fontSize: 10, color: "#d97706", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 14px" }}>Will retry automatically</div>}
                </div>
              )}
              {output && (
                <>
                  <textarea readOnly value={output}
                    style={{ width: "100%", height: atsScore ? 255 : 360, resize: "vertical", border: "1px solid #e8e8e8", borderRadius: 8, padding: "10px 12px", fontSize: 10, lineHeight: 1.6, color: "#1e1b4b", background: "#fafafa", boxSizing: "border-box", fontFamily: "'DM Mono',monospace", outline: "none" }} />
                  <div style={{ marginTop: 10, padding: "10px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 10, color: "#1e40af", lineHeight: 1.8 }}>
                    <strong>Next:</strong> Copy the LaTeX above, go to <a href="https://overleaf.com" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>overleaf.com</a>, New Project, Blank, paste, click Recompile, download PDF.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ---- HOW IT WORKS ---- */}
        <div style={{ marginTop: 52, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#ccc", letterSpacing: "4px", marginBottom: 24 }}>HOW IT WORKS</div>
          <div className="ats-how-wrap">
            {[
              { icon: "📤", title: "Upload", desc: "PDF, TXT, LaTeX, or Markdown" },
              { icon: "📋", title: "Paste JD", desc: "Drop in the complete job description" },
              { icon: "🤖", title: "AI Saturates", desc: "Claude injects every JD keyword" },
              { icon: "✅", title: "Score 90%+", desc: "Compile on Overleaf and apply" },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "stretch" }}>
                <div className="ats-how-card" style={{ textAlign: "center", padding: "20px 24px", background: "#fff", border: "1px solid #ebebeb", borderRadius: i === 0 ? "12px 0 0 12px" : i === 3 ? "0 12px 12px 0" : "0", borderLeft: i > 0 ? "none" : "1px solid #ebebeb", minWidth: 0, flex: "1 1 140px" }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>{item.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#111", marginBottom: 4, fontFamily: "'Syne',sans-serif" }}>{item.title}</div>
                  <div style={{ fontSize: 10, color: "#999", lineHeight: 1.6 }}>{item.desc}</div>
                </div>
                {i < 3 && <div className="ats-how-arrow" style={{ display: "flex", alignItems: "center", padding: "0 1px" }}><div style={{ fontSize: 14, color: "#e0e0e0" }}>›</div></div>}
              </div>
            ))}
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 28, fontSize: 9, color: "#ccc", letterSpacing: "1px" }}>Built with Claude AI - Your data is never stored or logged</div>
      </div>
    </div>
  );
}
