/* =====================================================================
   Single source of truth for all portfolio content.
   Transcribed from Soubhik Ghosh's resume (June 2026). Do NOT invent
   facts, metrics or dates — if it is not here, it does not exist.
   ===================================================================== */

/** Prefix a public-asset path with Vite's base URL so it resolves correctly
    whether the site is served from the root or a subpath (e.g. /OS/). */
const asset = (p: string) => `${import.meta.env.BASE_URL}${p.replace(/^\//, '')}`

export const identity = {
  name: 'Soubhik Ghosh',
  title: 'Artificial Intelligence & Machine Learning Engineer',
  phone: '+91-7903388603',
  whatsapp: '+91-9777465221',
  email: '99ghoshsoubhik@gmail.com',
  linkedin: 'https://linkedin.com/in/soweak',
  github: 'https://github.com/SoubhikGhosh',
  location: 'Bengaluru, India',
  resumePdf: asset('/SoubhikGhosh-Resume.pdf'),
}

/** Headline experience tally, exactly as stated on the resume. */
export const experienceTally = { fullTimeYears: 4, internYears: 1 }

export const summary = `Full Stack & AI/ML Engineer with 4 years of full-time experience (plus a 1-year internship) delivering scalable FinTech platforms at HDFC Bank, PayU, and FICO. Ships production Generative AI (LLM agents, RAG, document intelligence) and classical ML/Computer Vision (face/voice biometrics, anti-spoofing, signature verification) on robust full-stack architectures. Recognized with the Silver Star Award (HDFC) for presenting transformative AI to the CEO & Board, and the Quarterly Ace Award (PayU) for zero-defect delivery.`

export interface SkillGroup {
  label: string
  items: string[]
}

export const skills: SkillGroup[] = [
  {
    label: 'Languages',
    items: ['Python', 'Java', 'TypeScript', 'JavaScript (ES6+)', 'C/C++'],
  },
  {
    label: 'GenAI / LLM',
    items: [
      'Gemini (1.5/2.5 Flash)',
      'Vertex AI',
      'LiteLLM',
      'LangChain',
      'LangGraph',
      'RAG',
      'Agentic Frameworks',
      'Prompt Engineering',
    ],
  },
  {
    label: 'ML / CV / NLP',
    items: [
      'PyTorch',
      'Transformers',
      'BERT',
      'RoBERTa',
      'DeBERTa',
      'LayoutLM',
      'Donut',
      'YOLOv8',
      'Pix2Pix GAN',
      'ArcFace',
      'FaceNet',
      'InsightFace',
      'Wav2Vec2',
      'Whisper',
      'Indic Parler-TTS',
      'ECAPA-TDNN',
    ],
  },
  {
    label: 'Full Stack',
    items: [
      'ReactJS',
      'Angular',
      'Micro Frontends',
      'ThreeJS',
      'FastAPI',
      'Spring Boot',
      'Node.js',
      'REST',
      'Microservices',
    ],
  },
  {
    label: 'Data / Infra',
    items: [
      'PostgreSQL',
      'MySQL',
      'Couchbase',
      'Redis',
      'FAISS',
      'BM25',
      'Vector DB',
      'YugabyteDB',
      'Docker',
      'Kubernetes',
      'CI/CD',
      'GCP',
      'AWS',
      'Kafka',
      'Keycloak',
      'FIDO2',
      'OAuth',
      'OWASP LLM Top 10',
    ],
  },
]

export interface Project {
  id: string
  name: string
  tagline: string
  org: 'HDFC Bank' | 'Open Source'
  category: 'genai' | 'ml-cv' | 'oss'
  stack: string[]
  bullets: string[]
  /** generated retro artwork, served from /projects/<id>.jpg */
  art: string
  links?: { label: string; url: string }[]
}

