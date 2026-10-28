import React, { useState, useEffect, useMemo, useRef } from 'react';
import './App.css';
// ==========================================
// TYPES & INTERFACES
// ==========================================
export interface Question {
  id: string;
  text: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation?: string;
}

export interface Quiz {
  id: string;
  title: string;
  subject: string;
  description: string;
  durationMinutes: number;
  createdAt: string;
  updatedAt: string;
  questions: Question[];
}

export interface ExamAttempt {
  id: string;
  quizId: string;
  quizTitle: string;
  date: string;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  scorePercentage: number;
  timeSpentSeconds: number;
  userAnswers: Record<string, number>;
  questionsSnapshot: Question[];
}

type TabType = 'dashboard' | 'quizzes' | 'create' | 'exam' | 'history' | 'pdf-quiz';

// ==========================================
// STORAGE KEYS & SEED DATA
// ==========================================
const QUIZZES_KEY = 'quizcraft_quizzes_v1';
const RESULTS_KEY = 'quizcraft_results_v1';
const GEMINI_KEY_STORAGE = 'quizcraft_gemini_api_key';

const DEFAULT_SAMPLE_QUIZ: Quiz = {
  id: 'sample-quiz-cs101',
  title: 'Computer Science: Algorithms & Data Structures',
  subject: 'Computer Science',
  description: 'Core concepts including Big-O complexity, hash tables, stacks, and binary trees.',
  durationMinutes: 10,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  questions: [
    {
      id: 'q1',
      text: 'What is the average time complexity of looking up a key in a well-balanced Hash Map?',
      options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
      correctIndex: 0,
      explanation: 'Hash maps compute a hash of the key to index directly into array buckets, giving O(1) average lookup time.'
    },
    {
      id: 'q2',
      text: 'Which data structure follows the LIFO (Last In, First Out) principle?',
      options: ['Queue', 'Stack', 'Linked List', 'Binary Tree'],
      correctIndex: 1,
      explanation: 'A Stack strictly enforces Last In, First Out (LIFO), analogous to a stack of trays.'
    },
    {
      id: 'q3',
      text: 'What is the worst-case time complexity of standard QuickSort on an already sorted array with naive pivot selection?',
      options: ['O(n)', 'O(n log n)', 'O(n²)', 'O(2ⁿ)'],
      correctIndex: 2,
      explanation: 'If the pivot produces subproblems of sizes 0 and n-1 each round, QuickSort degrades to O(n²).'
    },
    {
      id: 'q4',
      text: 'In a complete binary tree of height h (where root height = 0), what is the maximum number of nodes?',
      options: ['2ʰ - 1', '2ʰ⁺¹ - 1', '2ʰ', 'h² + 1'],
      correctIndex: 1,
      explanation: 'The maximum node count in a binary tree of height h is 2^(h+1) - 1.'
    }
  ]
};

function safeLoadQuizzes(): Quiz[] {
  try {
    const raw = localStorage.getItem(QUIZZES_KEY);
    if (!raw) {
      localStorage.setItem(QUIZZES_KEY, JSON.stringify([DEFAULT_SAMPLE_QUIZ]));
      return [DEFAULT_SAMPLE_QUIZ];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [DEFAULT_SAMPLE_QUIZ];
  } catch (err) {
    console.error('QuizCraft: Error reading quizzes from localStorage:', err);
    return [DEFAULT_SAMPLE_QUIZ];
  }
}

function safeLoadResults(): ExamAttempt[] {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('QuizCraft: Error reading results from localStorage:', err);
    return [];
  }
}

