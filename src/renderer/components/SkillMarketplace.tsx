import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wrench,
  Upload,
  Star,
  Download,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Edit3,
  FileText,
  Check,
  X,
  Search,
} from "lucide-react";
import { GlassCard } from "./premium/GlassCard";
import { GlowButton } from "./premium/GlowButton";
import { StatusBadge } from "./premium/StatusBadge";

interface SkillStep {
  order: number;
  action: string;
  description: string;
  tool?: string;
  parameters: Record<string, unknown>;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: SkillStep[];
  tools_needed: string[];
  examples: string[];
  confidence: number;
  rating: number;
  installs: number;
  installed?: boolean;
}

const categories = ["All", "Coding", "Design", "Research", "DevOps", "Security", "Testing"];

const demoSkills: Skill[] = [
  {
    id: "1",
    name: "React Component Generator",
    description: "Generates production-ready React components with TypeScript, stories, and tests.",
    category: "Coding",
    steps: [
      { order: 1, action: "analyze_requirements", description: "Parse component requirements from prompt", tool: "llm", parameters: {} },
      { order: 2, action: "generate_component", description: "Generate .tsx component file", tool: "code_writer", parameters: {} },
      { order: 3, action: "generate_stories", description: "Create Storybook stories", tool: "code_writer", parameters: {} },
      { order: 4, action: "generate_tests", description: "Create unit tests with Vitest", tool: "code_writer", parameters: {} },
    ],
    tools_needed: ["llm", "code_writer"],
    examples: ["Create a Button component with variants"],
    confidence: 0.92,
    rating: 4.8,
    installs: 1243,
  },
  {
    id: "2",
    name: "API Endpoint Scaffold",
    description: "Scaffolds RESTful API endpoints with validation, controllers, and routes.",
    category: "Coding",
    steps: [
      { order: 1, action: "parse_schema", description: "Parse data model from input", tool: "schema_parser", parameters: {} },
      { order: 2, action: "generate_controller", description: "Create controller with CRUD operations", tool: "code_writer", parameters: {} },
      { order: 3, action: "generate_routes", description: "Set up Express/Fastify routes", tool: "code_writer", parameters: {} },
      { order: 4, action: "generate_validation", description: "Add Zod/Joi validation schemas", tool: "code_writer", parameters: {} },
    ],
    tools_needed: ["code_writer", "schema_parser"],
    examples: ["Create a user CRUD API"],
    confidence: 0.88,
    rating: 4.5,
    installs: 892,
  },
  {
    id: "3",
    name: "UI Mockup Converter",
    description: "Converts Figma designs or image mockups into HTML/CSS or React code.",
    category: "Design",
    steps: [
      { order: 1, action: "analyze_image", description: "Extract layout from design image", tool: "vision", parameters: {} },
      { order: 2, action: "generate_html", description: "Create semantic HTML structure", tool: "code_writer", parameters: {} },
      { order: 3, action: "generate_css", description: "Write CSS with design tokens", tool: "code_writer", parameters: {} },
      { order: 4, action: "responsive_check", description: "Add responsive breakpoints", tool: "code_writer", parameters: {} },
    ],
    tools_needed: ["vision", "code_writer"],
    examples: ["Convert this landing page design to React"],
    confidence: 0.85,
    rating: 4.6,
    installs: 756,
  },
  {
    id: "4",
    name: "Design System Audit",
    description: "Audits existing UI for design system consistency and generates a report.",
    category: "Design",
    steps: [
      { order: 1, action: "scan_components", description: "Scan all component files", tool: "file_scanner", parameters: {} },
      { order: 2, action: "extract_tokens", description: "Extract color, typography, spacing usage", tool: "analyzer", parameters: {} },
      { order: 3, action: "compare_tokens", description: "Compare against design tokens", tool: "analyzer", parameters: {} },
      { order: 4, action: "generate_report", description: "Generate audit report with recommendations", tool: "report_writer", parameters: {} },
    ],
    tools_needed: ["file_scanner", "analyzer"],
    examples: ["Audit design system compliance"],
    confidence: 0.78,
    rating: 4.2,
    installs: 423,
  },
  {
    id: "5",
    name: "Research Synthesizer",
    description: "Synthesizes research papers and articles into structured summaries with citations.",
    category: "Research",
    steps: [
      { order: 1, action: "fetch_sources", description: "Retrieve sources from URLs or files", tool: "web_fetcher", parameters: {} },
      { order: 2, action: "extract_key_points", description: "Extract key findings and data", tool: "llm", parameters: {} },
      { order: 3, action: "synthesize", description: "Synthesize into coherent summary", tool: "llm", parameters: {} },
      { order: 4, action: "generate_citations", description: "Format citations in target style", tool: "formatter", parameters: {} },
    ],
    tools_needed: ["web_fetcher", "llm", "formatter"],
    examples: ["Summarize these 5 papers on LLM agents"],
    confidence: 0.90,
    rating: 4.7,
    installs: 1102,
  },
  {
    id: "6",
    name: "Competitor Analyzer",
    description: "Analyzes competitor products from public data and generates comparison matrices.",
    category: "Research",
    steps: [
      { order: 1, action: "gather_data", description: "Collect public data on competitors", tool: "web_fetcher", parameters: {} },
      { order: 2, action: "categorize", description: "Categorize features and pricing", tool: "llm", parameters: {} },
      { order: 3, action: "create_matrix", description: "Build comparison matrix", tool: "report_writer", parameters: {} },
      { order: 4, action: "recommend", description: "Generate strategic recommendations", tool: "llm", parameters: {} },
    ],
    tools_needed: ["web_fetcher", "llm", "report_writer"],
    examples: ["Analyze competitors in the AI IDE space"],
    confidence: 0.82,
    rating: 4.3,
    installs: 634,
  },
  {
    id: "7",
    name: "Dockerfile Generator",
    description: "Generates optimized Dockerfiles and docker-compose configs for any project.",
    category: "DevOps",
    steps: [
      { order: 1, action: "detect_stack", description: "Detect project stack and dependencies", tool: "file_scanner", parameters: {} },
      { order: 2, action: "select_base", description: "Choose optimal base image", tool: "llm", parameters: {} },
      { order: 3, action: "write_dockerfile", description: "Create multi-stage Dockerfile", tool: "code_writer", parameters: {} },
      { order: 4, action: "write_compose", description: "Create docker-compose.yml", tool: "code_writer", parameters: {} },
    ],
    tools_needed: ["file_scanner", "llm", "code_writer"],
    examples: ["Dockerize this Node.js monorepo"],
    confidence: 0.87,
    rating: 4.6,
    installs: 978,
  },
  {
    id: "8",
    name: "CI/CD Pipeline Builder",
    description: "Creates GitHub Actions, GitLab CI, or Azure DevOps pipelines with best practices.",
    category: "DevOps",
    steps: [
      { order: 1, action: "detect_repo", description: "Detect repository structure and language", tool: "file_scanner", parameters: {} },
      { order: 2, action: "choose_platform", description: "Select CI/CD platform based on context", tool: "llm", parameters: {} },
      { order: 3, action: "generate_workflow", description: "Create workflow YAML with stages", tool: "code_writer", parameters: {} },
      { order: 4, action: "add_secrets", description: "Configure secrets and environment variables", tool: "code_writer", parameters: {} },
    ],
    tools_needed: ["file_scanner", "llm", "code_writer"],
    examples: ["Set up CI for this Python project"],
    confidence: 0.84,
    rating: 4.4,
    installs: 712,
  },
];