export const projects: Project[] = [
  {
    id: 'ai-fabric',
    name: 'AI Fabric: TradeOps',
    tagline: 'LLM Document Intelligence Platform',
    org: 'HDFC Bank',
    category: 'genai',
    stack: [
      'Python',
      'FastAPI',
      'Gemini 2.5 Flash',
      'Vertex AI',
      'LiteLLM',
      'LayoutLM',
      'BERT',
      'Docker',
      'CI/CD',
    ],
    bullets: [
      "Architected and led the bank's first production Python AI platform: document classification/extraction microservices for 800+ users pan-India at 97% accuracy, cutting manual processing time 90%.",
      'Built a pluggable LLM interface (Vertex AI + LiteLLM) eliminating vendor lock-in, pairing Gemini with LayoutLM/BERT extraction, confidence scoring, a prompt hub, and an 11-API feedback loop (98%+ test coverage); led 4 engineers and set up CI/CD.',
    ],
    art: asset('/projects/ai-fabric.jpg'),
  },
  {
    id: 'cheque-ai',
    name: 'Cheque Processing: Clearing House',
    tagline: 'High-Throughput Document AI',
    org: 'HDFC Bank',
    category: 'genai',
    stack: [
      'Python',
      'FastAPI',
      'Gemini 1.5/2.5 Flash',
      'Vertex AI',
      'LiteLLM',
      'LayoutLM',
      'Donut',
      'OpenCV',
    ],
    bullets: [
      'Solely owned an AI cheque engine pairing Gemini with LayoutLM/Donut, hitting 99%+ accuracy at 10+ cheques/sec; built a validation harness over 700K+ ICR reject records, projected to halve operations time.',
    ],
    art: asset('/projects/cheque-ai.jpg'),
  },
  {
    id: 'verifyx',
    name: 'VerifyX: Audit, Credit & Retail AI',
    tagline: 'RAG-Powered Verification Framework',
    org: 'HDFC Bank',
    category: 'genai',
    stack: ['ReactJS', 'FastAPI', 'Gemini', 'RAG (CAG agent)', 'LiteLLM'],
    bullets: [
      'Built an extensible audit framework (VKYC + ECCS cheque-data audit) with a CAG chat agent over RAG spanning 27,000+ documents, reused across retail and credit from one modular codebase.',
      'Optimized chunking and token strategy to cut LLM cost; demoed live to the CEO and Board of Directors.',
    ],
    art: asset('/projects/verifyx.jpg'),
  },
  {
    id: 'narad-ai',
    name: 'Narad AI & VRM',
    tagline: 'Enterprise Agentic Frontends',
    org: 'HDFC Bank',
    category: 'genai',
    stack: [
      'ReactJS',
      'Micro Frontends (MFE)',
      'Gemini',
      'FastAPI',
      'LiteLLM',
      'ThreeJS',
    ],
    bullets: [
      'Single-handedly built the Narad AI email-agent frontend on a reusable MFE architecture (98%+ test coverage) and the VERA voice-to-voice interface with real-time ThreeJS 3D visualizations.',
    ],
    art: asset('/projects/narad-ai.jpg'),
  },
  {
    id: 'ai-banking',
    name: 'AI Banking Platform',
    tagline: 'LangGraph Agentic Orchestration',
    org: 'HDFC Bank',
    category: 'genai',
    stack: [
      'Python',
      'LangGraph',
      'FastAPI',
      'Gemini',
      'LiteLLM',
      'ReactJS MFE',
      'Keycloak/MFA',
    ],
    bullets: [
      'Co-designed and drove a LangGraph-based, skills-oriented agentic platform composing banking workflows from modular skills, integrating session management, MFA authentication, and downstream banking entities behind a unified orchestration layer.',
      "Delivered the customizable Aqua AI micro-frontend chat surface and enforced strict modularity and code-quality standards across the platform's repositories.",
    ],
    art: asset('/projects/ai-banking.jpg'),
  },
  {
    id: 'rag-service',
    name: 'RAG-as-a-Service',
    tagline: 'Shared Retrieval Infrastructure',
    org: 'HDFC Bank',
    category: 'genai',
    stack: [
      'Python',
      'FAISS',
      'BM25 (hybrid retrieval)',
      'Sentence-Transformers',
      'Cohere/BGE reranker',
      'LiteLLM',
    ],
    bullets: [
      'Pioneered a hybrid FAISS + BM25 retrieval service with sentence-transformer embeddings and a Cohere/BGE reranker, reducing LLM hallucinations by 40-60% across 5 projects.',
    ],
    art: asset('/projects/rag-service.jpg'),
  },
  {
    id: 'signature-verify',
    name: 'Signature Verification Pipeline',
    tagline: 'Document Forensics (CV)',
    org: 'HDFC Bank',
    category: 'ml-cv',
    stack: [
      'YOLOv8',
      'Pix2Pix GAN',
      'Embedding Matching',
      'Bicubic Interpolation',
      'PyTorch',
    ],
    bullets: [
      'Designed an end-to-end pipeline: custom YOLOv8 for signature extraction, Pix2Pix GAN for image denoising/cleaning, and embedding-based similarity with bicubic interpolation for precise verification.',
    ],
    art: asset('/projects/signature-verify.jpg'),
  },
  {
    id: 'pay-by-face',
    name: 'Pay-by-Face & LOOK',
    tagline: 'Real-Time Facial Recognition + Anti-Spoofing',
    org: 'HDFC Bank',
    category: 'ml-cv',
    stack: [
      'ArcFace',
      'FaceNet',
      'InsightFace',
      'FAISS/Milvus vector store',
      'Custom Anti-Spoofing CNN',
      'PyTorch',
    ],
    bullets: [
      'Benchmarked 7 face-embedding models (ArcFace, FaceNet variants on InsightFace) and shipped sub-100ms recognition at 99.2% accuracy under production load, served from a FAISS/Milvus vector store.',
      'Built a custom anti-spoofing CNN using liveness, depth maps, and texture analysis, achieving a false acceptance rate below 0.1%; recognized with the Silver Star Award.',
    ],
    art: asset('/projects/pay-by-face.jpg'),
  },
  {
    id: 'pay-by-voice',
    name: 'Vaani & Pay-by-Voice',
    tagline: 'Speaker Verification + Voice-to-Voice',
    org: 'HDFC Bank',
    category: 'ml-cv',
    stack: [
      'Indic Parler-TTS',
      'Wav2Vec2',
      'Whisper (STT)',
      'ECAPA-TDNN/x-vector',
      'PyTorch',
    ],
    bullets: [
      'Fine-tuned Indic Parler-TTS and Wav2Vec2/Whisper STT and built ECAPA-TDNN speaker verification reaching 97% accuracy, plus anti-spoofing voice forensics for a multimodal Pay-by-Voice system.',
    ],
    art: asset('/projects/pay-by-voice.jpg'),
  },
  {
    id: 'ankan',
    name: 'Ankan: Image Labelling Platform',
    tagline: 'Active-Learning Annotation Tool',
    org: 'HDFC Bank',
    category: 'ml-cv',
    stack: ['ReactJS', 'FastAPI', 'YugabyteDB', 'Active Learning', 'Quality Gating'],
    bullets: [
      'Built from scratch an annotation tool with active-learning loops and quality gates; 100+ users have labelled 10,000+ images, now the standard for bank-wide ML training data.',
    ],
    art: asset('/projects/ankan.jpg'),
  },
  {
    id: 'pareekshana',
    name: 'Pareekshana Automation Suite & AI OS',
    tagline: 'QA Automation + Platform Foundation',
    org: 'HDFC Bank',
    category: 'genai',
    stack: ['ReactJS MFE', 'RAG-based CAG', 'FastAPI', 'LLM Orchestration'],
    bullets: [
      'Redesigned the enterprise QA suite (User Experience overhaul, Micro Frontend, RAG-based CAG) and laid the groundwork for AI OS; led up to 10 engineers and presented strategy to the board. Built a YOLO-based merchant-verification POC and an LLM-powered merchant-onboarding compliance solution.',
    ],
    art: asset('/projects/pareekshana.jpg'),
  },
  {
    id: 'soweak',
    name: 'soweak: AI Security Framework',
    tagline: 'OWASP-Aligned LLM Security Middleware (Python & TypeScript)',
    org: 'Open Source',
    category: 'oss',
    stack: [
      'Python',
      'TypeScript',
      'Transformers',
      'RoBERTa',
      'DeBERTa',
      'NER',
      'Sentence-Transformers',
      'OWASP LLM Top 10',
    ],
    bullets: [
      'Published an OWASP-aligned security middleware that defends every boundary of an LLM pipeline (input, retrieval, tool calls, output, streaming) with block/redact/transform/approval decisions and full audit trails; shipped both a Python (PyPI) library and an isomorphic TypeScript (npm) port for Node, browsers, and edge runtimes.',
      'Trained custom NER and NLP ML classifiers (RoBERTa/DeBERTa fine-tunes) for prompt-injection, jailbreak, PII/DLP, and toxicity detection, with LangChain, OpenAI, and Gemini adapters plus a red-team CLI.',
    ],
    art: asset('/projects/soweak.jpg'),
    links: [
      { label: 'GitHub', url: 'https://github.com/SoubhikGhosh/soweak' },
    ],
  },
  {
    id: 'aakaar',
    name: 'aakaar: NL to DAG Workflow Automation',
    tagline: 'Natural Language → Typed DAG Execution',
    org: 'Open Source',
    category: 'oss',
    stack: [
      'Python',
      'FastAPI',
      'React',
      'TypeScript',
      'LLM Planner',
      'WebSockets',
      'SQLite',
      'Chroma',
      'Playwright',
    ],
    bullets: [
      'Built a multi-tenant platform that compiles plain-language tasks into a typed DAG of registry-defined capabilities via an LLM planner, then executes it on a generic runtime interpreter with a credential vault and per-task audit.',
      'Engineered a remote-execution spine dispatching capability nodes over outbound WebSockets to lightweight cross-OS agents (shell, system, desktop-GUI), letting one authored workflow run on the server or any enrolled workstation.',
    ],
    art: asset('/projects/aakaar.jpg'),
    links: [
      { label: 'GitHub', url: 'https://github.com/SoubhikGhosh/aakaar' },
    ],
  },
]

