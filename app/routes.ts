import {
  type RouteConfig,
  index,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  route("words", "routes/words.tsx"),
  route("words/:id", "routes/word-detail.tsx"),
  route("words/:id/edit", "routes/word-edit.tsx"),
  route("phrases", "routes/phrases.tsx"),
  route("phrases/lists", "routes/phrases-lists.tsx"),
  route("phrases/new", "routes/phrases-new.tsx"),
  route("phrases/upload", "routes/phrases-upload.tsx"),
  route("lists/:id", "routes/list-detail.tsx"),
  route("lists/:id/edit", "routes/list-edit.tsx"),
  route("lists/new", "routes/lists-new.tsx"),
  route("rules", "routes/rules.tsx"),
  route("rules/new", "routes/rule-new.tsx"),
  route("rules/upload", "routes/rule-upload.tsx"),
  route("rules/:id", "routes/rule-detail.tsx"),
  route("rules/:id/edit", "routes/rule-edit.tsx"),
  // Study: flashcards (deck builder + runner) and quizzes (setup + session).
  route("study/flashcards", "routes/study-flashcards.tsx"),
  route("study/flashcards/session", "routes/study-flashcards-session.tsx"),
  route("study/quizzes", "routes/study-quizzes.tsx"),
  route("study/quizzes/session", "routes/study-quizzes-session.tsx"),
  // Legacy URLs — the builder and runner moved under /study/flashcards.
  route("study", "routes/study-redirect.tsx"),
  route("study/session", "routes/study-session-redirect.tsx"),
  route("settings", "routes/settings.tsx"),
  route("upload", "routes/upload.tsx"),
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),
  // Auth token store (httpOnly cookies)
  route("api/auth-token", "routes/api.auth-token.ts"),
  // JSON API (restricted to registered users, rate limited)
  route("api", "routes/api.docs.ts"),
  route("api/lists", "routes/api.lists.ts"),
  route("api/words", "routes/api.words.ts"),
  route("api/words/:id", "routes/api.word.ts"),
  route("api/examples", "routes/api.examples.ts"),
  // AI quiz generation (signed-in users only, own rate limit).
  route("api/quiz/generate", "routes/api.quiz-generate.ts"),
  // Sign-in sync: move device-scoped content into the account.
  route("api/sync", "routes/api.sync.ts"),
] satisfies RouteConfig;