export default function SkillMarketplace() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [mySkills, setMySkills] = useState<Skill[]>([]);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<Skill | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredSkills = demoSkills.filter((skill) => {
    const matchesCategory = activeCategory === "All" || skill.category === activeCategory;
    const matchesSearch =
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const addToMySkills = useCallback(
    (skill: Skill) => {
      if (!mySkills.find((s) => s.id === skill.id)) {
        setMySkills([...mySkills, { ...skill, installed: true }]);
      }
    },
    [mySkills]
  );

  const removeFromMySkills = useCallback(
    (skillId: string) => {
      setMySkills(mySkills.filter((s) => s.id !== skillId));
    },
    [mySkills]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    // Simulate parsing uploaded document
    const mockParsed: Skill = {
      id: `custom-${Date.now()}`,
      name: "Custom Uploaded Skill",
      description: "Auto-parsed from uploaded document. Review and save to activate.",
      category: "Coding",
      steps: [
        { order: 1, action: "parse_input", description: "Parse uploaded document content", tool: "document_parser", parameters: {} },
        { order: 2, action: "extract_steps", description: "Extract actionable steps", tool: "llm", parameters: {} },
      ],
      tools_needed: ["document_parser", "llm"],
      examples: ["Parsed from document"],
      confidence: 0.7,
      rating: 0,
      installs: 0,
    };
    setUploadPreview(mockParsed);
  }, []);

  const saveUploadedSkill = useCallback(() => {
    if (uploadPreview) {
      addToMySkills(uploadPreview);
      setUploadPreview(null);
      setShowUpload(false);
    }
  }, [uploadPreview, addToMySkills]);

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-construct-border/50">
        <div className="flex items-center gap-2">
          <Wrench size={16} className="text-construct-accent" />
          <span className="text-sm font-semibold text-construct-text">Skill Marketplace</span>
        </div>
        <GlowButton size="sm" onClick={() => setShowUpload(!showUpload)}>
          <Upload size={12} />
          Upload Document
        </GlowButton>
      </div>

      {/* Upload Zone */}
      <AnimatePresence>
        {showUpload && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                mx-4 mt-3 p-6 rounded-xl border-2 border-dashed cursor-pointer text-center transition-all
                ${dragOver
                  ? "border-construct-accent bg-construct-accent/5"
                  : "border-construct-border/50 bg-[rgba(255,255,255,0.02)] hover:border-construct-accent/50"
                }
              `}
            >
              <input ref={fileInputRef} type="file" className="hidden" accept=".md,.txt,.pdf" />
              <FileText size={24} className="mx-auto mb-2 text-construct-textMuted" />
              <p className="text-xs text-construct-textMuted">
                Drag & drop a document, or click to browse
              </p>
              <p className="text-[10px] text-construct-textMuted mt-1">Supports .md, .txt, .pdf</p>
            </div>

            {/* Upload Preview */}
            <AnimatePresence>
              {uploadPreview && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mx-4 mt-2"
                >
                  <GlassCard className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-construct-text">
                          {uploadPreview.name}
                        </div>
                        <div className="text-[10px] text-construct-textMuted">
                          {uploadPreview.steps.length} steps detected
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <GlowButton variant="ghost" size="sm" onClick={() => setUploadPreview(null)}>
                          <X size={12} />
                        </GlowButton>
                        <GlowButton size="sm" onClick={saveUploadedSkill}>
                          <Check size={12} />
                          Save Skill
                        </GlowButton>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Category Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-construct-border/50 overflow-x-auto">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`
              px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all
              ${activeCategory === cat
                ? "bg-construct-accent/15 text-construct-accent border border-construct-accent/25"
                : "text-construct-textMuted hover:text-construct-text hover:bg-[rgba(255,255,255,0.04)]"
              }
            `}
          >
            {cat}
          </button>
        ))}
        <div className="flex-1" />
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-construct-textMuted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills..."
            className="h-6 pl-7 pr-2 bg-[rgba(255,255,255,0.04)] border border-construct-border/50 rounded-lg text-[11px] text-construct-text placeholder-construct-textMuted outline-none focus:border-construct-accent/50 transition-colors w-36"
          />
        </div>
      </div>

      {/* My Skills Section */}
      {mySkills.length > 0 && (
        <div className="px-4 py-2 border-b border-construct-border/30">
          <div className="text-[11px] font-semibold text-construct-accent mb-2">My Skills</div>
          <div className="flex flex-wrap gap-2">
            {mySkills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center gap-1.5 px-2 py-1 bg-construct-accent/10 border border-construct-accent/20 rounded-lg"
              >
                <span className="text-[11px] text-construct-text">{skill.name}</span>
                <button
                  onClick={() => removeFromMySkills(skill.id)}
                  className="text-construct-textMuted hover:text-construct-error transition-colors"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skills Grid */}
      <div className="flex-1 overflow-auto px-4 py-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredSkills.map((skill) => (
            <GlassCard key={skill.id} className="p-3" glow="accent">
              {/* Skill Header */}
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="text-xs font-semibold text-construct-text">{skill.name}</h3>
                  <p className="text-[10px] text-construct-textMuted mt-0.5 line-clamp-2">
                    {skill.description}
                  </p>
                </div>
                <span className="px-1.5 py-0.5 bg-[rgba(255,255,255,0.06)] rounded text-[9px] text-construct-textMuted capitalize shrink-0">
                  {skill.category}
                </span>
              </div>

              {/* Rating & Installs */}
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      size={10}
                      className={i < Math.floor(skill.rating) ? "text-[#f9e2af] fill-[#f9e2af]" : "text-construct-textMuted/30"}
                    />
                  ))}
                  <span className="text-[10px] text-construct-textMuted ml-1">{skill.rating}</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-construct-textMuted">
                  <Download size={10} />
                  {skill.installs.toLocaleString()}
                </div>
              </div>

              {/* Tools */}
              <div className="flex flex-wrap gap-1 mb-2">
                {skill.tools_needed.map((tool) => (
                  <span
                    key={tool}
                    className="px-1.5 py-0.5 bg-construct-accent/10 rounded text-[9px] text-construct-accent"
                  >
                    {tool}
                  </span>
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 mt-auto pt-2 border-t border-construct-border/30">
                <GlowButton
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={() =>
                    setExpandedSkill(expandedSkill === skill.id ? null : skill.id)
                  }
                >
                  {expandedSkill === skill.id ? (
                    <>
                      <ChevronUp size={10} />
                      Hide
                    </>
                  ) : (
                    <>
                      <ChevronDown size={10} />
                      Preview
                    </>
                  )}
                </GlowButton>
                <GlowButton
                  size="sm"
                  className="flex-1"
                  onClick={() => addToMySkills(skill)}
                  disabled={mySkills.some((s) => s.id === skill.id)}
                >
                  <Plus size={10} />
                  {mySkills.some((s) => s.id === skill.id) ? "Added" : "Add"}
                </GlowButton>
              </div>

              {/* Expanded Steps */}
              <AnimatePresence>
                {expandedSkill === skill.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 pt-2 border-t border-construct-border/30 space-y-1">
                      {skill.steps.map((step) => (
                        <div key={step.order} className="flex gap-2 text-[10px]">
                          <span className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full bg-construct-accent/15 text-construct-accent font-medium">
                            {step.order}
                          </span>
                          <div>
                            <span className="text-construct-text font-medium">{step.action}</span>
                            <span className="text-construct-textMuted ml-1">{step.description}</span>
                            {step.tool && (
                              <span className="ml-1 px-1 bg-[rgba(255,255,255,0.06)] rounded text-[9px] text-construct-textMuted">
                                {step.tool}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                      {/* Confidence */}
                      <div className="flex items-center gap-2 mt-2 pt-1 border-t border-construct-border/30">
                        <span className="text-[10px] text-construct-textMuted">Confidence:</span>
                        <div className="flex-1 h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{
                              background: "linear-gradient(90deg, #89b4fa, #a6e3a1)",
                            }}
                            initial={{ width: 0 }}
                            animate={{ width: `${skill.confidence * 100}%` }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                          />
                        </div>
                        <span className="text-[10px] text-construct-accent">
                          {Math.round(skill.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </GlassCard>
          ))}
        </div>

        {filteredSkills.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-construct-textMuted">
            <Search size={24} className="mb-2 opacity-50" />
            <p className="text-xs">No skills found</p>
          </div>
        )}
      </div>
    </div>
  );
}
