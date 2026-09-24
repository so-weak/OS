/* =====================================================================
   Single source of truth for all portfolio content.
   Transcribed from Soubhik Ghosh's resume (September 2026). Do NOT
   invent facts, metrics or dates — if it is not here, it does not
   exist. Keep this file in step with public/SoubhikGhosh-Resume.pdf;
   the CRT renders that same PDF as SVG (see src/os/apps/Resume.tsx).
   ===================================================================== */

/** Prefix a public-asset path with Vite's base URL so it resolves correctly
    whether the site is served from the root or a subpath (e.g. /OS/). */
const asset = (p: string) => `${import.meta.env.BASE_URL}${p.replace(/^\//, '')}`

export const identity = {
  name: 'Soubhik Ghosh',
  title: 'GenAI & Machine Learning Engineer',
  /** the three the resume headline calls out after the role */
  focus: ['LLMs', 'Agentic AI', 'RAG'],
  phone: '+91-7903388603',
  whatsapp: '+91-9777465221',
  email: '99ghoshsoubhik@gmail.com',
  website: 'https://so-weak.github.io/OS',
  linkedin: 'https://linkedin.com/in/soweak',
  github: 'https://github.com/so-weak',
  location: 'Bengaluru, India',
  resumePdf: asset('/SoubhikGhosh-Resume.pdf'),
}

/** Headline experience tally, exactly as stated on the resume: "5+ years
    of combined experience across HDFC Bank, PayU (Wibmo), and FICO". */
export const experienceTally = {
  combinedYears: 5,
  employers: ['HDFC Bank', 'PayU (Wibmo)', 'FICO'],
}

