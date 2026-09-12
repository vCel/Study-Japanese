import {
  type RouteConfig,
  index,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  route("words", "routes/words.tsx"),
  route("words/examples", "routes/examples.tsx"),
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
  route("rules/examples", "routes/rule-examples.tsx"),
  route("rules/new", "routes/rule-new.tsx"),
  route("rules/upload", "routes/rule-upload.tsx"),
  route("rules/:id", "routes/rule-detail.tsx"),
  route("rules/:id/edit", "routes/rule-edit.tsx"),
  route("study", "routes/study.tsx"),
  route("study/session", "routes/study-session.tsx"),
  route("settings", "routes/settings.tsx"),
  // Legacy URL — redirects to /words/examples.
  route("examples", "routes/examples-redirect.tsx"),
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
] satisfies RouteConfig;
