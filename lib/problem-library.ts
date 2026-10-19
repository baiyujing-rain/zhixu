export type LibraryProblem = {
  id: string; site: 'cn' | 'com' | 'manual'; slug: string | null; question_id: string | null; frontend_id: string | null;
  title: string; content: string; difficulty: string; tags: string[]; code_snippets: Record<string, string>;
  example_testcases: string; sample_test_case: string; metadata: Record<string, unknown>; run_enabled: boolean;
  source_url: string | null; paid_only: boolean; pasted_content?: string; created_at?: string; updated_at?: string;
  accepted_at?: string | null; practice_count?: number;
};
export type ProblemCandidate = Pick<LibraryProblem, 'site' | 'slug' | 'frontend_id' | 'title' | 'difficulty'>;
export type JudgeJob = {
  id: string; session_id: number; mode: 'run' | 'submit'; language: 'cpp' | 'python'; code: string; input_data: string;
  problem: Pick<LibraryProblem, 'site' | 'slug' | 'question_id' | 'frontend_id' | 'title' | 'source_url'>;
  status: 'preparing' | 'pending' | 'done' | 'error' | 'unknown'; remote_id: string | null; result: Record<string, unknown>;
  error: string; created_at: string; finished_at: string | null;
};