// ==========================================
// MAIN COMPONENT
// ==========================================
export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // App Data
  const [quizzes, setQuizzes] = useState<Quiz[]>(safeLoadQuizzes);
  const [results, setResults] = useState<ExamAttempt[]>(safeLoadResults);
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [selectedAttemptForReview, setSelectedAttemptForReview] = useState<ExamAttempt | null>(null);

  // Active Exam State
  const [activeExamQuiz, setActiveExamQuiz] = useState<Quiz | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [examAnswers, setExamAnswers] = useState<Record<string, number>>({});
  const [markedQuestions, setMarkedQuestions] = useState<Set<string>>(new Set());
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [examActive, setExamActive] = useState(false);
  const examStartTimeRef = useRef<number>(0);
  const examEndTimeRef = useRef<number>(0);

  // PDF & AI State
  const [pdfFileName, setPdfFileName] = useState('');
  const [pdfExtractedText, setPdfExtractedText] = useState('');
  const [isExtractingText, setIsExtractingText] = useState(false);
  const [extractionError, setExtractionError] = useState('');
  const [pdfTargetQuestions, setPdfTargetQuestions] = useState(5);
  const [pdfDifficulty, setPdfDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>('Medium');
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [generatedDraftQuestions, setGeneratedDraftQuestions] = useState<Question[]>([]);
  const [generatedDraftTitle, setGeneratedDraftTitle] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => localStorage.getItem(GEMINI_KEY_STORAGE) || '');
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);

  // Sync Quizzes to localStorage
  const updateQuizzes = (newQuizzes: Quiz[]) => {
    setQuizzes(newQuizzes);
    try {
      localStorage.setItem(QUIZZES_KEY, JSON.stringify(newQuizzes));
    } catch (e) {
      console.error('Failed to sync quizzes to localStorage', e);
    }
  };

  // Sync Results to localStorage
  const updateResults = (newResults: ExamAttempt[]) => {
    setResults(newResults);
    try {
      localStorage.setItem(RESULTS_KEY, JSON.stringify(newResults));
    } catch (e) {
      console.error('Failed to sync results to localStorage', e);
    }
  };

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // ==========================================
  // EXAM ENGINE TIMING (DRIFT-RESISTANT)
  // ==========================================
  useEffect(() => {
    if (!examActive) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const diff = Math.max(0, Math.round((examEndTimeRef.current - now) / 1000));
      setRemainingSeconds(diff);

      if (diff <= 0) {
        clearInterval(timer);
        finishExam(true);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [examActive, activeExamQuiz, examAnswers]);

  const startExam = (quiz: Quiz) => {
    if (!quiz.questions || quiz.questions.length === 0) {
      showToast('Cannot start exam: This quiz has no questions.', 'error');
      return;
    }
    setActiveExamQuiz(quiz);
    setExamAnswers({});
    setMarkedQuestions(new Set());
    setCurrentQuestionIndex(0);
    const totalSecs = Math.max(1, quiz.durationMinutes) * 60;
    setRemainingSeconds(totalSecs);
    examStartTimeRef.current = Date.now();
    examEndTimeRef.current = Date.now() + totalSecs * 1000;
    setExamActive(true);
    setActiveTab('exam');
  };

  const finishExam = (isAutoSubmit = false) => {
    if (!activeExamQuiz) return;

    const questions = activeExamQuiz.questions;
    let correctCount = 0;
    let answeredCount = 0;

    questions.forEach(q => {
      const chosen = examAnswers[q.id];
      if (chosen !== undefined) {
        answeredCount++;
        if (chosen === q.correctIndex) {
          correctCount++;
        }
      }
    });

    const scorePercentage = Math.round((correctCount / questions.length) * 100);
    const timeSpentSeconds = Math.max(1, Math.round((Date.now() - examStartTimeRef.current) / 1000));

    const attempt: ExamAttempt = {
      id: 'attempt_' + Date.now(),
      quizId: activeExamQuiz.id,
      quizTitle: activeExamQuiz.title,
      date: new Date().toLocaleString(),
      totalQuestions: questions.length,
      answeredCount,
      correctCount,
      scorePercentage,
      timeSpentSeconds,
      userAnswers: { ...examAnswers },
      questionsSnapshot: JSON.parse(JSON.stringify(questions))
    };

    const updated = [attempt, ...results];
    updateResults(updated);
    setExamActive(false);
    setSelectedAttemptForReview(attempt);
    setActiveTab('history');

    if (isAutoSubmit) {
      showToast('Time expired! Your exam was automatically submitted.', 'info');
    } else {
      showToast(`Exam submitted! Score: ${scorePercentage}% (${correctCount}/${questions.length})`, 'success');
    }
  };

  // ==========================================
  // REAL COMPUTED DASHBOARD METRICS
  // ==========================================
  const stats = useMemo(() => {
    const totalQuizzes = quizzes.length;
    const totalAttempts = results.length;
    const averageScore = totalAttempts > 0
      ? Math.round(results.reduce((acc, curr) => acc + curr.scorePercentage, 0) / totalAttempts)
      : 0;
    const questionsAnswered = results.reduce((acc, curr) => acc + curr.answeredCount, 0);

    return { totalQuizzes, totalAttempts, averageScore, questionsAnswered };
  }, [quizzes, results]);

  // ==========================================
  // CLIENT-SIDE PDF / TEXT EXTRACTION
  // ==========================================
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPdfFileName(file.name);
    setPdfExtractedText('');
    setExtractionError('');
    setIsExtractingText(true);

    try {
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        const text = await file.text();
        if (!text.trim()) throw new Error('The selected text file is completely empty.');
        setPdfExtractedText(text);
        setGeneratedDraftTitle(file.name.replace(/\.[^/.]+$/, '') + ' Quiz');
        showToast('Text file loaded successfully!', 'success');
      } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const buffer = await file.arrayBuffer();
        const extracted = parsePdfBuffer(buffer);

        if (!extracted || extracted.trim().length < 50) {
          throw new Error(
            'Scanned PDF detected: Unable to extract digital text streams. This document appears to be an image or scanned document. Please paste the text or study notes manually below.'
          );
        }

        setPdfExtractedText(extracted);
        setGeneratedDraftTitle(file.name.replace(/\.[^/.]+$/, '') + ' Quiz');
        showToast(`Extracted ${extracted.split(/\s+/).length} words from PDF.`, 'success');
      } else {
        throw new Error('Unsupported format. Please select a .pdf or .txt file.');
      }
    } catch (err: any) {
      setExtractionError(err.message || 'Error reading document.');
      showToast(err.message || 'Failed to read file.', 'error');
    } finally {
      setIsExtractingText(false);
    }
  };

  // Client-side text stream parser for PDF files
  function parsePdfBuffer(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.byteLength; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }

    let parsedText = '';
    const tjRegex = /\(([^)]+)\)\s*Tj/g;
    let match;
    while ((match = tjRegex.exec(binary)) !== null) {
      const cleaned = match[1].replace(/\\([()\\])/g, '$1');
      if (cleaned.length > 1) parsedText += cleaned + ' ';
    }

    const tjArrayRegex = /\[([^\]]+)\]\s*TJ/g;
    while ((match = tjArrayRegex.exec(binary)) !== null) {
      const inner = match[1];
      const innerParenRegex = /\(([^)]+)\)/g;
      let innerMatch;
      while ((innerMatch = innerParenRegex.exec(inner)) !== null) {
        parsedText += innerMatch[1].replace(/\\([()\\])/g, '$1') + ' ';
      }
      parsedText += '\n';
    }

    if (parsedText.trim().length < 40) {
      const asciiStrings = binary.match(/[\x20-\x7E]{5,}/g) || [];
      const filtered = asciiStrings.filter(s =>
        !s.startsWith('%PDF') &&
        !s.includes('/Root') &&
        !s.includes('obj') &&
        !s.includes('endobj') &&
        !s.includes('stream') &&
        !s.includes('xref')
      );
      parsedText = filtered.join(' ');
    }

    return parsedText.replace(/\s+/g, ' ').trim();
  }

  // ==========================================
  // AI MCQ GENERATOR (GEMINI & OFFLINE ENGINE)
  // ==========================================
  const handleGenerateQuestions = async () => {
    if (!pdfExtractedText.trim()) {
      showToast('Please provide text or upload a document first.', 'error');
      return;
    }

    setIsGeneratingQuiz(true);
    setGeneratedDraftQuestions([]);

    const cleanKey = geminiApiKey.trim();

    try {
      if (cleanKey) {
        // Direct call to Gemini 1.5 Flash endpoint
        const prompt = `You are an academic test maker. Based strictly on the following source material, generate exactly ${pdfTargetQuestions} multiple-choice questions at ${pdfDifficulty} difficulty.
Return ONLY valid JSON matching this exact structure:
[
  {
    "text": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0,
    "explanation": "Brief reasoning directly grounded in text."
  }
]
SOURCE MATERIAL:
${pdfExtractedText.slice(0, 9000)}`;

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(cleanKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2 }
            })
          }
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData?.error?.message || `Gemini API returned status ${response.status}`);
        }

        const data = await response.json();
        const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleanedJson = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanedJson);

        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error('Gemini did not return question records.');
        }

        const formatted: Question[] = parsed.map((item: any, idx: number) => ({
          id: 'gen_' + Date.now() + '_' + idx,
          text: item.text || `Question ${idx + 1}`,
          options: Array.isArray(item.options) && item.options.length === 4
            ? [String(item.options[0]), String(item.options[1]), String(item.options[2]), String(item.options[3])]
            : ['Choice A', 'Choice B', 'Choice C', 'Choice D'],
          correctIndex: typeof item.correctIndex === 'number' && item.correctIndex >= 0 && item.correctIndex <= 3
            ? item.correctIndex
            : 0,
          explanation: item.explanation || 'Directly grounded in the uploaded material.'
        }));

        setGeneratedDraftQuestions(formatted);
        showToast(`Generated ${formatted.length} questions via Gemini 1.5 Flash!`, 'success');
      } else {
        // Offline heuristic question synthesis
        const generated = buildHeuristicQuestions(pdfExtractedText, pdfTargetQuestions);
        setGeneratedDraftQuestions(generated);
        showToast(`Generated ${generated.length} questions using in-browser heuristic engine.`, 'info');
      }
    } catch (err: any) {
      console.warn('AI Generation warning, using offline fallback:', err);
      showToast(err.message || 'Generation issue. Falling back to local synthesizer.', 'error');
      const fallback = buildHeuristicQuestions(pdfExtractedText, pdfTargetQuestions);
      setGeneratedDraftQuestions(fallback);
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  function buildHeuristicQuestions(text: string, count: number): Question[] {
    const rawSentences = text
      .split(/(?<=[.?!])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 40 && s.length < 220 && !s.includes('http'));

    const sentences = Array.from(new Set(rawSentences));
    const targetCount = Math.min(count, Math.max(3, sentences.length));
    const generated: Question[] = [];

    const words = text
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 5 && !['because', 'should', 'between', 'through', 'before', 'without'].includes(w.toLowerCase()));
    const uniquePool = Array.from(new Set(words));

    for (let i = 0; i < targetCount; i++) {
      const sentence = sentences[i % sentences.length];
      const sentenceWords = sentence.split(' ').filter(w => w.length > 4);
      const targetWord = sentenceWords[Math.floor(sentenceWords.length / 2)] || 'concept';
      const cleanTarget = targetWord.replace(/[^a-zA-Z0-9]/g, '');

      const distractors = uniquePool
        .filter(k => k.toLowerCase() !== cleanTarget.toLowerCase())
        .slice(i * 3, i * 3 + 3);

      while (distractors.length < 3) {
        distractors.push(`Factor ${distractors.length + 1}`);
      }

      const options: [string, string, string, string] = [
        cleanTarget,
        distractors[0] || 'Alternative Parameter',
        distractors[1] || 'Secondary Element',
        distractors[2] || 'Null Hypothesis'
      ];

      // Deterministic shuffle
      const correctText = cleanTarget;
      options.sort(() => 0.5 - Math.random());
      const correctIndex = options.indexOf(correctText);

      const blankedSentence = sentence.replace(new RegExp(`\\b${cleanTarget}\\b`, 'i'), '__________');

      generated.push({
        id: 'heuristic_' + Date.now() + '_' + i,
        text: `Based on the source text, fill in the blank: "${blankedSentence}"`,
        options: [options[0], options[1], options[2], options[3]],
        correctIndex: correctIndex >= 0 ? correctIndex : 0,
        explanation: `Original proposition: "${sentence}"`
      });
    }

    return generated;
  }

  // Backup / Export Quizzes as JSON
  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(quizzes, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `QuizCraft_Quizzes_Backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Quiz library exported to JSON successfully!', 'success');
  };

  // Import Quizzes JSON
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) throw new Error('Invalid JSON format: expected array.');
        updateQuizzes([...parsed, ...quizzes]);
        showToast(`Imported ${parsed.length} quizzes into your library!`, 'success');
      } catch (err: any) {
        showToast('Failed to import JSON file. Please ensure it is valid QuizCraft data.', 'error');
      }
    };
    reader.readAsText(file);
  };

  // ==========================================
  // RENDER MAIN APPLICATION UI
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* GLOBAL TOAST NOTIFICATION */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 transition-all transform ease-out duration-300">
          <div
            className={`px-4 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 border ${
              notification.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                : notification.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-300'
                : 'bg-indigo-50 text-indigo-800 border-indigo-300'
            }`}
          >
            <span>{notification.message}</span>
            <button onClick={() => setNotification(null)} className="ml-2 font-bold opacity-60 hover:opacity-100">
              ×
            </button>
          </div>
        </div>
      )}

      {/* TOP HEADER & NAVBAR */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => setActiveTab('dashboard')}
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white font-extrabold text-lg shadow-md shadow-indigo-100">
                QC
              </div>
              <div>
                <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-950 to-indigo-700 bg-clip-text text-transparent">
                  QuizCraft AI
                </span>
                <span className="hidden sm:inline-block ml-2 text-[11px] font-semibold px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">
                  Exam Simulator
                </span>
              </div>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex space-x-1">
              {[
                { id: 'dashboard', label: 'Dashboard' },
                { id: 'quizzes', label: 'My Quizzes' },
                { id: 'create', label: 'Create Quiz' },
                { id: 'pdf-quiz', label: 'PDF-to-Quiz (AI)' },
                { id: 'history', label: 'Results History' },
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'create') setEditingQuiz(null);
                    setActiveTab(item.id as TabType);
                  }}
                  className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === item.id
                      ? 'bg-indigo-50 text-indigo-700 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            {/* API Key Modal Button & Mobile Hamburger */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowApiKeyModal(true)}
                className="text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 font-medium flex items-center gap-1.5"
              >
                <span>{geminiApiKey ? '🔑 Key Active' : '⚙️ Setup Key'}</span>
              </button>

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 pt-2 pb-3 space-y-1 shadow-lg">
            {[
              { id: 'dashboard', label: 'Dashboard' },
              { id: 'quizzes', label: 'My Quizzes' },
              { id: 'create', label: 'Create Quiz' },
              { id: 'pdf-quiz', label: 'PDF-to-Quiz (AI)' },
              { id: 'history', label: 'Results History' },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'create') setEditingQuiz(null);
                  setActiveTab(item.id as TabType);
                  setMobileMenuOpen(false);
                }}
                className={`block w-full text-left px-3 py-2 rounded-md text-base font-medium ${
                  activeTab === item.id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* API KEY CONFIGURATION MODAL */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-900">Gemini API Key Settings</h3>
              <button onClick={() => setShowApiKeyModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Your API key is never committed to GitHub or sent to any intermediate server. It is saved directly to your browser's local storage and used only to communicate directly with Google's Generative AI endpoint.
            </p>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Google Gemini API Key</label>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={geminiApiKey}
                onChange={e => {
                  setGeminiApiKey(e.target.value);
                  localStorage.setItem(GEMINI_KEY_STORAGE, e.target.value);
                }}
                className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono"
              />
            </div>
            <div className="flex justify-between items-center pt-2">
              {geminiApiKey ? (
                <button
                  onClick={() => {
                    setGeminiApiKey('');
                    localStorage.removeItem(GEMINI_KEY_STORAGE);
                    showToast('API key removed from local storage.', 'info');
                  }}
                  className="text-xs text-rose-600 hover:text-rose-800 font-medium"
                >
                  Remove Key
                </button>
              ) : (
                <div />
              )}
              <button
                onClick={() => {
                  setShowApiKeyModal(false);
                  showToast('Key settings saved.', 'success');
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold"
              >
                Close & Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTAINER CONTENT */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ========================================================= */}
        {/* TAB 1: DASHBOARD */}
        {/* ========================================================= */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            {/* Academic Hero Card */}
            <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 rounded-2xl p-6 sm:p-8 text-white shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="space-y-2 max-w-xl">
                <span className="inline-block px-3 py-1 bg-indigo-500/30 text-indigo-200 text-xs font-semibold rounded-full uppercase tracking-wider">
                  Verified Academic Simulator
                </span>
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight">QuizCraft AI</h1>
                <p className="text-indigo-200 text-sm sm:text-base leading-relaxed">
                  Turn syllabus notes and PDFs into exam-grade question banks. Practice in a timed simulation and review your answer rationales.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => setActiveTab('pdf-quiz')}
                  className="px-4 py-2.5 bg-amber-400 text-amber-950 hover:bg-amber-300 font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center gap-1.5"
                >
                  ⚡ Convert PDF to Quiz
                </button>
                <button
                  onClick={() => {
                    setEditingQuiz(null);
                    setActiveTab('create');
                  }}
                  className="px-4 py-2.5 bg-white text-indigo-900 hover:bg-indigo-50 font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all"
                >
                  + Create New Quiz
                </button>
              </div>
            </div>

            {/* LIVE VERIFIED METRICS CARDS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Quizzes Stored</p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-3xl font-black text-slate-900">{stats.totalQuizzes}</span>
                  <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">Active</span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Exams Completed</p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-3xl font-black text-slate-900">{stats.totalAttempts}</span>
                  <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">Recorded</span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Average Score</p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-3xl font-black text-slate-900">
                    {stats.totalAttempts > 0 ? `${stats.averageScore}%` : 'N/A'}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    {stats.totalAttempts > 0 ? 'Across all tests' : 'No data yet'}
                  </span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Questions Answered</p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-3xl font-black text-slate-900">{stats.questionsAnswered}</span>
                  <span className="text-xs font-medium text-slate-500">Items attempted</span>
                </div>
              </div>
            </div>

            {/* Quick Practice & Recent Attempts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-base font-bold text-slate-900">Ready to Practice</h2>
                  <button onClick={() => setActiveTab('quizzes')} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">
                    All Quizzes ({quizzes.length}) →
                  </button>
                </div>

                {quizzes.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-slate-200 rounded-xl">
                    <p className="text-slate-500 text-sm">No quizzes found.</p>
                    <button
                      onClick={() => updateQuizzes([DEFAULT_SAMPLE_QUIZ])}
                      className="mt-3 px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 font-bold rounded-lg"
                    >
                      Load Sample Quiz
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {quizzes.slice(0, 3).map(quiz => (
                      <div key={quiz.id} className="py-3.5 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                        <div>
                          <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                            {quiz.subject || 'General'}
                          </span>
                          <h3 className="font-semibold text-slate-900 text-sm mt-1">{quiz.title}</h3>
                          <p className="text-xs text-slate-500">
                            {quiz.questions.length} questions • {quiz.durationMinutes} min timer
                          </p>
                        </div>
                        <button
                          onClick={() => startExam(quiz)}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs self-start sm:self-center"
                        >
                          Start Exam
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-base font-bold text-slate-900">Recent Exam Scores</h2>
                  <button onClick={() => setActiveTab('history')} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">
                    History →
                  </button>
                </div>

                {results.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                    <p className="text-xs text-slate-500">No attempts logged yet.</p>
                    <p className="text-[11px] text-slate-400 mt-1">Take a quiz to see your score trajectory here.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 flex-1">
                    {results.slice(0, 4).map(attempt => (
                      <div
                        key={attempt.id}
                        onClick={() => {
                          setSelectedAttemptForReview(attempt);
                          setActiveTab('history');
                        }}
                        className="p-3 bg-slate-50 hover:bg-slate-100 cursor-pointer rounded-lg border border-slate-200 transition-colors flex justify-between items-center"
                      >
                        <div className="truncate pr-2">
                          <p className="text-xs font-bold text-slate-800 truncate">{attempt.quizTitle}</p>
                          <p className="text-[10px] text-slate-500">{attempt.date.split(',')[0]}</p>
                        </div>
                        <div className="text-right">
                          <span
                            className={`text-xs font-extrabold ${
                              attempt.scorePercentage >= 70 ? 'text-emerald-600' : 'text-amber-600'
                            }`}
                          >
                            {attempt.scorePercentage}%
                          </span>
                          <p className="text-[10px] text-slate-400">
                            {attempt.correctCount}/{attempt.totalQuestions}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: MY QUIZZES */}
        {/* ========================================================= */}
        {activeTab === 'quizzes' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Quiz Library</h1>
                <p className="text-sm text-slate-500">Manage, edit, export, or launch practice exams.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg cursor-pointer">
                  📥 Import JSON
                  <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
                </label>
                <button
                  onClick={handleExportJSON}
                  className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg"
                >
                  📤 Export JSON
                </button>
                <button
                  onClick={() => {
                    setEditingQuiz(null);
                    setActiveTab('create');
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs"
                >
                  + New Quiz
                </button>
              </div>
            </div>

            {quizzes.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <h3 className="text-base font-bold text-slate-800">No Quizzes in Library</h3>
                <p className="text-xs text-slate-500 mt-1">Create one manually or generate from a PDF.</p>
                <button
                  onClick={() => updateQuizzes([DEFAULT_SAMPLE_QUIZ])}
                  className="mt-4 px-4 py-2 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-lg"
                >
                  Restore Sample Quiz
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {quizzes.map(quiz => (
                  <div
                    key={quiz.id}
                    className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                          {quiz.subject || 'General'}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {new Date(quiz.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mt-2 line-clamp-1">{quiz.title}</h3>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                        {quiz.description || 'No description provided.'}
                      </p>

                      <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs text-slate-600 font-medium">
                        <div>{quiz.questions.length} Questions</div>
                        <div>{quiz.durationMinutes} Minutes Limit</div>
                      </div>
                    </div>

                    <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingQuiz(quiz);
                            setActiveTab('create');
                          }}
                          className="px-2.5 py-1 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete "${quiz.title}"?`)) {
                              updateQuizzes(quizzes.filter(q => q.id !== quiz.id));
                              showToast(`Deleted "${quiz.title}".`, 'info');
                            }
                          }}
                          className="px-2.5 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded"
                        >
                          Delete
                        </button>
                      </div>

                      <button
                        onClick={() => startExam(quiz)}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs"
                      >
                        Start Exam
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: CREATE / EDIT QUIZ FORM */}
        {/* ========================================================= */}
        {activeTab === 'create' && (
          <QuizEditorForm
            initialQuiz={editingQuiz}
            onSave={(quiz) => {
              if (editingQuiz) {
                updateQuizzes(quizzes.map(q => q.id === quiz.id ? quiz : q));
                showToast(`Updated "${quiz.title}".`, 'success');
              } else {
                updateQuizzes([quiz, ...quizzes]);
                showToast(`Created "${quiz.title}".`, 'success');
              }
              setEditingQuiz(null);
              setActiveTab('quizzes');
            }}
            onCancel={() => {
              setEditingQuiz(null);
              setActiveTab('quizzes');
            }}
            onError={(msg) => showToast(msg, 'error')}
          />
        )}

        {/* ========================================================= */}
        {/* TAB 4: PRACTICE EXAM ENGINE */}
        {/* ========================================================= */}
        {activeTab === 'exam' && (
          <ExamSimulatorEngine
            quiz={activeExamQuiz}
            currentQuestionIndex={currentQuestionIndex}
            examAnswers={examAnswers}
            markedQuestions={markedQuestions}
            remainingSeconds={remainingSeconds}
            onSelectAnswer={(qid, optIdx) => setExamAnswers(prev => ({ ...prev, [qid]: optIdx }))}
            onClearAnswer={(qid) => {
              setExamAnswers(prev => {
                const next = { ...prev };
                delete next[qid];
                return next;
              });
            }}
            onToggleMark={(qid) => {
              setMarkedQuestions(prev => {
                const next = new Set(prev);
                if (next.has(qid)) next.delete(qid);
                else next.add(qid);
                return next;
              });
            }}
            onJumpQuestion={setCurrentQuestionIndex}
            onFinish={() => {
              if (window.confirm('Are you ready to submit your exam for grading?')) {
                finishExam(false);
              }
            }}
            onExit={() => {
              if (window.confirm('Exit exam? Progress will be lost.')) {
                setExamActive(false);
                setActiveTab('quizzes');
              }
            }}
          />
        )}

        {/* ========================================================= */}
        {/* TAB 5: RESULTS & HISTORY */}
        {/* ========================================================= */}
        {activeTab === 'history' && (
          <ResultsHistoryView
            results={results}
            selectedAttempt={selectedAttemptForReview}
            onSelectAttempt={setSelectedAttemptForReview}
            onRetakeExam={(quizId) => {
              const quiz = quizzes.find(q => q.id === quizId);
              if (quiz) startExam(quiz);
              else showToast('Original quiz not found.', 'error');
            }}
            onClearHistory={() => {
              if (window.confirm('Clear all exam history records?')) {
                updateResults([]);
                setSelectedAttemptForReview(null);
                showToast('Exam history cleared.', 'info');
              }
            }}
          />
        )}

        {/* ========================================================= */}
        {/* TAB 6: PDF-TO-QUIZ (AI & HEURISTIC) */}
        {/* ========================================================= */}
        {activeTab === 'pdf-quiz' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">PDF-to-Quiz AI Generator</h1>
              <p className="text-sm text-slate-500">
                Ground MCQs in your lecture notes or syllabus documents.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
                  <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">1. Document Input</h2>

                  <label className="border-2 border-dashed border-slate-300 hover:border-indigo-500 bg-slate-50 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors text-center">
                    <span className="text-sm font-bold text-slate-700">Choose PDF or TXT File</span>
                    <span className="text-xs text-slate-400 mt-1">Client-side document parsing</span>
                    <input type="file" accept=".pdf,.txt" onChange={handleFileUpload} className="hidden" />
                  </label>

                  {pdfFileName && (
                    <div className="p-2.5 bg-indigo-50 border border-indigo-100 rounded-lg text-xs font-semibold text-indigo-900 flex justify-between">
                      <span className="truncate">📄 {pdfFileName}</span>
                      <span className="text-emerald-700">Ready</span>
                    </div>
                  )}

                  {extractionError && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 leading-relaxed">
                      <strong>Document Note:</strong> {extractionError}
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-semibold text-slate-700">Extracted / Study Text:</label>
                      <span className="text-[11px] text-slate-400">
                        {pdfExtractedText.split(/\s+/).filter(Boolean).length} words
                      </span>
                    </div>
                    <textarea
                      rows={5}
                      value={pdfExtractedText}
                      onChange={e => setPdfExtractedText(e.target.value)}
                      placeholder="Extracted text appears here. You may also paste notes or syllabus text directly..."
                      className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono bg-slate-50"
                    />
                  </div>

                  <div className="pt-2 border-t border-slate-100 space-y-3">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">2. Generation Parameters</h2>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-slate-700 block mb-1">Question Count</label>
                        <select
                          value={pdfTargetQuestions}
                          onChange={e => setPdfTargetQuestions(Number(e.target.value))}
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white"
                        >
                          <option value={3}>3 Questions</option>
                          <option value={5}>5 Questions</option>
                          <option value={8}>8 Questions</option>
                          <option value={10}>10 Questions</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-medium text-slate-700 block mb-1">Difficulty</label>
                        <select
                          value={pdfDifficulty}
                          onChange={e => setPdfDifficulty(e.target.value as any)}
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white"
                        >
                          <option value="Easy">Easy (Recall)</option>
                          <option value="Medium">Medium (Application)</option>
                          <option value="Hard">Hard (Analysis)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700 block mb-1">Quiz Title</label>
                      <input
                        type="text"
                        value={generatedDraftTitle}
                        onChange={e => setGeneratedDraftTitle(e.target.value)}
                        placeholder="e.g. Chapter 1 Assessment"
                        className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white"
                      />
                    </div>

                    <button
                      disabled={isGeneratingQuiz || isExtractingText || !pdfExtractedText.trim()}
                      onClick={handleGenerateQuestions}
                      className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isGeneratingQuiz ? 'Synthesizing Questions...' : 'Generate Questions'}
                    </button>
                    {!geminiApiKey && (
                      <p className="text-[11px] text-slate-500 text-center">
                        Offline heuristic engine active. Enter a Gemini Key in top bar for deep generative AI.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Generated Review Area */}
              <div className="lg:col-span-7 space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Generated Questions Review</h2>
                      <p className="text-xs text-slate-500">
                        {generatedDraftQuestions.length > 0
                          ? `Review all ${generatedDraftQuestions.length} questions before committing to your library.`
                          : 'No questions generated yet.'}
                      </p>
                    </div>

                    {generatedDraftQuestions.length > 0 && (
                      <button
                        onClick={() => {
                          const newQuiz: Quiz = {
                            id: 'quiz_' + Date.now(),
                            title: generatedDraftTitle.trim() || 'AI Generated Quiz',
                            subject: 'Document Study',
                            description: `Generated from ${pdfFileName || 'notes'} with ${generatedDraftQuestions.length} items.`,
                            durationMinutes: Math.max(5, Math.round(generatedDraftQuestions.length * 1.5)),
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            questions: generatedDraftQuestions
                          };
                          updateQuizzes([newQuiz, ...quizzes]);
                          showToast(`Quiz "${newQuiz.title}" saved to library!`, 'success');
                          setActiveTab('quizzes');
                        }}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
                      >
                        ✓ Save to Library
                      </button>
                    )}
                  </div>

                  {generatedDraftQuestions.length === 0 ? (
                    <div className="text-center py-16 border border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                      No questions generated yet. Choose a file or paste study notes to start.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {generatedDraftQuestions.map((q, idx) => (
                        <div key={q.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                          <div className="flex justify-between items-start">
                            <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                              Item #{idx + 1}
                            </span>
                            <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                              Correct: {['A', 'B', 'C', 'D'][q.correctIndex]}
                            </span>
                          </div>

                          <p className="text-sm font-semibold text-slate-800">{q.text}</p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            {q.options.map((opt, optIdx) => (
                              <div
                                key={optIdx}
                                className={`p-2.5 rounded-lg border ${
                                  optIdx === q.correctIndex
                                    ? 'bg-emerald-50 border-emerald-300 font-bold text-emerald-950'
                                    : 'bg-white border-slate-200 text-slate-700'
                                }`}
                              >
                                <span className="text-slate-400 mr-1.5">{['A', 'B', 'C', 'D'][optIdx]}:</span>
                                <span>{opt}</span>
                              </div>
                            ))}
                          </div>

                          {q.explanation && (
                            <p className="text-[11px] text-slate-500 bg-white p-2 rounded border border-slate-100">
                              <strong>Grounding Rationale: </strong>
                              {q.explanation}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-12 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4">
          <p>QuizCraft AI — Academic Examination & Grounded Assessment Simulator</p>
          <p className="mt-1 text-[11px] text-slate-400">Strict localStorage persistence • In-browser text extractor • No external database</p>
        </div>
      </footer>
    </div>
  );
}

// ==========================================
// SUBCOMPONENT: QUIZ FORM (CREATE / EDIT)
// ==========================================
function QuizEditorForm({
  initialQuiz,
  onSave,
  onCancel,
  onError
}: {
  initialQuiz: Quiz | null;
  onSave: (quiz: Quiz) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState(initialQuiz?.title || '');
  const [subject, setSubject] = useState(initialQuiz?.subject || '');
  const [description, setDescription] = useState(initialQuiz?.description || '');
  const [durationMinutes, setDurationMinutes] = useState(initialQuiz?.durationMinutes || 15);
  const [questions, setQuestions] = useState<Question[]>(
    initialQuiz?.questions || [
      {
        id: 'q_' + Date.now(),
        text: '',
        options: ['', '', '', ''],
        correctIndex: 0,
        explanation: ''
      }
    ]
  );

  const addQuestion = () => {
    setQuestions([
      ...questions,
      {
        id: 'q_' + Date.now() + '_' + questions.length,
        text: '',
        options: ['', '', '', ''],
        correctIndex: 0,
        explanation: ''
      }
    ]);
  };

  const removeQuestion = (idx: number) => {
    if (questions.length <= 1) {
      onError('Quiz must have at least one question.');
      return;
    }
    setQuestions(questions.filter((_, i) => i !== idx));
  };

  const updateQuestionOption = (qIdx: number, optIdx: number, val: string) => {
    setQuestions(
      questions.map((q, i) => {
        if (i !== qIdx) return q;
        const newOpts = [...q.options] as [string, string, string, string];
        newOpts[optIdx] = val;
        return { ...q, options: newOpts };
      })
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      onError('Quiz title is required.');
      return;
    }
    for (let i = 0; i < questions.length; i++) {
      if (!questions[i].text.trim()) {
        onError(`Question #${i + 1} text is empty.`);
        return;
      }
      for (let o = 0; o < 4; o++) {
        if (!questions[i].options[o].trim()) {
          onError(`Question #${i + 1} Option ${['A', 'B', 'C', 'D'][o]} cannot be empty.`);
          return;
        }
      }
    }

    onSave({
      id: initialQuiz ? initialQuiz.id : 'quiz_' + Date.now(),
      title,
      subject,
      description,
      durationMinutes: Number(durationMinutes) || 10,
      createdAt: initialQuiz ? initialQuiz.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{initialQuiz ? 'Edit Quiz' : 'Create New Quiz'}</h1>
          <p className="text-xs text-slate-500">Configure quiz metadata and MCQs.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-xs"
          >
            Save Quiz
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
        <h2 className="text-sm font-bold text-slate-900">Quiz Metadata</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Midterm Biology: Cell Structure"
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Biology"
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Description (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Overview of scope"
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Duration (Minutes)</label>
            <input
              type="number"
              min={1}
              max={180}
              required
              value={durationMinutes}
              onChange={e => setDurationMinutes(Number(e.target.value))}
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-bold text-slate-900">Questions ({questions.length})</h2>
          <button
            type="button"
            onClick={addQuestion}
            className="px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200"
          >
            + Add Question
          </button>
        </div>

        {questions.map((q, qIdx) => (
          <div key={q.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                Question #{qIdx + 1}
              </span>
              <button
                type="button"
                onClick={() => removeQuestion(qIdx)}
                className="text-xs text-rose-600 hover:text-rose-800 font-bold"
              >
                Delete
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Question Statement *</label>
              <textarea
                rows={2}
                required
                value={q.text}
                onChange={e => {
                  const val = e.target.value;
                  setQuestions(questions.map((item, i) => i === qIdx ? { ...item, text: val } : item));
                }}
                className="w-full text-xs p-2.5 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {([0, 1, 2, 3] as const).map(optIdx => (
                <div
                  key={optIdx}
                  className={`p-2.5 rounded-lg border flex items-center gap-2 ${
                    q.correctIndex === optIdx ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name={`correct_${q.id}`}
                    checked={q.correctIndex === optIdx}
                    onChange={() => {
                      setQuestions(questions.map((item, i) => i === qIdx ? { ...item, correctIndex: optIdx } : item));
                    }}
                    className="w-4 h-4 text-emerald-600"
                  />
                  <span className="font-bold text-xs text-slate-400">{['A', 'B', 'C', 'D'][optIdx]}:</span>
                  <input
                    type="text"
                    required
                    value={q.options[optIdx]}
                    onChange={e => updateQuestionOption(qIdx, optIdx, e.target.value)}
                    placeholder={`Option ${['A', 'B', 'C', 'D'][optIdx]}`}
                    className="w-full text-xs p-1.5 bg-white border border-slate-300 rounded"
                  />
                </div>
              ))}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Solution Explanation (Optional)</label>
              <input
                type="text"
                value={q.explanation || ''}
                onChange={e => {
                  const val = e.target.value;
                  setQuestions(questions.map((item, i) => i === qIdx ? { ...item, explanation: val } : item));
                }}
                placeholder="Grounding reasoning for students"
                className="w-full text-xs p-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-xs"
        >
          Save All Changes
        </button>
      </div>
    </form>
  );
}

// ==========================================
// SUBCOMPONENT: EXAM SIMULATOR
// ==========================================
function ExamSimulatorEngine({
  quiz,
  currentQuestionIndex,
  examAnswers,
  markedQuestions,
  remainingSeconds,
  onSelectAnswer,
  onClearAnswer,
  onToggleMark,
  onJumpQuestion,
  onFinish,
  onExit
}: {
  quiz: Quiz | null;
  currentQuestionIndex: number;
  examAnswers: Record<string, number>;
  markedQuestions: Set<string>;
  remainingSeconds: number;
  onSelectAnswer: (qid: string, idx: number) => void;
  onClearAnswer: (qid: string) => void;
  onToggleMark: (qid: string) => void;
  onJumpQuestion: (idx: number) => void;
  onFinish: () => void;
  onExit: () => void;
}) {
  if (!quiz) return null;

  const currentQ = quiz.questions[currentQuestionIndex];
  const isMarked = markedQuestions.has(currentQ.id);
  const selectedAnswer = examAnswers[currentQ.id];
  const answeredCount = Object.keys(examAnswers).length;

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Exam Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap justify-between items-center gap-4">
        <div>
          <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
            {quiz.subject || 'Exam Simulator'}
          </span>
          <h1 className="text-base font-bold text-slate-900 mt-1">{quiz.title}</h1>
          <p className="text-xs text-slate-500">
            Progress: {answeredCount} of {quiz.questions.length} answered
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div
            className={`px-3 py-1.5 rounded-lg border font-mono font-bold text-sm ${
              remainingSeconds <= 120
                ? 'bg-rose-50 text-rose-700 border-rose-300 animate-pulse'
                : 'bg-slate-50 text-slate-800 border-slate-200'
            }`}
          >
            ⏱ {formatTimer(remainingSeconds)}
          </div>
          <button
            onClick={onFinish}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs"
          >
            Submit Exam
          </button>
          <button onClick={onExit} className="text-xs font-bold text-slate-500 hover:text-slate-800">
            Exit
          </button>
        </div>
      </div>

      {/* Main Focus Area & Navigator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
          <div className="flex justify-between items-center pb-3 border-b border-slate-100">
            <span className="text-xs font-bold text-slate-500">
              Question {currentQuestionIndex + 1} of {quiz.questions.length}
            </span>
            <div className="flex gap-2">
              {selectedAnswer !== undefined && (
                <button
                  onClick={() => onClearAnswer(currentQ.id)}
                  className="text-xs text-slate-500 hover:text-slate-800 underline"
                >
                  Clear Choice
                </button>
              )}
              <button
                onClick={() => onToggleMark(currentQ.id)}
                className={`text-xs font-bold px-3 py-1 rounded-md border ${
                  isMarked ? 'bg-amber-50 text-amber-900 border-amber-300' : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                {isMarked ? '★ Marked' : '☆ Mark Review'}
              </button>
            </div>
          </div>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-relaxed">{currentQ.text}</h2>

          <div className="space-y-3">
            {currentQ.options.map((opt, idx) => {
              const isSelected = selectedAnswer === idx;
              return (
                <div
                  key={idx}
                  onClick={() => onSelectAnswer(currentQ.id, idx)}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-3 ${
                    isSelected ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                      isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {['A', 'B', 'C', 'D'][idx]}
                  </div>
                  <span className="text-xs sm:text-sm font-medium text-slate-800">{opt}</span>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
            <button
              disabled={currentQuestionIndex === 0}
              onClick={() => onJumpQuestion(currentQuestionIndex - 1)}
              className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-bold rounded-lg disabled:opacity-40"
            >
              ← Previous
            </button>

            {currentQuestionIndex < quiz.questions.length - 1 ? (
              <button
                onClick={() => onJumpQuestion(currentQuestionIndex + 1)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg"
              >
                Next →
              </button>
            ) : (
              <button
                onClick={onFinish}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
              >
                Submit Exam
              </button>
            )}
          </div>
        </div>

        {/* Navigator Palette */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">Question Palette</h3>
          <div className="grid grid-cols-5 gap-2">
            {quiz.questions.map((q, idx) => {
              const isCurrent = idx === currentQuestionIndex;
              const isAnswered = examAnswers[q.id] !== undefined;
              const isM = markedQuestions.has(q.id);

              let style = 'bg-slate-100 text-slate-700';
              if (isM) style = 'bg-amber-400 text-amber-950 font-bold';
              else if (isAnswered) style = 'bg-indigo-600 text-white font-bold';

              return (
                <button
                  key={q.id}
                  onClick={() => onJumpQuestion(idx)}
                  className={`h-9 rounded-lg text-xs font-bold flex items-center justify-center transition-all ${style} ${
                    isCurrent ? 'ring-2 ring-offset-1 ring-indigo-500' : ''
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
          <button
            onClick={onFinish}
            className="w-full mt-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs"
          >
            Finish Exam ({answeredCount}/{quiz.questions.length})
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SUBCOMPONENT: RESULTS HISTORY
// ==========================================
function ResultsHistoryView({
  results,
  selectedAttempt,
  onSelectAttempt,
  onRetakeExam,
  onClearHistory
}: {
  results: ExamAttempt[];
  selectedAttempt: ExamAttempt | null;
  onSelectAttempt: (attempt: ExamAttempt | null) => void;
  onRetakeExam: (quizId: string) => void;
  onClearHistory: () => void;
}) {
  const [filterMode, setFilterMode] = useState<'all' | 'incorrect'>('all');

  if (selectedAttempt) {
    const list = filterMode === 'incorrect'
      ? selectedAttempt.questionsSnapshot.filter(q => selectedAttempt.userAnswers[q.id] !== q.correctIndex)
      : selectedAttempt.questionsSnapshot;

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <button
              onClick={() => onSelectAttempt(null)}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 mb-1 block"
            >
              ← Back to All Attempts
            </button>
            <h1 className="text-xl font-bold text-slate-900">{selectedAttempt.quizTitle}</h1>
            <p className="text-xs text-slate-500">Attempted: {selectedAttempt.date}</p>
          </div>
          <button
            onClick={() => onRetakeExam(selectedAttempt.quizId)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold"
          >
            Retake Exam
          </button>
        </div>

        {/* Scorecard */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase">Score</p>
            <p className="text-3xl font-black text-slate-900 mt-1">{selectedAttempt.scorePercentage}%</p>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase">Accuracy</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">
              {selectedAttempt.correctCount} / {selectedAttempt.totalQuestions}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase">Answered</p>
            <p className="text-2xl font-bold text-indigo-600 mt-1">
              {selectedAttempt.answeredCount} / {selectedAttempt.totalQuestions}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase">Time Spent</p>
            <p className="text-2xl font-bold text-slate-700 mt-1">
              {Math.floor(selectedAttempt.timeSpentSeconds / 60)}m {selectedAttempt.timeSpentSeconds % 60}s
            </p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              filterMode === 'all' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            All Questions ({selectedAttempt.questionsSnapshot.length})
          </button>
          <button
            onClick={() => setFilterMode('incorrect')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              filterMode === 'incorrect' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            Incorrect Only ({selectedAttempt.totalQuestions - selectedAttempt.correctCount})
          </button>
        </div>

        {/* Detailed Question Review List */}
        <div className="space-y-4">
          {list.map((q, idx) => {
            const chosen = selectedAttempt.userAnswers[q.id];
            const isCorrect = chosen === q.correctIndex;
            const wasOmitted = chosen === undefined;

            return (
              <div
                key={q.id}
                className={`p-5 rounded-xl border bg-white shadow-xs space-y-3 ${
                  isCorrect ? 'border-emerald-200' : wasOmitted ? 'border-slate-200' : 'border-rose-200'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-500">Question #{idx + 1}</span>
                  {isCorrect ? (
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                      ✓ Correct
                    </span>
                  ) : wasOmitted ? (
                    <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full">
                      Omitted
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full">
                      ✕ Incorrect
                    </span>
                  )}
                </div>

                <p className="text-sm font-semibold text-slate-900">{q.text}</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {q.options.map((opt, optIdx) => {
                    const isKey = optIdx === q.correctIndex;
                    const isUserPick = optIdx === chosen;

                    let style = 'bg-slate-50 border-slate-200 text-slate-700';
                    if (isKey) style = 'bg-emerald-50 border-emerald-400 font-bold text-emerald-950';
                    else if (isUserPick && !isCorrect) style = 'bg-rose-50 border-rose-300 text-rose-950 line-through';

                    return (
                      <div key={optIdx} className={`p-2.5 rounded-lg border flex items-center gap-2 ${style}`}>
                        <span className="text-slate-400 font-bold">{['A', 'B', 'C', 'D'][optIdx]}:</span>
                        <span className="flex-1">{opt}</span>
                        {isKey && <span className="text-emerald-700 font-bold text-[10px]">Key</span>}
                        {isUserPick && !isCorrect && (
                          <span className="text-rose-600 font-bold text-[10px]">Your pick</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {q.explanation && (
                  <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-100">
                    <strong>Explanation: </strong> {q.explanation}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Attempts Summary Table
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Exam Results History</h1>
          <p className="text-xs text-slate-500">Persistent history of submitted assessments.</p>
        </div>
        {results.length > 0 && (
          <button onClick={onClearHistory} className="text-xs font-bold text-rose-600 hover:text-rose-800">
            Clear History
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-xs text-slate-400">
          No attempts on record. Take a practice exam to track scores.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Quiz Title</th>
                <th className="px-6 py-3.5">Date</th>
                <th className="px-6 py-3.5">Score</th>
                <th className="px-6 py-3.5">Percentage</th>
                <th className="px-6 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map(item => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3.5 font-bold text-slate-900">{item.quizTitle}</td>
                  <td className="px-6 py-3.5 text-slate-500">{item.date}</td>
                  <td className="px-6 py-3.5 text-slate-700">
                    {item.correctCount} / {item.totalQuestions}
                  </td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`font-bold px-2 py-0.5 rounded text-xs ${
                        item.scorePercentage >= 70 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {item.scorePercentage}%
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <button
                      onClick={() => onSelectAttempt(item)}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
                    >
                      Review Breakdown →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}