export const summary = `GenAI & Machine Learning Engineer with 5+ years of combined experience across HDFC Bank, PayU (Wibmo), and FICO, building production AI systems across Generative AI, LLM engineering, Agentic AI, RAG, Document AI, Computer Vision, biometrics, and intelligent automation. Strong hands-on expertise in LLM orchestration, AI solution architecture, hybrid retrieval, AI microservices, MLOps, and full-stack AI applications, with experience leading engineers and taking AI systems from experimentation to production. Recognized with the HDFC Bank Silver Star Award for AI technical excellence and presenting AI initiatives to the CEO and Board.`

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
      'Vertex AI',
      'LiteLLM',
      'LangChain',
      'LangGraph',
      'RAG',
      'Agentic AI',
      'Prompt Engineering',
    ],
  },
  {
    label: 'ML / CV / NLP',
    items: [
      'PyTorch',
      'Transformers',
      'DistilBERT ML',
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
      'WebGL',
      'FastAPI',
      'Spring Boot',
      'Node.js',
      'REST APIs',
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
  links?: { label: string; url: string }[]
}

export const projects: Project[] = [
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
      'ReactJS Micro Frontends',
      'Keycloak',
      'MFA',
      'RAG',
    ],
    bullets: [
      "Designed and drove the bank's first agentic AI platform, architecting a LangGraph-based orchestration layer that composes banking workflows from modular skills and agents while integrating session management, MFA-aware agents, authentication, and downstream banking entities.",
      'Integrated 25+ tools and banking capabilities behind a unified tool-calling layer, enabling agents to securely invoke reusable services and workflows rather than relying on hard-coded conversational flows.',
      'Designed RAG capabilities over public website and enterprise knowledge sources, enabling agents to retrieve grounded, current information and combine it with authenticated banking workflows and tool responses.',
      'Designed and load-tested the platform for approximately 3 lakh concurrent users ahead of its initial production rollout; the initiative was subsequently showcased at Global FinTech Fest 2026.',
      'Established modularity, authentication, observability, and code-quality standards across platform repositories.',
    ],
  },
  {
    id: 'ai-fabric',
    name: 'AI Fabric: TradeOps',
    tagline: 'LLM Document Intelligence Platform',
    org: 'HDFC Bank',
    category: 'genai',
    stack: [
      'Python',
      'FastAPI',
      'Gemini',
      'Vertex AI',
      'ChandraOCR',
      'LiteLLM',
      'LayoutLM',
      'BERT',
      'Docker',
      'CI/CD',
    ],
    bullets: [
      "Architected and led the bank's first production Python AI platform: document classification/extraction microservices serving 800+ users pan-India at 97% accuracy, reducing manual processing time by 90%.",
      'Built a pluggable LLM architecture using Vertex AI and LiteLLM, integrating Gemini with LayoutLM/BERT extraction, confidence scoring, prompt management, and an 11-API feedback loop; led 4 engineers and established CI/CD with 98%+ test coverage.',
    ],
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
      'Gemini 3.5 Flash Lite',
      'Vertex AI',
      'LiteLLM',
      'LayoutLM',
      'RapidOCR',
      'OpenCV',
    ],
    bullets: [
      'Engineered a high-throughput cheque-processing engine combining Gemini, LayoutLM, and Donut, achieving 99%+ accuracy at 10+ cheques/sec; built a validation harness over 700K+ ICR reject records to benchmark and improve production quality.',
    ],
  },
  {
    id: 'verifyx',
    name: 'VerifyX: Audit, Credit & Retail AI',
    tagline: 'RAG-Powered Verification Framework',
    org: 'HDFC Bank',
    category: 'genai',
    stack: ['ReactJS', 'FastAPI', 'Gemini', 'RAG', 'CAG Agent', 'LiteLLM'],
    bullets: [
      'Built a reusable audit and verification framework for VKYC and ECCS cheque-data workflows, with a RAG/CAG chat agent spanning 27,000+ documents, reused across retail and credit.',
      'Optimized chunking and token strategies to improve retrieval efficiency and reduce LLM consumption; presented the framework and enterprise GenAI capabilities to the CEO and Board.',
    ],
  },
  {
    id: 'narad-ai',
    name: 'Narad AI & VERA',
    tagline: 'Enterprise Agentic & Voice AI Interfaces',
    org: 'HDFC Bank',
    category: 'genai',
    stack: [
      'ReactJS',
      'Micro Frontends',
      'Llama Omni',
      'FastAPI',
      'LiteLLM',
      'ThreeJS',
    ],
    bullets: [
      'Built the Narad AI email-agent on a reusable micro-frontend architecture that categorises and responds to emails and raises tickets with 98%+ test coverage, and developed the VERA voice-to-voice interface with real-time ThreeJS visualizations.',
    ],
  },
  {
    id: 'pay-by-face',
    name: 'Pay-by-Face & LOOK: Facial Biometrics',
    tagline: 'Real-Time Recognition + Anti-Spoofing',
    org: 'HDFC Bank',
    category: 'ml-cv',
    stack: [
      'ArcFace',
      'FaceNet',
      'InsightFace',
      'FAISS',
      'Milvus',
      'Custom Anti-Spoofing CNN',
      'PyTorch',
    ],
    bullets: [
      'Benchmarked 7 face-embedding models and shipped sub-100ms recognition at 99.2% accuracy under production load; built a custom anti-spoofing CNN using liveness, depth maps, and texture analysis with false acceptance rate below 0.1%.',
    ],
  },
  {
    id: 'signature-verify',
    name: 'Signature Verification Pipeline',
    tagline: 'Document Forensics',
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
      'Designed signature verification using custom YOLOv8 extraction, Pix2Pix GAN denoising, embedding similarity, and image interpolation.',
    ],
  },
  {
    id: 'pay-by-voice',
    name: 'Vaani & Pay-by-Voice: Voice Biometrics',
    tagline: 'Speaker Verification + Voice-to-Voice',
    org: 'HDFC Bank',
    category: 'ml-cv',
    stack: [
      'Indic Parler-TTS',
      'Wav2Vec2',
      'Whisper',
      'ECAPA-TDNN/x-vector',
      'PyTorch',
    ],
    bullets: [
      'Built ECAPA-TDNN speaker verification reaching 97% accuracy, with Wav2Vec2/Whisper, Indic Parler-TTS, and anti-spoofing voice forensics for multimodal Pay-by-Voice.',
    ],
  },
  {
    id: 'ankan',
    name: 'Ankan: Image Labelling Platform',
    tagline: 'Active-Learning Annotation Tool',
    org: 'HDFC Bank',
    category: 'ml-cv',
    stack: ['ReactJS', 'FastAPI', 'YugabyteDB', 'Active Learning', 'Quality Gating'],
    bullets: [
      'Built an active-learning annotation platform with quality gates; 100+ users labelled 10,000+ images for bank-wide ML training data.',
    ],
  },
  {
    id: 'pareekshana',
    name: 'Pareekshana Automation Suite & AI OS',
    tagline: 'QA Automation + Platform Foundation',
    org: 'HDFC Bank',
    category: 'ml-cv',
    stack: ['ReactJS MFE', 'RAG-based CAG', 'FastAPI', 'LLM Orchestration'],
    bullets: [
      'Redesigned the enterprise QA suite with Micro Frontends, RAG-based CAG, and LLM orchestration; led up to 10 engineers and built AI-powered merchant-verification and onboarding compliance POCs.',
    ],
  },
  {
    id: 'soweak',
    name: 'soweak: AI Security Framework',
    tagline: 'Python & TypeScript — PyPI & npm',
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
      'Published OWASP-aligned middleware defending LLM boundaries across input, retrieval, tool calls, output, and streaming; shipped Python (PyPI) and TypeScript (npm) implementations with audit trails.',
      'Trained RoBERTa/DeBERTa classifiers for prompt injection, jailbreak, PII/DLP, and toxicity detection, with LangChain, OpenAI, and Gemini adapters plus a red-team CLI.',
    ],
    links: [{ label: 'GitHub', url: 'https://github.com/so-weak/soweak' }],
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
      'PlaywrightMCP',
    ],
    bullets: [
      'Built a multi-tenant platform that compiles natural-language tasks into typed DAG workflows through an LLM planner, with credential management, per-task audit, and remote execution over WebSockets.',
    ],
    links: [{ label: 'GitHub', url: 'https://github.com/so-weak/aakaar' }],
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
      'Generative AI & large language model engineering: agentic platforms, document intelligence, RAG and enterprise AI interfaces for India’s largest private bank.',
      'Machine learning, computer vision & biometrics: face and voice verification, anti-spoofing, signature forensics and annotation tooling.',
    ],
    projectIds: [
      'ai-banking',
      'ai-fabric',
      'cheque-ai',
      'verifyx',
      'narad-ai',
      'pay-by-face',
      'signature-verify',
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
      'Owned the Angular frontend end-to-end for the Fraud Detection Risk Management Portal, including architecture, UI development, state management, performance optimization, and production deployment.',
      'Architected and scaled Spring Boot microservices, developing 20+ REST APIs with Couchbase and Redis caching and reducing response times by 50% during high-traffic workloads.',
      'Built secure authentication and API infrastructure using FIDO2, FIDO UAM, Keycloak, secure API gateways, Docker, Kubernetes, and Nginx; received PayU Quarterly Ace and ThankU Awards.',
    ],
  },
  {
    company: 'Fair Isaac Corporation (FICO)',
    role: 'Associate Software Engineer / Software Engineering Intern',
    period: 'Jun 2021 – Aug 2022',
    location: 'Bengaluru, India',
    bullets: [
      'Built Python and Computer Vision pipelines for bank statements and identity documents; optimized C++/Python facial-recognition code toward FRVT/NIST certification and contributed to rPPG liveness-detection datasets and model development.',
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
]

export const awards = [
  {
    title: 'Silver Star Award — HDFC Bank',
    detail: 'AI technical excellence.',
  },
  {
    title: 'Quarterly Ace Award — PayU',
    detail: 'Consistent full-stack delivery.',
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
  'Google IT Support',
  'From Data to Insights with Google Cloud',
  'Human-Centered Design',
  'JLPT N4 (Japanese Language Proficiency Test)',
]