export interface Job {
  company: string
  role: string
  period: string
  location: string
  bullets: string[]
  /** project ids from `projects` shipped during this job */
  projectIds?: string[]
}

export const experience: Job[] = [
  {
    company: 'HDFC Bank',
    role: 'Data Scientist (Deputy Manager)',
    period: 'Nov 2024 – Present',
    location: 'Bengaluru, India',
    bullets: [
      'Generative AI & LLM engineering: document intelligence, RAG, agentic platforms and enterprise frontends for India’s largest private bank.',
      'Machine learning, computer vision & biometrics: face/voice verification, anti-spoofing, signature forensics and annotation tooling.',
    ],
    projectIds: [
      'ai-fabric',
      'cheque-ai',
      'verifyx',
      'narad-ai',
      'ai-banking',
      'rag-service',
      'signature-verify',
      'pay-by-face',
      'pay-by-voice',
      'ankan',
      'pareekshana',
    ],
  },
  {
    company: 'PayU (Wibmo)',
    role: 'Software Engineer / Associate Software Engineer',
    period: 'Aug 2022 – Nov 2024',
    location: 'Bengaluru, India',
    bullets: [
      'Owned the Angular frontend end-to-end for the Fraud Detection Risk Management Portal (Angular, Figma), from design and development through state management, performance tuning, and production deployment of complex data-visualization dashboards.',
      'Architected and scaled Spring Boot microservices to absorb traffic spikes, cutting response times 50%; developed 20+ REST APIs backed by Couchbase and Redis caching.',
      'Built the FIDO2 / FIDO UAM / Keycloak authentication and secure API gateways.',
      'Containerized and shipped services with Docker, Kubernetes, and Nginx; earned the PayU ThankU and Quarterly Ace awards for consistent full-stack delivery.',
    ],
  },
  {
    company: 'Fair Isaac Corporation (FICO)',
    role: 'Associate Software Engineer / Software Engineering Intern',
    period: 'Jun 2021 – Aug 2022',
    location: 'Bengaluru, India',
    bullets: [
      'Built Python + Computer Vision pipelines to extract data from bank statements and identity documents; optimized C++/Python facial-recognition code toward FRVT NIST certification and annotated rPPG liveness-detection datasets within an Agile SDLC.',
    ],
  },
]

export const education = [
  {
    degree: 'B.Tech, Computer Science and Engineering',
    school: 'KIIT, Bhubaneswar',
    score: '9.56 CGPA',
    period: '2018 – 2022',
  },
  {
    degree: 'Class XII (CBSE)',
    school: 'Delhi Public School, Dhanbad',
    score: '90.4%',
    period: '2018',
  },
  {
    degree: 'Class X (ICSE)',
    school: 'De-Nobili School CMRI, Dhanbad',
    score: '95%',
    period: '2016',
  },
]

export const awards = [
  {
    title: 'Silver Star Award — HDFC Bank',
    detail: 'AI technical excellence; presented transformative AI to the CEO & Board.',
  },
  {
    title: 'Quarterly Ace Award — PayU',
    detail: 'Zero-defect delivery.',
  },
  {
    title: 'ThankU Award — PayU',
    detail: 'Consistent full-stack delivery.',
  },
  {
    title: 'Delegate — Google I/O Connect Bengaluru 2025',
    detail: 'Represented HDFC Bank.',
  },
]

export const certifications = [
  'Google IT Support Specialization',
  'From Data to Insights with Google Cloud',
  'Human-Centered Design',
  'JLPT N4 (Japanese Language Proficiency Test)',
]
